import { prisma } from '@shared/db/prisma';
import { BadgeTier, BadgeMetric } from '@prisma/client';

export const gamificationService = {
  /**
   * Evaluates all active badges for a worker, updates progress,
   * unlocks new badges, awards points, and recalculates tier.
   */
  async evaluateWorkerMetrics(workerId: string) {
    const worker = await prisma.worker.findUnique({
      where: { userId: workerId },
      include: { workerBadges: true }
    });
    if (!worker) return null;

    const allBadges = await prisma.badge.findMany({ where: { isActive: true } });
    let totalPoints = worker.gamificationPoints;
    let earnedNewBadge = false;

    for (const badge of allBadges) {
      // Find current progress
      let currentProgress = 0;
      switch (badge.metric) {
        case BadgeMetric.TOTAL_JOBS:
          currentProgress = worker.totalJobs;
          break;
        case BadgeMetric.RATING:
          currentProgress = worker.rating ?? 0;
          break;
        case BadgeMetric.ACCEPTANCE_RATE:
          currentProgress = worker.acceptanceRate ?? 0;
          break;
        case BadgeMetric.ON_TIME_RATE:
          // Assuming we add onTimeRate to Worker eventually, for now mock as 100%
          currentProgress = 100;
          break;
        case BadgeMetric.TOTAL_EARNINGS:
          currentProgress = (worker as any).walletBalance ?? 0;
          break;
      }

      const isEarned = currentProgress >= badge.targetValue;
      const existingWorkerBadge = worker.workerBadges.find((wb: any) => wb.badgeId === badge.id);

      if (!existingWorkerBadge) {
        // Create new worker badge record
        await prisma.workerBadge.create({
          data: {
            workerId: worker.userId,
            badgeId: badge.id,
            progress: currentProgress,
            isEarned: isEarned,
            earnedAt: isEarned ? new Date() : null,
          }
        });
        if (isEarned) {
          totalPoints += badge.pointsReward;
          earnedNewBadge = true;
        }
      } else {
        // Update existing progress if it wasn't earned before
        if (!existingWorkerBadge.isEarned) {
          await prisma.workerBadge.update({
            where: { id: existingWorkerBadge.id },
            data: {
              progress: currentProgress,
              isEarned: isEarned,
              earnedAt: isEarned ? new Date() : null,
            }
          });
          if (isEarned) {
            totalPoints += badge.pointsReward;
            earnedNewBadge = true;
          }
        }
      }
    }

    // Recalculate tier based on total points
    let newTier: BadgeTier = BadgeTier.BRONZE;
    if (totalPoints >= 2500) newTier = BadgeTier.DIAMOND;
    else if (totalPoints >= 1000) newTier = BadgeTier.PLATINUM;
    else if (totalPoints >= 500) newTier = BadgeTier.GOLD;
    else if (totalPoints >= 200) newTier = BadgeTier.SILVER;

    if (earnedNewBadge || newTier !== worker.gamificationTier || totalPoints !== worker.gamificationPoints) {
      await prisma.worker.update({
        where: { userId: workerId },
        data: {
          gamificationPoints: totalPoints,
          gamificationTier: newTier,
        }
      });
    }

    return { totalPoints, newTier, badgesEvaluated: allBadges.length };
  },

  /**
   * Fetches the formatted badges response for the workforce API
   */
  async getBadgesForWorker(workerId: string) {
    // Ensure metrics are evaluated to have up to date badges
    await this.evaluateWorkerMetrics(workerId);

    const worker = await prisma.worker.findUnique({
      where: { userId: workerId },
      include: {
        workerBadges: {
          include: { badge: true }
        }
      }
    });

    if (!worker) return null;

    const earned = worker.workerBadges
      .filter((wb: any) => wb.isEarned)
      .map((wb: any) => ({
        id: wb.badge.code,
        name: wb.badge.name,
        description: wb.badge.description,
        icon: wb.badge.icon,
        tier: wb.badge.tier,
        earnedAt: wb.earnedAt,
      }));

    const locked = worker.workerBadges
      .filter((wb: any) => !wb.isEarned)
      .map((wb: any) => ({
        id: wb.badge.code,
        name: wb.badge.name,
        description: wb.badge.description,
        icon: wb.badge.icon,
        tier: wb.badge.tier,
        progress: wb.progress,
        total: wb.badge.targetValue,
      }));

    return {
      tier: worker.gamificationTier,
      totalEarned: earned.length,
      points: worker.gamificationPoints,
      earned,
      locked
    };
  }
};
