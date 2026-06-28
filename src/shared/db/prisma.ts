/**
 * prisma.ts — Singleton PrismaClient instance
 *
 * WHY THIS EXISTS:
 * Each `new PrismaClient()` creates a new connection pool. With multiple service
 * files each doing `new PrismaClient()`, we exhaust Supabase's 20 connection limit
 * within seconds under real load, causing "Too many connections" errors.
 *
 * SOLUTION: Export a single shared instance. Every module imports from here.
 *
 * USAGE:
 *   import { prisma } from '@shared/db/prisma';
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '@shared/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: [
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
    errorFormat: 'minimal',
  });
}

// In production: create a single instance.
// In development (hot-reload): reuse the instance across module reloads
// to avoid connection pool exhaustion during dev restarts.
export const prisma: PrismaClient =
  global.__prisma ?? (global.__prisma = createPrismaClient());

// Wire up Prisma events to Winston logger
(prisma as any).$on('error', (e: any) => {
  logger.error('[Prisma] Database error', { message: e.message, target: e.target });
});

(prisma as any).$on('warn', (e: any) => {
  logger.warn('[Prisma] Database warning', { message: e.message });
});

// Graceful shutdown
process.on('beforeExit', async () => {
  logger.info('[Prisma] Disconnecting...');
  await prisma.$disconnect();
});
