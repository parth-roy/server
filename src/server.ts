// Sentry MUST be initialized before any other imports
import { initSentry } from '@config/sentry';
initSentry();

import { prisma } from '@shared/db/prisma';
import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { getRedis } from '@config/redis';
import { setupTrackingGateway } from '@modules/tracking/tracking.gateway';
import { registerEventListeners } from '@shared/eventbus/listeners';
import { startAllWorkers } from './workers';
import { startCleanupJobs } from '@shared/jobs/cleanup.job';
import { setSocketInstance } from '@shared/socket/socket.instance';


async function bootstrap() {
  // 1. Test Supabase connection
  try {
    await prisma.$connect();
    logger.info('✅ Supabase (PostgreSQL) connected');
  } catch (err) {
    logger.error('❌ Supabase connection failed. Check DATABASE_URL in .env:', err);
    process.exit(1);
  }

  // 2. Connect Upstash Redis (only for OTP - minimal usage)
  const redisClient = getRedis();
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    logger.info('✅ Redis (Upstash) connected');
  } catch (err) {
    logger.error('❌ Upstash Redis connection failed. Check REDIS_URL in .env:', err);
    // Don't exit - Redis is optional for OTP (fallback to DB)
  }

  // 3. Express app
  const app = createApp();
  const httpServer = createServer(app);

  // 4. Socket.io - IN-MEMORY adapter (no Redis needed for single server)
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  const io = new SocketServer(httpServer, {
    cors: {
      origin: env.NODE_ENV === 'production' ? allowedOrigins : '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });
  logger.info('Socket.io ready (in-memory mode - no Redis adapter)');

  // 5. Tracking gateway + register socket instance for worker access
  setupTrackingGateway(io);
  setSocketInstance(io); // Allows ETA worker and other workers to emit socket events

  // 5.5. Register event bus listeners (booking.confirmed → dispatch, delivered → coins, etc.)
  registerEventListeners();

  // 5.6. Start maintenance cleanup jobs (location history TTL, expired tokens)
  startCleanupJobs();

  // 6. Start BullMQ workers
  try {
    await startAllWorkers();
    logger.info('✅ BullMQ workers started');
  } catch (err) {
    logger.warn('⚠️  BullMQ workers failed to start (non-fatal — queue jobs will accumulate):', err);
  }

  // 7. Start HTTP server
  httpServer.listen(env.PORT, () => {
    logger.info(`🚀 ${env.APP_NAME} running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`   Health: http://localhost:${env.PORT}/health`);
  });

  // 8. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      if (redisClient.status === 'ready') {
        await redisClient.quit();
      }
      logger.info('Server closed cleanly');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});
