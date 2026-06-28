import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';

export function startNotificationWorker() {
  createWorker(QUEUES.NOTIFICATION, async (job) => {
    logger.debug(`Notification job received: ${job.id} — will be implemented in Phase 11`);
  });
  logger.info('✅ Notification worker started');
}