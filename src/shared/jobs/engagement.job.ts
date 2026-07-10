import cron from 'node-cron';
import { prisma } from '@shared/db/prisma';
import { notificationService } from '@modules/notifications/notification.service';
import { PROMO_MESSAGES } from '@shared/eventbus/listeners';
import { logger } from '@shared/logger';

let _promoIndex = 0;

function getNextPromo() {
    const msg = PROMO_MESSAGES[_promoIndex % PROMO_MESSAGES.length];
    _promoIndex++;
    return msg;
}

/**
 * Broadcast a re-engagement push to all users that have an FCM token.
 * Runs via FCM topic broadcast (no per-user DB loop needed).
 */
async function sendReEngagementPush() {
    try {
        const promo = getNextPromo();
        await notificationService.sendToTopic('all_users', {
            title: promo.title,
            body: promo.body,
            data: { type: 'PROMO', screen: '/home' },
        });
        logger.info(`[EngagementJob] Re-engagement push sent: "${promo.title}"`);
    } catch (err) {
        logger.error('[EngagementJob] Failed to send re-engagement push:', err);
    }
}

/**
 * Start all scheduled engagement jobs.
 * Called once at server startup.
 *
 * Schedule:
 *  - Mon/Wed/Fri at 9:00 AM IST  → morning motivation
 *  - Tue/Thu at 2:00 PM IST      → afternoon nudge
 *  - Sat at 7:00 PM IST          → weekend push
 *
 * IST = UTC+5:30, so:
 *  9:00 AM IST  = 3:30 AM UTC
 *  2:00 PM IST  = 8:30 AM UTC
 *  7:00 PM IST  = 1:30 PM UTC
 */
export function startEngagementJobs() {
    // Mon, Wed, Fri — 9:00 AM IST
    cron.schedule('30 3 * * 1,3,5', () => {
        sendReEngagementPush();
    });

    // Tue, Thu — 2:00 PM IST
    cron.schedule('30 8 * * 2,4', () => {
        sendReEngagementPush();
    });

    // Sat — 7:00 PM IST
    cron.schedule('30 13 * * 6', () => {
        sendReEngagementPush();
    });

    logger.info('📅 Engagement jobs scheduled (Mon/Wed/Fri 9AM, Tue/Thu 2PM, Sat 7PM IST)');
}
