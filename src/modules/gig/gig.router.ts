import { Router } from 'express';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as ctrl from './gig.controller';
import * as schema from './gig.schema';
import { UserRole } from '@prisma/client';

export const gigRouter = Router();

// Customer Endpoints
gigRouter.post(
    '/customer',
    authenticate,
    requireRole(UserRole.CUSTOMER),
    validate(schema.createGigSchema),
    ctrl.createGig
);

gigRouter.get(
    '/customer',
    authenticate,
    requireRole(UserRole.CUSTOMER),
    ctrl.getCustomerGigs
);

// Workforce Endpoints
gigRouter.get(
    '/nearby',
    authenticate,
    requireRole(UserRole.WORKER),
    ctrl.getNearbyGigs
);

gigRouter.post(
    '/:id/accept',
    authenticate,
    requireRole(UserRole.WORKER),
    ctrl.acceptGig
);

// Admin Endpoints
gigRouter.get(
    '/admin',
    authenticate,
    requireRole(UserRole.ADMIN),
    ctrl.getAllGigsAdmin
);
