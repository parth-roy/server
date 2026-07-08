import { Request, Response, NextFunction } from 'express';
import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { sendSuccess } from '@shared/utils/response';

export async function listBadges(req: Request, res: Response, next: NextFunction) {
  try {
    const badges = await prisma.badge.findMany({
      orderBy: { createdAt: 'desc' }
    });
    sendSuccess(res, badges);
  } catch (err) { next(err); }
}

export async function createBadge(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body;
    const newBadge = await prisma.badge.create({ data });
    sendSuccess(res, newBadge, 'Badge created');
  } catch (err) { next(err); }
}

export async function updateBadge(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const data = req.body;
    const updatedBadge = await prisma.badge.update({
      where: { id },
      data
    });
    sendSuccess(res, updatedBadge, 'Badge updated');
  } catch (err) { next(err); }
}

export async function getGamificationStats(req: Request, res: Response, next: NextFunction) {
  try {
    // 1. Tier Distribution
    const tierDistribution = await prisma.worker.groupBy({
      by: ['gamificationTier'],
      _count: { gamificationTier: true }
    });

    // 2. Most Earned Badges
    const badgeUnlocks = await prisma.workerBadge.groupBy({
      by: ['badgeId'],
      where: { isEarned: true },
      _count: { badgeId: true },
      orderBy: { _count: { badgeId: 'desc' } },
      take: 5
    });

    // Fetch actual badge details for the unlocks
    const badgeDetails = await prisma.badge.findMany({
      where: { id: { in: badgeUnlocks.map((b: any) => b.badgeId) } },
      select: { id: true, name: true, code: true }
    });

    const topEarnedBadges = badgeUnlocks.map((unlock: any) => {
      const b = badgeDetails.find((d: any) => d.id === unlock.badgeId);
      return {
        name: b?.name,
        code: b?.code,
        count: unlock._count.badgeId
      };
    });

    sendSuccess(res, {
      tierDistribution: tierDistribution.map((t: any) => ({
        tier: t.gamificationTier,
        count: t._count.gamificationTier
      })),
      topEarnedBadges
    });
  } catch (err) { next(err); }
}
