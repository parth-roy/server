/**
 * ulip.controller.ts — ULIP API Controllers
 *
 * ARCHITECTURE:
 *   SARATHI / VAHAN / FASTAG / ECHALLAN:
 *     Dispatched via BullMQ queue (async background) → returns HTTP 202 instantly.
 *     Worker processes job, pushes result via Socket.IO `ulip_verification_result`.
 *
 *   DIGILOCKER (Aadhaar & PAN KYC):
 *     Handled synchronously (3 steps) because each step requires the previous
 *     step's response before proceeding.
 *
 *     POST /ulip/digilocker/init       → Step 01 (+ sometimes auto-completes Step 03)
 *     POST /ulip/digilocker/verify-otp → Step 02 + auto Step 03 (new users only)
 *     POST /ulip/digilocker/fetch-docs → Step 04 (PAN) + Step 05 (Aadhaar)
 *     POST /ulip/digilocker/manual-upload → Fallback: save S3 URLs, mark MANUAL_REVIEW
 *     GET  /ulip/digilocker/status     → Returns current KYC status for the worker
 */

import { prisma } from '@shared/db/prisma';
import { Request, Response, NextFunction } from 'express';
import { UlipVerifStatus, DigiKycStatus } from '@prisma/client';
import { logger } from '@shared/logger';
import { AppError } from '@shared/errors/AppError';
import { ulipVerificationQueue } from '@shared/queue';
import { sendSuccess } from '@shared/utils/response';
import type {
  UlipSarathiJobData,
  UlipVahanJobData,
  UlipFastagJobData,
  UlipEchallanJobData,
} from '@shared/queue/workers/ulip.worker';
import {
  initDigilockerSession,
  verifyDigilockerOtp,
  exchangeDigilockerToken,
  fetchDigilockerPan,
  fetchDigilockerAadhaar,
} from './ulip.service';


// ─── SARATHI (Driving License) ────────────────────────────────────────────────

export async function verifyDriverLicense(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { dlNumber, dob, driverName, permit } = req.body as {
      dlNumber: string;
      dob: string;
      driverName?: string;
      permit?: string;
    };

    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new AppError('Driver profile not found.', 404);

    // Immediately mark as PENDING in DB so UI can reflect the status
    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        dlNumber,
        dob: new Date(dob),
        dlVerifStatus: UlipVerifStatus.PENDING,
        dlVerifiedAt: null,
      },
    });

    // Dispatch background job — controller returns instantly after this
    const jobData: UlipSarathiJobData = { type: 'SARATHI', driverId: driver.id, userId, dlNumber, dob, driverName, permit };
    await ulipVerificationQueue.add('sarathi-verify', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s between retries
    });

    logger.info(`[ULIP] SARATHI job queued for driver ${driver.id} (dlNumber: ${dlNumber})`);

    // Return immediately — Flutter app shows "Verification in progress"
    return res.status(202).json({
      success: true,
      message: 'Verification submitted. You will be notified once complete.',
      data: { status: UlipVerifStatus.PENDING },
    });
  } catch (error) {
    next(error);
  }
}


// ─── VAHAN (Vehicle Registration) ────────────────────────────────────────────

export async function verifyVehicleRc(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { vehicleId, ownerName, chassisNumber, engineNumber } = req.body as {
      vehicleId: string;
      ownerName?: string;
      chassisNumber?: string;
      engineNumber?: string;
    };

    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new AppError('Driver profile not found.', 404);

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new AppError('Vehicle not found.', 404);

    // Immediately mark as PENDING in DB
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        rcVerifStatus: UlipVerifStatus.PENDING,
        rcVerifiedAt: null,
      },
    });

    const jobData: UlipVahanJobData = {
      type: 'VAHAN',
      driverId: driver.id,
      userId,
      vehicleId,
      vehicleRegistrationNo: vehicle.registrationNo,
      ownerName,
      chassisNumber,
      engineNumber,
    };
    await ulipVerificationQueue.add('vahan-verify', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info(`[ULIP] VAHAN job queued for vehicle ${vehicle.id} (${vehicle.registrationNo})`);

    return res.status(202).json({
      success: true,
      message: 'Verification submitted. You will be notified once complete.',
      data: { status: UlipVerifStatus.PENDING },
    });
  } catch (error) {
    next(error);
  }
}


// ─── FASTAG ───────────────────────────────────────────────────────────────────

