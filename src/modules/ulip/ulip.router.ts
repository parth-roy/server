import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth.middleware';
import { validate } from '@shared/middleware/validate';
import * as UlipController from './ulip.controller';
import {
  verifyDlSchema,
  verifyRcSchema,
  verifyFastagSchema,
  verifyEchallanSchema,
  digilockerInitSchema,
  digilockerVerifyOtpSchema,
  digilockerFetchDocsSchema,
  manualKycUploadSchema,
} from './ulip.schema';

export const ulipRouter = Router();

// All ULIP verification routes require an authenticated user (Driver / Worker)
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

// ─── DIGILOCKER KYC (Aadhaar + PAN) — Multi-Step Flow ───────────────────────
//
//  Step 01: POST /ulip/digilocker/init
//           Body: { uid, name, dob, gender, mobile, consent }
//           Returns: { requiresOtp, tokenReady, message }
//
//  Step 02: POST /ulip/digilocker/verify-otp   (new users only, skip if requiresOtp=false)
//           Body: { otp }
//           Returns: { tokenReady, message }
//
//  Step 03: POST /ulip/digilocker/fetch-docs
//           Body: { panno, panFullName, consent }
//           Returns: { aadhaarVerified, panVerified, aadhaarName, maskedUid, ... }
//
//  Fallback: POST /ulip/digilocker/manual-upload
//           Body: { aadhaarUrl?, panUrl? }
//           Returns: { status: "MANUAL_REVIEW" }
//
//  Status:  GET /ulip/digilocker/status
//           Returns: { isDocVerified, aadhaar: {...}, pan: {...} }
//
//  View:    GET /ulip/digilocker/document/:type
//           :type = "aadhaar" | "pan"
//           Returns: { type, status, dataUri }

ulipRouter.post(
  '/digilocker/init',
  validate(digilockerInitSchema),
  UlipController.digilockerInit
);

ulipRouter.post(
  '/digilocker/verify-otp',
  validate(digilockerVerifyOtpSchema),
  UlipController.digilockerVerifyOtp
);

ulipRouter.post(
  '/digilocker/fetch-docs',
  validate(digilockerFetchDocsSchema),
  UlipController.digilockerFetchDocuments
);

ulipRouter.post(
  '/digilocker/manual-upload',
  validate(manualKycUploadSchema),
  UlipController.digilockerManualUpload
);

ulipRouter.get(
  '/digilocker/status',
  UlipController.digilockerStatus
);

ulipRouter.get(
  '/digilocker/document/:type',
  UlipController.digilockerGetDocument
);

// ─── Legacy (deprecated) ─────────────────────────────────────────────────────
ulipRouter.post('/verify-digilocker', UlipController.verifyDigilocker);
