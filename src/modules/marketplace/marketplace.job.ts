import { logger } from '@shared/logger';
import { expireMarketplaceState } from './marketplace.service';

const MARKETPLACE_EXPIRY_INTERVAL_MS = 30_000;

export function startMarketplaceJobs(): void {
  const run = () => expireMarketplaceState().catch((error) => {
    logger.error('[Marketplace] Expiry/recovery job failed', error);
  });

  run();
  const timer = setInterval(run, MARKETPLACE_EXPIRY_INTERVAL_MS);
  timer.unref();
  logger.info('✅ Marketplace expiry/recovery job scheduled (30s interval)');
}
