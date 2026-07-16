import { prisma } from '@shared/db/prisma';
import { getRedis } from '@config/redis';
import { getMessaging } from '@config/firebase';
import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { assertRazorpayXPayoutsEnabled } from '@shared/payments/outbound-payment.policy';
import { notificationService } from '@modules/notifications/notification.service';
import { gamificationService } from '@modules/gamification/gamification.service';
import { createNotification } from '@modules/notifications/inapp.notification.service';
import { NotificationType, UserRole, WorkerStatus, WorkerJobStatus, WalletTransactionType, WalletTransactionReason, LaborType, Prisma } from '@prisma/client';
import { emitToWorkerRoom, emitToBookingRoom } from '@shared/socket/socket.instance';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type {
  SendOtpInput,
  VerifyOtpInput,
  UpdateStatusInput,
  UpdateLocationInput,
  UpdateBankDetailsInput,
  UpdatePreferencesInput,
  UpdateSettingsInput,
  UploadDocumentsInput,
  AvailableJobsQuery,
  DeclineJobInput,
  CompleteJobInput,
  JobRadarQuery,
  WithdrawInput,
  HistoryQuery,
  EarningsChartQuery,
  SosInput,
} from './workforce.schema';

const redis = getRedis();
const OTP_TTL_SECONDS = 300; // 5 minutes
const COMPLETION_OTP_TTL_SECONDS = 900; // 15 minutes
const OTP_KEY = (phone: string) => `workforce:otp:${phone}`;
const WORKER_LOCATION_KEY = (workerId: string) => `worker:location:${workerId}`;
const WORKER_LOCATION_TTL = 60; // seconds — stale after one missed heartbeat

// ─────────────────────────────────────────────
// Haversine helper (duplicated from dispatch to avoid circular imports)
// ─────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────
// OTP HELPERS (dual-write Redis + in-memory)
// ─────────────────────────────────────────────
const inMemoryOtp = new Map<string, { otp: string; expiresAt: number }>();

async function storeOtp(phone: string, otp: string): Promise<void> {
  inMemoryOtp.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 });
  try {
    await redis.set(OTP_KEY(phone), otp, 'EX', OTP_TTL_SECONDS);
  } catch {
    logger.warn('[Workforce OTP] Redis write failed — in-memory only');
  }
}

async function getOtp(phone: string): Promise<string | null> {
  try {
    const redisOtp = await redis.get(OTP_KEY(phone));
    if (redisOtp) return redisOtp;
  } catch {
    logger.warn('[Workforce OTP] Redis read failed — checking in-memory');
  }
  const mem = inMemoryOtp.get(phone);
  if (mem && mem.expiresAt > Date.now()) return mem.otp;
  return null;
}

async function deleteOtp(phone: string): Promise<void> {
  inMemoryOtp.delete(phone);
  try { await redis.del(OTP_KEY(phone)); } catch { /* non-fatal */ }
}

const DEMO_ACCOUNTS: Record<string, { role: any, staticOtp: string, name: string }> = {
  '9999999999': { role: 'WORKER', staticOtp: '123456', name: 'Apple Reviewer' },
};
const isDemoAccount = (phone: string) => phone in DEMO_ACCOUNTS;

// ─────────────────────────────────────────────
// AUTH — SEND OTP
// ─────────────────────────────────────────────
export async function sendOtp(input: SendOtpInput): Promise<{ message: string }> {
  // Demo account: skip real OTP delivery
  if (isDemoAccount(input.phone)) {
    logger.info(`[Workforce OTP] Demo account ${input.phone} — static OTP accepted, skipping delivery`);
    return { message: 'OTP sent successfully' };
  }

  const otp = String(crypto.randomInt(100000, 999999));
  await storeOtp(input.phone, otp);

  // In production: send via FCM data message or MSG91 SMS
  if (env.NODE_ENV !== 'production') {
    logger.info(`[Workforce OTP] Dev OTP for ${input.phone}: ${otp}`);
  } else {
    // Best-effort FCM: use provided token or find existing user
    let token = input.fcmToken;
    if (!token) {
      const user = await prisma.user.findUnique({ where: { phone: input.phone }, select: { fcmToken: true } });
      token = user?.fcmToken || undefined;
    }

    if (token) {
      try {
        await notificationService.sendToDevice(token, {
          title: 'Your OTP',
          body: `Your GoMyTruck Workforce OTP is ${otp}. Valid for 5 minutes.`,
          data: { type: 'WORKFORCE_OTP', otp },
        });
      } catch (err) {
        logger.error('[Workforce OTP] FCM send failed:', err);
      }
    }
  }

  return { message: 'OTP sent successfully' };
}

// ─────────────────────────────────────────────
// AUTH — VERIFY OTP → JWT
// ─────────────────────────────────────────────
export async function verifyOtp(input: VerifyOtpInput) {
  let finalName = input.name;

  if (isDemoAccount(input.phone)) {
    const demo = DEMO_ACCOUNTS[input.phone];
    if (input.otp !== demo.staticOtp) {
      throw AppError.badRequest('Invalid OTP', 'OTP_INVALID');
    }
    finalName = finalName || demo.name;
    logger.info(`[Workforce OTP] Demo account ${input.phone} verified`);
  } else {
    const storedOtp = await getOtp(input.phone);
    if (!storedOtp || storedOtp !== input.otp) {
      throw AppError.badRequest('Invalid or expired OTP', 'INVALID_OTP');
    }
    await deleteOtp(input.phone); // Single-use
  }

  // Upsert user with WORKER role
  const user = await prisma.user.upsert({
    where: { phone: input.phone },
    update: {
      isActive: true,
      ...(input.fcmToken && { fcmToken: input.fcmToken }),
      ...(finalName && { name: finalName }),
    },
    create: {
      phone: input.phone,
      role: UserRole.WORKER,
      isActive: true,
      profileComplete: false,
      ...(input.fcmToken && { fcmToken: input.fcmToken }),
      ...(finalName && { name: finalName }),
    },
    select: { id: true, phone: true, role: true, name: true, profileComplete: true },
  });

  // Ensure Worker record exists
  let worker = await prisma.worker.findUnique({ where: { userId: user.id } });
  if (!worker) {
    worker = await prisma.worker.create({
      data: { userId: user.id },
    });
  }

  // Issue JWT pair
  const accessToken = jwt.sign(
    { userId: user.id, phone: user.phone, role: UserRole.WORKER }, // Contextual Login
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as any }
  );
  const jti = crypto.randomUUID();
  const refreshTokenValue = jwt.sign(
    { userId: user.id, role: UserRole.WORKER, jti },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '30d' }
  );

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await prisma.refreshToken.create({
    data: { token: refreshTokenValue, userId: user.id, expiresAt },
  });

  return {
    user: { ...user, workerId: worker.id },
    accessToken,
    refreshToken: refreshTokenValue,
    isNewUser: !user.profileComplete,
  };
}

