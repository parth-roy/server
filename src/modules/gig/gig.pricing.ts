/**
 * gig.pricing.ts — GoMyTruck Gig Pricing Engine v1
 *
 * West Bengal Zone-aware pricing for gig/workforce jobs.
 *
 * Formula (per worker):
 *   rawEarnings    = baseHourlyRate × skillMultiplier × hoursMultiplier
 *   urgencyAdd     = rawEarnings × urgencyRate
 *   surgeAdd       = rawEarnings × maxActiveSurgeRate
 *   travelFee      = max(0, workerDistanceKm - 5) × travelFeePerKm
 *   workerEarnings = rawEarnings + urgencyAdd + surgeAdd + travelFee
 *   customerPerWkr = workerEarnings × (1 + platformCommissionRate)
 *   grandTotal     = customerPerWkr × workersNeeded
 *
 * Zone classification (lat/lng bounding boxes for West Bengal):
 *   METRO  → Kolkata + suburbs
 *   TIER2  → Durgapur, Asansol, Siliguri, Bardhaman, Kharagpur
 *   RURAL  → All remaining WB districts
 */

import type { GigFareRequest, GigFareBreakdown, GigZone, GigSkill } from './gig.pricing.types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Base hourly rate by zone (INR/hr) */
const ZONE_BASE_RATES: Record<GigZone, number> = {
  METRO: 130,
  TIER2: 110,
  RURAL:  90,
};

/** Skill multipliers */
const SKILL_MULTIPLIERS: Record<GigSkill, number> = {
  HELPER:           1.0,
  CLEANER:          1.1,
  LOADER:           1.2,
  PACKER:           1.4,
  FURNITURE_MOVER:  1.3,
  HEAVY_LOADER:     1.5,
  ELECTRICIAN:      2.0,
  RIGGER:           3.0,
};

/**
 * Hours multiplier table.
 * Not linear — accounts for mobilisation overhead on short jobs
 * and economies of scale for long-day engagement.
 */
const HOURS_MULTIPLIERS: { hours: number; multiplier: number }[] = [
  { hours:  1, multiplier: 1.0  },
  { hours:  2, multiplier: 1.9  },
  { hours:  4, multiplier: 3.5  },
  { hours:  8, multiplier: 6.5  },
  { hours: 12, multiplier: 9.0  },
];

/** Urgency premium rates */
const URGENCY_RATES: Record<string, number> = {
  IMMEDIATE:    0.20,
  WITHIN_HOUR:  0.15,
  SCHEDULED:    0.00,
};

/** Surge premium rates (only the highest active one is applied) */
const SURGE_RATES = {
  festival:   0.25,
  rain:       0.15,
  night:      0.20,
  highDemand: 0.10,
};

/** Travel fee: first 5 km free, ₹15/km beyond that */
const TRAVEL_FREE_KM = 5;
const DEFAULT_TRAVEL_FEE_PER_KM = 15;
const DEFAULT_PLATFORM_COMMISSION = 0.12;

// ─────────────────────────────────────────────
// ZONE CLASSIFIER
// ─────────────────────────────────────────────

interface LatLngBox { latMin: number; latMax: number; lngMin: number; lngMax: number }

const METRO_BOXES: LatLngBox[] = [
  // Core Kolkata + Howrah + Bidhannagar
  { latMin: 22.40, latMax: 22.75, lngMin: 88.20, lngMax: 88.50 },
  // South Suburban (Sonarpur, Rajpur, Baruipur)
  { latMin: 22.30, latMax: 22.42, lngMin: 88.35, lngMax: 88.50 },
  // North 24 Parganas suburban (Barasat, Dum Dum, Barrackpore)
  { latMin: 22.70, latMax: 22.95, lngMin: 88.35, lngMax: 88.55 },
];

const TIER2_BOXES: LatLngBox[] = [
  // Durgapur
  { latMin: 23.48, latMax: 23.58, lngMin: 87.28, lngMax: 87.40 },
  // Asansol
  { latMin: 23.64, latMax: 23.72, lngMin: 86.98, lngMax: 87.12 },
  // Siliguri
  { latMin: 26.68, latMax: 26.76, lngMin: 88.38, lngMax: 88.46 },
  // Bardhaman town
  { latMin: 23.22, latMax: 23.28, lngMin: 87.82, lngMax: 87.90 },
  // Kharagpur
  { latMin: 22.32, latMax: 22.38, lngMin: 87.28, lngMax: 87.36 },
  // Haldia
  { latMin: 22.04, latMax: 22.10, lngMin: 88.04, lngMax: 88.12 },
];

function inBox(lat: number, lng: number, box: LatLngBox): boolean {
  return lat >= box.latMin && lat <= box.latMax &&
         lng >= box.lngMin && lng <= box.lngMax;
}

export function classifyZone(lat: number, lng: number): GigZone {
  if (METRO_BOXES.some(b => inBox(lat, lng, b))) return 'METRO';
  if (TIER2_BOXES.some(b => inBox(lat, lng, b))) return 'TIER2';
  return 'RURAL';
}

// ─────────────────────────────────────────────
// HOURS MULTIPLIER LOOKUP
// ─────────────────────────────────────────────

/**
 * Snap requested hours to nearest tier.
 * e.g. 3 hrs → snaps to 2hr tier (conservative), 5 hrs → 4hr tier.
 */