export async function verifyFastag(req: Request, res: Response, next: NextFunction) {
  try {
    const { vehicleId, vehicleNumber } = req.body;
    const userId = req.user!.id;

    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new AppError('Driver profile not found.', 404);

    let regNo = vehicleNumber;
    if (vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) throw AppError.notFound('Vehicle not found');
      regNo = vehicle.registrationNo;
    }
    if (!regNo) throw AppError.badRequest('Vehicle number or ID is required');

    const jobData: UlipFastagJobData = { type: 'FASTAG', driverId: driver.id, userId, vehicleId, vehicleNumber: regNo };
    await ulipVerificationQueue.add('fastag-verify', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info(`[ULIP] FASTAG job queued for vehicle ${regNo}`);
    return res.status(202).json({ success: true, message: 'FASTAG verification submitted.', data: { status: UlipVerifStatus.PENDING } });
  } catch (error) {
    next(error);
  }
}


// ─── E-CHALLAN ────────────────────────────────────────────────────────────────

export async function verifyEchallan(req: Request, res: Response, next: NextFunction) {
  try {
    const { vehicleId, vehicleNumber } = req.body;
    const userId = req.user!.id;

    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new AppError('Driver profile not found.', 404);

    let regNo = vehicleNumber;
    if (vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) throw AppError.notFound('Vehicle not found');
      regNo = vehicle.registrationNo;
    }
    if (!regNo) throw AppError.badRequest('Vehicle number or ID is required');

    const jobData: UlipEchallanJobData = { type: 'ECHALLAN', driverId: driver.id, userId, vehicleId, vehicleNumber: regNo };
    await ulipVerificationQueue.add('echallan-verify', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info(`[ULIP] ECHALLAN job queued for vehicle ${regNo}`);
    return res.status(202).json({ success: true, message: 'E-Challan verification submitted.', data: { status: UlipVerifStatus.PENDING } });
  } catch (error) {
    next(error);
  }
}


// ─── DIGILOCKER — Step 01: Initiate KYC Session ──────────────────────────────
//
// POST /api/v1/ulip/digilocker/init
//
// Flow:
//   1. Validates worker exists
//   2. Calls ULIP DIGILOCKER/01 with Aadhaar demographic data
//   3. Stores code, code_verifier, code_challenge in Worker record
//   4a. If requiresOtp=false → calls Step 03 immediately (returning user)
//   4b. If requiresOtp=true  → returns {requiresOtp: true} for frontend to collect OTP

export async function digilockerInit(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { uid, name, dob, gender, mobile, consent } = req.body;

    const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
    if (!worker) throw AppError.notFound('Worker profile not found');

    // Mark Aadhaar as PENDING so UI shows "in progress"
    await prisma.worker.update({
      where: { id: worker.id },
      data: { aadhaarVerifStatus: DigiKycStatus.PENDING },
    });

    // ── Step 01: Call ULIP DIGILOCKER/01 ──
    const step01 = await initDigilockerSession({ uid, name, dob, gender, mobile, consent });

    // ── Store PKCE state in DB ──
    await prisma.worker.update({
      where: { id: worker.id },
      data: {
        digiCode: step01.code,
        digiCodeVerifier: step01.codeVerifier,
        digiCodeChallenge: step01.codeChallenge,
      },
    });

    // ── Returning user (no OTP required) → immediately exchange for token ──
    if (!step01.requiresOtp) {
      const step03 = await exchangeDigilockerToken({
        code: step01.code,
        codeVerifier: step01.codeVerifier,
      });

      const expiresAt = new Date(Date.now() + step03.expiresIn * 1000);
      await prisma.worker.update({
        where: { id: worker.id },
        data: {
          digiAccessToken: step03.accessToken,
          digiTokenExpiresAt: expiresAt,
          aadhaarVerifStatus: DigiKycStatus.TOKEN_READY,
          digiCode: null, // clear code after use
        },
      });

      logger.info(`[DIGI] Worker ${worker.id} — returning user, token ready. Awaiting doc fetch.`);
      return sendSuccess(res, {
        requiresOtp: false,
        tokenReady: true,
        message: 'Aadhaar linked. Please proceed to fetch your documents.',
      });
    }

    // ── New user → OTP was sent → update status ──
    await prisma.worker.update({
      where: { id: worker.id },
      data: { aadhaarVerifStatus: DigiKycStatus.OTP_SENT },
    });

    logger.info(`[DIGI] Worker ${worker.id} — new user, OTP sent to mobile ending ...${mobile.slice(-4)}`);
    return sendSuccess(res, {
      requiresOtp: true,
      tokenReady: false,
      message: 'OTP sent to your registered mobile number. Please enter the OTP.',
    });
  } catch (error) {
    next(error);
  }
}


// ─── DIGILOCKER — Step 02: Verify OTP (new users only) ───────────────────────
//
// POST /api/v1/ulip/digilocker/verify-otp
//
// Automatically calls Step 03 (token exchange) after OTP validation.

