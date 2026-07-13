import Razorpay from 'razorpay';
import crypto from 'crypto';
import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { assertRazorpayXPayoutsEnabled } from '@shared/payments/outbound-payment.policy';
import {
  WalletTransactionType,
  DriverWalletReason,
  WithdrawalEntityType,
  WithdrawalStatus,
  PaymentMethod,
} from '@prisma/client';

const COMMISSION_RATE = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.20); // 20%
const COMMISSION_SOFT_ALERT = Number(process.env.COMMISSION_SOFT_ALERT_THRESHOLD ?? -500);
const COMMISSION_HARD_BLOCK  = Number(process.env.COMMISSION_HARD_BLOCK_THRESHOLD ?? -2000);
const MIN_WITHDRAWAL         = Number(process.env.MIN_WITHDRAWAL_AMOUNT ?? 50);
const INSTANT_WITHDRAWAL_FEE = Number(process.env.INSTANT_WITHDRAWAL_FEE ?? 5);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-create a DriverWallet if it doesn't exist yet.
 * Safe to call on every registration or first-wallet-access.
 */
export async function ensureDriverWallet(driverId: string) {
  return prisma.driverWallet.upsert({
    where: { driverId },
    create: { driverId },
    update: {},
  });
}

/**
 * Atomic wallet credit. Never throws on success — used internally after trip completion.
 */
async function creditDriverWallet(
  tx: any,
  driverId: string,
  amount: number,
  reason: DriverWalletReason,
  opts: { bookingId?: string; referenceId?: string; note?: string } = {}
) {
  const wallet = await tx.driverWallet.upsert({
    where: { driverId },
    create: { driverId, cachedBalance: amount },
    update: { cachedBalance: { increment: amount } },
  });

  const fresh = await tx.driverWallet.findUnique({ where: { driverId } });

  await tx.driverWalletTransaction.create({
    data: {
      walletId: wallet.id ?? fresh!.id,
      type: WalletTransactionType.CREDIT,
      reason,
      amount,
      balanceAfter: fresh!.cachedBalance,
      bookingId: opts.bookingId,
      referenceId: opts.referenceId,
      note: opts.note,
    },
  });

  return fresh!;
}

/**
 * Atomic wallet debit. balance CAN go negative for cash commission.
 */
