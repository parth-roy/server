import { prisma } from '@shared/db/prisma';
/**
 * fleet.service.ts — Business Logic for Fleet & ULIP Verification
 *
 * Responsibilities:
 *  1. Driver profile registration & retrieval
 *  2. Vehicle registration
 *  3. ULIP SARATHI (DL) verification — calls sarathi.service.ts
 *  4. ULIP VAHAN (RC) verification — calls vahan.service.ts
 *  5. Writes VerificationLog for every government API call (legal audit trail)
 *  6. Updates Driver/Vehicle verification status based on ULIP result
 *  7. Online/Offline status management
 *
 * RULE: Business logic lives here. Controllers are thin.
 * RULE: Never call ULIP directly from here — use sarathi.service / vahan.service.
 * RULE: Never delete VerificationLog rows — it's a legal audit trail.
 */

import { PrismaClient, UlipVerifStatus } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { verifyDriverWithSarathi } from './sarathi.service';
import { verifyVehicleWithVahan } from './vahan.service';
import type {
  RegisterDriverInput,
  RegisterVehicleInput,
  VerifyLicenseInput,
  VerifyVehicleRcInput,
  UpdateDriverStatusInput,
} from './fleet.schema';


// ── Driver Profile ────────────────────────────────────────────────────

/**
 * Creates a Driver profile linked to an existing User.
 * A User can only have one Driver profile.
 */
export async function registerDriver(
  userId: string,
  input: RegisterDriverInput
): Promise<object> {
  // Guard: if already registered, just update user and return existing driver
  const existing = await prisma.driver.findUnique({ where: { userId } });
  if (existing) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        language: input.language,
        profileImageUrl: input.profileImageUrl,
      },
    });
    logger.info('[Fleet] Driver profile already exists, updated user info', { userId, driverId: existing.id });
    return _formatDriverProfile(existing);
  }

  // Update user name/language if provided, then create driver record
  const [, driver] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        language: input.language,
        profileImageUrl: input.profileImageUrl,
      },
    }),
    prisma.driver.create({
      data: {
        userId,
        licenseNumber: `PENDING_${userId}`, // placeholder until DL verification
      },
    }),
  ]);

  logger.info('[Fleet] Driver profile created', { userId, driverId: driver.id });
  return _formatDriverProfile(driver);
}

/**
 * Returns the driver profile for the authenticated user.
 */
export async function getMyDriverProfile(userId: string): Promise<object> {
  const driver = await prisma.driver.findUnique({
    where: { userId },
    include: {
      vehicle: true,
      documents: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!driver) throw AppError.notFound('Driver profile not found. Please register first.');
  
  // --- Compute Dashboard Real-time Metrics ---
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const startOfThisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfLastWeek = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  let todayEarnings = 0;
  let yesterdayEarnings = 0;
  let weeklyEarnings = 0;
  let lastWeekEarnings = 0;

  const wallet = await prisma.driverWallet.findUnique({ where: { driverId: driver.id } });
  if (wallet) {
    const txns = await prisma.driverWalletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: 'CREDIT',
        reason: 'TRIP_EARNING',
        createdAt: { gte: startOfLastWeek },
      },
      select: { amount: true, createdAt: true },
    });

    for (const tx of txns) {
      if (tx.createdAt >= startOfThisWeek) {
        weeklyEarnings += tx.amount;
      } else {
        lastWeekEarnings += tx.amount;
      }

      if (tx.createdAt >= startOfToday) {
        todayEarnings += tx.amount;
      } else if (tx.createdAt >= startOfYesterday) {
        yesterdayEarnings += tx.amount;
      }
    }
  }

  const todayTrips = await prisma.booking.count({
    where: {
      driverId: driver.id,
      status: 'COMPLETED',
      createdAt: { gte: startOfToday },
    },
  });

  const calculateTrend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    const trend = ((current - previous) / previous) * 100;
    return Math.min(Math.max(trend, -100), 100); // Cap at -100% and +100%
  };

  const profile = _formatDriverProfile(driver);
  return {
    ...profile,
    todayEarnings,
    todayTrips,
    weeklyEarnings,
    todayTrend: calculateTrend(todayEarnings, yesterdayEarnings),
    weeklyTrend: calculateTrend(weeklyEarnings, lastWeekEarnings),
  };
}

