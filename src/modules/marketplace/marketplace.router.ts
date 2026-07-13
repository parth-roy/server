import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UserRole } from '@prisma/client';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as controller from './marketplace.controller';
import {
  createRevisionSchema,
  opportunitiesQuerySchema,
  sendBidMessageSchema,
  submitBidSchema,
} from './marketplace.schema';

export const marketplaceRouter = Router();

const commandLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many marketplace commands. Try again shortly.', code: 'RATE_LIMITED', statusCode: 429 },
});

const messageLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many chat messages. Try again shortly.', code: 'RATE_LIMITED', statusCode: 429 },
});

marketplaceRouter.use(authenticate);

marketplaceRouter.get(
  '/opportunities',
  requireRole(UserRole.DRIVER, UserRole.FLEET_OWNER),
  validate(opportunitiesQuerySchema, 'query'),
  controller.listOpportunities,
);

marketplaceRouter.get(
  '/opportunities/:bookingId',
  requireRole(UserRole.DRIVER, UserRole.FLEET_OWNER),
  controller.getOpportunity,
);

marketplaceRouter.get(
  '/bookings/:bookingId/bids',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER, UserRole.FLEET_OWNER),
  controller.listBookingBids,
);

marketplaceRouter.post(
  '/bookings/:bookingId/bids',
  requireRole(UserRole.DRIVER, UserRole.FLEET_OWNER),
  commandLimiter,
  validate(submitBidSchema),
  controller.submitBid,
);

marketplaceRouter.get(
  '/bids/:bidId',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER, UserRole.FLEET_OWNER),
  controller.getBidThread,
);

marketplaceRouter.post(
  '/bids/:bidId/revisions',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER, UserRole.FLEET_OWNER),
  commandLimiter,
  validate(createRevisionSchema),
  controller.createRevision,
);

marketplaceRouter.post(
  '/bids/:bidId/messages',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER, UserRole.FLEET_OWNER),
  messageLimiter,
  validate(sendBidMessageSchema),
  controller.sendMessage,
);

marketplaceRouter.post(
  '/bids/:bidId/withdraw',
  requireRole(UserRole.DRIVER, UserRole.FLEET_OWNER),
  commandLimiter,
  controller.withdrawBid,
);

marketplaceRouter.post(
  '/bids/:bidId/reject',
  requireRole(UserRole.CUSTOMER),
  commandLimiter,
  controller.rejectBid,
);

marketplaceRouter.post(
  '/bids/:bidId/revisions/:revisionId/accept',
  requireRole(UserRole.CUSTOMER),
  commandLimiter,
  controller.acceptRevision,
);

marketplaceRouter.get(
  '/bookings/:bookingId/award',
  requireRole(UserRole.CUSTOMER, UserRole.DRIVER, UserRole.FLEET_OWNER),
  controller.getAward,
);

marketplaceRouter.post(
  '/bookings/:bookingId/award/secure-cash',
  requireRole(UserRole.CUSTOMER),
  commandLimiter,
  controller.secureCashAward,
);
