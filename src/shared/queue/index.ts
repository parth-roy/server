import { Queue, Worker, Job } from 'bullmq';
import { getRedis } from '@config/redis';
import { logger } from '@shared/logger';

const connection = getRedis() as any;

export const QUEUES = {
  OTP: 'otp',
  NOTIFICATION: 'notification',
  INVOICE: 'invoice',
  DISPATCH: 'dispatch',
  ETA_RECALC: 'eta-recalc',        // Live ETA recalculation for active trips
  ULIP_VERIFICATION: 'ulip-verification', // Background ULIP gov-API verification jobs
} as const;

export function createQueue(name: string): Queue {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  });
}

export function createWorker(
  queueName: string,
  processor: (job: Job) => Promise<any>,
  concurrency = 5
): Worker {
  const worker = new Worker(queueName, processor, { connection, concurrency });

  worker.on('completed', (job: any) => {
    logger.debug(`Job ${job.id} in ${queueName} completed`);
  });
  worker.on('failed', (job: any, err: any) => {
    logger.error(`Job ${job?.id} in ${queueName} failed: ${err.message}`);
  });

  return worker;
}

export const otpQueue              = createQueue(QUEUES.OTP);
export const notificationQueue     = createQueue(QUEUES.NOTIFICATION);
export const invoiceQueue          = createQueue(QUEUES.INVOICE);
export const dispatchQueue         = createQueue(QUEUES.DISPATCH);
export const etaRecalcQueue        = createQueue(QUEUES.ETA_RECALC);
export const ulipVerificationQueue = createQueue(QUEUES.ULIP_VERIFICATION);