// ── Vehicle ───────────────────────────────────────────────────────────

/**
 * Registers a vehicle for the driver.
 * A driver can only have one vehicle.
 */
export async function registerVehicle(
  userId: string,
  input: RegisterVehicleInput
): Promise<object> {
  const driver = await _requireDriver(userId);

  if (driver.vehicleId) {
    // If the new registration number differs, ensure it's not taken by another driver
    if (input.registrationNo !== driver.vehicle?.registrationNo) {
      const existing = await prisma.vehicle.findUnique({
        where: { registrationNo: input.registrationNo },
      });
      if (existing) {
        throw AppError.conflict(
          `Vehicle "${input.registrationNo}" is already registered in the system`,
          'VEHICLE_REG_NO_TAKEN'
        );
      }
    }

    // Update the existing vehicle instead of blocking
    const updatedVehicle = await prisma.vehicle.update({
      where: { id: driver.vehicleId },
      data: {
        registrationNo: input.registrationNo,
        type: input.type as any,
        make: input.make,
        model: input.model,
        year: input.year,
        color: input.color,
        capacityKg: input.capacityKg,
        rcVerifStatus: 'PENDING', // Reset verification status
        rcVerifiedAt: null,
      },
    });

    logger.info('[Fleet] Vehicle updated', {
      driverId: driver.id,
      vehicleId: updatedVehicle.id,
      registrationNo: updatedVehicle.registrationNo,
    });

    return updatedVehicle;
  }

  // registrationNo already sanitized by Zod transform
  const existing = await prisma.vehicle.findUnique({
    where: { registrationNo: input.registrationNo },
  });
  if (existing) {
    throw AppError.conflict(
      `Vehicle "${input.registrationNo}" is already registered in the system`,
      'VEHICLE_REG_NO_TAKEN'
    );
  }

  const [vehicle] = await prisma.$transaction([
    prisma.vehicle.create({
      data: {
        registrationNo: input.registrationNo,
        type: input.type as any,
        make: input.make,
        model: input.model,
        year: input.year,
        color: input.color,
        capacityKg: input.capacityKg,
      },
    }),
  ]);

  // Link vehicle to driver
  await prisma.driver.update({
    where: { id: driver.id },
    data: { vehicleId: vehicle.id },
  });

  logger.info('[Fleet] Vehicle registered', {
    driverId: driver.id,
    vehicleId: vehicle.id,
    registrationNo: vehicle.registrationNo,
  });

  return vehicle;
}

// ── ULIP: DL Verification (SARATHI / AUTHAPI/03) ──────────────────────

/**
 * Verifies the driver's DL via ULIP SARATHI.
 * Stores raw ULIP response in VerificationLog (immutable audit trail).
 * Updates driver.dlVerifStatus based on result.
 */
