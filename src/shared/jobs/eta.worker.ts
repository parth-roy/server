/**
 * eta.worker.ts — Live ETA recalculation worker
 *
 * Architecture (as specified in the ETA Architecture Decision):
 *   - Driver GPS updates arrive every 5–10 seconds via Socket.IO
 *   - GPS updates are stored in Redis: driver:location:{driverId}
 *   - ETA is recalculated every 60 seconds by this BullMQ repeatable job
 *   - Mapbox Directions is called ONLY if driver moved > 200m since last calculation
 *   - Result pushed to customer via Socket.IO 'eta_updated' event
 *
 * Intelligent triggers (recalculate immediately, bypassing 60s cadence):
 *   1. Driver deviates > 500m from expected route
 *   2. Driver distance to pickup changes > 200m
 *   3. Resulting ETA changes by >= 2 minutes
 *   4. Mapbox returns no valid route
 *   5. Trip state changes (handled by booking.service.ts, not here)
 *
 * Mapbox cost control:
 *   Skip call if driver moved < 200m since last ETA calculation.
 *   At 100 concurrent trips with 70% movement probability:
 *   70 calls/min = 100,800 calls/day (within manageable cost).
 */

import { createWorker, etaRecalcQueue, QUEUES } from '@shared/queue';
import { prisma } from '@shared/db/prisma';
import { mapsService } from '@modules/maps/maps.service';
import { getRedis } from '@config/redis';
import { emitToBookingRoom } from '@shared/socket/socket.instance';
import { logger } from '@shared/logger';
import { BookingStatus } from '@prisma/client';

// ── Constants ─────────────────────────────────────────────────────────────────
const DRIVER_LOCATION_TTL = 60;        // Seconds — if no GPS in 60s, driver is offline
const MOVEMENT_THRESHOLD_KM = 0.2;    // 200m — skip Mapbox if driver barely moved
const ETA_CHANGE_THRESHOLD_MIN = 2;   // 2 minutes — only push update if ETA changed significantly
const RECALC_INTERVAL_MS = 60 * 1000; // 60 seconds