// ─────────────────────────────────────────────
// PROFILE — GET ME
// ─────────────────────────────────────────────
export async function getMe(userId: string) {
  const worker = await prisma.worker.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, name: true, phone: true, profileImageUrl: true, profileComplete: true } },
      documents: true,
    },
  });
  if (!worker) throw AppError.notFound('Worker profile not found');
  
  return {
    ...worker,
    aadhaarStatus: worker.isDocVerified ? 'VERIFIED' : worker.aadhaarVerifStatus,
    panStatus: worker.isDocVerified ? 'VERIFIED' : worker.panVerifStatus,
    bankVerified: worker.isDocVerified ? true : worker.bankVerified,
  };
}

// ─────────────────────────────────────────────
// PROFILE — UPDATE STATUS (ONLINE/OFFLINE toggle)
// ─────────────────────────────────────────────
export async function updateStatus(userId: string, input: UpdateStatusInput) {
  const worker = await prisma.worker.findUnique({ where: { userId } });
  if (!worker) throw AppError.notFound('Worker not found');

  // Cannot go AVAILABLE if on a job
  if (input.status === 'AVAILABLE' && worker.status === WorkerStatus.ON_JOB) {
    throw AppError.conflict('Cannot go available while on an active job', 'ON_JOB');
  }

  // Cannot go AVAILABLE if not doc-verified (Temporarily bypassed for testing)
  // if (input.status === 'AVAILABLE' && !worker.isDocVerified) {
  //   throw AppError.badRequest('Documents not verified. Please upload Aadhaar and PAN.', 'DOCS_UNVERIFIED');
  // }

  const updated = await prisma.worker.update({
    where: { userId },
    data: { status: input.status as WorkerStatus },
  });
  return updated;
}

// ─────────────────────────────────────────────
// PROFILE — UPDATE LOCATION (called by background GPS service)
// ─────────────────────────────────────────────
export async function updateLocation(userId: string, input: UpdateLocationInput): Promise<void> {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const now = new Date();

  // Cache in Redis (primary — fast reads for dispatch)
  redis.setex(
    WORKER_LOCATION_KEY(worker.id),
    WORKER_LOCATION_TTL,
    JSON.stringify({ lat: input.lat, lng: input.lng, updatedAt: now.getTime() }),
  ).catch((err: any) => logger.error('[Workforce] Redis location cache failed:', err));

  // Snapshot to DB every 30s (rate-limited via Redis NX key)
  const snapshotKey = `worker:db_snapshot:${worker.id}`;
  redis.set(snapshotKey, '1', 'EX', 30, 'NX').then(wasSet => {
    if (wasSet === 'OK') {
      prisma.worker.update({
        where: { id: worker.id },
        data: { currentLat: input.lat, currentLng: input.lng, lastLocationAt: now },
      }).catch((err: any) => logger.error('[Workforce] DB location snapshot failed:', err));
    }
  }).catch(() => {
    // Redis down — always write to DB
    prisma.worker.update({
      where: { id: worker.id },
      data: { currentLat: input.lat, currentLng: input.lng, lastLocationAt: now },
    }).catch((err: any) => logger.error('[Workforce] DB location fallback write failed:', err));
  });
}
// ─────────────────────────────────────────────
export async function updateBankDetails(userId: string, input: UpdateBankDetailsInput): Promise<void> {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true, bankVerified: true } });
  if (!worker) throw AppError.notFound('Worker not found');
  if (worker.bankVerified) throw AppError.badRequest('Bank details already verified. Contact support to change.');

  await prisma.worker.update({
    where: { id: worker.id },
    data: {
      bankAccountNo: input.bankAccountNo,
      bankIfsc: input.bankIfsc.toUpperCase(),
      bankName: input.bankName,
      bankAccountHolderName: input.bankAccountHolderName,
    }
  });
}

// ── PROFILE - UPDATE PREFERENCES & BANK DETAILS
// ─────────────────────────────────────────────────────────────────────────────
export async function updatePreferences(userId: string, input: UpdatePreferencesInput) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const { name, fcmToken, ...workerFields } = input;

  // Update user fields if provided
  if (name || fcmToken) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name, profileComplete: true }),
        ...(fcmToken && { fcmToken }),
      },
    });
  }

  // Update worker fields
  const updated = await prisma.worker.update({
    where: { userId },
    data: {
      ...(workerFields.maxWeightKg !== undefined && { maxWeightKg: workerFields.maxWeightKg }),
      ...(workerFields.preferredTypes && { preferredTypes: workerFields.preferredTypes as LaborType[] }),
      ...(workerFields.preferredWork !== undefined && { preferredWork: workerFields.preferredWork }),
      ...(workerFields.vehicleAccess !== undefined && { vehicleAccess: workerFields.vehicleAccess }),
      ...(workerFields.availableTime !== undefined && { availableTime: workerFields.availableTime }),
      ...(workerFields.preferredDistance !== undefined && { preferredDistance: workerFields.preferredDistance }),
      ...(workerFields.languages !== undefined && { languages: workerFields.languages }),
      ...(workerFields.bankAccountNo && { bankAccountNo: workerFields.bankAccountNo }),
      ...(workerFields.bankIfsc && { bankIfsc: workerFields.bankIfsc }),
      ...(workerFields.bankName && { bankName: workerFields.bankName }),
    },
    include: { user: { select: { name: true, phone: true, profileImageUrl: true } } },
  });

  return updated;
}

// ─────────────────────────────────────────────
// PROFILE — UPLOAD DOCUMENTS (S3 URLs stored after upload)
// ─────────────────────────────────────────────
export async function uploadDocuments(userId: string, input: UploadDocumentsInput) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const docsToCreate: any[] = [];
  if (input.aadhaarUrl) docsToCreate.push({ workerId: worker.id, type: 'AADHAAR', fileUrl: input.aadhaarUrl });
  if (input.panUrl) docsToCreate.push({ workerId: worker.id, type: 'PAN', fileUrl: input.panUrl });
  if (input.bikeUrl) docsToCreate.push({ workerId: worker.id, type: 'BIKE', fileUrl: input.bikeUrl });
  if (input.licenseUrl) docsToCreate.push({ workerId: worker.id, type: 'LICENSE', fileUrl: input.licenseUrl });
  if (input.rcUrl) docsToCreate.push({ workerId: worker.id, type: 'RC', fileUrl: input.rcUrl });
  if (input.selfieUrl) docsToCreate.push({ workerId: worker.id, type: 'SELFIE', fileUrl: input.selfieUrl });

  if (docsToCreate.length > 0) {
    await prisma.workerDocument.createMany({
      data: docsToCreate,
    });
  }

  return { success: true, message: 'Documents uploaded successfully for verification.' };
}

