import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { WalletTransactionType, WithdrawalEntityType, WithdrawalStatus } from '@prisma/client';
import { processWithdrawalViaRazorpayX } from '@modules/driver-wallet/driver-wallet.service';

const MIN_WITHDRAWAL = Number(process.env.MIN_WITHDRAWAL_AMOUNT ?? 50);

// ─────────────────────────────────────────────────────────────────────────────
// GET WALLET + HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export async function getFleetWallet(fleetOwnerId: string) {
  return prisma.fleetWallet.upsert({
    where:  { fleetOwnerId },
    create: { fleetOwnerId },
    update: {},
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
}

export async function getFleetTransactionHistory(
  fleetOwnerId: string,
  page  = 1,
  limit = 20
) {
  const wallet = await prisma.fleetWallet.findUnique({ where: { fleetOwnerId } });
  if (!wallet) return { transactions: [], total: 0, balance: 0 };

  const [transactions, total] = await Promise.all([
    prisma.fleetWalletTransaction.findMany({
      where:   { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.fleetWalletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return { transactions, total, balance: wallet.cachedBalance };
}

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL REQUEST
// ─────────────────────────────────────────────────────────────────────────────

export async function requestFleetWithdrawal(fleetOwnerId: string, amount: number) {
  if (amount < MIN_WITHDRAWAL) {
    throw AppError.badRequest(`Minimum withdrawal is Rs.${MIN_WITHDRAWAL}`, 'BELOW_MIN_WITHDRAWAL');
  }

  const [wallet, fleetOwner] = await Promise.all([
    prisma.fleetWallet.findUnique({ where: { fleetOwnerId } }),
    prisma.fleetOwner.findUnique({ where: { id: fleetOwnerId }, include: { user: true } }),
  ]);

  if (!wallet)      throw AppError.notFound('Fleet wallet not found');
  if (!fleetOwner)  throw AppError.notFound('Fleet owner not found');

  if (wallet.cachedBalance < amount) {
    throw AppError.badRequest(
      `Insufficient balance. Available: Rs.${wallet.cachedBalance.toFixed(2)}`,
      'INSUFFICIENT_BALANCE'
    );
  }

  if (!fleetOwner.bankAccountNo || !fleetOwner.bankIfsc) {
    throw AppError.badRequest(
      'Bank account details not configured. Please add your bank account first.',
      'NO_BANK_ACCOUNT'
    );
  }

  const pending = await prisma.withdrawalRequest.findFirst({
    where: {
      entityType: WithdrawalEntityType.FLEET,
      entityId:   fleetOwnerId,
      status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.AUTO_PROCESSING] },
    },
  });
  if (pending) {
    throw AppError.badRequest(
      'A withdrawal is already in progress. Please wait for it to complete.',
      'WITHDRAWAL_IN_PROGRESS'
    );
  }

  const withdrawalRequest = await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.fleetWallet.update({
      where: { fleetOwnerId },
      data:  { cachedBalance: { decrement: amount } },
    });

    await tx.fleetWalletTransaction.create({
      data: {
        walletId:    wallet.id,
        type:        WalletTransactionType.DEBIT,
        amount,
        balanceAfter: updatedWallet.cachedBalance,
        note:        `Withdrawal request`,
      },
    });

    return tx.withdrawalRequest.create({
      data: {
        entityType:            WithdrawalEntityType.FLEET,
        entityId:              fleetOwnerId,
        amount,
        bankAccountNo:         fleetOwner.bankAccountNo!,
        bankIfsc:              fleetOwner.bankIfsc!,
        bankName:              fleetOwner.bankName ?? 'Unknown',
        bankAccountHolderName: fleetOwner.bankAccountHolderName ?? fleetOwner.user.name ?? 'Fleet Owner',
        razorpayxContactId:    fleetOwner.razorpayxContactId,
        razorpayxFundAccountId: fleetOwner.razorpayxFundAccountId,
      },
    });
  });

  logger.info(`[FleetWallet] Withdrawal: Rs.${amount} for fleet ${fleetOwnerId}`);

  processWithdrawalViaRazorpayX(withdrawalRequest.id).catch((err) => {
    logger.error(`[FleetWallet] Auto-payout failed for ${withdrawalRequest.id}:`, err);
  });

  return withdrawalRequest;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLEET -> DRIVER DIGITAL TRANSFER
// Fleet owner pays salary to driver's DriverWallet from their FleetWallet
// ─────────────────────────────────────────────────────────────────────────────

export async function transferToDriver(
  fleetOwnerId: string,
  driverId:     string,
  amount:       number,
  note?:        string
) {
  if (amount <= 0) throw AppError.badRequest('Transfer amount must be positive');

  const fleetWallet = await prisma.fleetWallet.findUnique({ where: { fleetOwnerId } });
  if (!fleetWallet) throw AppError.notFound('Fleet wallet not found');

  if (fleetWallet.cachedBalance < amount) {
    throw AppError.badRequest(
      `Insufficient fleet balance. Available: Rs.${fleetWallet.cachedBalance.toFixed(2)}`,
      'INSUFFICIENT_BALANCE'
    );
  }

  const fleetDriver = await prisma.fleetDriver.findFirst({
    where: { fleetOwnerId, driverId, isActive: true },
  });
  if (!fleetDriver) {
    throw AppError.forbidden('Driver does not belong to your fleet');
  }

  return prisma.$transaction(async (tx) => {
    // 1. Debit fleet wallet
    const updatedFleetWallet = await tx.fleetWallet.update({
      where: { fleetOwnerId },
      data:  { cachedBalance: { decrement: amount } },
    });

    await tx.fleetWalletTransaction.create({
      data: {
        walletId:    fleetWallet.id,
        type:        WalletTransactionType.DEBIT,
        amount,
        balanceAfter: updatedFleetWallet.cachedBalance,
        note:        note ?? `Driver salary transfer`,
        referenceId: driverId,
      },
    });

    // 2. Credit driver's DriverWallet
    const driverWallet = await tx.driverWallet.upsert({
      where:  { driverId },
      create: { driverId, cachedBalance: amount },
      update: { cachedBalance: { increment: amount } },
    });
    const freshDriverWallet = await tx.driverWallet.findUnique({ where: { driverId } });

    await tx.driverWalletTransaction.create({
      data: {
        walletId:    driverWallet.id,
        type:        WalletTransactionType.CREDIT,
        reason:      'FLEET_SALARY' as any,
        amount,
        balanceAfter: freshDriverWallet!.cachedBalance,
        note:        note ?? `Salary from fleet`,
        referenceId: fleetOwnerId,
      },
    });

    logger.info(`[FleetWallet] Rs.${amount} transferred: fleet ${fleetOwnerId} -> driver ${driverId}`);
    return {
      fleetBalance:  updatedFleetWallet.cachedBalance,
      driverBalance: freshDriverWallet!.cachedBalance,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORD OFFLINE CASH SALARY (fleet owner paid driver in physical cash)
// Creates audit record + credits driver DriverWallet so driver can see history
// ─────────────────────────────────────────────────────────────────────────────

export async function recordOfflineDriverSalary(
  fleetOwnerId: string,
  driverId:     string,
  amount:       number,
  note?:        string
) {
  const fleetDriver = await prisma.fleetDriver.findFirst({
    where: { fleetOwnerId, driverId, isActive: true },
  });
  if (!fleetDriver) {
    throw AppError.forbidden('Driver does not belong to your fleet');
  }

  return prisma.$transaction(async (tx) => {
    const record = await tx.cashCollectionRecord.create({
      data: {
        entityType:  'DRIVER' as any,
        entityId:    driverId,
        amount,
        collectedBy: fleetOwnerId,
        note:        note ?? `Offline cash salary from fleet`,
      },
    });

    const driverWallet = await tx.driverWallet.upsert({
      where:  { driverId },
      create: { driverId, cachedBalance: amount },
      update: { cachedBalance: { increment: amount } },
    });
    const fresh = await tx.driverWallet.findUnique({ where: { driverId } });

    await tx.driverWalletTransaction.create({
      data: {
        walletId:    driverWallet.id,
        type:        WalletTransactionType.CREDIT,
        reason:      'FLEET_SALARY' as any,
        amount,
        balanceAfter: fresh!.cachedBalance,
        referenceId: record.id,
        note:        note ?? `Offline cash salary from fleet owner`,
      },
    });

    logger.info(`[FleetWallet] Offline salary Rs.${amount} recorded: fleet ${fleetOwnerId} -> driver ${driverId}`);
    return record;
  });
}
