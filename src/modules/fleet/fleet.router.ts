/**
 * fleet.router.ts — Route definitions for the Fleet & ULIP module
 *
 * All routes:
 *  - Require authenticate (JWT)
 *  - Require requireRole('DRIVER')
 *  - Are rate-limited (max 10 verification calls/IP/min) for ULIP quota protection
 *
 * SECURITY NOTE: ULIP verification routes carry a stricter rate limit.
 * Unlimited calls = burned ULIP API quota + compliance risk.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole } from '@shared/middleware/auth.middleware';
import * as fleetController from './fleet.controller';

export const fleetRouter = Router();

// ── Rate limiter for ULIP verification endpoints ──────────────────────
// 10 calls per IP per minute — protects ULIP API quota from abuse
const ulipRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification requests. Please wait a minute before trying again.',
    code: 'ULIP_RATE_LIMITED',
  },
});

// ── Admin Override Routes ───────────────────────────────────────────────
// These bypass the DRIVER role requirement and strictly require ADMIN
fleetRouter.post(
  '/admin/drivers/:driverId/verify-override',
  authenticate,
  requireRole('ADMIN'),
  fleetController.adminOverrideVerification
);

// ── Middleware applied to ALL fleet routes below ──────────────────────
fleetRouter.use(authenticate, requireRole('DRIVER'));

// ── Driver Profile ────────────────────────────────────────────────────
// POST /api/v1/fleet/drivers/register
fleetRouter.post('/drivers/register', fleetController.registerDriver);

// GET /api/v1/fleet/drivers/me
fleetRouter.get('/drivers/me', fleetController.getMyProfile);

// PATCH /api/v1/fleet/drivers/status
fleetRouter.patch('/drivers/status', fleetController.updateStatus);

// ── Vehicle ───────────────────────────────────────────────────────────
// POST /api/v1/fleet/vehicles/register
fleetRouter.post('/vehicles/register', fleetController.registerVehicle);

// ── ULIP Verification (rate-limited) ─────────────────────────────────
// POST /api/v1/fleet/drivers/verify-license  (SARATHI AUTHAPI/03)
fleetRouter.post(
  '/drivers/verify-license',
  ulipRateLimit,
  fleetController.verifyLicense
);

// POST /api/v1/fleet/vehicles/verify-rc  (VAHAN AUTHAPI/02)
fleetRouter.post(
  '/vehicles/verify-rc',
  ulipRateLimit,
  fleetController.verifyVehicleRc
);