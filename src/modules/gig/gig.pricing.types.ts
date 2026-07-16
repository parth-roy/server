/**
 * gig.pricing.types.ts — Type contracts for the Gig Pricing Engine
 * Separate from truck pricing types (pricing.types.ts)
 */

// ── Zone ─────────────────────────────────────────────────────────────────────

export type GigZone = 'METRO' | 'TIER2' | 'RURAL';

// ── Skill categories ──────────────────────────────────────────────────────────

export type GigSkill =
  | 'HELPER'
  | 'LOADER'
  | 'FURNITURE_MOVER'
  | 'HEAVY_LOADER'
  | 'PACKER'
  | 'CLEANER'
  | 'ELECTRICIAN'
  | 'RIGGER';

// ── Urgency ───────────────────────────────────────────────────────────────────

export type GigUrgency = 'IMMEDIATE' | 'WITHIN_HOUR' | 'SCHEDULED';

// ── Input ─────────────────────────────────────────────────────────────────────

export interface GigFareRequest {
  locationLat:    number;
  locationLng:    number;
  gigCategory:    GigSkill;
  durationHours:  number;        // 1 | 2 | 4 | 8 | 12
  urgency:        GigUrgency;
  workersNeeded:  number;
  workerDistanceKm?: number;     // distance from nearest available worker to job site
  // Surge overrides (from GigPricingConfig, passed in by service)
  festivalSurge?: boolean;
  rainSurge?:     boolean;
  nightSurge?:    boolean;       // auto-detected from scheduledAt hour if not passed
  scheduledHour?: number;        // 0-23, used to detect night surge
  // Platform rate (from GigPricingConfig)
  platformCommissionRate?: number; // default 0.12
  travelFeePerKmBeyond5?: number;  // default 15
}

// ── Breakdown (per worker + totals) ──────────────────────────────────────────

export interface GigFareBreakdown {
  // Zone & rate
  zone:              GigZone;
  baseHourlyRate:    number;
  skillMultiplier:   number;
  hoursMultiplier:   number;

  // Per-worker earnings build-up
  rawEarnings:       number;   // baseHourlyRate × skillMultiplier × hoursMultiplier
  urgencyPremium:    number;   // rupee amount added for urgency
  demandSurge:       number;   // rupee amount added for surge (festival/rain/night)
  travelFee:         number;   // ₹15/km beyond 5km, else 0
  workerEarnings:    number;   // rawEarnings + urgencyPremium + demandSurge + travelFee

  // Platform fee (customer pays on top)
  platformFeeRate:   number;   // 0.12
  platformFeePerWorker: number;

  // Per-worker customer price
  customerPerWorker: number;

  // Totals
  workersNeeded:     number;
  grandTotal:        number;   // customerPerWorker × workersNeeded
  totalWorkerPayout: number;   // workerEarnings × workersNeeded
  platformRevenue:   number;   // grandTotal - totalWorkerPayout

  // Surge flags (for UI display)
  surgeFlags: {
    festival:  boolean;
    rain:      boolean;
    night:     boolean;
    highDemand: boolean;
  };
}
