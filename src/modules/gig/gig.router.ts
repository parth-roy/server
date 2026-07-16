import { Router } from 'express';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as ctrl from './gig.controller';
import * as schema from './gig.schema';
import { UserRole } from '@prisma/client';

export const gigRouter = Router();

// ── Public ───────────────────────────────────────────────────────────────────

/** GET /gig/catalog — skill categories, zone rates, urgency options (no auth needed) */
gigRouter.get('/catalog', ctrl.getGigCatalog);

/** POST /gig/estimate — fare preview before booking (no auth needed) */
gigRouter.post(
  '/estimate',
  validate(schema.estimateGigSchema),
  ctrl.estimateGig,
);

// ── Customer ─────────────────────────────────────────────────────────────────

gigRouter.post(
  '/customer',
  authenticate,
  requireRole(UserRole.CUSTOMER),
  validate(schema.createGigSchema),
  ctrl.createGig,
);

gigRouter.get(
  '/customer',
  authenticate,
  requireRole(UserRole.CUSTOMER),
  ctrl.getCustomerGigs,
);

// ── Workforce ─────────────────────────────────────────────────────────────────

gigRouter.get(
  '/nearby',
  authenticate,
  requireRole(UserRole.WORKER),
  ctrl.getNearbyGigs,
);

gigRouter.post(
  '/:id/accept',
  authenticate,
  requireRole(UserRole.WORKER),
  ctrl.acceptGig,
);

// ── Admin ─────────────────────────────────────────────────────────────────────

gigRouter.get(
  '/admin',
  authenticate,
  requireRole(UserRole.ADMIN),
  ctrl.getAllGigsAdmin,
);
