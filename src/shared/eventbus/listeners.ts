import { eventBus } from './index';
import { dispatchBooking, dispatchWorkers } from '@modules/dispatch/dispatch.service';
import { generateScratchCard } from '@modules/rewards/rewards.service';
import { createNotification } from '@modules/notifications/inapp.notification.service';
import { notificationService } from '@modules/notifications/notification.service';
import { prisma } from '@shared/db/prisma';
import { NotificationType } from '@prisma/client';
import { logger } from '@shared/logger';
import { publishBidOpportunity } from '@modules/marketplace/marketplace.service';
import { announcementQueue } from '@shared/queue';

// ─── Punchy re-engagement messages (Zomato/Porter style) ───────────────────
export const PROMO_MESSAGES = [
    { title: '🚚 Saman shift karna hai?', body: 'GoMyTruck pe verified driver milega 2 min mein. Book karo abhi!' },
    { title: '📦 Move smarter, not harder!', body: 'Trucks, tempos & bikes — all at your fingertips. Book in 60 seconds.' },
    { title: '🏭 Running a business?', body: 'MSMEs trust GoMyTruck for daily logistics. Join 10,000+ happy businesses!' },
    { title: '⚡ Your next delivery, sorted!', body: 'Real drivers. Real-time tracking. Zero headaches. Try GoMyTruck today.' },
    { title: '🎯 Delivery on your terms!', body: 'Schedule now or book instantly — GoMyTruck adapts to your business.' },
    { title: '💰 Save big on logistics!', body: 'Compare prices, get live tracking & earn rewards. Only on GoMyTruck.' },
    { title: '🛣️ Goods don\'t move themselves!', body: 'Hire a verified driver in minutes. Your logistics partner is waiting.' },
];

/**
 * Register all application-level event listeners.
 * Called ONCE at server startup from server.ts.
 *
 * Every eventBus.emit() call in the codebase must have a matching listener here.
 * Listeners are intentionally fire-and-forget (async, non-blocking).
 */