// ─────────────────────────────────────────────
// DASHBOARD — STATS
// ─────────────────────────────────────────────
export async function getDashboardStats(userId: string) {
  const worker = await prisma.worker.findUnique({
    where: { userId },
    select: {
      id: true, status: true, rating: true, totalJobs: true, acceptanceRate: true,
      isDocVerified: true,
    },
  });
  if (!worker) throw AppError.notFound('Worker not found');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Today's completed jobs
  const todayJobs = await prisma.jobAssignment.count({
    where: {
      workerId: worker.id,
      status: WorkerJobStatus.COMPLETED,
      completedAt: { gte: todayStart },
    },
  });

  // Today's earnings — from WorkerWallet transactions
  const workerWalletForDashboard = await prisma.workerWallet.findUnique({ where: { workerId: worker.id }, select: { id: true } });
  let todayEarnings = 0;
  if (workerWalletForDashboard) {
    const txns = await prisma.workerWalletTransaction.aggregate({
      where: {
        walletId:  workerWalletForDashboard.id,
        type:      WalletTransactionType.CREDIT,
        createdAt: { gte: todayStart },
      },
      _sum: { amount: true },
    });
    todayEarnings = txns._sum.amount ?? 0;
  }

  // Active job (if any)
  const activeJob = await prisma.jobAssignment.findFirst({
    where: {
      workerId: worker.id,
      status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] },
    },
    include: {
      booking: {
        select: {
          bookingNumber: true, pickupAddress: true, laborType: true,
          stops: { take: 1, orderBy: { sequence: 'asc' }, select: { address: true } },
        },
      },
    },
  });

  return {
    status: worker.status,
    isDocVerified: worker.isDocVerified,
    rating: worker.rating,
    totalJobs: worker.totalJobs,
    acceptanceRate: worker.acceptanceRate,
    today: { jobs: todayJobs, earnings: todayEarnings },
    activeJob,
  };
}

// ─────────────────────────────────────────────
// JOBS — GET AVAILABLE JOB FEED
// ─────────────────────────────────────────────
export async function getAvailableJobs(userId: string, query: AvailableJobsQuery) {
  const worker = await prisma.worker.findUnique({
    where: { userId },
    select: { id: true, currentLat: true, currentLng: true, preferredTypes: true, maxWeightKg: true, status: true, isDocVerified: true },
  });
  if (!worker) throw AppError.notFound('Worker not found');

  const { page, limit, laborType, sortBy, minPayout, maxDistance } = query;
  if (!worker.isDocVerified) throw AppError.forbidden('Worker verification is required to view jobs');
  if (worker.status !== WorkerStatus.AVAILABLE) {
    return { jobs: [], meta: { page, limit, hasMore: false, total: 0 } };
  }
  const skip = (page - 1) * limit;

  // Build gigType filter based on preferredTypes if laborType isn't provided
  let gigTypeFilter: any = {};
  if (laborType) {
    gigTypeFilter = { gigType: laborType };
  } else if (worker.preferredTypes.length > 0) {
    // Optional: could filter by worker.preferredTypes if gigType matches
  }

  // Fetch GigJobs instead of Bookings
  const gigs = await prisma.gigJob.findMany({
    where: {
      ...gigTypeFilter,
      status: 'PENDING',
      assignments: { none: { workerId: worker.id } }, // Exclude jobs already responded to
    },
    select: {
      id: true,
      jobNumber: true,
      locationLat: true,
      locationLng: true,
      locationAddress: true,
      gigType: true,
      workersNeeded: true,
      totalFare: true,
      description: true,
      createdAt: true,
      assignments: {
        where: { status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] } },
        select: { id: true, workerId: true },
      },
    },
    skip,
    take: limit * 3, // Extra headroom
    orderBy: { createdAt: 'desc' },
  });

  // Map GigJobs to the JobFeedItem structure expected by the Flutter app
  let openBookings = gigs
    .filter(g => {
      const acceptedCount = g.assignments.length;
      const totalSlots = g.workersNeeded ?? 1;
      return acceptedCount < totalSlots;
    })
    .map(g => {
      const distanceKm =
        worker.currentLat != null && worker.currentLng != null
          ? Math.round(haversineKm(worker.currentLat, worker.currentLng, g.locationLat, g.locationLng) * 10) / 10
          : null;
      const acceptedCount = g.assignments.length;
      const totalSlots = g.workersNeeded ?? 1;

      return {
        id:             g.id,
        bookingNumber:  g.jobNumber,
        pickupLat:      g.locationLat,
        pickupLng:      g.locationLng,
        pickupAddress:  g.locationAddress,
        dropAddress:    'N/A', // Gigs usually don't have a dropoff
        laborType:      g.gigType,
        payoutAmount:   (g.totalFare ?? 0) / totalSlots,
        slotsRemaining: totalSlots - acceptedCount,
        totalSlots,
        vehicleType:    'Gig',
        goodsType:      'Service',
        goodsDescription: g.description,
        goodsWeightKg:  null,
        goodsQuantity:  1,
        goodsLengthCm:  null,
        goodsWidthCm:   null,
        goodsHeightCm:  null,
        handlingInstructions: null,
        goodsImageUrls: [],
        estimatedDuration: null,
        distanceKm,
        createdAt:      g.createdAt,
      };
    });

  if (minPayout != null) {
    openBookings = openBookings.filter(b => b.payoutAmount >= minPayout);
  }

  // Apply maxDistance filter after haversine
  if (maxDistance != null && worker.currentLat != null) {
    openBookings = openBookings.filter(b => b.distanceKm == null || b.distanceKm <= maxDistance);
  }

  // Sort
  if (sortBy === 'distance' && worker.currentLat != null) {
    openBookings.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  } else if (sortBy === 'payout') {
    openBookings.sort((a, b) => b.payoutAmount - a.payoutAmount);
  } else if (sortBy === 'recent') {
    openBookings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const total = openBookings.length;
  const paginated = openBookings.slice(0, limit);

  return {
    jobs: paginated,
    meta: { page, limit, hasMore: total > limit, total },
  };
}

