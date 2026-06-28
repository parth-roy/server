/**
 * ulip.worker.ts — Background worker for ULIP government API verification
 *
 * WHY THIS EXISTS:
 *   Government ULIP APIs (SARATHI/VAHAN) are notoriously slow and unreliable.
 *   They have 90-second timeouts and frequent 502 Bad Gateway errors.
 *   Running these calls synchronously in the HTTP request froze the Flutter app
 *   and blocked Node.js from handling other requests during the wait.
 *
 * HOW IT WORKS:
 *   1. Controller instantly returns HTTP 202 (Accepted) to the Flutter app.
 *   2. Controller dispatches a job to the ulip-verification BullMQ queue.
 *   3. THIS worker picks up the job and calls the AWS T3 → ULIP gov server.
 *   4. On result, worker updates DB and pushes Socket.IO event to the driver.
 *
 * ARCHITECTURE:
 *   - All ULIP calls go through the AWS T3 server (Indian IP, whitelisted by ULIP).
 *   - The DigitalOcean server NEVER calls ULIP directly (not whitelisted).
 *   - BullMQ uses local Redis (localhost:6379) — zero extra latency.
 *   - Retries: 3 attempts with exponential backoff (1s, 2s, 4s) via BullMQ config.
 *             ULIP service also has internal retry logic for 502 errors.
 */

import { createWorker, QUEUES } from '../index';
import { prisma } from '@shared/db/prisma';
import { logger } from '@shared/logger';
import { emitToDriverRoom } from '@shared/socket/socket.instance';
import * as UlipService from '@modules/ulip/ulip.service';
import { UlipVerifStatus } from '@prisma/client';

// ── Job payload types ──────────────────────────────────────────────────────────

export interface UlipSarathiJobData {
  type: 'SARATHI';
  driverId: string;
  userId: string;
  dlNumber: string;
  dob: string;
  driverName?: string;
  permit?: string;
}

export interface UlipVahanJobData {
  type: 'VAHAN';
  driverId: string;
  userId: string;
  vehicleId: string;
  vehicleRegistrationNo: string;
  ownerName?: string;
  chassisNumber?: string;
  engineNumber?: string;
}

export interface UlipFastagJobData {
  type: 'FASTAG';
  driverId: string;
  userId: string;
  vehicleId?: string;
  vehicleNumber: string;
}

export interface UlipEchallanJobData {
  type: 'ECHALLAN';
  driverId: string;
  userId: string;
  vehicleId?: string;
  vehicleNumber: string;
}

export interface UlipDigilockerJobData {
  type: 'DIGILOCKER';
  driverId: string;
  userId: string;
  documentType: string;
  documentNumber: string;
  dob?: string;
}

export type UlipJobData =
  | UlipSarathiJobData
  | UlipVahanJobData
  | UlipFastagJobData
  | UlipEchallanJobData
  | UlipDigilockerJobData;

// ── SARATHI processor ──────────────────────────────────────────────────────────

async function processSarathi(data: UlipSarathiJobData): Promise<void> {
  const { driverId, userId, dlNumber, dob, driverName, permit } = data;
  logger.info(`[ULIP Worker] Processing SARATHI for driver ${driverId}`);

  const sarathiResponse = await UlipService.verifySarathi(dlNumber, dob, driverName, permit);

  let status: UlipVerifStatus = UlipVerifStatus.FAILED;
  let isMatch = false;
  let permitTypes: string | null = null;

  if (sarathiResponse?.response?.length > 0) {
    const outerResponse = sarathiResponse.response[0].response;
    if (outerResponse?.dldetobj && outerResponse.dldetobj.length > 0) {
      const dlStatus = outerResponse.dldetobj[0]?.dlobj?.dlStatus;
      if (dlStatus?.toUpperCase() === 'ACTIVE') {
        status = UlipVerifStatus.VERIFIED;
        isMatch = true;
        permitTypes = outerResponse.dldetobj[0]?.dlcovs
          ?.map((c: any) => c.covabbrv?.trim())
          .filter(Boolean)
          .join(',') || null;
      }
    }
  }

  await prisma.driver.update({
    where: { id: driverId },
    data: {
      dlNumber,
      dob: new Date(dob),
      dlVerifStatus: status,
      dlVerifiedAt: isMatch ? new Date() : null,
      dlUlipRawResponse: sarathiResponse as any,
      permitTypes,
    },
  });

  await prisma.verificationLog.create({
    data: {
      entityType: 'driver',
      entityId: driverId,
      apiCalled: 'SARATHI/01',
      requestBody: { dlnumber: dlNumber, dob, driverName, permit },
      response: sarathiResponse as any,
      status,
      calledBy: userId,
    },
  });

  // Push result directly to driver's socket room
  emitToDriverRoom(driverId, 'ulip_verification_result', {
    type: 'DL',
    status,
    verified: isMatch,
    message: isMatch
      ? 'Driving License verified successfully.'
      : 'Verification failed or DL not active.',
  });

  logger.info(`[ULIP Worker] SARATHI for driver ${driverId} → ${status}`);
}

