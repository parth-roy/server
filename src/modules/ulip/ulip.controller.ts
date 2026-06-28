/**
 * ulip.controller.ts — ULIP API Controllers (Async Background Queue Version)
 *
 * ARCHITECTURE CHANGE:
 *   Previously: Controller called ULIP gov APIs synchronously → 90s wait → app froze.
 *   Now:        Controller dispatches job to BullMQ → returns HTTP 202 instantly.
 *               Worker (ulip.worker.ts) calls ULIP via AWS T3 in the background.
 *               Worker pushes result to Flutter via Socket.IO `ulip_verification_result`.
 *
 * ULIP ROUTING:
 *   All ULIP API calls are made from the AWS T3 server (Indian IP, ULIP whitelisted).
 *   The DigitalOcean backend NEVER calls ULIP directly — it only queues the job.
 */

import { prisma } from '@shared/db/prisma';
import { Request, Response, NextFunction } from 'express';
import { UlipVerifStatus } from '@prisma/client';
import { logger } from '@shared/logger';
import { AppError } from '@shared/errors/AppError';
import { ulipVerificationQueue } from '@shared/queue';
import type {
  UlipSarathiJobData,
  UlipVahanJobData,
  UlipFastagJobData,
  UlipEchallanJobData,
  UlipDigilockerJobData,
} from '@shared/queue/workers/ulip.worker';


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


// ─── DIGILOCKER ───────────────────────────────────────────────────────────────

export async function verifyDigilocker(req: Request, res: Response, next: NextFunction) {
  try {
    const { documentType, documentNumber } = req.body;
    const userId = req.user!.id;

    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw AppError.notFound('Driver not found');

    const docNum = documentNumber || driver.dlNumber;
    if (!docNum) throw AppError.badRequest('Document number missing');

    let dob: string | undefined;
    if (documentType === 'DL') {
      if (!driver.dob) {
        return res.status(400).json({
          success: false,
          message: 'Date of birth not found. Please complete driving license verification first.',
          code: 'DOB_MISSING',
        });
      }
      dob = new Date(driver.dob).toISOString().split('T')[0];
    }

    const jobData: UlipDigilockerJobData = { type: 'DIGILOCKER', driverId: driver.id, userId, documentType, documentNumber: docNum, dob };
    await ulipVerificationQueue.add('digilocker-verify', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info(`[ULIP] DIGILOCKER job queued for driver ${driver.id} (${documentType})`);
    return res.status(202).json({ success: true, message: 'DigiLocker verification submitted.', data: { status: UlipVerifStatus.PENDING } });
  } catch (error) {
    next(error);
  }
}