export function registerEventListeners(): void {

    // ─── 1. NEW USER WELCOME ─────────────────────────────────────────────────
    eventBus.on('user.registered', async ({ userId, fcmToken }: { userId: string; fcmToken?: string }) => {
        try {
            const token = fcmToken ?? (await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } }))?.fcmToken;
            if (token) {
                await notificationService.sendToDevice(token, {
                    title: '🎉 Welcome to GoMyTruck!',
                    body: 'Your goods just found their driver. Book your first trip & earn a scratch card! 🚚',
                    data: { type: 'WELCOME', screen: '/home' },
                });
            }
            await createNotification(userId, '🎉 Welcome to GoMyTruck!', 'Book your first trip & earn a scratch card!', NotificationType.SYSTEM);
        } catch (err) {
            logger.error('[EventBus] user.registered handler failed:', err);
        }
    });

    // ─── 2. BOOKING CONFIRMED → dispatch + customer notification ─────────────
    eventBus.on('booking.confirmed', async ({ bookingId }) => {
        try {
            const mode = await prisma.booking.findUnique({ where: { id: bookingId }, select: { bookingMode: true } });
            logger.info(`[EventBus] booking.confirmed → ${mode?.bookingMode === 'PRIVATE_BID' ? 'marketplace' : 'dispatch'} ${bookingId}`);
            if (mode?.bookingMode === 'PRIVATE_BID') {
                await publishBidOpportunity(bookingId);
            } else {
                await dispatchBooking(bookingId);
            }

            const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { customerId: true, bookingNumber: true } });
            if (booking) {
                const customer = await prisma.user.findUnique({ where: { id: booking.customerId }, select: { fcmToken: true } });
                const isPrivateBid = mode?.bookingMode === 'PRIVATE_BID';
                const title = isPrivateBid ? '🔒 Private bidding is live' : '🔍 Hunting Your Driver!';
                const body = isPrivateBid
                    ? `Booking #${booking.bookingNumber} is open to verified providers. Offers and counteroffers stay private.`
                    : `Booking #${booking.bookingNumber} confirmed! We're finding the best driver near you. Sit tight! 🚛`;
                if (customer?.fcmToken) {
                    await notificationService.sendToDevice(customer.fcmToken, {
                        title,
                        body,
                        data: { type: isPrivateBid ? 'BIDDING_OPEN' : 'BOOKING_CONFIRMED', bookingId },
                    });
                }
                await createNotification(booking.customerId, title, body, NotificationType.BOOKING_STATUS, bookingId);
            }
        } catch (err) {
            logger.error(`[EventBus] Dispatch failed for booking ${bookingId}:`, err);
        }
    });

    // booking.confirmed → labor dispatch (SECOND listener — runs in parallel)
    eventBus.on('booking.confirmed', async ({ bookingId }) => {
        try {
            const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { bookingMode: true } });
            if (booking?.bookingMode === 'PRIVATE_BID') return;
            await dispatchWorkers(bookingId);
        } catch (err) {
            logger.error(`[EventBus] Worker dispatch failed for booking ${bookingId}:`, err);
        }
    });

    // ─── 3. DRIVER ARRIVING (handled in booking.service.ts, log here) ────────
    eventBus.on('booking.driver_arriving', async ({ bookingId, customerId }: { bookingId: string; customerId: string }) => {
        try {
            logger.info(`[EventBus] booking.driver_arriving for ${bookingId}`);
        } catch (err) {
            logger.error('[EventBus] booking.driver_arriving handler failed:', err);
        }
    });

    // ─── 4. GOODS LOADED (handled in booking.service.ts, log here) ──────────
    eventBus.on('booking.goods_loaded', async ({ bookingId, customerId }: { bookingId: string; customerId: string }) => {
        try {
            logger.info(`[EventBus] booking.goods_loaded for ${bookingId}`);
        } catch (err) {
            logger.error('[EventBus] booking.goods_loaded handler failed:', err);
        }
    });

    // ─── 5. DELIVERED → scratch card + punchy push ───────────────────────────
    eventBus.on('booking.delivered', async ({ bookingId, customerId, totalFare }) => {
        try {
            await generateScratchCard(customerId, bookingId, totalFare);

            const user = await prisma.user.findUnique({ where: { id: customerId }, select: { fcmToken: true } });
            if (user?.fcmToken) {
                await notificationService.sendToDevice(user.fcmToken, {
                    title: '🏁 Delivered! Scratch card waiting!',
                    body: 'Your goods reached safely. Tap to scratch & win coins! 🎰',
                    data: { type: 'SCRATCH_CARD', bookingId, screen: '/rewards' },
                });
            }
            await createNotification(customerId, '🏁 Delivered Successfully!', 'Your goods reached safely. Check your rewards!', NotificationType.BOOKING_STATUS, bookingId);
        } catch (err) {
            logger.error(`[EventBus] booking.delivered handler failed for ${bookingId}:`, err);
        }
    });

    // ─── 6. BOOKING CANCELLED → notify assigned driver ───────────────────────
    eventBus.on('booking.cancelled', async ({ bookingId }) => {
        try {
            const booking = await prisma.booking.findUnique({
                where: { id: bookingId },
                select: { driver: { select: { user: { select: { id: true, fcmToken: true } } } } },
            });
            const driverUser = booking?.driver?.user;
            if (driverUser?.fcmToken) {
                await notificationService.sendToDevice(driverUser.fcmToken, {
                    title: '❌ Booking Cancelled',
                    body: 'The customer has cancelled this booking.',
                    data: { type: 'BOOKING_CANCELLED', bookingId },
                });
                await createNotification(driverUser.id, '❌ Booking Cancelled', 'The customer has cancelled this booking.', NotificationType.BOOKING_STATUS, bookingId);
            }
        } catch (err) {
            logger.error(`[EventBus] booking.cancelled handler failed for ${bookingId}:`, err);
        }
    });

    // ─── 7. BID ACCEPTED → notify winning driver ─────────────────────────────
    eventBus.on('booking.bid_accepted', async ({ bookingId, driverId }) => {
        try {
            const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { user: { select: { id: true, fcmToken: true } } } });
            if (driver?.user?.fcmToken) {
                await notificationService.sendToDevice(driver.user.fcmToken, {
                    title: '🏆 Bid Accepted!',
                    body: 'Your bid was accepted. Head to the pickup location now.',
                    data: { type: 'BID_ACCEPTED', bookingId },
                });
                await createNotification(driver.user.id, '🏆 Bid Accepted!', 'Your bid was accepted. Head to the pickup location.', NotificationType.BOOKING_STATUS, bookingId);
            }
        } catch (err) {
            logger.error(`[EventBus] booking.bid_accepted handler failed for ${bookingId}:`, err);
        }
    });

    // ─── 8. PAYMENT CONFIRMED ─────────────────────────────────────────────────
    eventBus.on('payment.completed', async ({ bookingId, customerId, amount, method }) => {
        try {
            await createNotification(customerId, '✅ Payment Confirmed', `Payment of ₹${amount} via ${method} received.`, NotificationType.PAYMENT, bookingId);
        } catch (err) {
            logger.error('[EventBus] payment.completed handler failed:', err);
        }
    });

    // ─── 9. COINS EARNED ─────────────────────────────────────────────────────
    eventBus.on('rewards.coins_earned', async ({ userId, coins, bookingId }) => {
        try {
            await createNotification(userId, `🪙 ${coins} Coins Earned!`, `You earned ${coins} coins for completing your delivery.`, NotificationType.SYSTEM, bookingId);
        } catch (err) {
            logger.error('[EventBus] rewards.coins_earned handler failed:', err);
        }
    });

    // ─── 10. SCRATCH CARD READY ──────────────────────────────────────────────
    eventBus.on('rewards.scratch_card_ready', async ({ userId }: { userId: string }) => {
        try {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
            if (user?.fcmToken) {
                await notificationService.sendToDevice(user.fcmToken, {
                    title: '🎰 You\'ve Got a Scratch Card!',
                    body: 'A reward is waiting for you! Tap to scratch & reveal your prize. 🪙',
                    data: { type: 'SCRATCH_CARD', screen: '/rewards' },
                });
            }
            await createNotification(userId, '🎰 Scratch Card Waiting!', 'Tap to scratch & reveal your reward coins.', NotificationType.SYSTEM);
        } catch (err) {
            logger.error('[EventBus] rewards.scratch_card_ready handler failed:', err);
        }
    });

    // ─── 11. ANNOUNCEMENT BROADCAST ──────────────────────────────────────────
    eventBus.on('announcement.created', async ({ target, title, body }: { target: string; title: string; body: string }) => {
        try {
            // Map target audience to firebase push topics
            // Values: ALL_USERS, CUSTOMER, DRIVER, FLEET_OWNER, WORKFORCE
            let topic = 'all_users';
            if (target === 'CUSTOMER') topic = 'topic_customers';
            else if (target === 'DRIVER') topic = 'topic_drivers';
            else if (target === 'FLEET_OWNER') topic = 'topic_fleet_owners';
            else if (target === 'WORKFORCE') topic = 'topic_workforce';

            await notificationService.sendToTopic(topic, {
                title: `📢 ${title}`,
                body,
                data: { type: 'ANNOUNCEMENT', screen: '/notification-center' },
            });
            logger.info(`[EventBus] Announcement broadcast sent: "${title}" to topic: ${topic}`);

            // Delegate in-app notification insertion to background worker
            await announcementQueue.add('create-inapp-notifications', {
                target,
                title,
                body,
            });
            logger.info(`[EventBus] Dispatched in-app notifications job to BullMQ for target: ${target}`);
        } catch (err) {
            logger.error('[EventBus] announcement.created handler failed:', err);
        }
    });

    logger.info('✅ All event bus listeners registered');
}
