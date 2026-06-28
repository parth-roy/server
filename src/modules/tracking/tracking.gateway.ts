import { prisma } from '@shared/db/prisma';
import { Server as SocketServer, Socket } from 'socket.io';
import { logger } from '@shared/logger';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { getRedis } from '@config/redis';
import { triggerImmediateETA } from '@shared/jobs/eta.worker';

// ── Driver location Redis key & TTL ───────────────────────────────────────────
// Primary store for latest GPS — ETA worker reads from here (fast, no DB hit).
const DRIVER_LOCATION_KEY = (driverId: string) => `driver:location:${driverId}`;
const DRIVER_LOCATION_TTL = 60; // 60s — stale after one missed heartbeat

// Intelligent trigger thresholds
const DEVIATION_TRIGGER_KM  = 0.5; // 500m route deviation → immediate ETA recalc
const DISTANCE_TRIGGER_KM   = 0.2; // 200m from pickup change → recalc

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const authMiddleware = (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('Authentication error: Missing token'));
    try {
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
        (socket as any).user = decoded;
        next();
    } catch {
        next(new Error('Authentication error: Invalid token'));
    }
};

export function setupTrackingGateway(io: SocketServer) {
    const tracking = io.of('/tracking');
    tracking.use(authMiddleware);

    tracking.on('connection', (socket: Socket) => {
        const userId = (socket as any).user?.userId;
        const role   = (socket as any).user?.role;
        logger.debug(`Socket connected: ${socket.id} user: ${userId}`);

        // Every driver automatically joins their personal room so ULIP worker
        // can push document verification results directly to them.
        if (role === 'DRIVER' && userId) {
            // We need the driverId, not userId — look it up and join the room
            prisma.driver.findUnique({ where: { userId }, select: { id: true } })
                .then(driver => {
                    if (driver) {
                        socket.join(`driver_${driver.id}`);
                        logger.debug(`Driver ${driver.id} joined personal room driver_${driver.id}`);
                    }
                })
                .catch(() => { /* non-fatal */ });
        }

        // Customer/admin subscribes to live updates for a booking
        socket.on('subscribe_booking', (bookingId: string) => {
            socket.join(`booking_${bookingId}`);
            logger.debug(`Socket ${socket.id} joined room booking_${bookingId}`);
        });


        socket.on('unsubscribe_booking', (bookingId: string) => {
            socket.leave(`booking_${bookingId}`);
        });

        // Driver emits GPS location update.
        // FIX HIGH-33: Verify the socket user is the ASSIGNED DRIVER for this booking
        // before broadcasting. Prevents any other user from spoofing driver location.
        socket.on('driver_location_update', async (data: { bookingId: string; lat: number; lng: number }) => {
            const { bookingId, lat, lng } = data;

            if (
                typeof lat !== 'number' || typeof lng !== 'number' ||
                lat < -90 || lat > 90 || lng < -180 || lng > 180
            ) {
                socket.emit('error', { message: 'Invalid coordinates' });
                return;
            }

            if (!userId) {
                socket.emit('error', { message: 'Authentication required' });
                return;
            }

            let driver: { id: string } | null = null;
            try {
                const booking = await prisma.booking.findUnique({
                    where: { id: bookingId },
                    select: { driverId: true },
                });
                if (!booking) { socket.emit('error', { message: 'Booking not found' }); return; }

                driver = await prisma.driver.findUnique({
                    where: { userId },
                    select: { id: true },
                });
                if (!driver || booking.driverId !== driver.id) {
                    socket.emit('error', { message: 'Not authorized to update location for this booking' });
                    logger.warn(`[Socket] Unauthorized location spoof attempt by user ${userId} for booking ${bookingId}`);
                    return;
                }
            } catch (err) {
                logger.error('Location auth check failed:', err);
                socket.emit('error', { message: 'Authorization check failed' });
                return;
            }

            if (!driver) return; // type guard — should never hit after the auth check above

            const now = new Date();

            // 1. Broadcast instantly to all subscribers (live map marker)
            tracking.to(`booking_${bookingId}`).emit('location_updated', { lat, lng, timestamp: now });

            // 2. Store in Redis as PRIMARY location store (ETA worker reads from here)
            //    This avoids DB hits on every 5s GPS ping.
            const redis = getRedis();
            redis.setex(
                DRIVER_LOCATION_KEY(driver.id),
                DRIVER_LOCATION_TTL,
                JSON.stringify({ lat, lng, updatedAt: now.getTime(), bookingId }),
            ).catch(err => logger.error('Failed to cache driver location in Redis:', err));

            // 3. Persist location history (fire-and-forget — DB write)
            prisma.bookingLocationHistory.create({
                data: { bookingId, latitude: lat, longitude: lng },
            }).catch(err => logger.error('Failed to save location history:', err));

            // 4. Snapshot driver's DB position every 30s (not on every ping)
            //    Check: only write to DB if last DB write was > 30s ago
            const dbSnapshotKey = `driver:db_snapshot:${driver.id}`;
            redis.set(dbSnapshotKey, '1', 'EX', 30, 'NX').then(wasSet => {
                if (wasSet === 'OK') {
                    // First write in 30s window — update DB
                    prisma.driver.update({
                        where: { id: driver.id },
                        data: { currentLat: lat, currentLng: lng, lastLocationAt: now },
                    }).catch(err => logger.error('Failed to snapshot driver location to DB:', err));
                }
            }).catch(() => {
                // Redis unavailable — always write to DB (fallback)
                prisma.driver.update({
                    where: { id: driver.id },
                    data: { currentLat: lat, currentLng: lng, lastLocationAt: now },
                }).catch(err => logger.error('Failed to update driver location (fallback):', err));
            });

            // 5. Intelligent ETA trigger: immediate recalculation if driver deviated significantly
            //    Only applies when booking is DRIVER_ARRIVING (driver is on the way to pickup)
            try {
                const bookingForETA = await prisma.booking.findUnique({
                    where: { id: bookingId },
                    select: {
                        status:          true,
                        pickupLat:       true,
                        pickupLng:       true,
                        etaLastDriverLat: true,
                        etaLastDriverLng: true,
                    },
                });

                if (bookingForETA?.status === 'DRIVER_ARRIVING') {
                    let shouldTriggerImmediate = false;

                    // Trigger: driver distance to pickup changed by > 200m since last ETA calc
                    if (bookingForETA.etaLastDriverLat !== null && bookingForETA.etaLastDriverLng !== null) {
                        const movementSinceLastCalc = haversineKm(
                            lat, lng,
                            bookingForETA.etaLastDriverLat,
                            bookingForETA.etaLastDriverLng
                        );
                        if (movementSinceLastCalc > DEVIATION_TRIGGER_KM) {
                            shouldTriggerImmediate = true;
                            logger.debug(`[ETA Trigger] Driver deviated ${Math.round(movementSinceLastCalc * 1000)}m from last calc position`);
                        }
                    }

                    if (shouldTriggerImmediate) {
                        // Use a debounce key to avoid triggering on every GPS ping during deviation
                        const triggerKey = `eta:trigger:${bookingId}`;
                        redis.set(triggerKey, '1', 'EX', 30, 'NX').then(wasSet => {
                            if (wasSet === 'OK') {
                                // First trigger in 30s — fire immediate recalc
                                triggerImmediateETA(bookingId).catch(err =>
                                    logger.error(`[ETA] Immediate trigger failed for ${bookingId}:`, err)
                                );
                            }
                        }).catch(() => {
                            // Redis down — skip trigger (60s worker handles it)
                        });
                    }
                }
            } catch (err) {
                // Non-fatal — ETA trigger failure must not affect GPS broadcast
                logger.debug('[ETA] Trigger check failed (non-fatal):', err);
            }
        });

        // FIX HIGH-34: Reject status changes via socket — they bypass assertTransition().
        // All status transitions must go through the REST API which enforces the state machine.
        socket.on('booking_status_change', (data: { bookingId: string; status: string }) => {
            logger.warn(`[Socket] booking_status_change rejected for booking ${data.bookingId} by user ${userId}`);
            socket.emit('error', {
                message: 'Use the REST API for status changes (PATCH /bookings/:id/arrive, /pickup, etc.)',
                code: 'USE_REST_API',
            });
        });

        socket.on('disconnect', () => {
            logger.debug(`Socket disconnected: ${socket.id}`);
        });
    });

    logger.info('✅ Tracking gateway ready (with driver location auth)');
}
