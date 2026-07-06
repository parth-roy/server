import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '@shared/db/prisma';
import { logger } from '@shared/logger';
import { sendSuccess } from '@shared/utils/response';
import { refundFailedWithdrawal } from '../driver-wallet/driver-wallet.service';
import { WithdrawalStatus } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY GUARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically record a webhook event ID. Returns true if this is a NEW event,
 * false if already processed (duplicate from Razorpay's at-least-once delivery).
 */
async function markEventProcessed(eventId: string, eventType: string): Promise<boolean> {
  try {
    await prisma.processedWebhook.create({ data: { eventId, eventType } });
    return true; // New event — process it
  } catch (err: any) {
    if (err.code === 'P2002') return false; // Unique constraint violation = duplicate
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAY PAYMENT GATEWAY WEBHOOK
// POST /webhooks/razorpay
// Must be registered with express.raw() BEFORE express.json() in app.ts
// ─────────────────────────────────────────────────────────────────────────────

export async function handleRazorpayWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    // 1. Verify webhook signature
    const signature = req.headers['x-razorpay-signature'] as string;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(req.body) // req.body is Buffer when using express.raw()
      .digest('hex');

    if (expectedSig !== signature) {
      logger.warn('[Webhook/Razorpay] Invalid signature — rejected');
      return res.status(400).json({ ok: false, message: 'Invalid signature' });
    }

    const payload = JSON.parse(req.body.toString());
    const eventId   = req.headers['x-razorpay-event-id'] as string ?? `${payload.event}_${Date.now()}`;
    const eventType = payload.event as string;

    // 2. Idempotency check — ack immediately if already processed
    const isNew = await markEventProcessed(eventId, eventType);
    if (!isNew) {
      logger.info(`[Webhook/Razorpay] Duplicate event ignored: ${eventId}`);
      return res.status(200).json({ ok: true });
    }

    logger.info(`[Webhook/Razorpay] Processing event: ${eventType} (${eventId})`);

    // 3. Handle events
    switch (eventType) {
      case 'payment.captured': {
        // Fallback: credit wallet if app verify API was never called
        // (e.g. user closed app before verify completed)
        const payment = payload.payload?.payment?.entity;
        if (!payment) break;

        const orderId = payment.order_id;
        if (!orderId) break;

        // Check if this was a wallet top-up order
        const existingTx = await prisma.walletTransaction.findFirst({
          where: { referenceId: payment.id },
        });

        if (!existingTx) {
          // Find the Razorpay order notes to get userId
          // Note: The wallet top-up flow sets notes.userId in createTopUpOrder
          // If found and not yet credited → credit now
          logger.info(`[Webhook/Razorpay] payment.captured for ${payment.id} — checking if wallet top-up`);
          // The wallet.service verifyTopUp handles this. If order notes contain userId, we credit.
          // For now: log for manual reconciliation. The CRON job handles these.
        }
        break;
      }

      default:
        logger.info(`[Webhook/Razorpay] Unhandled event type: ${eventType}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAYX PAYOUT WEBHOOK
// POST /webhooks/razorpayx
// Must also use express.raw() middleware
// ─────────────────────────────────────────────────────────────────────────────

export async function handleRazorpayXWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    // 1. Verify RazorpayX webhook signature (uses a separate secret)
    const signature = req.headers['x-razorpay-signature'] as string;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAYX_WEBHOOK_SECRET!)
      .update(req.body)
      .digest('hex');

    if (expectedSig !== signature) {
      logger.warn('[Webhook/RazorpayX] Invalid signature — rejected');
      return res.status(400).json({ ok: false, message: 'Invalid signature' });
    }

    const payload   = JSON.parse(req.body.toString());
    const eventId   = req.headers['x-razorpay-event-id'] as string ?? `${payload.event}_${Date.now()}`;
    const eventType = payload.event as string;

    // 2. Idempotency guard
    const isNew = await markEventProcessed(eventId, eventType);
    if (!isNew) {
      logger.info(`[Webhook/RazorpayX] Duplicate event ignored: ${eventId}`);
      return res.status(200).json({ ok: true });
    }

    const payout = payload.payload?.payout?.entity;
    if (!payout) {
      return res.status(200).json({ ok: true });
    }

    // Map RazorpayX payout ID → our WithdrawalRequest
    const withdrawal = await prisma.withdrawalRequest.findFirst({
      where: { razorpayxPayoutId: payout.id },
    });

    if (!withdrawal) {
      // Could be a payout not initiated by our system — safe to ignore
      logger.warn(`[Webhook/RazorpayX] No WithdrawalRequest found for payout ${payout.id}`);
      return res.status(200).json({ ok: true });
    }

    logger.info(`[Webhook/RazorpayX] ${eventType} for withdrawal ${withdrawal.id}`);

    switch (eventType) {
      case 'payout.processed': {
        // ✅ Money has hit the driver's bank account
        await prisma.withdrawalRequest.update({
          where: { id: withdrawal.id },
          data: {
            status:       WithdrawalStatus.COMPLETED,
            processedAt:  new Date(),
            razorpayxUtr: payout.utr ?? null, // Bank UTR number for reconciliation
          },
        });
        logger.info(`[Withdrawal] COMPLETED: ₹${withdrawal.amount} → ${withdrawal.entityType} ${withdrawal.entityId} (UTR: ${payout.utr})`);
        break;
      }

      case 'payout.reversed':
      case 'payout.failed': {
        // ❌ Payout failed — return funds to wallet + escalate to admin
        const reason = payout.failure_reason ?? eventType;
        await refundFailedWithdrawal(withdrawal.id, reason, true);
        logger.warn(`[Withdrawal] FAILED: ${withdrawal.id} — Reason: ${reason}`);
        break;
      }

      default:
        logger.info(`[Webhook/RazorpayX] Unhandled payout event: ${eventType}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}
