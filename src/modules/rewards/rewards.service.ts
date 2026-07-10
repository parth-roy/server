import { prisma } from '@shared/db/prisma';
import { PrismaClient, CoinTransactionType, ScratchCardStatus, RewardType } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { eventBus } from '@shared/eventbus';

// ─── Config ───────────────────────────────────────────────────────────────────
const RUPEE_TO_COIN_RATE = 1; // Used to calculate max possible scratch reward based on fare
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
        recentTransactions: coinBalance.transactions,
    };
}

// ─────────────────────────────────────────────
// GET COIN TRANSACTION HISTORY
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
// SCRATCH CARDS LOGIC
// ─────────────────────────────────────────────

export async function getScratchCards(userId: string) {
    return prisma.scratchCard.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
    });
}

export async function generateScratchCard(userId: string, bookingId: string, fareAmount: number) {
    try {
        // Only generate if there's no scratch card for this booking yet
        const existing = await prisma.scratchCard.findUnique({ where: { bookingId } });
        if (existing) return;

        // Calculate max coins they could win based on fare. Add randomness for fun factor.
        const maxCoins = Math.max(Math.floor(fareAmount * RUPEE_TO_COIN_RATE), 10);
        const winCoins = Math.floor(Math.random() * (maxCoins / 2)) + Math.floor(maxCoins / 2); // Win 50% to 100% of maxCoins
        
        // 90% chance to win coins, 10% chance to get 'better luck next time'
        const isWin = Math.random() > 0.1;

        await prisma.scratchCard.create({
            data: {
                userId,
                bookingId,
                status: ScratchCardStatus.READY,
                isWin,
                rewardType: RewardType.COINS,
                rewardValue: isWin ? winCoins : 0,
                title: 'Booking Reward',
                description: 'Scratch to reveal your reward!',
                unlockedAt: new Date(),
            }
        });

        // Notify user their scratch card is ready
        eventBus.emit('rewards.scratch_card_ready', { userId });

        logger.info(`Generated scratch card for user ${userId} for booking ${bookingId}`);
    } catch (err) {
        logger.error('Failed to generate scratch card:', err);
    }
}

export async function scratchCard(userId: string, cardId: string) {
    const card = await prisma.scratchCard.findFirst({
        where: { id: cardId, userId },
    });

    if (!card) throw AppError.notFound('Scratch card not found');
    if (card.status !== ScratchCardStatus.READY) throw AppError.badRequest('Card is not ready to be scratched');

    const now = new Date();
    // Mark scratched
    const updatedCard = await prisma.scratchCard.update({
        where: { id: cardId },
        data: {
            status: ScratchCardStatus.SCRATCHED,
            scratchedAt: now,
            expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), // 90 days expiry
        }
    });

    // If won, credit coins to CoinBalance (NOT Wallet)
    if (card.isWin && card.rewardType === RewardType.COINS && card.rewardValue) {
        let coinBalance = await prisma.coinBalance.findUnique({ where: { userId } });
        if (!coinBalance) {
            coinBalance = await prisma.coinBalance.create({ data: { userId, cachedBalance: 0 } });
        }

        const newBalance = coinBalance.cachedBalance + card.rewardValue;

        await prisma.$transaction([
            prisma.coinBalance.update({
                where: { id: coinBalance.id },
                data: { cachedBalance: newBalance },
            }),
            prisma.coinTransaction.create({
                data: {
                    coinBalanceId: coinBalance.id,
                    type: CoinTransactionType.EARN,
                    coins: card.rewardValue,
                    balanceAfter: newBalance,
                    referenceId: cardId,
                    note: `Won from scratch card`,
                }
            }),
        ]);
    }

    return updatedCard;
}
