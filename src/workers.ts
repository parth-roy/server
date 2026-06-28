import { logger } from '@shared/logger';

export async function startAllWorkers() {
  const { startNotificationWorker } = await import('@shared/queue/workers/notification.worker');
  const { startOtpWorker }          = await import('@shared/queue/workers/otp.worker');
  const { startInvoiceWorker }      = await import('@shared/queue/workers/invoice.worker');
  const { startDispatchWorker }     = await import('@modules/dispatch/dispatch.worker');
  const { startEtaWorker, scheduleEtaRecalculationJob } = await import('@shared/jobs/eta.worker');
  const { startUlipWorker }         = await import('@shared/queue/workers/ulip.worker');

  startOtpWorker();
  startNotificationWorker();
  startInvoiceWorker();
  startDispatchWorker();
  startEtaWorker();
  startUlipWorker(); // Processes ULIP gov-API verifications in the background

  // Schedule repeatable ETA batch (every 60 seconds)
  await scheduleEtaRecalculationJob();

  logger.info('All workers initialised');
}

