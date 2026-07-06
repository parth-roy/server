import { prisma } from '@shared/db/prisma';
import { PrismaClient, WalletTransactionType, WalletTransactionReason, PaymentStatus } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';
import Razorpay from 'razorpay';
import crypto from 'crypto';


const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

// ─────────────────────────────────────────────
// GET WALLET (with summary)
// ─────────────────────────────────────────────

export async function getWallet(userId: string) {
    let wallet = await prisma.wallet.findUnique({
        where: { userId },
        include: {
            transactions: {
                orderBy: { createdAt: 'desc' },
                take: 20,
            }
        }
    });

    if (!wallet) {
        wallet = await prisma.wallet.create({
            data: { userId, cachedBalance: 0 },
            include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        });
    }

    return wallet;
}

// ─────────────────────────────────────────────
// GET WALLET TRANSACTION HISTORY (paginated)
// ─────────────────────────────────────────────

export async function getTransactionHistory(userId: string, page: number, limit: number) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        return { transactions: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await prisma.$transaction([
        prisma.walletTransaction.findMany({
            where: { walletId: wallet.id },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return {
        transactions,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// ─────────────────────────────────────────────
// ADD MONEY (direct, used by admin or legacy)
// ─────────────────────────────────────────────

export async function addMoney(userId: string, amount: number, referenceId?: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw AppError.notFound('Wallet not found');

    const newBalance = wallet.cachedBalance + amount;

    const [updatedWallet, transaction] = await prisma.$transaction([
        prisma.wallet.update({
            where: { userId },
            data: { cachedBalance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.TOP_UP,
                amount,
                balanceAfter: newBalance,
                referenceId,
            }
        })
    ]);

    return { wallet: updatedWallet, transaction };
}

// ─────────────────────────────────────────────
// DEDUCT MONEY (internal utility)
// ─────────────────────────────────────────────

export async function deductMoney(userId: string, amount: number, reason: WalletTransactionReason, referenceId?: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw AppError.notFound('Wallet not found');

    if (wallet.cachedBalance < amount) {
        throw AppError.badRequest('Insufficient wallet balance', 'INSUFFICIENT_BALANCE');
    }

    const newBalance = wallet.cachedBalance - amount;

    const [updatedWallet, transaction] = await prisma.$transaction([
        prisma.wallet.update({
            where: { userId },
            data: { cachedBalance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.DEBIT,
                reason,
                amount,
                balanceAfter: newBalance,
                referenceId,
            }
        })
    ]);

    return { wallet: updatedWallet, transaction };
}

// ─────────────────────────────────────────────
// PAY FOR BOOKING VIA WALLET
// Atomically deducts balance and marks booking PAID
// ─────────────────────────────────────────────

export async function payForBooking(userId: string, bookingId: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw AppError.notFound('Booking not found');

    if (booking.customerId !== userId) {
        throw AppError.forbidden('You do not have access to this booking');
    }

    if (booking.paymentStatus === PaymentStatus.PAID) {
        throw AppError.conflict('Booking is already paid');
    }

    const amount = booking.totalFare;
    if (!amount || amount <= 0) {
        throw AppError.badRequest('Booking has no valid fare. Cannot pay via wallet.');
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw AppError.notFound('Wallet not found. Please add money to your wallet first.');

    if (wallet.cachedBalance < amount) {
        throw AppError.badRequest(
            `Insufficient wallet balance. Required: ₹${amount.toFixed(2)}, Available: ₹${wallet.cachedBalance.toFixed(2)}`,
            'INSUFFICIENT_BALANCE'
        );
    }

    // FIX CRITICAL-12: Atomic conditional decrement prevents double-spend race condition.
    // The WHERE clause enforces cachedBalance >= amount inside the transaction.
    // If two concurrent requests race, only one gets count=1; the other throws.
    const updatedBooking = await prisma.$transaction(async (tx) => {
        const deductResult = await tx.wallet.updateMany({
            where: { userId, cachedBalance: { gte: amount } },
            data: { cachedBalance: { decrement: amount } },
        });

        if (deductResult.count === 0) {
            throw AppError.badRequest(
                'Insufficient wallet balance',
                'INSUFFICIENT_BALANCE'
            );
        }

        const updatedWallet = await tx.wallet.findUnique({ where: { userId } });
        const newBalance = updatedWallet!.cachedBalance;

        const paid = await tx.booking.update({
            where: { id: bookingId },
            data: {
                paymentStatus: PaymentStatus.PAID,
                paymentRef: `WALLET_${Date.now()}`,
            },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.DEBIT,
                reason: WalletTransactionReason.BOOKING_PAYMENT,
                amount,
                balanceAfter: newBalance,
                referenceId: bookingId,
                note: `Payment for booking #${booking.bookingNumber}`,
            },
        });

        return paid;
    });

    return updatedBooking;
}

// ─────────────────────────────────────────────
// WALLET TOP-UP: CREATE RAZORPAY ORDER
// ─────────────────────────────────────────────

export async function createTopUpOrder(userId: string, amount: number) {
    if (!amount || amount < 1) {
        throw AppError.badRequest('Minimum top-up amount is ₹1');
    }
    if (amount > 100000) {
        throw AppError.badRequest('Maximum top-up amount is ₹1,00,000');
    }

    const amountInPaise = Math.round(amount * 100);

    // Ensure wallet exists
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { userId, cachedBalance: 0 } });
    }

    const order = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `WALLET_${userId}_${Date.now()}`,
    });

    return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
    };
}