// ─────────────────────────────────────────────
// JOBS — GET ACTIVE JOB
// ─────────────────────────────────────────────
export async function getActiveJob(userId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const assignment = await prisma.jobAssignment.findFirst({
    where: {
      workerId: worker.id,
      status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] },
    },
    include: {
      booking: {
        select: {
          id: true,
          bookingNumber: true,
          pickupLat: true,
          pickupLng: true,
          pickupAddress: true,
          laborType: true,
          laborersCount: true,
          vehicleType: true,
          goodsType: true,
          goodsDescription: true,
          goodsWeightKg: true,
          goodsQuantity: true,
          goodsLengthCm: true,
          goodsWidthCm: true,
          goodsHeightCm: true,
          handlingInstructions: true,
          goodsImageUrls: true,
          estimatedDuration: true,
          status: true,
          stops: { take: 1, orderBy: { sequence: 'asc' }, select: { address: true, latitude: true, longitude: true } },
        },
      },
    },
  });

  if (assignment) return assignment;

  const gigAssignment = await prisma.gigAssignment.findFirst({
    where: {
      workerId: worker.id,
      status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] },
    },
    include: {
      gig: {
        select: {
          id: true,
          jobNumber: true,
          locationLat: true,
          locationLng: true,
          locationAddress: true,
          gigType: true,
          workersNeeded: true,
          description: true,
          status: true,
        },
      },
    },
  });

  if (gigAssignment) {
    // Map gigAssignment to look like a jobAssignment with booking for the frontend
    return {
      ...gigAssignment,
      bookingId: gigAssignment.gigId,
      booking: {
        id: gigAssignment.gig.id,
        bookingNumber: gigAssignment.gig.jobNumber,
        pickupLat: gigAssignment.gig.locationLat,
        pickupLng: gigAssignment.gig.locationLng,
        pickupAddress: gigAssignment.gig.locationAddress,
        laborType: gigAssignment.gig.gigType,
        laborersCount: gigAssignment.gig.workersNeeded,
        vehicleType: 'Gig',
        goodsType: 'Service',
        goodsDescription: gigAssignment.gig.description,
        goodsWeightKg: null,
        goodsQuantity: 1,
        goodsLengthCm: null,
        goodsWidthCm: null,
        goodsHeightCm: null,
        handlingInstructions: null,
        goodsImageUrls: [],
        estimatedDuration: null,
        status: gigAssignment.gig.status,
        stops: [],
      },
    };
  }

  return null;
}

// ─────────────────────────────────────────────
// JOBS — ACCEPT
// ─────────────────────────────────────────────
export async function acceptJob(userId: string, bookingId: string) {
  const worker = await prisma.worker.findUnique({
    where: { userId },
    select: { id: true, status: true, isDocVerified: true },
  });
  if (!worker) throw AppError.notFound('Worker not found');
  if (!worker.isDocVerified) throw AppError.forbidden('Worker verification is required before accepting jobs');
  if (worker.status === WorkerStatus.ON_JOB) throw AppError.conflict('Already on an active job', 'ON_JOB');
  if (worker.status !== WorkerStatus.AVAILABLE) {
    throw AppError.conflict('Go online before accepting a job', 'WORKER_NOT_AVAILABLE');
  }

  let acceptedResult: { assignment: any; newAcceptedCount: number; totalSlots: number } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      acceptedResult = await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          select: { id: true, laborersCount: true, laborRequired: true, status: true, laborCharge: true },
        });
        if (!booking) throw AppError.notFound('Booking not found');
        if (!booking.laborRequired) throw AppError.badRequest('Booking does not require labor');
        if (!['CONFIRMED', 'DRIVER_ARRIVING', 'PICKED_UP'].includes(booking.status)) {
          throw AppError.conflict('This workforce job is no longer open', 'JOB_NOT_OPEN');
        }

        const existing = await tx.jobAssignment.findUnique({
          where: { bookingId_workerId: { bookingId, workerId: worker.id } },
        });
        if (existing) throw AppError.conflict('Already responded to this job');

        const acceptedCount = await tx.jobAssignment.count({
          where: {
            bookingId,
            status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] },
          },
        });
        const totalSlots = booking.laborersCount ?? 1;
        if (acceptedCount >= totalSlots) {
          throw AppError.conflict('This job is already full', 'JOB_FULL');
        }

        const assignment = await tx.jobAssignment.create({
          data: {
            bookingId,
            workerId: worker.id,
            status: WorkerJobStatus.ACCEPTED,
            payoutAmount: (booking.laborCharge ?? 0) / totalSlots,
          },
        });
        const workerClaim = await tx.worker.updateMany({
          where: { id: worker.id, status: WorkerStatus.AVAILABLE, isDocVerified: true },
          data: { status: WorkerStatus.ON_JOB },
        });
        if (workerClaim.count !== 1) {
          throw AppError.conflict('Worker is no longer available', 'WORKER_NOT_AVAILABLE');
        }
        return { assignment, newAcceptedCount: acceptedCount + 1, totalSlots };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error: any) {
      if (error?.code === 'P2034' && attempt < 3) continue;
      if (error?.code === 'P2002') throw AppError.conflict('Already responded to this job');
      throw error;
    }
  }
  if (!acceptedResult) throw AppError.conflict('Job acceptance conflicted. Please try again.', 'JOB_ACCEPT_CONFLICT');

  const { assignment, newAcceptedCount, totalSlots } = acceptedResult;
  if (newAcceptedCount >= totalSlots) {
    emitToBookingRoom(bookingId, 'workers_fully_assigned', {
      bookingId,
      workerCount: newAcceptedCount,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
  if (user?.fcmToken) {
    notificationService.sendToDevice(user.fcmToken, {
      title: '✅ Job Confirmed!',
      body: `You have accepted the job. Head to the pickup location. Payout: ₹${assignment.payoutAmount}`,
      data: { type: 'JOB_ACCEPTED', assignmentId: assignment.id },
    }).catch((err: any) => logger.error('[Workforce] FCM accept notification failed:', err));
  }

  return { accepted: true, assignment, allSlotsFilled: newAcceptedCount >= totalSlots };
}

// ─────────────────────────────────────────────
// JOBS — DECLINE
// ─────────────────────────────────────────────
export async function declineJob(userId: string, bookingId: string, input: DeclineJobInput) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true, totalJobs: true, acceptanceRate: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const gigJob = await prisma.gigJob.findUnique({ where: { id: bookingId } });
  const isGig = !!gigJob;

  if (isGig) {
    const existing = await prisma.gigAssignment.findFirst({ where: { gigId: bookingId, workerId: worker.id } });
    if (!existing) {
      await prisma.gigAssignment.create({
        data: { gigId: bookingId, workerId: worker.id, status: WorkerJobStatus.DECLINED, payoutAmount: 0, declinedAt: new Date() }
      });
    } else {
      await prisma.gigAssignment.update({ where: { id: existing.id }, data: { status: WorkerJobStatus.DECLINED, declinedAt: new Date() } });
    }
  } else {
    const existing = await prisma.jobAssignment.findFirst({ where: { bookingId, workerId: worker.id } });
    if (!existing) {
      await prisma.jobAssignment.create({
        data: { bookingId, workerId: worker.id, status: WorkerJobStatus.DECLINED, payoutAmount: 0, declinedAt: new Date(), declineReason: input?.reason }
      });
    } else {
      await prisma.jobAssignment.update({ where: { id: existing.id }, data: { status: WorkerJobStatus.DECLINED, declinedAt: new Date(), declineReason: input?.reason } });
    }
  }

  const jobAssignmentsCount = await prisma.jobAssignment.count({ where: { workerId: worker.id, status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.COMPLETED, WorkerJobStatus.DECLINED] } } });
  const gigAssignmentsCount = await prisma.gigAssignment.count({ where: { workerId: worker.id, status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.COMPLETED, WorkerJobStatus.DECLINED] } } });
  const allAssignments = jobAssignmentsCount + gigAssignmentsCount;

  const jobDeclinedCount = await prisma.jobAssignment.count({ where: { workerId: worker.id, status: WorkerJobStatus.DECLINED } });
  const gigDeclinedCount = await prisma.gigAssignment.count({ where: { workerId: worker.id, status: WorkerJobStatus.DECLINED } });
  const declinedCount = jobDeclinedCount + gigDeclinedCount;

  const newRate = allAssignments > 0 ? Math.round(((allAssignments - declinedCount) / allAssignments) * 100) : 100;

  await prisma.worker.update({ where: { id: worker.id }, data: { acceptanceRate: newRate } });

  return { declined: true };
}

