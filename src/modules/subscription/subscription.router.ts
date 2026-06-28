import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import { sendSuccess } from '@shared/utils/response';
import * as SubscriptionService from './subscription.service';
import { z } from 'zod';
import { validate } from '@shared/middleware/validate';

export const subscriptionRouter = Router();

subscriptionRouter.use(authenticate);

const selectPlanSchema = z.object({
  body: z.object({
    plan: z.enum(['BASIC', 'STANDARD', 'PRO', 'PREMIUM']),
    paymentReference: z.string().optional(), // Provided by Razorpay in Phase 2
  }),
});

// ── GET /api/v1/subscription — Get current subscription ─────────────────────
subscriptionRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subscription = await SubscriptionService.getSubscription(req.user!.id);
    sendSuccess(res, subscription);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/subscription/select — Select or upgrade plan ───────────────
subscriptionRouter.post(
  '/select',
  validate(selectPlanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { plan, paymentReference } = req.body;
      const subscription = await SubscriptionService.selectPlan(
        req.user!.id,
        plan,
        paymentReference,
      );
      sendSuccess(res, subscription, 'Subscription activated successfully');
    } catch (err) {
      next(err);
    }
  },
);
