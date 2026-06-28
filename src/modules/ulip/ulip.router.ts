import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as UlipController from './ulip.controller';
import { verifyDlSchema, verifyRcSchema, verifyFastagSchema, verifyEchallanSchema, verifyDigilockerSchema } from './ulip.schema';

export const ulipRouter = Router();

// All ULIP verification routes require an authenticated user (Driver)
ulipRouter.use(authenticate);

// ─── Driving License (SARATHI) ───────────────────────────────────────────────
ulipRouter.post(
  '/verify-dl',
  validate(verifyDlSchema),
  UlipController.verifyDriverLicense
);

// ─── Vehicle Registration (VAHAN) ────────────────────────────────────────────
ulipRouter.post(
  '/verify-rc',
  validate(verifyRcSchema),
  UlipController.verifyVehicleRc
);

// ─── FASTAG ──────────────────────────────────────────────────────────────────
ulipRouter.post(
  '/verify-fastag',
  validate(verifyFastagSchema),
  UlipController.verifyFastag
);

// ─── E-CHALLAN ───────────────────────────────────────────────────────────────
ulipRouter.post(
  '/verify-echallan',
  validate(verifyEchallanSchema),
  UlipController.verifyEchallan
);

// ─── DIGILOCKER ──────────────────────────────────────────────────────────────
ulipRouter.post(
  '/verify-digilocker',
  validate(verifyDigilockerSchema),
  UlipController.verifyDigilocker
);