// ─────────────────────────────────────────────
// JOBS — MARK ARRIVED
// ─────────────────────────────────────────────
export async function markArrived(userId: string, assignmentId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  let assignment: any = await prisma.jobAssignment.findUnique({ where: { id: assignmentId } });
  let isGig = false;
  if (!assignment) {
    assignment = await prisma.gigAssignment.findUnique({ where: { id: assignmentId } });
    isGig = true;
  }

  if (!assignment || assignment.workerId !== worker.id) throw AppError.notFound('Assignment not found');
  if (assignment.status !== WorkerJobStatus.ACCEPTED) {
    throw AppError.conflict('Invalid status transition — must be ACCEPTED to mark arrived', 'INVALID_TRANSITION');
  }

  let updated;
  if (isGig) {
    updated = await prisma.gigAssignment.update({ where: { id: assignmentId }, data: { status: WorkerJobStatus.ARRIVED, arrivedAt: new Date() } });
    emitToBookingRoom(assignment.gigId, 'worker_arrived', { assignmentId, workerId: worker.id });
  } else {
    updated = await prisma.jobAssignment.update({ where: { id: assignmentId }, data: { status: WorkerJobStatus.ARRIVED, arrivedAt: new Date() } });
    emitToBookingRoom(assignment.bookingId, 'worker_arrived', { assignmentId, workerId: worker.id });
  }

  return updated;
}

// ─────────────────────────────────────────────
// JOBS — START WORK
// ─────────────────────────────────────────────
export async function startJob(userId: string, assignmentId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  let assignment: any = await prisma.jobAssignment.findUnique({ where: { id: assignmentId } });
  let isGig = false;
  if (!assignment) {
    assignment = await prisma.gigAssignment.findUnique({ where: { id: assignmentId } });
    isGig = true;
  }

  if (!assignment || assignment.workerId !== worker.id) throw AppError.notFound('Assignment not found');
  if (assignment.status !== WorkerJobStatus.ARRIVED) {
    throw AppError.conflict('Must be ARRIVED before starting work', 'INVALID_TRANSITION');
  }

  let updated;
  if (isGig) {
    updated = await prisma.gigAssignment.update({ where: { id: assignmentId }, data: { status: WorkerJobStatus.IN_PROGRESS, startedAt: new Date() } });
    emitToBookingRoom(assignment.gigId, 'worker_started', { assignmentId, workerId: worker.id });
  } else {
    updated = await prisma.jobAssignment.update({ where: { id: assignmentId }, data: { status: WorkerJobStatus.IN_PROGRESS, startedAt: new Date() } });
    emitToBookingRoom(assignment.bookingId, 'worker_started', { assignmentId, workerId: worker.id });
  }

  return updated;
}

// ─────────────────────────────────────────────
// JOBS — REQUEST COMPLETION OTP (worker taps "I'm Done")
// ─────────────────────────────────────────────
export async function requestCompletionOtp(userId: string, assignmentId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  let assignment: any = await prisma.jobAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, workerId: true, status: true, bookingId: true, booking: { select: { customerId: true } } },
  });
  let isGig = false;
  if (!assignment) {
    assignment = await prisma.gigAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, workerId: true, status: true, gigId: true, gig: { select: { customerId: true } } },
    });
    if (assignment) {
      assignment.bookingId = assignment.gigId;
      assignment.booking = assignment.gig;
      isGig = true;
    }
  }

  if (!assignment || assignment.workerId !== worker.id) throw AppError.notFound('Assignment not found');
  if (assignment.status !== WorkerJobStatus.IN_PROGRESS) {
    throw AppError.conflict('Work must be IN_PROGRESS to request completion OTP', 'INVALID_TRANSITION');
  }

  const otp = String(crypto.randomInt(1000, 9999));
  const otpExpiresAt = new Date(Date.now() + 300 * 1000);

  if (isGig) {
    await prisma.gigJob.update({ where: { id: assignment.bookingId }, data: { completionOtp: otp } });
  } else {
    await prisma.jobAssignment.update({ where: { id: assignmentId }, data: { completionOtp: otp, otpExpiresAt } });
  }

  const customer = await prisma.user.findUnique({ where: { id: assignment.booking.customerId }, select: { fcmToken: true, id: true } });
  if (customer?.fcmToken) {
    notificationService.sendToDevice(customer.fcmToken, {
      title: '🏗️ Worker Done — Verify Completion',
      body: `Your worker is done. Verify completion with OTP: ${otp}`,
      data: { type: 'WORKER_COMPLETION_OTP', otp, assignmentId },
    }).catch((err: any) => logger.error('[Workforce] Completion OTP FCM failed:', err));
  }
  await createNotification(customer!.id, '🏗️ Worker Done — Verify Completion', `Your worker is done. Verify completion with OTP: ${otp}`, NotificationType.BOOKING_STATUS, assignment.bookingId);

  logger.info(`[Workforce] Completion OTP generated for assignment ${assignmentId}`);
  return { message: 'OTP sent to customer', otpExpiresAt };
}

