/**
 * cleanup.job.ts — Scheduled maintenance jobs run via setInterval at server startup.
 * Prevents unbounded table growth in BookingLocationHistory and stale RefreshTokens.
 */

import { prisma } from '@shared/db/prisma';
import { logger } from '@shared/logger';

const LOCATION_HISTORY_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// FIX MEDIUM-36: Delete location history older than 30 days.
// Without this, a 1-second GPS interval × 1h trips × 1000 bookings/day = ~3.6M rows/day.
export async function runLocationHistoryCleanup(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOCATION_HISTORY_RETENTION_DAYS);

    try {
        const result = await prisma.bookingLocationHistory.deleteMany({
            where: { recordedAt: { lt: cutoff } },
        });
        if (result.count > 0) {
            logger.info(`[Cleanup] Deleted ${result.count} location history records older than ${LOCATION_HISTORY_RETENTION_DAYS} days`);
        }
    } catch (err) {
        logger.error('[Cleanup] Location history cleanup failed:', err);
    }
}

// Delete expired refresh tokens to prevent table bloat
export async function runExpiredTokenCleanup(): Promise<void> {
    try {
        const result = await prisma.refreshToken.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
        if (result.count > 0) {
            logger.info(`[Cleanup] Deleted ${result.count} expired refresh tokens`);
        }
    } catch (err) {
        logger.error('[Cleanup] Refresh token cleanup failed:', err);
    }
}

export function startCleanupJobs(): void {
    // Run once at startup, then every 24 hours
    const run = () => {
        runLocationHistoryCleanup().catch(err => logger.error('[Cleanup] Location run failed:', err));
        runExpiredTokenCleanup().catch(err => logger.error('[Cleanup] Token run failed:', err));
    };

    run();
    setInterval(run, CLEANUP_INTERVAL_MS);

    logger.info('✅ Cleanup jobs scheduled (24h interval)');
}
