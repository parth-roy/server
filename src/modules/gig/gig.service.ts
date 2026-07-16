/**
 * gig.service.ts — GoMyTruck Gig/Workforce Job Service
 * Wired to Gig Pricing Engine v1 (West Bengal zone-aware)
 */

import { prisma } from '@shared/db/prisma';
import { AppError } from '@shared/errors/AppError';
import { GigJobStatus, WorkerJobStatus } from '@prisma/client';
import { getSocketInstance } from '@shared/socket/socket.instance';
import { logger } from '@shared/logger';
import { calculateGigFare, classifyZone } from './gig.pricing';
import type { GigFareRequest, GigSkill, GigUrgency } from './gig.pricing.types';

// ─────────────────────────────────────────────
// HELPERS — read GigPricingConfig from DB
// ─────────────────────────────────────────────

async function getGigConfig(): Promise<{
  festivalSurge: boolean;
  rainSurge: boolean;
  platformCommissionRate: number;
  travelFeePerKmBeyond5: number;
}> {
  try {
    const rows = await (prisma as any).gigPricingConfig.findMany() as { key: string; value: string }[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      festivalSurge:          map['gig_festival_surge_active'] === 'true',
      rainSurge:              map['gig_rain_surge_active'] === 'true',
      platformCommissionRate: parseFloat(map['gig_platform_commission_rate'] ?? '0.12'),
      travelFeePerKmBeyond5:  parseFloat(map['gig_travel_fee_per_km'] ?? '15'),
    };
  } catch {
    // fallback defaults if table missing / unreachable
    return { festivalSurge: false, rainSurge: false, platformCommissionRate: 0.12, travelFeePerKmBeyond5: 15 };
  }
}

/**
 * Find the nearest available worker to the job site and return the distance in km.
 * Falls back to 0 if no workers found (no travel fee applied).
 */