// ── VAHAN processor ────────────────────────────────────────────────────────────

async function processVahan(data: UlipVahanJobData): Promise<void> {
  const { driverId, userId, vehicleId, vehicleRegistrationNo, ownerName, chassisNumber, engineNumber } = data;
  logger.info(`[ULIP Worker] Processing VAHAN for vehicle ${vehicleId}`);

  const vahanResponse = await UlipService.verifyVahan(vehicleRegistrationNo, ownerName, chassisNumber, engineNumber);

  let status: UlipVerifStatus = UlipVerifStatus.FAILED;
  let isMatch = false;
  let parsedData: any = null;

  if (vahanResponse?.response?.length > 0) {
    let respData = vahanResponse.response[0].response as any;

    // ULIP VAHAN staging can return XML inside JSON
    if (typeof respData === 'string' && respData.includes('<VehicleDetails>')) {
      const statusMatch = respData.match(/<stautsMessage>(.*?)<\/stautsMessage>/);
      if (statusMatch?.[1] === 'OK') {
        status = UlipVerifStatus.VERIFIED;
        isMatch = true;
        parsedData = {
          rc_regn_no: respData.match(/<rc_regn_no>(.*?)<\/rc_regn_no>/)?.[1] || vehicleRegistrationNo,
          rc_owner_name: respData.match(/<rc_owner_name>(.*?)<\/rc_owner_name>/)?.[1] || ownerName,
          rc_chasi_no: respData.match(/<rc_chasi_no>(.*?)<\/rc_chasi_no>/)?.[1] || chassisNumber,
          rc_eng_no: respData.match(/<rc_eng_no>(.*?)<\/rc_eng_no>/)?.[1] || engineNumber,
        };
      }
    } else if (respData?.rc_regn_no?.toUpperCase() === vehicleRegistrationNo.toUpperCase()) {
      status = UlipVerifStatus.VERIFIED;
      isMatch = true;
      parsedData = respData;
    }
  }

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      rcVerifStatus: status,
      rcVerifiedAt: isMatch ? new Date() : null,
      rcUlipRawResponse: vahanResponse as any,
      ownerName: isMatch ? (parsedData?.rc_owner_name || ownerName) : ownerName,
      chassisNumber: isMatch ? (parsedData?.rc_chasi_no || chassisNumber) : chassisNumber,
      engineNumber: isMatch ? (parsedData?.rc_eng_no || engineNumber) : engineNumber,
    },
  });

  if (isMatch) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { profileComplete: true } }),
      prisma.driver.update({ where: { userId }, data: { isDocVerified: true } }),
    ]);
  }

  await prisma.verificationLog.create({
    data: {
      entityType: 'vehicle',
      entityId: vehicleId,
      apiCalled: 'VAHAN/01',
      requestBody: { vehiclenumber: vehicleRegistrationNo, ownername: ownerName, chasisnumber: chassisNumber, enginenumber: engineNumber },
      response: vahanResponse as any,
      status,
      calledBy: userId,
    },
  });

  emitToDriverRoom(driverId, 'ulip_verification_result', {
    type: 'RC',
    status,
    verified: isMatch,
    profileComplete: isMatch,
    message: isMatch ? 'Vehicle RC verified successfully.' : 'Verification failed.',
  });

  logger.info(`[ULIP Worker] VAHAN for vehicle ${vehicleId} → ${status}`);
}

// ── FASTAG processor ───────────────────────────────────────────────────────────

async function processFastag(data: UlipFastagJobData): Promise<void> {
  const { driverId, userId, vehicleId, vehicleNumber } = data;
  let status: UlipVerifStatus;
  let fastagResponse: any;

  try {
    fastagResponse = await UlipService.verifyFastag(vehicleNumber);
    const resp  = fastagResponse?.response?.[0]?.response;
    const layer = fastagResponse?.response?.[0];
    const rawStatus = (resp?.result || resp?.Result || layer?.responseStatus || resp?.TagStatus || resp?.status || '').toString().toUpperCase();
    const respCode  = (resp?.respCode || resp?.RespCode || '').toString();

    if (rawStatus === 'SUCCESS' || rawStatus === 'ACTIVE' || respCode === '000') {
      status = UlipVerifStatus.VERIFIED;
    } else if (rawStatus === 'FAILED' || rawStatus === 'INACTIVE' || rawStatus === 'BLACKLISTED') {
      status = UlipVerifStatus.FAILED;
    } else {
      status = UlipVerifStatus.MANUAL_REVIEW;
    }
  } catch (err: any) {
    status = UlipVerifStatus.FAILED;
    fastagResponse = { error: true, message: err.message };
  }

  await prisma.verificationLog.create({
    data: {
      entityType: 'vehicle',
      entityId: vehicleId ?? vehicleNumber,
      apiCalled: 'FASTAG/01',
      requestBody: { vehiclenumber: vehicleNumber },
      response: fastagResponse,
      status,
      calledBy: userId,
    },
  });

  emitToDriverRoom(driverId, 'ulip_verification_result', { type: 'FASTAG', status, verified: status === UlipVerifStatus.VERIFIED });
  logger.info(`[ULIP Worker] FASTAG for vehicle ${vehicleNumber} → ${status}`);
}