export async function verifyDriverLicense(
  userId: string,
  input: VerifyLicenseInput
): Promise<object> {
  const driver = await _requireDriver(userId);

  // Check if DL is already used by someone else
  const existingDl = await prisma.driver.findFirst({
    where: { licenseNumber: input.dlNumber, id: { not: driver.id } },
  });
  if (existingDl) {
    throw AppError.conflict(
      'This Driving License number is already registered to another account. Please use a different one for testing.',
      'DL_ALREADY_REGISTERED'
    );
  }

  // ── MOCK MODE (ULIP IP not yet whitelisted) ────────────────────────
  // Set MOCK_ULIP=true in .env to bypass the government API during development.
  // Flip to false once ULIP support whitelists the server IP.
  if (env.MOCK_ULIP === 'true') {
    logger.warn('[Fleet] ⚠️  MOCK_ULIP=true — Skipping SARATHI API, returning fake VERIFIED result', { driverId: driver.id });
    const ulipStatus = UlipVerifStatus.VERIFIED;
    await prisma.$transaction([
      prisma.driver.update({
        where: { id: driver.id },
        data: {
          dlNumber: input.dlNumber,
          dob: new Date(input.dob),
          permitTypes: input.permit,
          dlVerifStatus: ulipStatus,
          dlVerifiedAt: new Date(),
          dlUlipRawResponse: { mock: true, note: 'MOCK_ULIP mode — real API not called' } as any,
          licenseNumber: input.dlNumber,
        },
      }),
      prisma.verificationLog.create({
        data: {
          entityType: 'driver',
          entityId: driver.id,
          apiCalled: 'AUTHAPI/03-MOCK',
          requestBody: { dlnumber: input.dlNumber, dob: input.dob },
          response: { mock: true } as any,
          status: ulipStatus,
          calledBy: userId,
        },
      }),
    ]);
    return {
      status: ulipStatus,
      isVerified: true,
      requiresManualReview: false,
      message: '✅ [DEV MODE] Driving license mock-verified. Real verification will run once ULIP IP is whitelisted.',
      fields: {},
    };
  }
  // ── END MOCK MODE ──────────────────────────────────────────────────

  logger.info('[Fleet] Starting DL verification', {
    driverId: driver.id,
    dlNumber: input.dlNumber,
  });

  let result;
  try {
    result = await verifyDriverWithSarathi({
      dlnumber: input.dlNumber,
      dob: input.dob,
      driverName: input.driverName,
      permit: input.permit,
    });
  } catch (err: any) {
    logger.error('[Fleet] SARATHI API call failed', { err: err.message });
    throw AppError.internal(
      'Government verification service is temporarily unavailable. Please try again in a moment.'
    );
  }

  let ulipStatus: UlipVerifStatus;
  if (result.isNotInSarathi) {
    ulipStatus = UlipVerifStatus.MANUAL_REVIEW;
  } else if (result.isDriverVerified) {
    ulipStatus = UlipVerifStatus.VERIFIED;
  } else {
    ulipStatus = UlipVerifStatus.FAILED;
  }

  await prisma.$transaction([
    prisma.driver.update({
      where: { id: driver.id },
      data: {
        dlNumber: input.dlNumber,
        dob: new Date(input.dob),
        permitTypes: input.permit,
        dlVerifStatus: ulipStatus,
        dlVerifiedAt: ulipStatus === UlipVerifStatus.VERIFIED ? new Date() : null,
        dlUlipRawResponse: result.rawResponse as any,
        licenseNumber: input.dlNumber,
      },
    }),
    prisma.verificationLog.create({
      data: {
        entityType: 'driver',
        entityId: driver.id,
        apiCalled: 'AUTHAPI/03',
        requestBody: {
          dlnumber: input.dlNumber,
          dob: input.dob,
          driverName: input.driverName,
          permit: input.permit,
        },
        response: result.rawResponse as any,
        status: ulipStatus,
        calledBy: userId,
      },
    }),
  ]);

  logger.info('[Fleet] DL verification complete', {
    driverId: driver.id,
    status: ulipStatus,
  });

  return {
    status: ulipStatus,
    isVerified: ulipStatus === UlipVerifStatus.VERIFIED,
    requiresManualReview: ulipStatus === UlipVerifStatus.MANUAL_REVIEW,
    message: _getDlStatusMessage(ulipStatus),
    fields: result.fields,
  };
}

// ── ULIP: RC Verification (VAHAN / AUTHAPI/02) ────────────────────────

/**
 * Verifies the driver's vehicle RC via ULIP VAHAN.
 * Stores raw ULIP response in VerificationLog.
 * Updates vehicle.rcVerifStatus based on result.
 */
