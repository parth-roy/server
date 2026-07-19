import { Router } from 'express';
import { validate } from '@shared/middleware/validate';
import { authenticate, requireRole, optionalAuth } from '@shared/middleware/auth.middleware';
import { UserRole } from '@prisma/client';
import * as ctrl from './leads.controller';
import {
  CreateLeadSchema,
  GetLeadsQuerySchema,
  UpdateLeadStatusSchema
} from './leads.schema';

export const publicLeadsRouter = Router();
export const adminLeadsRouter = Router();

// ── Public Routes (For website forms) ──
publicLeadsRouter.post(
  '/',
  optionalAuth,
  validate(CreateLeadSchema),
  ctrl.createLead
);

// ── Admin Routes (Protected) ──
adminLeadsRouter.use(authenticate, requireRole(UserRole.ADMIN));

adminLeadsRouter.get(
  '/',
  validate(GetLeadsQuerySchema, 'query'),
  ctrl.getLeads
);

adminLeadsRouter.patch(
  '/:id/status',
  validate(UpdateLeadStatusSchema),
  ctrl.updateLeadStatus
);
