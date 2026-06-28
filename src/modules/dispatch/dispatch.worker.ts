import { createWorker, QUEUES } from '@shared/queue';
import { logger } from '@shared/logger';
import { dispatchBooking } from './dispatch.service';

export interface DispatchJobData {
    bookingId: string;
}

export function startDispatchWorker() {
    createWorker(QUEUES.DISPATCH, async (job) => {
        const { bookingId } = job.data as DispatchJobData;

        if (!bookingId) {
            logger.error(`[DispatchWorker] Job ${job.id} missing bookingId — skipping`);
            return;
        }

        logger.info(`[DispatchWorker] Dispatching booking ${bookingId} (job ${job.id})`);
        await dispatchBooking(bookingId);
        logger.info(`[DispatchWorker] Dispatch complete for booking ${bookingId}`);
    });

    logger.info('✅ Dispatch worker started');
}