function getHoursMultiplier(hours: number): { multiplier: number; snappedHours: number } {
  // Find the largest tier ≤ requested hours
  let best = HOURS_MULTIPLIERS[0];
  for (const tier of HOURS_MULTIPLIERS) {
    if (hours >= tier.hours) best = tier;
  }
  return { multiplier: best.multiplier, snappedHours: best.hours };
}

// ─────────────────────────────────────────────
// MAIN CALCULATION
// ─────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateGigFare(req: GigFareRequest): GigFareBreakdown {
  const zone = classifyZone(req.locationLat, req.locationLng);
  const baseHourlyRate   = ZONE_BASE_RATES[zone];
  const skillMultiplier  = SKILL_MULTIPLIERS[req.gigCategory] ?? 1.0;
  const { multiplier: hoursMultiplier } = getHoursMultiplier(req.durationHours);

  // Step 1-3: Raw earnings
  const rawEarnings = round2(baseHourlyRate * skillMultiplier * hoursMultiplier);

  // Step 4: Urgency premium
  const urgencyRate     = URGENCY_RATES[req.urgency] ?? 0;
  const urgencyPremium  = round2(rawEarnings * urgencyRate);

  // Step 5: Demand surge — apply only the HIGHEST active surge (no stacking)
  const surgeFlags = {
    festival:   req.festivalSurge  ?? false,
    rain:       req.rainSurge      ?? false,
    night:      req.nightSurge     ?? (req.scheduledHour !== undefined
                  ? req.scheduledHour >= 21 || req.scheduledHour < 6
                  : false),
    highDemand: false, // populated by service via DB query, false in pure calc
  };

  const activeSurgeRates: number[] = [];
  if (surgeFlags.festival)   activeSurgeRates.push(SURGE_RATES.festival);
  if (surgeFlags.rain)       activeSurgeRates.push(SURGE_RATES.rain);
  if (surgeFlags.night)      activeSurgeRates.push(SURGE_RATES.night);
  if (surgeFlags.highDemand) activeSurgeRates.push(SURGE_RATES.highDemand);

  const maxSurgeRate = activeSurgeRates.length > 0 ? Math.max(...activeSurgeRates) : 0;
  const demandSurge  = round2(rawEarnings * maxSurgeRate);

  // Step 6: Travel fee — first 5 km free, ₹15/km beyond
  const workerDist = req.workerDistanceKm ?? 0;
  const travelFeePerKm = req.travelFeePerKmBeyond5 ?? DEFAULT_TRAVEL_FEE_PER_KM;
  const billableKm = Math.max(0, workerDist - TRAVEL_FREE_KM);
  const travelFee  = round2(billableKm * travelFeePerKm);

  // Worker earnings per person
  const workerEarnings = round2(rawEarnings + urgencyPremium + demandSurge + travelFee);

  // Step 7: Platform fee on top
  const platformFeeRate       = req.platformCommissionRate ?? DEFAULT_PLATFORM_COMMISSION;
  const platformFeePerWorker  = round2(workerEarnings * platformFeeRate);
  const customerPerWorker     = round2(workerEarnings + platformFeePerWorker);

  // Totals
  const workersNeeded     = req.workersNeeded;
  const grandTotal        = round2(customerPerWorker * workersNeeded);
  const totalWorkerPayout = round2(workerEarnings * workersNeeded);
  const platformRevenue   = round2(grandTotal - totalWorkerPayout);

  return {
    zone,
    baseHourlyRate,
    skillMultiplier,
    hoursMultiplier,
    rawEarnings,
    urgencyPremium,
    demandSurge,
    travelFee,
    workerEarnings,
    platformFeeRate,
    platformFeePerWorker,
    customerPerWorker,
    workersNeeded,
    grandTotal,
    totalWorkerPayout,
    platformRevenue,
    surgeFlags,
  };
}

/** Returns the skill multiplier map for API consumption (e.g. Flutter dropdown) */
export function getSkillCatalog(): { code: GigSkill; label: string; multiplier: number }[] {
  return [
    { code: 'HELPER',          label: 'General Helper',         multiplier: SKILL_MULTIPLIERS.HELPER },
    { code: 'CLEANER',         label: 'Cleaning / Housekeeping',multiplier: SKILL_MULTIPLIERS.CLEANER },
    { code: 'LOADER',          label: 'Loader / Unloader',      multiplier: SKILL_MULTIPLIERS.LOADER },
    { code: 'PACKER',          label: 'Professional Packer',    multiplier: SKILL_MULTIPLIERS.PACKER },
    { code: 'FURNITURE_MOVER', label: 'Furniture Moving',       multiplier: SKILL_MULTIPLIERS.FURNITURE_MOVER },
    { code: 'HEAVY_LOADER',    label: 'Heavy Loading',          multiplier: SKILL_MULTIPLIERS.HEAVY_LOADER },
    { code: 'ELECTRICIAN',     label: 'Electrician',            multiplier: SKILL_MULTIPLIERS.ELECTRICIAN },
    { code: 'RIGGER',          label: 'Certified Rigger',       multiplier: SKILL_MULTIPLIERS.RIGGER },
  ];
}

/** Returns available zone base rates (for admin display) */
export function getZoneRates(): { zone: GigZone; baseHourlyRate: number }[] {
  return [
    { zone: 'METRO', baseHourlyRate: ZONE_BASE_RATES.METRO },
    { zone: 'TIER2', baseHourlyRate: ZONE_BASE_RATES.TIER2 },
    { zone: 'RURAL', baseHourlyRate: ZONE_BASE_RATES.RURAL },
  ];
}