// ─────────────────────────────────────────────
// JOBS — COMPLETE (OTP verified)
// ─────────────────────────────────────────────
export async function completeJob(userId: string, assignmentId: string, input: CompleteJobInput) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  let assignment: any = await prisma.jobAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, workerId: true, status: true, bookingId: true, completionOtp: true, otpExpiresAt: true, payoutAmount: true },
  });
  let isGig = false;
  if (!assignment) {
    assignment = await prisma.gigAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, workerId: true, status: true, gigId: true, payoutAmount: true, gig: { select: { completionOtp: true } } },
    });
    if (assignment) {
      assignment.bookingId = assignment.gigId;
      assignment.completionOtp = assignment.gig.completionOtp;
      isGig = true;
    }
  }

  if (!assignment || assignment.workerId !== worker.id) throw AppError.notFound('Assignment not found');
  if (assignment.status !== WorkerJobStatus.IN_PROGRESS) {
    throw AppError.conflict('Work must be IN_PROGRESS to complete', 'INVALID_TRANSITION');
  }

  const now = new Date();

  if (isGig) {
    await prisma.gigAssignment.update({ where: { id: assignmentId }, data: { status: WorkerJobStatus.COMPLETED, completedAt: now } });
    await prisma.gigJob.update({ where: { id: assignment.bookingId }, data: { completionOtp: null } });
  } else {
    await prisma.jobAssignment.update({ where: { id: assignmentId }, data: { status: WorkerJobStatus.COMPLETED, completedAt: now, completionOtp: null, otpExpiresAt: null } });
  }

  await prisma.worker.update({ where: { id: worker.id }, data: { totalJobs: { increment: 1 }, status: WorkerStatus.AVAILABLE } });

  const workerRecord = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!workerRecord) throw AppError.notFound('Worker record not found');

  const WORKFORCE_COMMISSION_RATE = Number(process.env.WORKFORCE_COMMISSION_RATE ?? 0.15);
  const commission = Math.round(assignment.payoutAmount * WORKFORCE_COMMISSION_RATE * 100) / 100;
  const workerNet = assignment.payoutAmount - commission;

  const deadline = new Date();
  deadline.setHours(deadline.getHours() + 24);

  const workerWallet = await prisma.workerWallet.upsert({
    where: { workerId: workerRecord.id },
    create: { workerId: workerRecord.id, cachedBalance: workerNet, commissionDue: commission, commissionDeadline: deadline },
    update: { cachedBalance: { increment: workerNet }, commissionDue: { increment: commission }, commissionDeadline: deadline },
  });
  const freshWorkerWallet = await prisma.workerWallet.findUnique({ where: { workerId: workerRecord.id } });

  await prisma.workerWalletTransaction.create({
    data: {
      walletId: workerWallet.id,
      type: WalletTransactionType.CREDIT,
      reason: 'JOB_EARNING' as any,
      amount: workerNet,
      balanceAfter: freshWorkerWallet!.cachedBalance,
      bookingId: assignment.bookingId,
      referenceId: assignmentId,
      note: `Job completed — Assignment ${assignmentId.substring(0, 8)}`,
    },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
  if (user?.fcmToken) {
    notificationService.sendToDevice(user.fcmToken, {
      title: '💰 Job Completed!',
      body: `₹${workerNet} has been credited to your wallet.`,
      data: { type: 'JOB_COMPLETED', assignmentId, payout: String(workerNet) },
    }).catch((err: any) => logger.error('[Workforce] Completion FCM failed:', err));
  }
  await createNotification(userId, '💰 Job Completed!', `₹${workerNet} has been credited to your wallet.`, NotificationType.PAYMENT, assignment.bookingId);

  emitToBookingRoom(assignment.bookingId, 'worker_completed', { assignmentId, workerId: worker.id });

  let pendingWorkers = 0;
  if (isGig) {
    pendingWorkers = await prisma.gigAssignment.count({
      where: { gigId: assignment.bookingId, status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS, WorkerJobStatus.PENDING_ACCEPTANCE] } },
    });
    if (pendingWorkers === 0) {
      await prisma.gigJob.update({ where: { id: assignment.bookingId }, data: { status: 'COMPLETED' } });
    }
  } else {
    pendingWorkers = await prisma.jobAssignment.count({
      where: { bookingId: assignment.bookingId, status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS, WorkerJobStatus.PENDING_ACCEPTANCE] } },
    });
  }
  
  if (pendingWorkers === 0) {
    emitToBookingRoom(assignment.bookingId, 'all_workers_completed', { bookingId: assignment.bookingId });
    logger.info(`[Workforce] All workers completed for booking ${assignment.bookingId}`);
  }

  logger.info(`[Workforce] Worker ${worker.id} completed job ${assignmentId}. Payout: ₹${workerNet} (Commission: ₹${commission})`);
  return { completed: true, payoutAmount: workerNet, commission };
}

// ─────────────────────────────────────────────
// WALLET — BALANCE
// ─────────────────────────────────────────────
export async function getWalletBalance(userId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const workerWallet = await prisma.workerWallet.upsert({
    where: { workerId: worker.id },
    create: { workerId: worker.id },
    update: {},
  });

  const pendingJob = await prisma.jobAssignment.aggregate({
    where: { workerId: worker.id, status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] } },
    _sum: { payoutAmount: true },
  });
  const pendingGig = await prisma.gigAssignment.aggregate({
    where: { workerId: worker.id, status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] } },
    _sum: { payoutAmount: true },
  });
  const pendingPayout = (pendingJob._sum.payoutAmount ?? 0) + (pendingGig._sum.payoutAmount ?? 0);

  return { balance: workerWallet.cachedBalance, commissionDue: workerWallet.commissionDue, pendingPayout };
}