async function debitDriverWallet(
  tx: any,
  driverId: string,
  amount: number,
  reason: DriverWalletReason,
  opts: { bookingId?: string; referenceId?: string; note?: string } = {}
) {
  const wallet = await tx.driverWallet.upsert({
    where: { driverId },
    create: { driverId, cachedBalance: -amount },
    update: { cachedBalance: { decrement: amount } },
  });

  const fresh = await tx.driverWallet.findUnique({ where: { driverId } });

  await tx.driverWalletTransaction.create({
    data: {
      walletId: wallet.id ?? fresh!.id,
      type: WalletTransactionType.DEBIT,
      reason,
      amount,
      balanceAfter: fresh!.cachedBalance,
      bookingId: opts.bookingId,
      referenceId: opts.referenceId,
      note: opts.note,
    },
  });

  return fresh!;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIP COMPLETION — called from booking.service.ts completeBooking()
// ─────────────────────────────────────────────────────────────────────────────

export interface TripSettlementInput {
  bookingId:     string;
  driverId:      string;
  grossAmount:   number;   // grandTotal paid by customer
  paymentMethod: PaymentMethod;
  fleetOwnerId?: string;   // If this is a fleet trip
}

export async function settleTripEarnings(input: TripSettlementInput) {
  const { bookingId, driverId, grossAmount, paymentMethod, fleetOwnerId } = input;

  const commission  = Math.round(grossAmount * COMMISSION_RATE * 100) / 100;
  const driverNet   = Math.round((grossAmount - commission) * 100) / 100;
  const isCash      = paymentMethod === PaymentMethod.CASH;

  return prisma.$transaction(async (tx) => {
    // 1. Always create the DriverEarning audit record
    await tx.driverEarning.upsert({
      where: { bookingId },
      create: { driverId, bookingId, grossAmount, commission, netAmount: driverNet },
      update: {},  // idempotent — never overwrite
    });

    if (isCash) {
      // 2a. CASH TRIP: Deduct commission from driver wallet (may go negative)
      const wallet = await debitDriverWallet(
        tx, driverId, commission, DriverWalletReason.COMMISSION_DEDUCTED,
        { bookingId, note: `Cash trip commission — Booking ${bookingId.substring(0, 8)}` }
      );

      // Track running commission debt
      await tx.driverWallet.update({
        where: { driverId },
        data: { commissionDue: { increment: commission } },
      });

      logger.info(`[DriverWallet] Cash commission deducted: ₹${commission} from driver ${driverId}. Balance: ${wallet.cachedBalance}`);

      return { type: 'CASH', commission, driverNet, walletBalance: wallet.cachedBalance };
    } else {
      // 2b. ONLINE TRIP: Credit net earnings to driver wallet
      const wallet = await creditDriverWallet(
        tx, driverId, driverNet, DriverWalletReason.TRIP_EARNING,
        { bookingId, note: `Online trip earnings — Booking ${bookingId.substring(0, 8)}` }
      );

      // If driver had outstanding commission debt, auto-offset from this earning
      const freshWallet = await tx.driverWallet.findUnique({ where: { driverId } });
      if (freshWallet && freshWallet.commissionDue > 0) {
        const offset = Math.min(freshWallet.commissionDue, driverNet);
        await tx.driverWallet.update({
          where: { driverId },
          data: { commissionDue: { decrement: offset } },
        });
        logger.info(`[DriverWallet] Auto-offset ₹${offset} of commission debt for driver ${driverId}`);
      }

      // 3. Fleet split (if fleet trip)
      if (fleetOwnerId) {
        const fleetNet = driverNet; // Fleet owner gets the driver's portion (they pay driver separately)
        await tx.fleetWallet.upsert({
          where: { fleetOwnerId },
          create: { fleetOwnerId, cachedBalance: fleetNet },
          update: { cachedBalance: { increment: fleetNet } },
        });
        const freshFleetWallet = await tx.fleetWallet.findUnique({ where: { fleetOwnerId } });
        await tx.fleetWalletTransaction.create({
          data: {
            walletId: freshFleetWallet!.id,
            type: WalletTransactionType.CREDIT,
            amount: fleetNet,
            balanceAfter: freshFleetWallet!.cachedBalance,
            referenceId: bookingId,
            note: `Fleet trip earnings — Booking ${bookingId.substring(0, 8)}`,
          },
        });

        await tx.fleetEarning.upsert({
          where: { bookingId },
          create: { fleetOwnerId, bookingId, grossAmount, driverPayout: driverNet, netAmount: fleetNet },
          update: {},
        });
      }

      logger.info(`[DriverWallet] Online trip credited: ₹${driverNet} to driver ${driverId}. Balance: ${wallet.cachedBalance}`);
      return { type: 'ONLINE', commission, driverNet, walletBalance: wallet.cachedBalance };
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMISSION PAYMENT — Driver pays outstanding commission online
// ─────────────────────────────────────────────────────────────────────────────

export async function createCommissionPaymentOrder(driverId: string) {
  const wallet = await prisma.driverWallet.findUnique({ where: { driverId } });
  if (!wallet) throw AppError.notFound('Driver wallet not found');

  if (wallet.commissionDue <= 0) {
    throw AppError.badRequest('No outstanding commission to pay', 'NO_COMMISSION_DUE');
  }

  const amountPaise = Math.round(wallet.commissionDue * 100);

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `comm_${driverId.substring(0, 8)}_${Date.now()}`,
    notes: {
      purpose: 'commission_payment',
      driverId,
    },
  });

  return {
    orderId: order.id,
    amount: amountPaise,
    currency: 'INR',
    commissionDue: wallet.commissionDue,
    keyId: process.env.RAZORPAY_KEY_ID,
  };
}

export async function verifyCommissionPayment(
  driverId: string,
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string
) {
  // 1. Verify HMAC signature
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    throw AppError.unauthorized('Invalid payment signature');
  }

  // 2. Idempotency — prevent double credit
  const existing = await prisma.driverWalletTransaction.findFirst({
    where: { referenceId: razorpay_payment_id },
  });
  if (existing) return prisma.driverWallet.findUnique({ where: { driverId } });

  // 3. Fetch actual amount from Razorpay (never trust client)
  const payment = await razorpay.payments.fetch(razorpay_payment_id) as any;
  const amountPaid = payment.amount / 100; // Convert paise to INR

  // 4. Atomic: credit wallet + clear commissionDue
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.driverWallet.findUnique({ where: { driverId } });
    if (!wallet) throw AppError.notFound('Driver wallet not found');

    const cleared = Math.min(amountPaid, wallet.commissionDue);

    await creditDriverWallet(tx, driverId, amountPaid, DriverWalletReason.COMMISSION_PAID, {
      referenceId: razorpay_payment_id,
      note: `Commission payment — Razorpay ${razorpay_payment_id}`,
    });

    const updatedWallet = await tx.driverWallet.update({
      where: { driverId },
      data: { commissionDue: { decrement: cleared } },
    });

    // Re-activate driver if they were blocked
    if (updatedWallet.cachedBalance >= 0) {
      await tx.driver.update({
        where: { id: driverId },
        data: { status: 'AVAILABLE' },
      });
    }

    logger.info(`[DriverWallet] Commission paid: ₹${amountPaid} by driver ${driverId}. New balance: ${updatedWallet.cachedBalance}`);
    return updatedWallet;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET WALLET & HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export async function getDriverWallet(driverId: string) {
  const wallet = await prisma.driverWallet.findUnique({
    where: { driverId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!wallet) return ensureDriverWallet(driverId);
  return wallet;
}

export async function getDriverTransactionHistory(
  driverId: string,
  page: number = 1,
  limit: number = 20
) {
  const wallet = await prisma.driverWallet.findUnique({ where: { driverId } });
  if (!wallet) return { transactions: [], total: 0, balance: 0, commissionDue: 0 };

  const [transactions, total] = await Promise.all([
    prisma.driverWalletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.driverWalletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return { transactions, total, balance: wallet.cachedBalance, commissionDue: wallet.commissionDue };
}

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL REQUEST
// ─────────────────────────────────────────────────────────────────────────────

export async function requestWithdrawal(driverId: string, amount: number) {
  assertRazorpayXPayoutsEnabled();

  if (amount < MIN_WITHDRAWAL) {
    throw AppError.badRequest(`Minimum withdrawal is ₹${MIN_WITHDRAWAL}`, 'BELOW_MIN_WITHDRAWAL');
  }

  const [wallet, driver] = await Promise.all([
    prisma.driverWallet.findUnique({ where: { driverId } }),
    prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } }),
  ]);

  if (!wallet) throw AppError.notFound('Driver wallet not found');
  if (!driver) throw AppError.notFound('Driver not found');

  if (wallet.cachedBalance < amount) {
    throw AppError.badRequest(
      `Insufficient balance. Available: ₹${wallet.cachedBalance.toFixed(2)}`,
      'INSUFFICIENT_BALANCE'
    );
  }

  if (!driver.bankAccountNo || !driver.bankIfsc) {
    throw AppError.badRequest('Bank account details not configured. Please add your bank account first.', 'NO_BANK_ACCOUNT');
  }

  // Check for pending withdrawal
  const pending = await prisma.withdrawalRequest.findFirst({
    where: {
      entityType: WithdrawalEntityType.DRIVER,
      entityId: driverId,
      status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.AUTO_PROCESSING] },
    },
  });
  if (pending) {
    throw AppError.badRequest('You already have a withdrawal in progress. Please wait for it to complete.', 'WITHDRAWAL_IN_PROGRESS');
  }

  // Atomic: reserve funds + create request
  const withdrawalRequest = await prisma.$transaction(async (tx) => {
    // Reserve funds immediately (deduct from wallet)
    await debitDriverWallet(tx, driverId, amount, DriverWalletReason.WITHDRAWAL, {
      note: `Withdrawal request — ₹${amount}`,
    });

    return tx.withdrawalRequest.create({
      data: {
        entityType: WithdrawalEntityType.DRIVER,
        entityId: driverId,
        amount,
        bankAccountNo:         driver.bankAccountNo!,
        bankIfsc:              driver.bankIfsc!,
        bankName:              driver.bankName ?? 'Unknown',
        bankAccountHolderName: driver.bankAccountHolderName ?? driver.user.name ?? 'Driver',
        razorpayxContactId:    driver.razorpayxContactId,
        razorpayxFundAccountId: driver.razorpayxFundAccountId,
      },
    });
  });

  logger.info(`[Withdrawal] Request created: ₹${amount} for driver ${driverId} — ID: ${withdrawalRequest.id}`);

  // Trigger async RazorpayX payout (don't await — fire and forget)
  processWithdrawalViaRazorpayX(withdrawalRequest.id).catch((err) => {
    logger.error(`[Withdrawal] Auto-payout failed for ${withdrawalRequest.id}:`, err);
  });

  return withdrawalRequest;
}

// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAYX AUTOMATED PAYOUT
// ─────────────────────────────────────────────────────────────────────────────

export async function processWithdrawalViaRazorpayX(withdrawalRequestId: string) {
  // Defence in depth: direct/background callers must never bypass the pause.
  assertRazorpayXPayoutsEnabled();

  const withdrawal = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalRequestId },
  });

  if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) return;

  const razorpayxBaseUrl = 'https://api.razorpay.com/v1';
  const razorpayxAuth = Buffer.from(
    `${process.env.RAZORPAYX_KEY_ID}:${process.env.RAZORPAYX_KEY_SECRET}`
  ).toString('base64');

  const headers: Record<string, string> = {
    Authorization: `Basic ${razorpayxAuth}`,
    'Content-Type': 'application/json',
    'X-Payout-Idempotency': withdrawalRequestId, // Our ID = idempotency key
  };

  try {
    // Step 1: Get or create Contact
    let contactId = withdrawal.razorpayxContactId;
    if (!contactId) {
      const contactRes = await fetch(`${razorpayxBaseUrl}/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: withdrawal.bankAccountHolderName,
          type: 'employee',
          reference_id: withdrawal.entityId,
        }),
      });
      const contactData = await contactRes.json() as any;
      if (!contactRes.ok) throw new Error(`Contact create failed: ${JSON.stringify(contactData)}`);
      contactId = contactData.id;

      // Cache contact ID on Driver record for future payouts
      if (withdrawal.entityType === WithdrawalEntityType.DRIVER) {
        await prisma.driver.update({
          where: { id: withdrawal.entityId },
          data: { razorpayxContactId: contactId },
        });
      }

      await prisma.withdrawalRequest.update({
        where: { id: withdrawalRequestId },
        data: { razorpayxContactId: contactId },
      });
    }

    // Step 2: Get or create Fund Account
    let fundAccountId = withdrawal.razorpayxFundAccountId;
    if (!fundAccountId) {
      const faRes = await fetch(`${razorpayxBaseUrl}/fund_accounts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contact_id: contactId,
          account_type: 'bank_account',
          bank_account: {
            name:           withdrawal.bankAccountHolderName,
            ifsc:           withdrawal.bankIfsc,
            account_number: withdrawal.bankAccountNo,
          },
        }),
      });
      const faData = await faRes.json() as any;
      if (!faRes.ok) throw new Error(`Fund account create failed: ${JSON.stringify(faData)}`);
      fundAccountId = faData.id;

      // Cache fund account ID on Driver for future payouts
      if (withdrawal.entityType === WithdrawalEntityType.DRIVER) {
        await prisma.driver.update({
          where: { id: withdrawal.entityId },
          data: { razorpayxFundAccountId: fundAccountId, bankVerified: true },
        });
      }

      await prisma.withdrawalRequest.update({
        where: { id: withdrawalRequestId },
        data: { razorpayxFundAccountId: fundAccountId },
      });
    }

    // Step 3: Create Payout
    // Use IMPS for amounts < ₹2L, RTGS for >= ₹2L
    const mode = withdrawal.amount >= 200000 ? 'RTGS' : 'IMPS';
    const payoutRes = await fetch(`${razorpayxBaseUrl}/payouts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        account_number:       process.env.RAZORPAYX_ACCOUNT_NUMBER,
        fund_account_id:      fundAccountId,
        amount:               Math.round(withdrawal.amount * 100), // paise
        currency:             'INR',
        mode,
        purpose:              'payout',
        queue_if_low_balance: true,
        reference_id:         withdrawalRequestId,
        narration:            `Parther earnings ${withdrawalRequestId.substring(0, 8)}`,
      }),
    });
    const payoutData = await payoutRes.json() as any;

    if (!payoutRes.ok) {
      throw new Error(`Payout create failed: ${JSON.stringify(payoutData)}`);
    }

    await prisma.withdrawalRequest.update({
      where: { id: withdrawalRequestId },
      data: {
        status:            WithdrawalStatus.AUTO_PROCESSING,
        razorpayxPayoutId: payoutData.id,
      },
    });

    logger.info(`[Withdrawal] RazorpayX payout created: ${payoutData.id} for withdrawal ${withdrawalRequestId}`);
  } catch (err: any) {
    logger.error(`[Withdrawal] RazorpayX payout error for ${withdrawalRequestId}:`, err.message);

    // Return funds to wallet + escalate to admin
    await refundFailedWithdrawal(withdrawalRequestId, err.message, true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL FAILURE — return funds to wallet
// ─────────────────────────────────────────────────────────────────────────────

export async function refundFailedWithdrawal(
  withdrawalRequestId: string,
  reason: string,
  escalateToAdmin: boolean = false
) {
  const withdrawal = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalRequestId },
  });
  if (!withdrawal) return;
  if (withdrawal.status === WithdrawalStatus.COMPLETED) return; // Never refund completed

  await prisma.$transaction(async (tx) => {
    // ── Route refund to the CORRECT wallet based on entity type ──────────────
    switch (withdrawal.entityType) {

      case WithdrawalEntityType.DRIVER: {
        await creditDriverWallet(tx, withdrawal.entityId, withdrawal.amount, DriverWalletReason.ADMIN_CREDIT, {
          referenceId: withdrawalRequestId,
          note: `Withdrawal refund — ${reason}`,
        });
        break;
      }

      case WithdrawalEntityType.FLEET: {
        const fleetWallet = await tx.fleetWallet.findUnique({ where: { fleetOwnerId: withdrawal.entityId } });
        if (fleetWallet) {
          await tx.fleetWallet.update({
            where: { fleetOwnerId: withdrawal.entityId },
            data: { cachedBalance: { increment: withdrawal.amount } },
          });
          const fresh = await tx.fleetWallet.findUnique({ where: { fleetOwnerId: withdrawal.entityId } });
          await tx.fleetWalletTransaction.create({
            data: {
              walletId:    fleetWallet.id,
              type:        WalletTransactionType.CREDIT,
              amount:      withdrawal.amount,
              balanceAfter: fresh!.cachedBalance,
              referenceId: withdrawalRequestId,
              note:        `Withdrawal refund — ${reason}`,
            },
          });
        }
        break;
      }

      case WithdrawalEntityType.WORKER: {
        const worker = await tx.worker.findUnique({ where: { id: withdrawal.entityId }, select: { id: true } });
        if (worker) {
          const workerWallet = await tx.workerWallet.upsert({
            where:  { workerId: worker.id },
            create: { workerId: worker.id, cachedBalance: withdrawal.amount },
            update: { cachedBalance: { increment: withdrawal.amount } },
          });
          const fresh = await tx.workerWallet.findUnique({ where: { workerId: worker.id } });
          await tx.workerWalletTransaction.create({
            data: {
              walletId:    workerWallet.id,
              type:        WalletTransactionType.CREDIT,
              reason:      'ADMIN_CREDIT' as any,
              amount:      withdrawal.amount,
              balanceAfter: fresh!.cachedBalance,
              referenceId: withdrawalRequestId,
              note:        `Withdrawal refund — ${reason}`,
            },
          });
        }
        break;
      }
    }

    await tx.withdrawalRequest.update({
      where: { id: withdrawalRequestId },
      data: {
        status:        escalateToAdmin ? WithdrawalStatus.ADMIN_PENDING : WithdrawalStatus.FAILED,
        failedAt:      new Date(),
        failureReason: reason,
      },
    });
  });

  logger.warn(`[Withdrawal] Funds returned to ${withdrawal.entityType} wallet for ${withdrawalRequestId}. Reason: ${reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CASH COLLECTION
// ─────────────────────────────────────────────────────────────────────────────

export async function recordCashCollection(
  adminUserId: string,
  data: {
    entityType: WithdrawalEntityType;
    entityId:   string;
    amount:     number;
    bookingId?: string;
    note?:      string;
  }
) {
  const { entityType, entityId, amount, bookingId, note } = data;

  return prisma.$transaction(async (tx) => {
    // 1. Record the physical cash receipt
    const record = await tx.cashCollectionRecord.create({
      data: { entityType, entityId, bookingId, amount, collectedBy: adminUserId, note },
    });

    // 2. Credit the appropriate wallet
    if (entityType === WithdrawalEntityType.DRIVER) {
      const wallet = await creditDriverWallet(
        tx, entityId, amount, DriverWalletReason.COMMISSION_PAID,
        { bookingId, referenceId: record.id, note: note ?? 'Cash commission received at office' }
      );
      // Clear commission due
      const cleared = Math.min(amount, wallet.commissionDue);
      await tx.driverWallet.update({
        where: { driverId: entityId },
        data: { commissionDue: { decrement: cleared } },
      });

      // Re-activate driver if their balance is now >= 0
      const fresh = await tx.driverWallet.findUnique({ where: { driverId: entityId } });
      if (fresh && fresh.cachedBalance >= 0) {
        await tx.driver.update({
          where: { id: entityId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    if (entityType === WithdrawalEntityType.FLEET) {
      // Credit the fleet wallet (admin collected cash from fleet on behalf of platform)
      const fleetWallet = await tx.fleetWallet.upsert({
        where:  { fleetOwnerId: entityId },
        create: { fleetOwnerId: entityId, cachedBalance: amount },
        update: { cachedBalance: { increment: amount } },
      });
      const freshFleet = await tx.fleetWallet.findUnique({ where: { fleetOwnerId: entityId } });
      await tx.fleetWalletTransaction.create({
        data: {
          walletId:    fleetWallet.id,
          type:        WalletTransactionType.CREDIT,
          amount,
          balanceAfter: freshFleet!.cachedBalance,
          referenceId: record.id,
          note:        note ?? 'Cash received at office — Fleet',
        },
      });
    }

    if (entityType === WithdrawalEntityType.WORKER) {
      // Credit WorkerWallet — e.g. worker pays commission in cash at office
      const workerRecord = await tx.worker.findUnique({ where: { id: entityId }, select: { id: true } });
      if (workerRecord) {
        const ww = await tx.workerWallet.upsert({
          where:  { workerId: entityId },
          create: { workerId: entityId, cachedBalance: amount },
          update: { cachedBalance: { increment: amount } },
        });
        const freshWW = await tx.workerWallet.findUnique({ where: { workerId: entityId } });
        await tx.workerWalletTransaction.create({
          data: {
            walletId:    ww.id,
            type:        WalletTransactionType.CREDIT,
            reason:      'COMMISSION_PAID' as any,
            amount,
            balanceAfter: freshWW!.cachedBalance,
            referenceId: record.id,
            note:        note ?? 'Cash commission received at office — Worker',
          },
        });
        // Clear commissionDue
        const cleared = Math.min(amount, freshWW!.commissionDue);
        if (cleared > 0) {
          await tx.workerWallet.update({
            where: { workerId: entityId },
            data:  { commissionDue: { decrement: cleared } },
          });
        }
      }
    }

    logger.info(`[CashCollection] Admin ${adminUserId} recorded Rs.${amount} cash from ${entityType} ${entityId}`);
    return record;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMISSION DEBT MONITORING — called by CRON
// ─────────────────────────────────────────────────────────────────────────────

export async function auditCommissionDebts(notifyService: (driverId: string, message: string) => Promise<void>) {
  const debtedWallets = await prisma.driverWallet.findMany({
    where: { commissionDue: { gt: 0 } },
    include: { driver: true },
  });

  for (const wallet of debtedWallets) {
    const balance = wallet.cachedBalance;

    if (balance <= COMMISSION_HARD_BLOCK) {
      // Hard block: set BREAK status
      await prisma.driver.update({
        where: { id: wallet.driverId },
        data: { status: 'BREAK' },
      });
      await notifyService(
        wallet.driverId,
        `Your account has been paused due to ₹${wallet.commissionDue.toFixed(2)} outstanding commission. Please pay or visit our office to resume.`
      );
      logger.warn(`[CommissionAudit] Driver ${wallet.driverId} BLOCKED — commission debt: ₹${wallet.commissionDue}`);
    } else if (balance <= COMMISSION_SOFT_ALERT) {
      // Soft alert: notify only
      await notifyService(
        wallet.driverId,
        `Reminder: You have ₹${wallet.commissionDue.toFixed(2)} outstanding commission. Pay now via the app to avoid account pause.`
      );
    }
  }
}