export async function verifyVehicleRc(
  userId: string,
  input: VerifyVehicleRcInput
): Promise<object> {
  const driver = await _requireDriver(userId);

  if (!driver.vehicleId) {
    throw AppError.badRequest(
      'Please register your vehicle before verifying its RC',
      'NO_VEHICLE_REGISTERED'
    );
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: input.vehicleId },
  });
  if (!vehicle || vehicle.id !== driver.vehicleId) {
    throw AppError.forbidden('This vehicle does not belong to your profile');
  }

  // ── MOCK MODE (ULIP IP not yet whitelisted) ────────────────────────
  if (env.MOCK_ULIP === 'true') {
    logger.warn('[Fleet] ⚠️  MOCK_ULIP=true — Skipping VAHAN API, returning fake VERIFIED result', { vehicleId: vehicle.id });
    const ulipStatus = UlipVerifStatus.VERIFIED;
    await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          ownerName: input.ownerName,
          chassisNumber: input.chassisNumber,
          engineNumber: input.engineNumber,
          rcVerifStatus: ulipStatus,
          rcVerifiedAt: new Date(),
          rcUlipRawResponse: { mock: true, note: 'MOCK_ULIP mode — real API not called' } as any,
        },
      }),
      // Mark onboarding complete — the router guard checks this field
      prisma.user.update({
        where: { id: userId },
        data: { profileComplete: true },
      }),
      prisma.verificationLog.create({
        data: {
          entityType: 'vehicle',
          entityId: vehicle.id,
          apiCalled: 'AUTHAPI/02-MOCK',
          requestBody: { vehiclenumber: vehicle.registrationNo },
          response: { mock: true } as any,
          status: ulipStatus,
          calledBy: userId,
        },
      }),
    ]);
    logger.info('[Fleet] User profileComplete set to true after RC mock-verification', { userId });
    return {
      status: ulipStatus,
      isVerified: true,
      isNotFound: false,
      message: '✅ [DEV MODE] Vehicle RC mock-verified. Real verification will run once ULIP IP is whitelisted.',
      fields: {},
    };
  }
  // ── END MOCK MODE ──────────────────────────────────────────────────

  logger.info('[Fleet] Starting RC verification', {
    driverId: driver.id,
    vehicleId: vehicle.id,
    registrationNo: vehicle.registrationNo,
  });

  let result;
  try {
    result = await verifyVehicleWithVahan({
      vehiclenumber: vehicle.registrationNo,
      ownerName: input.ownerName,
      chassisNumber: input.chassisNumber,
      engineNumber: input.engineNumber,
    });
  } catch (err: any) {
    logger.error('[Fleet] VAHAN API call failed', { err: err.message });
    throw AppError.internal(
      'Government verification service is temporarily unavailable. Please try again in a moment.'
    );
  }

  let ulipStatus: UlipVerifStatus;
  if (result.isNotFound) {
    ulipStatus = UlipVerifStatus.FAILED;
  } else if (result.isVerified) {
    ulipStatus = UlipVerifStatus.VERIFIED;
  } else {
    ulipStatus = UlipVerifStatus.FAILED;
  }

  await prisma.$transaction([
    prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        ownerName: input.ownerName,
        chassisNumber: input.chassisNumber,
        engineNumber: input.engineNumber,
        rcVerifStatus: ulipStatus,
        rcVerifiedAt: ulipStatus === UlipVerifStatus.VERIFIED ? new Date() : null,
        rcUlipRawResponse: result.rawResponse as any,
      },
    }),
    // Mark user onboarding complete on successful verification
    ...(ulipStatus === UlipVerifStatus.VERIFIED ? [
      prisma.user.update({
        where: { id: userId },
        data: { profileComplete: true },
      }),
    ] : []),
    prisma.verificationLog.create({
      data: {
        entityType: 'vehicle',
        entityId: vehicle.id,
        apiCalled: 'AUTHAPI/02',
        requestBody: {
          vehiclenumber: vehicle.registrationNo,
          ownerName: input.ownerName,
          chassisNumber: input.chassisNumber,
          engineNumber: input.engineNumber,
        },
        response: result.rawResponse as any,
        status: ulipStatus,
        calledBy: userId,
      },
    }),
  ]);

  logger.info('[Fleet] RC verification complete', {
    vehicleId: vehicle.id,
    status: ulipStatus,
  });

  return {
    status: ulipStatus,
    isVerified: ulipStatus === UlipVerifStatus.VERIFIED,
    isNotFound: result.isNotFound,
    message: _getRcStatusMessage(ulipStatus, result.isNotFound),
    fields: result.fields,
  };
}