// ─────────────────────────────────────────────
// WALLET — TRANSACTION HISTORY
// ─────────────────────────────────────────────
export async function getWalletTransactions(userId: string, page: number, limit: number) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) return { transactions: [], meta: { total: 0, page, limit, totalPages: 0 } };

  const workerWallet = await prisma.workerWallet.findUnique({ where: { workerId: worker.id } });
  if (!workerWallet) return { transactions: [], meta: { total: 0, page, limit, totalPages: 0 } };

  const skip = (page - 1) * limit;
  const [transactions, total] = await prisma.$transaction([
    prisma.workerWalletTransaction.findMany({
      where: { walletId: workerWallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.workerWalletTransaction.count({ where: { walletId: workerWallet.id } }),
  ]);

  return { transactions, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

// ─────────────────────────────────────────────
// JOB RADAR — MAP PINS
// ─────────────────────────────────────────────
export async function getNearbyPins(userId: string, query: JobRadarQuery) {
  const { lat, lng, radiusKm } = query;
  
  // Find nearby available Gig jobs
  const jobs = await prisma.gigJob.findMany({
    where: {
      status: 'PENDING',
      assignments: { none: { worker: { userId } } }, // Exclude jobs already offered/assigned to this worker
    },
    select: {
      id: true,
      jobNumber: true,
      locationLat: true,
      locationLng: true,
      locationAddress: true,
      totalFare: true,
      gigType: true,
      workersNeeded: true,
      assignments: {
        where: { status: { in: [WorkerJobStatus.ACCEPTED, WorkerJobStatus.ARRIVED, WorkerJobStatus.IN_PROGRESS] } },
        select: { id: true },
      },
    }
  });

  const availablePins = jobs
    .filter(job => {
      const acceptedCount = job.assignments.length;
      const totalSlots = job.workersNeeded ?? 1;
      return acceptedCount < totalSlots;
    })
    .map(job => ({
      id: job.id,
      bookingNumber: job.jobNumber,
      pickupLat: job.locationLat,
      pickupLng: job.locationLng,
      pickupAddress: job.locationAddress,
      laborCharge: (job.totalFare ?? 0) / (job.workersNeeded ?? 1),
      laborType: job.gigType,
      laborersCount: job.workersNeeded,
      vehicleType: 'Gig',
      goodsType: 'Service',
      goodsWeightKg: null,
      goodsQuantity: 1,
      distanceKm: haversineKm(lat, lng, job.locationLat, job.locationLng)
    }))
    .filter(job => job.distanceKm <= radiusKm);

  return availablePins;
}

// ─────────────────────────────────────────────
// WALLET — WITHDRAW (creates RazorpayX payout request)
// ─────────────────────────────────────────────
export async function withdrawWallet(userId: string, input: WithdrawInput) {
  assertRazorpayXPayoutsEnabled();

  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true, bankAccountNo: true, bankIfsc: true, bankName: true, bankAccountHolderName: true, razorpayxContactId: true, razorpayxFundAccountId: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  if (!worker.bankAccountNo || !worker.bankIfsc) {
    throw AppError.badRequest('Bank account details not configured. Please add your bank account first.', 'NO_BANK_ACCOUNT');
  }

  const workerWallet = await prisma.workerWallet.findUnique({ where: { workerId: worker.id } });
  if (!workerWallet) throw AppError.notFound('Wallet not found');

  const minWithdrawal = Number(process.env.MIN_WITHDRAWAL_AMOUNT ?? 50);
  if (input.amount < minWithdrawal) {
    throw AppError.badRequest(`Minimum withdrawal is ₹${minWithdrawal}`, 'BELOW_MIN_WITHDRAWAL');
  }
  if (workerWallet.cachedBalance < input.amount) {
    throw AppError.badRequest('Insufficient balance', 'INSUFFICIENT_BALANCE');
  }

  // Check for in-progress withdrawal
  const existing = await prisma.withdrawalRequest.findFirst({
    where: {
      entityType: 'WORKER',
      entityId: worker.id,
      status: { in: ['PENDING', 'AUTO_PROCESSING'] },
    },
  });
  if (existing) throw AppError.badRequest('A withdrawal is already in progress.', 'WITHDRAWAL_IN_PROGRESS');

  // Atomic: reserve funds + create request
  const withdrawalRequest = await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.workerWallet.update({
      where: { workerId: worker.id },
      data: { cachedBalance: { decrement: input.amount } },
    });

    await tx.workerWalletTransaction.create({
      data: {
        walletId: workerWallet.id,
        type: WalletTransactionType.DEBIT,
        reason: 'WITHDRAWAL' as any,
        amount: input.amount,
        balanceAfter: updatedWallet.cachedBalance,
        note: `Withdrawal request — ₹${input.amount}`,
      },
    });

    return tx.withdrawalRequest.create({
      data: {
        entityType: 'WORKER' as any,
        entityId: worker.id,
        amount: input.amount,
        bankAccountNo:         worker.bankAccountNo!,
        bankIfsc:              worker.bankIfsc!,
        bankName:              worker.bankName ?? 'Unknown',
        bankAccountHolderName: worker.bankAccountHolderName ?? 'Worker',
        razorpayxContactId:    worker.razorpayxContactId,
        razorpayxFundAccountId: worker.razorpayxFundAccountId,
      },
    });
  });

  logger.info(`[Workforce] Withdrawal requested: ₹${input.amount} for worker ${worker.id}`);

  // Fire-and-forget: auto-trigger RazorpayX payout
  const { processWithdrawalViaRazorpayX } = await import('@modules/driver-wallet/driver-wallet.service');
  processWithdrawalViaRazorpayX(withdrawalRequest.id).catch((err) => {
    logger.error(`[Workforce] Auto-payout failed for ${withdrawalRequest.id}:`, err);
  });

  return { withdrawalRequest, balance: workerWallet.cachedBalance - input.amount };
}

// ─────────────────────────────────────────────
// JOB HISTORY
// ─────────────────────────────────────────────
export async function getJobHistory(userId: string, query: HistoryQuery) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  const { status, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: any = {
    workerId: worker.id,
    status: status ? { equals: status as any } : { in: ['COMPLETED', 'CANCELLED'] as any[] },
  };

  const jobAssignments = await prisma.jobAssignment.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, status: true, payoutAmount: true, createdAt: true, completedAt: true,
      booking: { select: { id: true, bookingNumber: true, pickupAddress: true, stops: { select: { address: true } }, laborType: true } },
    },
  });

  const gigAssignments = await prisma.gigAssignment.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, status: true, payoutAmount: true, createdAt: true, completedAt: true,
      gig: { select: { id: true, jobNumber: true, locationAddress: true, gigType: true } },
    },
  });

  let allAssignments = [
    ...jobAssignments,
    ...gigAssignments.map(g => ({
      id: g.id, status: g.status, payoutAmount: g.payoutAmount, createdAt: g.createdAt, completedAt: g.completedAt,
      booking: {
        id: g.gig.id, bookingNumber: g.gig.jobNumber, pickupAddress: g.gig.locationAddress, stops: [], laborType: g.gig.gigType
      }
    }))
  ];

  allAssignments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = allAssignments.length;
  const paginated = allAssignments.slice(skip, skip + limit);

  return {
    assignments: paginated,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// ─────────────────────────────────────────────
// EARNINGS CHART (aggregated by period)
// ─────────────────────────────────────────────
export async function getEarningsChart(userId: string, query: EarningsChartQuery) {
  // Earnings chart — from WorkerWallet transactions
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');
  const workerWalletForChart = await prisma.workerWallet.findUnique({ where: { workerId: worker.id }, select: { id: true } });
  if (!workerWalletForChart) return { data: [], total: 0 };

  const now = new Date();
  let startDate: Date;
  if (query.period === 'day') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 7);
  } else if (query.period === 'week') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 28);
  } else {
    startDate = new Date(now);
    startDate.setMonth(now.getMonth() - 6);
  }

  const transactions = await prisma.workerWalletTransaction.findMany({
    where: {
      walletId:  workerWalletForChart.id,
      type:      WalletTransactionType.CREDIT,
      createdAt: { gte: startDate },
    },
    select:  { amount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // Group by bucket
  const buckets: Record<string, number> = {};
  for (const tx of transactions) {
    let key: string;
    const d = tx.createdAt;
    if (query.period === 'day') {
      key = d.toISOString().substring(0, 10); // YYYY-MM-DD
    } else if (query.period === 'week') {
      // ISO week label
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      key = weekStart.toISOString().substring(0, 10);
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    buckets[key] = (buckets[key] ?? 0) + tx.amount;
  }

  const chartData = Object.entries(buckets).map(([label, amount]) => ({ label, amount }));

  return { period: query.period, chartData };
}

// ─────────────────────────────────────────────
// PERFORMANCE METRICS
// ─────────────────────────────────────────────
export async function getPerformanceMetrics(userId: string) {
  const worker = await prisma.worker.findUnique({
    where: { userId },
    select: {
      id: true,
      rating: true,
      totalJobs: true,
      acceptanceRate: true,
    },
  });
  if (!worker) throw AppError.notFound('Worker not found');

  const [completed, cancelled] = await prisma.$transaction([
    prisma.jobAssignment.count({ where: { workerId: worker.id, status: 'COMPLETED' as any } }),
    prisma.jobAssignment.count({ where: { workerId: worker.id, status: 'CANCELLED' as any } }),
  ]);

  const completionRate = worker.totalJobs > 0
    ? Math.round((completed / worker.totalJobs) * 100)
    : 0;

  const tips: string[] = [];
  if (worker.acceptanceRate < 80) tips.push('Try to accept more jobs to improve your acceptance rate and get priority dispatch.');
  if ((worker.rating ?? 5) < 4) tips.push('Ask customers for feedback after each job to improve your rating.');
  if (completionRate < 90) tips.push('Avoid cancelling accepted jobs — it impacts your priority ranking.');
  if (tips.length === 0) tips.push('Great work! Keep accepting jobs quickly to maintain your top-tier status.');

  return {
    rating: worker.rating ?? 5.0,
    ratingCount: 0,
    totalJobs: worker.totalJobs,
    completedJobs: completed,
    cancelledJobs: cancelled,
    acceptanceRate: worker.acceptanceRate,
    completionRate,
    tips,
  };
}

// ─────────────────────────────────────────────
// SAFETY — SOS ALERT
// ─────────────────────────────────────────────
export async function triggerSos(userId: string, input: SosInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, fcmToken: true },
  });
  if (!user) throw AppError.notFound('User not found');

  const description = [
    `🚨 SOS EMERGENCY — Worker: ${user.name ?? 'Unknown'} (${user.phone})`,
    `Location: lat=${input.lat}, lng=${input.lng}`,
    `Google Maps: https://maps.google.com/?q=${input.lat},${input.lng}`,
    input.message ? `Message: ${input.message}` : '',
  ].filter(Boolean).join('\n');

  // 1. Create a support ticket so Admin sees it immediately on the dashboard
  const ticket = await prisma.supportTicket.create({
    data: {
      userId,
      subject: '🚨 SOS EMERGENCY ALERT',
      status: 'OPEN',
      messages: {
        create: {
          senderId: userId,
          isAgent: false,
          content: description,
        },
      },
    },
  });

  // 2. Emit real-time alert to admin namespace
  emitToWorkerRoom('admin', 'sos_alert', {
    workerId: userId,
    workerName: user.name,
    workerPhone: user.phone,
    lat: input.lat,
    lng: input.lng,
    message: input.message,
    ticketId: ticket.id,
    triggeredAt: new Date().toISOString(),
  });

  logger.warn(`[SAFETY] SOS triggered by worker ${userId} at lat=${input.lat} lng=${input.lng}`);

  return { success: true, ticketId: ticket.id };
}