async function getNearestWorkerDistanceKm(lat: number, lng: number): Promise<number> {
  try {
    const workers = await prisma.worker.findMany({
      where: { isActive: true, status: 'AVAILABLE' },
      select: { currentLat: true, currentLng: true },
    });
    if (workers.length === 0) return 0;

    const R = 6371;
    let minKm = Infinity;
    for (const w of workers) {
      if (w.currentLat == null || w.currentLng == null) continue;
      const dLat = ((w.currentLat - lat) * Math.PI) / 180;
      const dLng = ((w.currentLng - lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat * Math.PI) / 180) *
        Math.cos((w.currentLat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
      const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (km < minKm) minKm = km;
    }
    return minKm === Infinity ? 0 : Math.round(minKm * 10) / 10;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────
// ESTIMATE (no DB write — for preview in Flutter)
// ─────────────────────────────────────────────

export async function estimateGigFare(input: {
  locationLat:   number;
  locationLng:   number;
  gigCategory:   string;
  durationHours: number;
  urgency:       string;
  workersNeeded: number;
  scheduledHour?: number;
}) {
  const config = await getGigConfig();
  const workerDistanceKm = await getNearestWorkerDistanceKm(input.locationLat, input.locationLng);

  const req: GigFareRequest = {
    locationLat:           input.locationLat,
    locationLng:           input.locationLng,
    gigCategory:           input.gigCategory as GigSkill,
    durationHours:         input.durationHours,
    urgency:               input.urgency as GigUrgency,
    workersNeeded:         input.workersNeeded,
    workerDistanceKm,
    festivalSurge:         config.festivalSurge,
    rainSurge:             config.rainSurge,
    scheduledHour:         input.scheduledHour,
    platformCommissionRate:config.platformCommissionRate,
    travelFeePerKmBeyond5: config.travelFeePerKmBeyond5,
  };

  const breakdown = calculateGigFare(req);

  return {
    estimate: breakdown,
    workerDistanceKm,
    note: 'Estimate only. Actual fare computed at booking time.',
  };
}

// ─────────────────────────────────────────────
// CREATE GIG
// ─────────────────────────────────────────────

export async function createGig(customerId: string, data: any) {
  const config = await getGigConfig();
  const workerDistanceKm = await getNearestWorkerDistanceKm(data.locationLat, data.locationLng);

  const req: GigFareRequest = {
    locationLat:           data.locationLat,
    locationLng:           data.locationLng,
    gigCategory:           (data.gigCategory ?? 'HELPER') as GigSkill,
    durationHours:         data.durationHours ?? 2,
    urgency:               (data.urgency ?? 'SCHEDULED') as GigUrgency,
    workersNeeded:         data.workersNeeded ?? 1,
    workerDistanceKm,
    festivalSurge:         config.festivalSurge,
    rainSurge:             config.rainSurge,
    scheduledHour:         data.scheduledHour,
    platformCommissionRate:config.platformCommissionRate,
    travelFeePerKmBeyond5: config.travelFeePerKmBeyond5,
  };

  const breakdown = calculateGigFare(req);
  const zone = classifyZone(data.locationLat, data.locationLng);

  logger.info(
    `[GigPricing] Creating GIG — zone=${zone} cat=${req.gigCategory} hrs=${req.durationHours} ` +
    `workers=${req.workersNeeded} grandTotal=₹${breakdown.grandTotal} platformFee=₹${breakdown.platformRevenue}`
  );

  const gig = await prisma.gigJob.create({
    data: {
      jobNumber:    `GIG-${Math.floor(100000 + Math.random() * 900000)}`,
      customerId,
      gigType:      data.gigCategory ?? data.gigType ?? 'HELPER', // keep legacy field
      gigCategory:  req.gigCategory,
      description:  data.description,
      locationLat:  data.locationLat,
      locationLng:  data.locationLng,
      locationAddress: data.locationAddress,
      locationZone: zone,
      durationHours: req.durationHours,
      urgency:       req.urgency,
      workersNeeded: req.workersNeeded,
      totalFare:     breakdown.grandTotal,
      perWorkerRate: breakdown.workerEarnings,
      platformFee:   breakdown.platformRevenue,
      fareBreakdown: breakdown as any,
      status:        'PENDING',
    },
  });

  // Notify nearby workforce via Socket.IO
  const io = getSocketInstance();
  if (io) {
    io.of('/workforce').emit('new_gig_job', {
      ...gig,
      fareBreakdown: breakdown,
      workerEarnings: breakdown.workerEarnings,
    });
  }

  return { gig, fareBreakdown: breakdown };
}

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

export async function getCustomerGigs(customerId: string) {
  return prisma.gigJob.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: { assignments: true },
  });
}

export async function getNearbyGigs(lat: number, lng: number, _radiusKm: number) {
  // Return all PENDING gigs — radius filter can be added with PostGIS in future
  return prisma.gigJob.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getGigById(id: string) {
  const gig = await prisma.gigJob.findUnique({
    where: { id },
    include: {
      customer: true,
      assignments: { include: { worker: { include: { user: true } } } },
    },
  });
  if (!gig) throw AppError.notFound('Gig job not found');
  return gig;
}

export async function getAllGigs() {
  return prisma.gigJob.findMany({
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
}

// ─────────────────────────────────────────────
// ACCEPT GIG
// ─────────────────────────────────────────────

export async function acceptGig(workerUserId: string, gigId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId: workerUserId } });
  if (!worker) throw AppError.notFound('Worker profile not found');

  const gig = await prisma.gigJob.findUnique({
    where: { id: gigId },
    include: { assignments: true },
  });
  if (!gig) throw AppError.notFound('Gig job not found');
  if (gig.status !== 'PENDING' && gig.status !== 'ASSIGNED') {
    throw AppError.badRequest('Gig job is no longer available');
  }
  if (gig.assignments.length >= gig.workersNeeded) {
    throw AppError.badRequest('Gig job has already reached required workforce');
  }
  const existingAssignment = gig.assignments.find((a: any) => a.workerId === worker.id);
  if (existingAssignment) throw AppError.badRequest('You have already accepted this job');

  const assignment = await prisma.gigAssignment.create({
    data: {
      gigId,
      workerId:     worker.id,
      status:       'PENDING_ACCEPTANCE',
      payoutAmount: (gig as any).perWorkerRate ?? gig.totalFare / gig.workersNeeded,
    },
  });

  // Promote to ASSIGNED when all workers filled
  if (gig.assignments.length + 1 >= gig.workersNeeded) {
    await prisma.gigJob.update({
      where: { id: gigId },
      data: { status: 'ASSIGNED' },
    });
  }

  return assignment;
}