// ── Driver Online Status ──────────────────────────────────────────────

/**
 * Allows a verified, doc-approved driver to toggle ONLINE (AVAILABLE) or OFFLINE.
 * Drivers cannot set ON_TRIP or BREAK — only the dispatch system does that.
 */
export async function updateDriverStatus(
  userId: string,
  input: UpdateDriverStatusInput
): Promise<object> {
  const driver = await _requireDriver(userId);

  // Guard: docs must be approved before going online
  if (input.status === 'AVAILABLE' && !driver.isDocVerified) {
    throw AppError.badRequest(
      'Your documents are still being reviewed. You will be notified by the Parther team once approved.',
      'DOCS_NOT_VERIFIED'
    );
  }

  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: { status: input.status as any },
  });

  logger.info('[Fleet] Driver status updated', {
    driverId: driver.id,
    status: input.status,
  });

  return { status: updated.status };
}

// ── Private helpers ───────────────────────────────────────────────────

async function _requireDriver(userId: string) {
  const driver = await prisma.driver.findUnique({
    where: { userId },
    include: { vehicle: true },
  });
  if (!driver) {
    throw AppError.notFound(
      'Driver profile not found. Please complete registration first.'
    );
  }
  return driver;
}

function _formatDriverProfile(driver: any) {
  // Never expose raw ULIP response to the client (contains government data)
  const { dlUlipRawResponse: _dl, ...rest } = driver;
  return rest;
}

function _getDlStatusMessage(status: UlipVerifStatus): string {
  switch (status) {
    case UlipVerifStatus.VERIFIED:
      return '✅ Driving license verified successfully via government records.';
    case UlipVerifStatus.FAILED:
      return '❌ Verification failed. Please check your DL number, date of birth, and name — they must match exactly as on your license.';
    case UlipVerifStatus.MANUAL_REVIEW:
      return '🔍 Your license could not be found in the government digital database. It will be verified manually by the Parther team within 1–2 business days.';
    default:
      return 'Verification pending.';
  }
}

function _getRcStatusMessage(status: UlipVerifStatus, isNotFound: boolean): string {
  if (isNotFound)
    return '❌ Vehicle registration number not found in VAHAN. Ensure the number is correct, or the vehicle may be unregistered.';
  switch (status) {
    case UlipVerifStatus.VERIFIED:
      return '✅ Vehicle RC verified successfully via government records.';
    case UlipVerifStatus.FAILED:
      return '❌ RC verification failed. Owner name, chassis number, or engine number does not match VAHAN records. Please recheck.';
    default:
      return 'Verification pending.';
  }
}

// ── Admin Override ────────────────────────────────────────────────────────

/**
 * P3-4: Manually override a driver's verification status (ADMIN ONLY).
 * Useful when ULIP APIs are down, or manual offline verification is done.
 */
export async function adminOverrideVerification(
  adminId: string,
  driverId: string,
  notes?: string
): Promise<object> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
  });

  if (!driver) {
    throw AppError.notFound('Driver not found');
  }

  // Update Driver status to VERIFIED
  const updatedDriver = await prisma.driver.update({
    where: { id: driverId },
    data: {
      dlVerifStatus: UlipVerifStatus.VERIFIED,
    },
  });

  // Write to VerificationLog to track WHO overrode it
  await prisma.verificationLog.create({
    data: {
      entityType: 'driver',
      entityId: driverId,
      apiCalled: 'MANUAL_OVERRIDE',
      requestBody: { adminId, driverId, notes: notes || 'No notes provided' },
      response: { status: 'SUCCESS', action: 'MANUAL_OVERRIDE' },
      status: UlipVerifStatus.VERIFIED,
      calledBy: adminId,
    },
  });

  logger.info(`[Admin] Driver ${driverId} verification manually overridden by admin ${adminId}. Notes: ${notes}`);

  return _formatDriverProfile(updatedDriver);
}
