import { Router } from 'express';
import { validate } from '@shared/middleware/validate';
import { authenticate, requireRole, optionalAuth } from '@shared/middleware/auth.middleware';
import { UserRole } from '@prisma/client';
import * as ctrl from './leads.controller';
import {
  CreateWorkforceLeadSchema,
  GetLeadsQuerySchema,
  UpdateWorkforceLeadStatusSchema
} from './leads.schema';

export const publicLeadsRouter = Router();
export const adminLeadsRouter = Router();

// ── Public Routes (For website forms) ──
publicLeadsRouter.post(
  '/workforce',
  optionalAuth,
  validate(CreateWorkforceLeadSchema),
  ctrl.createWorkforceLead
);

// ── Admin Routes (Protected) ──
adminLeadsRouter.use(authenticate, requireRole(UserRole.ADMIN));

adminLeadsRouter.get(
  '/workforce',
  validate(GetLeadsQuerySchema, 'query'),
  ctrl.getWorkforceLeads
);

adminLeadsRouter.patch(
  '/workforce/:id/status',
  validate(UpdateWorkforceLeadStatusSchema),
  ctrl.updateWorkforceLeadStatus
);
