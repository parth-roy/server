import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';
import { env } from '@config/env';

interface OtpJobData {
  phone: string;
  otp: string;
}

async function sendViaMSG91(phone: string, otp: string): Promise<void> {
  // TODO Phase 3b: Replace this with real MSG91 call
  // The interface stays exactly the same — only this function changes
  logger.info(`[MSG91-STUB] Sending OTP ${otp} to +91${phone}`);
  console.log(`\n🔐 OTP for +91${phone}: ${otp}\n`);
}

export function startOtpWorker() {
  createWorker(QUEUES.OTP, async (job) => {
    const { phone, otp } = job.data as OtpJobData;

    try {
      await sendViaMSG91(phone, otp);
      logger.info(`OTP sent to ${phone}`);
    } catch (err) {
      logger.error(`OTP send failed for ${phone}:`, err);
      throw err; // BullMQ will retry (3 attempts configured)
    }
  });

  logger.info('✅ OTP worker started');
}