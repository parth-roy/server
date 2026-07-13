import { prisma } from '@shared/db/prisma';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PaymentStatus, BookingStatus, BookingMode, BidAwardStatus, PaymentMethod } from '@prisma/client';
import { sendSuccess } from '@shared/utils/response';
import { AppError } from '@shared/errors/AppError';
import { completeBooking } from '@modules/booking/booking.service';
import crypto from 'crypto';
import { finalizePaidAward } from '@modules/marketplace/marketplace.service';
import { razorpay } from './razorpay.client';
import { secureCapturedBookingPayment } from './booking-payment.service';


// ─────────────────────────────────────────────
// CREATE ORDER
// ─────────────────────────────────────────────
export async function createOrder(req: Request, res: Response, next: NextFunction) {
    try {
        const { bookingId } = req.body;

        if (!bookingId || typeof bookingId !== 'string') {
            throw AppError.badRequest('bookingId is required');
        }

        const userId = req.user!.id;

        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) throw AppError.notFound('Booking not found');

        if (booking.customerId !== userId && req.user!.role !== 'ADMIN') {
            throw AppError.forbidden('Access denied');
        }

        if (booking.paymentStatus === PaymentStatus.PAID) {
            throw AppError.conflict('Booking is already paid');
        }

        if (booking.paymentStatus === PaymentStatus.REFUNDED) {
            throw AppError.conflict('Booking payment has been refunded');
        }

        if (booking.bookingMode === BookingMode.PRIVATE_BID) {
            const award = await prisma.bidAward.findFirst({
                where: {
                    bookingId,
                    activeKey: bookingId,
                    status: { in: [BidAwardStatus.PAYMENT_PENDING, BidAwardStatus.PAYMENT_RECONCILING] },
                },
            });
            if (!award) throw AppError.conflict('Select an active bid before creating payment', 'BID_AWARD_REQUIRED');
            if (award.paymentDeadline.getTime() <= Date.now() && !booking.razorpayOrderId) {
                throw AppError.conflict('Bid payment deadline has expired', 'PAYMENT_DEADLINE_EXPIRED');
            }
        }

        // FIX HIGH-15: Idempotency — return the existing unpaid order if one exists,
        // preventing duplicate charges from double-clicks.
        if ((booking as any).razorpayOrderId && booking.paymentStatus === PaymentStatus.PENDING) {
            try {
                const existingOrder = await razorpay.orders.fetch((booking as any).razorpayOrderId);
                if ((existingOrder as any).status === 'created') {
                    sendSuccess(res, {
                        orderId: existingOrder.id,
                        amount: existingOrder.amount,
                        currency: existingOrder.currency,
                    }, 'Existing order returned (idempotent)');
                    return;
                }
            } catch {
                // Fetch failed — order expired or invalid; fall through to create a new one
            }
        }

        const amountInPaise = Math.round((booking.grandTotal ?? booking.totalFare ?? 0) * 100);

        if (amountInPaise <= 0) {
            throw AppError.badRequest('Booking has no valid fare amount. Please ensure the booking is confirmed with a calculated fare before payment.');
        }

        if (amountInPaise < 100) {
            throw AppError.badRequest('Payment amount must be at least ₹1.00');
        }

        const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: bookingId,
        });

        // FIX CRITICAL-13: Persist the Razorpay order ID on the booking so we can
        // cross-verify it in verifyPayment and block cross-booking replay attacks.
        const persistedOrder = await prisma.booking.updateMany({
            where: {
                id: bookingId,
                customerId: booking.customerId,
                paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
                ...(booking.bookingMode === BookingMode.PRIVATE_BID
                    ? {
                        bidAwards: {
                            some: {
                                activeKey: bookingId,
                                status: BidAwardStatus.PAYMENT_PENDING,
                                paymentDeadline: { gt: new Date() },
                            },
                        },
                    }
                    : {}),
            },
            data: { razorpayOrderId: order.id },
        });
        if (persistedOrder.count !== 1) {
            throw AppError.conflict(
                'The selected bid or payment state changed before the order was created',
                'PAYMENT_STATE_CONFLICT',
            );
        }

        sendSuccess(res, {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
        }, 'Razorpay order created');
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// VERIFY PAYMENT (Frontend callback)
// ─────────────────────────────────────────────
export async function verifyPayment(req: Request, res: Response, next: NextFunction) {
    try {
        const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!bookingId || typeof bookingId !== 'string') {
            throw AppError.badRequest('bookingId is required');
        }
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            throw AppError.badRequest('razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required');
        }

        const userId = req.user!.id;

        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) throw AppError.notFound('Booking not found');

        if (booking.customerId !== userId && req.user!.role !== 'ADMIN') {
            throw AppError.forbidden('Access denied');
        }

        // Idempotency: webhook may have already marked it paid
        if (booking.paymentStatus === PaymentStatus.PAID) {
            await finalizePaidAward(bookingId);
            sendSuccess(res, booking, 'Booking payment already confirmed');
            return;
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

        // FIX CRITICAL-13: Cross-check that the order ID belongs to this booking.
        // Prevents a user from paying ₹10 for order B and verifying it against booking A (worth ₹10,000).
        const storedOrderId = (booking as any).razorpayOrderId;
        if (storedOrderId && storedOrderId !== razorpay_order_id) {
            throw AppError.badRequest(
                'Payment order does not match this booking. Possible replay attack detected.',
                'ORDER_MISMATCH'
            );
        }


        // Bind the verified gateway payment to the exact order, currency and accepted amount.
        const gatewayPayment = await razorpay.payments.fetch(razorpay_payment_id);
        if (
            gatewayPayment.order_id !== razorpay_order_id ||
            gatewayPayment.currency !== 'INR'
        ) {
            throw AppError.badRequest('Payment currency or order does not match this booking', 'PAYMENT_MISMATCH');
        }
        if (gatewayPayment.status !== 'captured' && gatewayPayment.captured !== true) {
            throw AppError.conflict('Payment is not captured yet. Please wait for confirmation.', 'PAYMENT_NOT_CAPTURED');
        }

        const updatedBooking = await secureCapturedBookingPayment({
            bookingId,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            amountPaise: Number(gatewayPayment.amount),
            currency: gatewayPayment.currency,
        });

        await finalizePaidAward(updatedBooking.id);

        if (updatedBooking.status === BookingStatus.DELIVERED && updatedBooking.driverId) {
            const driver = await prisma.driver.findUnique({ where: { id: updatedBooking.driverId } });
            if (driver) {
                await completeBooking(updatedBooking.id, driver.userId);
            }
        }

        sendSuccess(res, updatedBooking, 'Payment verified successfully');
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────
// RAZORPAY WEBHOOK (Server-to-Server)
// ─────────────────────────────────────────────
// CRITICAL: Registered in app.ts with express.raw({ type: 'application/json' })
// BEFORE express.json(). req.body is a raw Buffer here — do NOT move this route.
export async function razorpayWebhook(req: Request, res: Response, _next: NextFunction) {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!webhookSecret || webhookSecret === 'your_webhook_secret_here_change_in_production') {
            console.error('WEBHOOK: RAZORPAY_WEBHOOK_SECRET is not configured. Rejecting webhook.');
            res.status(400).json({ error: 'Webhook not configured' });
            return;
        }

        const signature = req.headers['x-razorpay-signature'] as string | undefined;
        if (!signature) {
            console.warn('WEBHOOK: Missing x-razorpay-signature header');
            res.status(400).json({ error: 'Missing signature' });
            return;
        }

        const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));

        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');

        if (expectedSignature !== signature) {
            console.warn('WEBHOOK: Signature mismatch — possible forgery attempt');
            res.status(400).json({ error: 'Invalid webhook signature' });
            return;
        }

        const body = JSON.parse(rawBody.toString('utf8'));
        const event = body.event as string;
        const payload = body.payload;

        console.log(`WEBHOOK: Received event [${event}]`);

        if (event === 'payment.captured') {
            const payment = payload?.payment?.entity;
            if (!payment?.order_id) {
                console.warn('WEBHOOK: payment.captured missing order_id');
                res.status(200).json({ status: 'ok' });
                return;
            }

            const order = await razorpay.orders.fetch(payment.order_id);
            const actualBookingId = order.receipt;

            if (!actualBookingId) {
                console.warn(`WEBHOOK: No receipt/bookingId on order ${payment.order_id}`);
                res.status(200).json({ status: 'ok' });
                return;
            }

            const booking = await prisma.booking.findUnique({ where: { id: actualBookingId } });
            if (!booking) {
                console.warn(`WEBHOOK: Booking ${actualBookingId} not found`);
                res.status(200).json({ status: 'ok' });
                return;
            }

            if (booking.paymentStatus !== PaymentStatus.PAID) {
                const updatedBooking = await secureCapturedBookingPayment({
                    bookingId: actualBookingId,
                    orderId: payment.order_id,
                    paymentId: payment.id,
                    amountPaise: Number(payment.amount),
                    currency: payment.currency,
                });

                await finalizePaidAward(updatedBooking.id);

                if (updatedBooking.status === BookingStatus.DELIVERED && updatedBooking.driverId) {
                    const driver = await prisma.driver.findUnique({ where: { id: updatedBooking.driverId } });
                    if (driver) {
                        await completeBooking(updatedBooking.id, driver.userId);
                    }
                }
                console.log(`WEBHOOK: Booking ${actualBookingId} marked PAID via webhook`);
            } else {
                // The payment transaction may have committed before a previous finalizer attempt
                // failed. Retrying is safe and closes that recovery gap for marketplace awards.
                await finalizePaidAward(actualBookingId);
                console.log(`WEBHOOK: Booking ${actualBookingId} already PAID — skipped (idempotent)`);
            }

        } else if (event === 'payment.failed') {
            const payment = payload?.payment?.entity;
            if (!payment?.order_id) {
                console.warn('WEBHOOK: payment.failed missing order_id');
                res.status(200).json({ status: 'ok' });
                return;
            }

            const order = await razorpay.orders.fetch(payment.order_id);
            const actualBookingId = order.receipt;

            if (actualBookingId) {
                const booking = await prisma.booking.findUnique({ where: { id: actualBookingId } });
                if (
                    booking &&
                    booking.razorpayOrderId === payment.order_id &&
                    booking.paymentStatus !== PaymentStatus.PAID
                ) {
                    const activeBidAward = booking.bookingMode === BookingMode.PRIVATE_BID
                        ? await prisma.bidAward.findFirst({
                            where: {
                                bookingId: actualBookingId,
                                activeKey: actualBookingId,
                                status: {
                                    in: [BidAwardStatus.PAYMENT_PENDING, BidAwardStatus.PAYMENT_RECONCILING],
                                },
                            },
                        })
                        : true;
                    if (!activeBidAward) {
                        console.warn(`WEBHOOK: Ignored failed payment for inactive bid award ${actualBookingId}`);
                        res.status(200).json({ status: 'ok' });
                        return;
                    }
                    await prisma.booking.updateMany({
                        where: {
                            id: actualBookingId,
                            razorpayOrderId: payment.order_id,
                            paymentStatus: PaymentStatus.PENDING,
                        },
                        data: { paymentStatus: PaymentStatus.FAILED },
                    });
                    console.log(`WEBHOOK: Booking ${actualBookingId} marked FAILED`);
                }
            }
        } else {
            console.log(`WEBHOOK: Unhandled event [${event}] — ignored`);
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('WEBHOOK: Unhandled error:', err);
        // FIX HIGH-14: Return 200 even on internal errors to prevent Razorpay retry storms.
        // The error is logged — investigate via logs/Sentry, not via Razorpay retries.
        res.status(200).json({ status: 'ok', warning: 'Internal processing error — check server logs' });
    }
}