// ── Haversine distance ────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Get latest driver location from Redis ─────────────────────────────────────
async function getDriverLocationFromRedis(driverId: string): Promise<{ lat: number; lng: number; updatedAt: number } | null> {
    try {
        const redis = getRedis();
        const raw = await redis.get(`driver:location:${driverId}`);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// ── Core ETA calculation for one active trip ──────────────────────────────────
async function recalculateETAForTrip(booking: {
    id:             string;
    driverId:       string | null;
    pickupLat:      number;
    pickupLng:      number;
    pickupAddress:  string;
    etaMinutes:     number | null;
    etaLastDriverLat: number | null;
    etaLastDriverLng: number | null;
}): Promise<void> {
    if (!booking.driverId) return;

    // Get latest driver GPS from Redis (fast — no DB hit)
    const driverLocation = await getDriverLocationFromRedis(booking.driverId);

    if (!driverLocation) {
        // Driver location not in Redis (offline or GPS stale)
        logger.debug(`[ETA] No Redis location for driver ${booking.driverId} — skipping`);
        return;
    }

    const { lat: driverLat, lng: driverLng } = driverLocation;

    // ── Intelligent trigger: movement filter ──────────────────────────────────
    // Skip Mapbox call if driver hasn't moved meaningfully since last calculation
    if (booking.etaLastDriverLat !== null && booking.etaLastDriverLng !== null) {
        const movedKm = haversineKm(driverLat, driverLng, booking.etaLastDriverLat, booking.etaLastDriverLng);
        if (movedKm < MOVEMENT_THRESHOLD_KM) {
            logger.debug(`[ETA] Driver ${booking.driverId} moved only ${Math.round(movedKm * 1000)}m — skipping Mapbox call`);
            return;
        }
    }

    // ── Mapbox Directions call (1 per trip per 60s cadence when driver is moving) ─
    let newEtaMinutes: number;
    try {
        const { durationMinutes } = await mapsService.getDistanceMatrix(
            driverLat, driverLng,
            booking.pickupLat, booking.pickupLng
        );
        newEtaMinutes = durationMinutes;
    } catch (err) {
        logger.error(`[ETA] Mapbox failed for booking ${booking.id}:`, err);
        // Fallback: Haversine-based estimate at 30 km/h city speed
        const distKm = haversineKm(driverLat, driverLng, booking.pickupLat, booking.pickupLng);
        newEtaMinutes = Math.max(1, Math.round((distKm / 30) * 60));
    }

    // ── Intelligent trigger: only update if ETA changed significantly ─────────
    const currentEta = booking.etaMinutes ?? 999;
    const etaChangedMin = Math.abs(newEtaMinutes - currentEta);

    if (etaChangedMin < ETA_CHANGE_THRESHOLD_MIN && booking.etaMinutes !== null) {
        logger.debug(`[ETA] ETA for booking ${booking.id} changed only ${etaChangedMin}min — no push needed`);
        // Still update DB position to track movement, but don't emit socket event
        await prisma.booking.update({
            where: { id: booking.id },
            data: {
                etaLastDriverLat: driverLat,
                etaLastDriverLng: driverLng,
                etaLastCalculatedAt: new Date(),
            } as any,
        });
        return;
    }

    // ── Update DB and push to customer ────────────────────────────────────────
    await prisma.booking.update({
        where: { id: booking.id },
        data: {
            etaMinutes:          newEtaMinutes,
            etaLastCalculatedAt: new Date(),
            etaLastDriverLat:    driverLat,
            etaLastDriverLng:    driverLng,
        } as any,
    });

    const driverDistanceKm = Math.round(haversineKm(driverLat, driverLng, booking.pickupLat, booking.pickupLng) * 10) / 10;

    // Emit to customer's socket room
    emitToBookingRoom(booking.id, 'eta_updated', {
        bookingId:       booking.id,
        etaMinutes:      newEtaMinutes,
        driverDistanceKm,
        lastUpdatedAt:   new Date().toISOString(),
    });

    logger.info(`[ETA] Booking ${booking.id}: ETA ${currentEta}min → ${newEtaMinutes}min (driver ${Math.round(driverDistanceKm * 10) / 10}km away)`);
}

// ── Main batch ETA recalculation job ─────────────────────────────────────────
async function runETABatch(): Promise<void> {
    // Find all bookings where driver is en-route (DRIVER_ARRIVING status)
    const activeBookings = await prisma.booking.findMany({
        where: {
            status: BookingStatus.DRIVER_ARRIVING,
            driverId: { not: null },
        },
        select: {
            id:              true,
            driverId:        true,
            pickupLat:       true,
            pickupLng:       true,
            pickupAddress:   true,
            etaMinutes:      true,
            etaLastDriverLat: true,
            etaLastDriverLng: true,
        },
    });

    if (activeBookings.length === 0) {
        logger.debug('[ETA] No active DRIVER_ARRIVING bookings');
        return;
    }

    logger.info(`[ETA] Recalculating for ${activeBookings.length} active trip(s)`);

    // Process trips concurrently (max 5 simultaneous Mapbox calls to respect rate limits)
    const BATCH_SIZE = 5;
    for (let i = 0; i < activeBookings.length; i += BATCH_SIZE) {
        const batch = activeBookings.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(b => recalculateETAForTrip(b as any)));
    }
}

// ── Worker setup ──────────────────────────────────────────────────────────────
export function startEtaWorker(): void {
    createWorker(QUEUES.ETA_RECALC, async (job) => {
        await runETABatch();
    }, 1); // concurrency=1 — only one batch runs at a time

    logger.info('✅ ETA recalculation worker started');
}

// ── Schedule repeatable job ───────────────────────────────────────────────────
export async function scheduleEtaRecalculationJob(): Promise<void> {
    // Remove any existing repeatable job first (idempotent setup)
    const repeatableJobs = await etaRecalcQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === 'eta-batch') {
            await etaRecalcQueue.removeRepeatableByKey(job.key);
        }
    }

    await etaRecalcQueue.add(
        'eta-batch',
        {},
        {
            repeat:  { every: RECALC_INTERVAL_MS },
            jobId:   'eta-batch-repeatable',
            removeOnComplete: 10,
            removeOnFail: 5,
        }
    );

    logger.info(`✅ ETA recalculation scheduled every ${RECALC_INTERVAL_MS / 1000}s`);
}

/**
 * Trigger an immediate ETA recalculation for a specific booking.
 * Called by tracking.gateway.ts when an intelligent trigger fires.
 */
export async function triggerImmediateETA(bookingId: string): Promise<void> {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
            id:              true,
            driverId:        true,
            pickupLat:       true,
            pickupLng:       true,
            pickupAddress:   true,
            etaMinutes:      true,
            status:          true,
            etaLastDriverLat: true,
            etaLastDriverLng: true,
        },
    });

    if (!booking || booking.status !== BookingStatus.DRIVER_ARRIVING) return;

    // Bypass movement filter for immediate triggers — recalculate regardless
    const driverLocation = await getDriverLocationFromRedis(booking.driverId!);
    if (!driverLocation) return;

    try {
        const { durationMinutes } = await mapsService.getDistanceMatrix(
            driverLocation.lat, driverLocation.lng,
            booking.pickupLat, booking.pickupLng
        );

        await prisma.booking.update({
            where: { id: bookingId },
            data: {
                etaMinutes:          durationMinutes,
                etaLastCalculatedAt: new Date(),
                etaLastDriverLat:    driverLocation.lat,
                etaLastDriverLng:    driverLocation.lng,
            } as any,
        });

        const driverDistanceKm = Math.round(
            haversineKm(driverLocation.lat, driverLocation.lng, booking.pickupLat, booking.pickupLng) * 10
        ) / 10;

        emitToBookingRoom(bookingId, 'eta_updated', {
            bookingId,
            etaMinutes:      durationMinutes,
            driverDistanceKm,
            lastUpdatedAt:   new Date().toISOString(),
            trigger:         'immediate',
        });

        logger.info(`[ETA] Immediate recalc for ${bookingId}: ${durationMinutes}min`);
    } catch (err) {
        logger.error(`[ETA] Immediate recalc failed for ${bookingId}:`, err);
    }
}