export async function digilockerVerifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { otp } = req.body;

    const worker = await prisma.worker.findUnique({
      where: { userId },
      select: {
        id: true,
        digiCode: true,
        digiCodeVerifier: true,
        digiCodeChallenge: true,
        user: { select: { phone: true } },
      },
    });
    if (!worker) throw AppError.notFound('Worker profile not found');
    if (!worker.digiCode || !worker.digiCodeVerifier || !worker.digiCodeChallenge) {
      throw AppError.badRequest('Digilocker session expired. Please start verification again.');
    }

    // ── Step 02: Verify OTP ──
    const step02 = await verifyDigilockerOtp({
      mobile: worker.user.phone,
      otp,
      codeChallenge: worker.digiCodeChallenge,
      codeVerifier: worker.digiCodeVerifier,
    });

    // ── Step 03: Exchange code for access token ──
    const step03 = await exchangeDigilockerToken({
      code: step02.code,
      codeVerifier: step02.codeVerifier,
    });

    const expiresAt = new Date(Date.now() + step03.expiresIn * 1000);
    await prisma.worker.update({
      where: { id: worker.id },
      data: {
        digiAccessToken: step03.accessToken,
        digiTokenExpiresAt: expiresAt,
        aadhaarVerifStatus: DigiKycStatus.TOKEN_READY,
        digiCode: null,          // Clear used code
        digiCodeChallenge: null, // Clear challenge
        // Keep code_verifier cleared too
        digiCodeVerifier: null,
      },
    });

    logger.info(`[DIGI] Worker ${worker.id} — OTP verified, access_token obtained`);
    return sendSuccess(res, {
      tokenReady: true,
      message: 'OTP verified. Please proceed to fetch your documents.',
    });
  } catch (error) {
    next(error);
  }
}


// ─── DIGILOCKER — Step 04+05: Fetch Documents ────────────────────────────────
//
// POST /api/v1/ulip/digilocker/fetch-docs
//
// Fetches PAN PDF (Step 04) and Aadhaar XML (Step 05) using the stored access_token.
// Saves base64 content directly to the Worker record (aadhaarUrl, panUrl as data URIs,
// or uploads to S3 — for now we store the base64 inline and let admin download).

export async function digilockerFetchDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { panno, panFullName, consent } = req.body;

    const worker = await prisma.worker.findUnique({
      where: { userId },
      select: { id: true, digiAccessToken: true, digiTokenExpiresAt: true },
    });
    if (!worker) throw AppError.notFound('Worker profile not found');
    if (!worker.digiAccessToken) {
      throw AppError.badRequest('Digilocker token not found. Please complete Aadhaar verification first.');
    }

    // Check token expiry
    if (worker.digiTokenExpiresAt && new Date() > worker.digiTokenExpiresAt) {
      await prisma.worker.update({
        where: { id: worker.id },
        data: { aadhaarVerifStatus: DigiKycStatus.FAILED, digiAccessToken: null },
      });
      throw AppError.badRequest('Digilocker session expired. Please start verification again.');
    }

    // ── Step 04: Fetch PAN PDF ──
    const panResult = await fetchDigilockerPan({
      panno,
      panFullName,
      accessToken: worker.digiAccessToken,
    });

    // ── Step 05: Fetch Aadhaar XML ──
    const aadhaarResult = await fetchDigilockerAadhaar({
      accessToken: worker.digiAccessToken,
    });

    // ── Store results in DB ──
    // Store as data URIs (base64) so admin and worker can view/download directly.
    // Production: replace with S3 upload and store the URL instead.
    const aadhaarDataUri = `data:image/jpeg;base64,${aadhaarResult.photoBase64}`;
    const panDataUri = `data:application/pdf;base64,${panResult.base64Pdf}`;

    await prisma.worker.update({
      where: { id: worker.id },
      data: {
        // Aadhaar fields
        aadhaarNumber: aadhaarResult.uid,    // Already masked by UIDAI (e.g. "xxxxxxxx9858")
        aadhaarUrl: aadhaarDataUri,
        aadhaarVerifStatus: DigiKycStatus.VERIFIED,
        aadhaarVerifiedAt: new Date(),
        // PAN fields
        panNumber: panno,
        panUrl: panDataUri,
        panVerifStatus: DigiKycStatus.VERIFIED,
        panVerifiedAt: new Date(),
        // Clear Digilocker session tokens (security best practice)
        digiAccessToken: null,
        digiTokenExpiresAt: null,
        digiCodeVerifier: null,
        digiCodeChallenge: null,
        digiCode: null,
        // Mark fully verified if both documents are now done
        isDocVerified: true,
      },
    });

    logger.info(`[DIGI] Worker ${worker.id} — VERIFIED. Aadhaar UID: ${aadhaarResult.uid}, PAN: ${panno}`);
    return sendSuccess(res, {
      aadhaarVerified: true,
      panVerified: true,
      aadhaarName: aadhaarResult.name,
      aadhaarDob: aadhaarResult.dob,
      aadhaarGender: aadhaarResult.gender,
      aadhaarAddress: aadhaarResult.address,
      maskedUid: aadhaarResult.uid,
      message: 'KYC verification complete! Your Aadhaar and PAN have been verified.',
    }, 'KYC documents fetched and verified successfully');
  } catch (error) {
    next(error);
  }
}


