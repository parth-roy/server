import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';

export function startInvoiceWorker() {
  createWorker(QUEUES.INVOICE, async (job) => {
    logger.debug(`Invoice job received: ${job.id} — will be implemented in Phase 9`);
  });
  logger.info('✅ Invoice worker started');
}