// ─────────────────────────────────────────────
// WALLET TOP-UP: VERIFY & CREDIT
// ─────────────────────────────────────────────

export async function verifyTopUp(
    userId: string,
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
) {
    // Validate all fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw AppError.badRequest('razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required');
    }

    // Verify HMAC signature
    const secret = process.env.RAZORPAY_KEY_SECRET || '';
    const generatedSignature = crypto
        .createHmac('sha256', secret)
        .update(razorpay_order_id + '|' + razorpay_payment_id)
        .digest('hex');

    if (generatedSignature !== razorpay_signature) {
        throw AppError.badRequest('Payment signature is invalid. Possible tampering detected.');
    }

    // Fetch order from Razorpay to get the actual amount paid
    const order = await razorpay.orders.fetch(razorpay_order_id);
    // FIX HIGH-16: Use amount_paid (what was actually captured), not order.amount.
    // Prevents crediting the full order amount when only a partial payment was made.
    const creditAmount = Number((order as any).amount_paid || order.amount) / 100;

    if (creditAmount <= 0) {
        throw AppError.badRequest('Invalid payment amount');
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw AppError.notFound('Wallet not found');

    // Idempotency: check if this payment_id was already processed
    const existing = await prisma.walletTransaction.findFirst({
        where: { referenceId: razorpay_payment_id },
    });
    if (existing) {
        return { message: 'Already credited', wallet };
    }

    const newBalance = wallet.cachedBalance + creditAmount;

    const [updatedWallet] = await prisma.$transaction([
        prisma.wallet.update({
            where: { userId },
            data: { cachedBalance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.TOP_UP,
                amount: creditAmount,
                balanceAfter: newBalance,
                referenceId: razorpay_payment_id,
                note: `Wallet top-up via Razorpay`,
            }
        }),
    ]);

    return { message: 'Wallet topped up successfully', wallet: updatedWallet, amountCredited: creditAmount };
}

// ─────────────────────────────────────────────────────────────────────────────
// REFUND — credited when an online-paid booking is cancelled
// ─────────────────────────────────────────────────────────────────────────────
export async function refundToWallet(userId: string, bookingId: string, amount: number) {
    if (amount <= 0) throw AppError.badRequest('Refund amount must be positive');

    // Idempotency: never double-refund the same booking
    const existingRefund = await prisma.walletTransaction.findFirst({
        where: {
            referenceId: `REFUND_${bookingId}`,
            reason: WalletTransactionReason.REFUND,
        },
    });
    if (existingRefund) {
        return { message: 'Already refunded', refundAmount: amount };
    }

    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { userId, cachedBalance: 0 } });
    }

    const newBalance = wallet.cachedBalance + amount;

    const [updatedWallet] = await prisma.$transaction([
        prisma.wallet.update({ where: { userId }, data: { cachedBalance: newBalance } }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.REFUND,
                amount,
                balanceAfter: newBalance,
                referenceId: `REFUND_${bookingId}`,
                note: `Refund for cancelled booking`,
            },
        }),
    ]);

    return { message: 'Refund credited to wallet', wallet: updatedWallet, refundAmount: amount };
}

// ─────────────────────────────────────────────────────────────────────────────
// CASHBACK — credited for rewards, promotions, referrals
// ─────────────────────────────────────────────────────────────────────────────
export async function creditCashback(userId: string, amount: number, referenceId: string, note?: string) {
    if (amount <= 0) return;

    // Idempotency: never double-credit the same reward
    const existing = await prisma.walletTransaction.findFirst({
        where: { referenceId, reason: WalletTransactionReason.CASHBACK },
    });
    if (existing) return;

    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { userId, cachedBalance: 0 } });
    }

    const newBalance = wallet.cachedBalance + amount;

    await prisma.$transaction([
        prisma.wallet.update({ where: { userId }, data: { cachedBalance: newBalance } }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.CASHBACK,
                amount,
                balanceAfter: newBalance,
                referenceId,
                note: note ?? `Cashback credited`,
            },
        }),
    ]);
}