// ─── DIGILOCKER — Manual Upload Fallback ─────────────────────────────────────
//
// POST /api/v1/ulip/digilocker/manual-upload
//
// When Digilocker API is unavailable or the user can't complete the OTP flow,
// they can upload scanned copies. These are stored with MANUAL_REVIEW status
// and an admin must approve them before isDocVerified is set to true.

export async function digilockerManualUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { aadhaarUrl, panUrl } = req.body;

    const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
    if (!worker) throw AppError.notFound('Worker profile not found');

    const updateData: any = {};
    if (aadhaarUrl) {
      updateData.aadhaarUrl = aadhaarUrl;
      updateData.aadhaarVerifStatus = DigiKycStatus.MANUAL_REVIEW;
    }
    if (panUrl) {
      updateData.panUrl = panUrl;
      updateData.panVerifStatus = DigiKycStatus.MANUAL_REVIEW;
    }

    await prisma.worker.update({ where: { id: worker.id }, data: updateData });

    logger.info(`[DIGI] Worker ${worker.id} — manual KYC upload submitted for admin review`);
    return sendSuccess(res, {
      status: 'MANUAL_REVIEW',
      message: 'Documents submitted. Our team will verify them within 24 hours.',
    });
  } catch (error) {
    next(error);
  }
}


// ─── DIGILOCKER — KYC Status ─────────────────────────────────────────────────
//
// GET /api/v1/ulip/digilocker/status
//
// Returns the worker's current KYC status so the Flutter app can show
// the right UI state without fetching the full profile.

export async function digilockerStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const worker = await prisma.worker.findUnique({
      where: { userId },
      select: {
        isDocVerified: true,
        aadhaarNumber: true,
        aadhaarVerifStatus: true,
        aadhaarVerifiedAt: true,
        aadhaarUrl: true,
        panNumber: true,
        panVerifStatus: true,
        panVerifiedAt: true,
        panUrl: true,
      },
    });
    if (!worker) throw AppError.notFound('Worker profile not found');

    return sendSuccess(res, {
      isDocVerified: worker.isDocVerified,
      aadhaar: {
        status: worker.aadhaarVerifStatus,
        verifiedAt: worker.aadhaarVerifiedAt,
        maskedUid: worker.aadhaarNumber,
        hasDocument: !!worker.aadhaarUrl,
      },
      pan: {
        status: worker.panVerifStatus,
        verifiedAt: worker.panVerifiedAt,
        panNumber: worker.panNumber,
        hasDocument: !!worker.panUrl,
      },
    });
  } catch (error) {
    next(error);
  }
}


// ─── DIGILOCKER — View/Download Document ─────────────────────────────────────
//
// GET /api/v1/ulip/digilocker/document/:type
// :type = "aadhaar" | "pan"
//
// Returns the document as a data URI so the Flutter app can display/download it.

export async function digilockerGetDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { type } = req.params as { type: 'aadhaar' | 'pan' };

    if (!['aadhaar', 'pan'].includes(type)) {
      throw AppError.badRequest('Document type must be "aadhaar" or "pan"');
    }

    const worker = await prisma.worker.findUnique({
      where: { userId },
      select: { aadhaarUrl: true, panUrl: true, aadhaarVerifStatus: true, panVerifStatus: true },
    });
    if (!worker) throw AppError.notFound('Worker profile not found');

    const url = type === 'aadhaar' ? worker.aadhaarUrl : worker.panUrl;
    const status = type === 'aadhaar' ? worker.aadhaarVerifStatus : worker.panVerifStatus;

    if (!url) {
      throw AppError.notFound(`${type === 'aadhaar' ? 'Aadhaar' : 'PAN'} document not yet fetched`);
    }

    return sendSuccess(res, { type, status, dataUri: url });
  } catch (error) {
    next(error);
  }
}


// ─── Legacy endpoint (kept for backward compatibility) ────────────────────────

export async function verifyDigilocker(req: Request, res: Response, next: NextFunction) {
  return res.status(410).json({
    success: false,
    message: 'This endpoint is deprecated. Use POST /ulip/digilocker/init instead.',
    code: 'ENDPOINT_DEPRECATED',
  });
}
