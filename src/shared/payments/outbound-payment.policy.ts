import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';

/**
 * One source of truth for payment capabilities that can move money out of the
 * platform or between participant wallets. Both controls intentionally default
 * to false in env.ts. Standard Razorpay customer collections remain enabled.
 */
export const paymentCapabilities = Object.freeze({
  razorpayCollectionsEnabled: true,
  razorpayXPayoutsEnabled: env.RAZORPAYX_PAYOUTS_ENABLED,
  multiPartyTransfersEnabled: env.MULTI_PARTY_TRANSFERS_ENABLED,
});

export function assertRazorpayXPayoutsEnabled(): void {
  if (!paymentCapabilities.razorpayXPayoutsEnabled) {
    throw new AppError(
      'Withdrawals are temporarily paused. Your earnings remain safely recorded in your wallet ledger.',
      503,
      'RAZORPAYX_PAYOUTS_DISABLED'
    );
  }
}

export function assertMultiPartyTransfersEnabled(): void {
  if (!paymentCapabilities.multiPartyTransfersEnabled) {
    throw new AppError(
      'Digital transfers between participant wallets are temporarily paused. No balance was changed.',
      503,
      'MULTI_PARTY_TRANSFERS_DISABLED'
    );
  }
}
