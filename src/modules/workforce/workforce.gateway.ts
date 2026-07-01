import { prisma } from '@shared/db/prisma';
import { Server as SocketServer, Socket } from 'socket.io';
import { logger } from '@shared/logger';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { WorkerStatus } from '@prisma/client';

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

export function setupWorkforceGateway(io: SocketServer): void {
  const workforce = io.of('/workforce');
  workforce.use(authMiddleware);

  workforce.on('connection', async (socket: Socket) => {
    const userId = (socket as any).user?.userId;
    const role = (socket as any).user?.role;
    logger.debug(`[WorkforceSocket] Connected: ${socket.id} user: ${userId} role: ${role}`);

    // Only WORKER role is allowed in this namespace
    if (role !== 'WORKER') {
      logger.warn(`[WorkforceSocket] Non-WORKER connected: ${userId}. Disconnecting.`);
      socket.disconnect(true);
      return;
    }

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Find worker record and join personal room for targeted push
    try {
      const worker = await prisma.worker.findUnique({
        where: { userId },
        select: { id: true, status: true },
      });
      if (!worker) {
        socket.disconnect(true);
        return;
      }
      socket.join(`worker_${worker.id}`);
      logger.debug(`[WorkforceSocket] Worker ${worker.id} joined personal room worker_${worker.id}`);

      // ── WORKER LOCATION UPDATE ─────────────────────────────────────────
      // Worker app sends GPS pings here (mirrors driver location_update pattern).
      // Rate-limited via Redis: DB snapshot only every 30s, Redis update always.
      socket.on('worker_location_update', async (data: { lat: number; lng: number }) => {
        const { lat, lng } = data;

        // Validate coordinates
        if (
          typeof lat !== 'number' || typeof lng !== 'number' ||
          lat < -90 || lat > 90 || lng < -180 || lng > 180
        ) {
          socket.emit('error', { message: 'Invalid coordinates' });
          return;
        }

        try {
          // Fire-and-forget location update (same pattern as tracking gateway)
          // This avoids await blocking the socket event loop
          const redis = (await import('@config/redis')).getRedis();
          const now = new Date();
          const locationKey = `worker:location:${worker.id}`;

          redis.setex(
            locationKey,
            60,
            JSON.stringify({ lat, lng, updatedAt: now.getTime() }),
          ).catch(err => logger.error('[WorkforceSocket] Redis location update failed:', err));

          // DB snapshot throttled to every 30s
          const snapshotKey = `worker:db_snapshot:${worker.id}`;
          redis.set(snapshotKey, '1', 'EX', 30, 'NX').then(wasSet => {
            if (wasSet === 'OK') {
              prisma.worker.update({
                where: { id: worker.id },
                data: { currentLat: lat, currentLng: lng, lastLocationAt: now },
              }).catch(err => logger.error('[WorkforceSocket] DB location snapshot failed:', err));
            }
          }).catch(() => {
            prisma.worker.update({
              where: { id: worker.id },
              data: { currentLat: lat, currentLng: lng, lastLocationAt: now },
            }).catch(err => logger.error('[WorkforceSocket] DB location fallback failed:', err));
          });
        } catch (err) {
          logger.error('[WorkforceSocket] Location update error:', err);
        }
      });

      // ── WORKER STATUS CHANGE ───────────────────────────────────────────
      // Worker toggles ONLINE/OFFLINE from within the socket connection.
      // This is a convenience — REST API is the source of truth for status.
      socket.on('worker_status_update', async (data: { status: 'OFFLINE' | 'AVAILABLE' }) => {
        if (!['OFFLINE', 'AVAILABLE'].includes(data.status)) {
          socket.emit('error', { message: 'Invalid status. Use OFFLINE or AVAILABLE.' });
          return;
        }
        // Prevent going AVAILABLE if ON_JOB
        const current = await prisma.worker.findUnique({ where: { id: worker.id }, select: { status: true } });
        if (data.status === 'AVAILABLE' && current?.status === WorkerStatus.ON_JOB) {
          socket.emit('error', { message: 'Cannot go available while on an active job' });
          return;
        }
        await prisma.worker.update({
          where: { id: worker.id },
          data: { status: data.status as WorkerStatus },
        });
        socket.emit('status_updated', { status: data.status });
        logger.debug(`[WorkforceSocket] Worker ${worker.id} status → ${data.status}`);
      });

    } catch (err) {
      logger.error('[WorkforceSocket] Connection setup failed:', err);
      socket.disconnect(true);
    }

    socket.on('disconnect', () => {
      logger.debug(`[WorkforceSocket] Disconnected: ${socket.id}`);
    });
  });

  logger.info('✅ Workforce gateway ready (/workforce namespace)');
}
