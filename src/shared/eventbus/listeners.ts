import { eventBus } from './index';
import { dispatchBooking } from '@modules/dispatch/dispatch.service';
import { earnCoins } from '@modules/rewards/rewards.service';
import { createNotification } from '@modules/notifications/inapp.notification.service';
import { notificationService } from '@modules/notifications/notification.service';
import { prisma } from '@shared/db/prisma';
import { NotificationType } from '@prisma/client';
import { logger } from '@shared/logger';

/**
 * Register all application-level event listeners.
 * Called ONCE at server startup from server.ts.
 *
 * Every eventBus.emit() call in the codebase must have a matching listener here.
 * Listeners are intentionally fire-and-forget (async, non-blocking).
 */
export function registerEventListeners(): void {

    // booking.confirmed → auto-dispatch to nearest available drivers
    eventBus.on('booking.confirmed', async ({ bookingId }) => {
        try {
            logger.info(`[EventBus] booking.confirmed → dispatching ${bookingId}`);
            await dispatchBooking(bookingId);
        } catch (err) {
            logger.error(`[EventBus] Dispatch failed for booking ${bookingId}:`, err);
        }
    });

    // booking.delivered → earn coins for customer + push notification
    eventBus.on('booking.delivered', async ({ bookingId, customerId, totalFare }) => {
        try {
            await earnCoins(customerId, bookingId, totalFare);

            const user = await prisma.user.findUnique({
                where: { id: customerId },
                select: { fcmToken: true },
            });
            if (user?.fcmToken) {
                await notificationService.sendToDevice(user.fcmToken, {
                    title: '📦 Delivered!',
                    body: 'Your goods have been delivered. Please verify and complete the booking.',
                    data: { type: 'BOOKING_DELIVERED', bookingId },
                });
            }
            await createNotification(
                customerId,
                '📦 Delivered!',
                'Your goods have been delivered. Please verify and complete the booking.',
                NotificationType.BOOKING_STATUS,
                bookingId,
            );
        } catch (err) {
            logger.error(`[EventBus] booking.delivered handler failed for ${bookingId}:`, err);
        }
    });

    // booking.cancelled → notify the assigned driver (if any)
    eventBus.on('booking.cancelled', async ({ bookingId }) => {
        try {
            const booking = await prisma.booking.findUnique({
                where: { id: bookingId },
                select: {
                    driver: {
                        select: { user: { select: { id: true, fcmToken: true } } },
                    },
                },
            });
            const driverUser = booking?.driver?.user;
            if (driverUser?.fcmToken) {
                await notificationService.sendToDevice(driverUser.fcmToken, {
                    title: '❌ Booking Cancelled',
                    body: 'The customer has cancelled this booking.',
                    data: { type: 'BOOKING_CANCELLED', bookingId },
                });
                await createNotification(
                    driverUser.id,
                    '❌ Booking Cancelled',
                    'The customer has cancelled this booking.',
                    NotificationType.BOOKING_STATUS,
                    bookingId,
                );
            }
        } catch (err) {
            logger.error(`[EventBus] booking.cancelled handler failed for ${bookingId}:`, err);
        }
    });

    // booking.bid_accepted → notify the winning driver
    eventBus.on('booking.bid_accepted', async ({ bookingId, driverId }) => {
        try {
            const driver = await prisma.driver.findUnique({
                where: { id: driverId },
                select: { user: { select: { id: true, fcmToken: true } } },
            });
            if (driver?.user?.fcmToken) {
                await notificationService.sendToDevice(driver.user.fcmToken, {
                    title: '🎉 Bid Accepted!',
                    body: 'Your bid was accepted. Head to the pickup location.',
                    data: { type: 'BID_ACCEPTED', bookingId },
                });
                await createNotification(
                    driver.user.id,
                    '🎉 Bid Accepted!',
                    'Your bid was accepted. Head to the pickup location.',
                    NotificationType.BOOKING_STATUS,
                    bookingId,
                );
            }
        } catch (err) {
            logger.error(`[EventBus] booking.bid_accepted handler failed for ${bookingId}:`, err);
        }
    });

    // payment.completed → in-app notification for customer
    eventBus.on('payment.completed', async ({ bookingId, customerId, amount, method }) => {
        try {
            await createNotification(
                customerId,
                '✅ Payment Confirmed',
                `Payment of ₹${amount} via ${method} received.`,
                NotificationType.PAYMENT,
                bookingId,
            );
        } catch (err) {
            logger.error('[EventBus] payment.completed handler failed:', err);
        }
    });

    // rewards.coins_earned → in-app notification for user
    eventBus.on('rewards.coins_earned', async ({ userId, coins, bookingId }) => {
        try {
            await createNotification(
                userId,
                `🪙 ${coins} Coins Earned!`,
                `You earned ${coins} coins for completing your delivery.`,
                NotificationType.SYSTEM,
                bookingId,
            );
        } catch (err) {
            logger.error('[EventBus] rewards.coins_earned handler failed:', err);
        }
    });

    logger.info('✅ All event bus listeners registered');
}