// ─────────────────────────────────────────────
// MOCK PAYMENT (Dev only)
// ─────────────────────────────────────────────
export async function mockPaymentSuccess(req: Request, res: Response, next: NextFunction) {
    try {
        // FIX MEDIUM-18: Restrict to development only — not staging, not production.
        if (process.env.NODE_ENV !== 'development') {
            throw AppError.forbidden('Mock payment is only available in development');
        }

        const { bookingId } = req.body;

        if (!bookingId || typeof bookingId !== 'string') {
            throw AppError.badRequest('bookingId is required');
        }

        const userId = req.user!.id;

        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) throw AppError.notFound('Booking not found');

        if (booking.customerId !== userId && req.user!.role !== 'ADMIN') {
            throw AppError.forbidden('Access denied');
        }

        if (booking.paymentStatus === PaymentStatus.PAID) {
            throw AppError.conflict('Booking is already paid');
        }

        const updatedBooking = await prisma.booking.update({
            where: { id: bookingId },
            data: {
                paymentStatus: PaymentStatus.PAID,
                paymentRef: 'MOCK_TXN_' + Date.now(),
                paymentMethod: PaymentMethod.CARD,
            },
        });

        await finalizePaidAward(updatedBooking.id);

        if (updatedBooking.status === BookingStatus.DELIVERED && updatedBooking.driverId) {
            const driver = await prisma.driver.findUnique({ where: { id: updatedBooking.driverId } });
            if (driver) {
                await completeBooking(updatedBooking.id, driver.userId);
            }
        }

        sendSuccess(res, updatedBooking, 'Payment successful (MOCKED)');
    } catch (err) {
        next(err);
    }
}
