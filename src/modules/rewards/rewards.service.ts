import { prisma } from '@shared/db/prisma';
import { PrismaClient, CoinTransactionType, WalletTransactionType, WalletTransactionReason } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';


// ─── Config ───────────────────────────────────────────────────────────────────
// 1 Coin = ₹0.9 in wallet credit (configurable)
const COIN_TO_RUPEE_RATE = 0.9;
// Coins earned per ₹ spent
const RUPEE_TO_COIN_RATE = 1; // 1 coin per ₹1 spent
// Tier thresholds
const TIERS = [
    { name: 'Bronze', minCoins: 0 },
    { name: 'Silver', minCoins: 500 },
    { name: 'Gold', minCoins: 2000 },
    { name: 'Platinum', minCoins: 5000 },
];

function getTier(balance: number) {
    let tier = TIERS[0];
    for (const t of TIERS) {
        if (balance >= t.minCoins) tier = t;
    }
    return tier;
}

// ─────────────────────────────────────────────
// GET COIN BALANCE + TIER
// ─────────────────────────────────────────────

export async function getCoinBalance(userId: string) {
    let coinBalance = await prisma.coinBalance.findUnique({
        where: { userId },
        include: {
            transactions: {
                orderBy: { createdAt: 'desc' },
                take: 5,
            }
        }
    });

    if (!coinBalance) {
        coinBalance = await prisma.coinBalance.create({
            data: { userId, cachedBalance: 0 },
            include: { transactions: { orderBy: { createdAt: 'desc' }, take: 5 } },
        });
    }

    const tier = getTier(coinBalance.cachedBalance);

    return {
        coins: coinBalance.cachedBalance,
        tier: tier.name,
        nextTier: TIERS[TIERS.indexOf(tier) + 1] ?? null,
        coinToRupeeRate: COIN_TO_RUPEE_RATE,
        recentTransactions: coinBalance.transactions,
    };
}

// ─────────────────────────────────────────────
// GET COIN TRANSACTION HISTORY (paginated)
// ─────────────────────────────────────────────

export async function getCoinHistory(userId: string, page: number, limit: number) {
    const coinBalance = await prisma.coinBalance.findUnique({ where: { userId } });
    if (!coinBalance) {
        return { transactions: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await prisma.$transaction([
        prisma.coinTransaction.findMany({
            where: { coinBalanceId: coinBalance.id },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.coinTransaction.count({ where: { coinBalanceId: coinBalance.id } }),
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
// EARN COINS (called internally after booking completion)
// ─────────────────────────────────────────────

export async function earnCoins(userId: string, bookingId: string, fareAmount: number) {
    try {
        const coinsToEarn = Math.floor(fareAmount * RUPEE_TO_COIN_RATE);
        if (coinsToEarn <= 0) return;

        let coinBalance = await prisma.coinBalance.findUnique({ where: { userId } });
        if (!coinBalance) {
            coinBalance = await prisma.coinBalance.create({ data: { userId, cachedBalance: 0 } });
        }

        const newBalance = coinBalance.cachedBalance + coinsToEarn;

        await prisma.$transaction([
            prisma.coinBalance.update({
                where: { userId },
                data: { cachedBalance: newBalance },
            }),
            prisma.coinTransaction.create({
                data: {
                    coinBalanceId: coinBalance.id,
                    type: CoinTransactionType.EARN,
                    coins: coinsToEarn,
                    balanceAfter: newBalance,
                    referenceId: bookingId,
                    note: `Earned from delivery`,
                }
            }),
        ]);

        logger.info(`Coins earned: ${coinsToEarn} for user ${userId} from booking ${bookingId}`);
    } catch (err) {
        // Non-critical — don't let coin errors break the booking flow
        logger.error('Failed to award coins:', err);
    }
}

// ─────────────────────────────────────────────
// REDEEM COINS → WALLET CREDIT
// ─────────────────────────────────────────────

export async function redeemCoins(userId: string, coins: number) {
    if (!coins || coins <= 0) {
        throw AppError.badRequest('coins must be a positive number');
    }
    if (!Number.isInteger(coins)) {
        throw AppError.badRequest('coins must be a whole number');
    }

    const coinBalance = await prisma.coinBalance.findUnique({ where: { userId } });
    if (!coinBalance) throw AppError.notFound('Coin balance not found');

    if (coinBalance.cachedBalance < coins) {
        throw AppError.badRequest(
            `Insufficient coins. You have ${coinBalance.cachedBalance} coins, but tried to redeem ${coins}.`,
            'INSUFFICIENT_COINS'
        );
    }

    const rupeeCredit = coins * COIN_TO_RUPEE_RATE;
    const newCoinBalance = coinBalance.cachedBalance - coins;

    // Get or create wallet
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { userId, cachedBalance: 0 } });
    }
    const newWalletBalance = wallet.cachedBalance + rupeeCredit;

    // Atomic: deduct coins + credit wallet
    await prisma.$transaction([
        prisma.coinBalance.update({
            where: { userId },
            data: { cachedBalance: newCoinBalance },
        }),
        prisma.coinTransaction.create({
            data: {
                coinBalanceId: coinBalance.id,
                type: CoinTransactionType.REDEEM,
                coins,
                balanceAfter: newCoinBalance,
                note: `Redeemed for ₹${rupeeCredit.toFixed(2)} wallet credit`,
            }
        }),
        prisma.wallet.update({
            where: { userId },
            data: { cachedBalance: newWalletBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.CASHBACK,
                amount: rupeeCredit,
                balanceAfter: newWalletBalance,
                note: `Redeemed ${coins} coins`,
            }
        }),
    ]);

    return {
        coinsRedeemed: coins,
        rupeesCredited: rupeeCredit,
        newCoinBalance,
        newWalletBalance,
    };
}