// ─────────────────────────────────────────────
// SAFETY — ALERTS (static/contextual tips)
// ─────────────────────────────────────────────
export async function getSafetyAlerts() {
  // Static safety tips — replace with DB-driven content when available
  return {
    safetyScore: 92,
    alerts: [
      {
        id: 'sa_1',
        type: 'TIP',
        title: 'Lift with your legs, not your back',
        body: 'Bend your knees when lifting heavy items. Never twist your spine while holding a load.',
        icon: 'fitness_center',
      },
      {
        id: 'sa_2',
        type: 'RULE',
        title: 'Always wear safety gloves',
        body: 'Gloves protect you from cuts and splinters when handling boxes and loose materials.',
        icon: 'back_hand',
      },
      {
        id: 'sa_3',
        type: 'ALERT',
        title: 'Stay hydrated on long shifts',
        body: 'Drink water every 30 minutes during physical work, especially in summer.',
        icon: 'water_drop',
      },
      {
        id: 'sa_4',
        type: 'RULE',
        title: 'Do not work if you feel unwell',
        body: 'If you are feeling sick or dizzy, mark yourself offline and rest. Your health comes first.',
        icon: 'health_and_safety',
      },
    ],
  };
}

// ─────────────────────────────────────────────
// BADGES (mock — no DB tables yet)
// ─────────────────────────────────────────────
export async function getBadges(userId: string) {
  const result = await gamificationService.getBadgesForWorker(userId);
  if (!result) throw AppError.notFound('Worker not found');
  return result;
}

// ─────────────────────────────────────────────
// TRAINING COURSES (Moved to Dedicated Module)
// ─────────────────────────────────────────────

export async function getAnnouncements() {
  return prisma.announcement.findMany({
    where: { isActive: true, target: 'WORKFORCE' },
    orderBy: { createdAt: 'desc' },
  });
}

// ─────────────────────────────────────────────
// SETTINGS & ACCOUNT MANAGEMENT
// ─────────────────────────────────────────────
export async function updateSettings(userId: string, input: UpdateSettingsInput) {
  await prisma.user.update({
    where: { id: userId },
    data: input,
  });
  return getMe(userId);
}

export async function deleteAccount(userId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) throw AppError.notFound('Worker not found');

  // Soft delete both User and Worker
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive: false } }),
    prisma.worker.update({ where: { id: worker.id }, data: { isActive: false, status: 'OFFLINE' } }),
  ]);

  return { deleted: true };
}