// ── ECHALLAN processor ─────────────────────────────────────────────────────────

async function processEchallan(data: UlipEchallanJobData): Promise<void> {
  const { driverId, userId, vehicleId, vehicleNumber } = data;
  let status: UlipVerifStatus;
  let echallanResponse: any;

  try {
    echallanResponse = await UlipService.verifyEchallan(vehicleNumber);
    const resp       = echallanResponse?.response?.[0]?.response;
    const layer      = echallanResponse?.response?.[0];
    const pendingCount = resp?.pendingChallanCount ?? resp?.PendingChallanCount ?? null;
    const challanStatus = (resp?.challanStatus || '').toString().toUpperCase();
    const statusMsg  = (layer?.statusMessage || echallanResponse?.status || '').toString().toUpperCase();
    const statusCode = (layer?.statusCode || '').toString();

    if (pendingCount === 0 || challanStatus.includes('NO PENDING') || statusCode === '101' || statusMsg === 'SUCCESSFUL' || statusMsg === 'SUCCESS') {
      status = UlipVerifStatus.VERIFIED;
    } else if ((pendingCount !== null && pendingCount > 0) || challanStatus.includes('PENDING')) {
      status = UlipVerifStatus.FAILED;
    } else {
      status = UlipVerifStatus.MANUAL_REVIEW;
    }
  } catch (err: any) {
    status = UlipVerifStatus.FAILED;
    echallanResponse = { error: true, message: err.message };
  }

  await prisma.verificationLog.create({
    data: {
      entityType: 'vehicle',
      entityId: vehicleId ?? vehicleNumber,
      apiCalled: 'ECHALLAN/01',
      requestBody: { vehiclenumber: vehicleNumber },
      response: echallanResponse,
      status,
      calledBy: userId,
    },
  });

  emitToDriverRoom(driverId, 'ulip_verification_result', { type: 'ECHALLAN', status, verified: status === UlipVerifStatus.VERIFIED });
  logger.info(`[ULIP Worker] ECHALLAN for vehicle ${vehicleNumber} → ${status}`);
}

// ── DIGILOCKER processor ───────────────────────────────────────────────────────

async function processDigilocker(data: UlipDigilockerJobData): Promise<void> {
  const { driverId, userId, documentType, documentNumber, dob } = data;
  let status: UlipVerifStatus;
  let digilockerResponse: any;

  try {
    digilockerResponse = await UlipService.verifyDigilocker(documentNumber, documentType, dob);
    const resp = digilockerResponse?.response?.[0]?.response;
    const apiStatus = (digilockerResponse?.status || resp?.status || '').toUpperCase();
    status = (apiStatus === 'SUCCESS' || apiStatus === 'VERIFIED')
      ? UlipVerifStatus.VERIFIED
      : UlipVerifStatus.MANUAL_REVIEW;
  } catch (err: any) {
    status = UlipVerifStatus.FAILED;
    digilockerResponse = { error: true, message: err.message };
  }

  await prisma.verificationLog.create({
    data: {
      entityType: 'driver',
      entityId: driverId,
      apiCalled: 'DIGILOCKER/01',
      requestBody: { documentType, documentNumber },
      response: digilockerResponse,
      status,
      calledBy: userId,
    },
  });

  emitToDriverRoom(driverId, 'ulip_verification_result', { type: 'DIGILOCKER', status, verified: status === UlipVerifStatus.VERIFIED });
  logger.info(`[ULIP Worker] DIGILOCKER for driver ${driverId} → ${status}`);
}

// ── Worker bootstrap ───────────────────────────────────────────────────────────

export function startUlipWorker(): void {
  createWorker(QUEUES.ULIP_VERIFICATION, async (job) => {
    const data = job.data as UlipJobData;
    logger.info(`[ULIP Worker] Job received: type=${data.type} id=${job.id}`);

    switch (data.type) {
      case 'SARATHI':    await processSarathi(data);    break;
      case 'VAHAN':      await processVahan(data);      break;
      case 'FASTAG':     await processFastag(data);     break;
      case 'ECHALLAN':   await processEchallan(data);   break;
      case 'DIGILOCKER': await processDigilocker(data); break;
      default:
        logger.error(`[ULIP Worker] Unknown job type: ${(data as any).type}`);
    }
  }, 2); // concurrency=2: handle 2 simultaneous ULIP verifications

  logger.info('✅ ULIP verification worker started');
}
