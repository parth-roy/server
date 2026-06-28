/**
 * pricing.types.ts — All TypeScript interfaces for the Pricing Engine.
 * These are the contracts between the pricing service, booking service,
 * and API response layer.
 */

// ── Input ─────────────────────────────────────────────────────────────────────

export interface FareEstimateRequest {
  pickupLat:       number;
  pickupLng:       number;
  dropLat:         number;
  dropLng:         number;
  vehicleType:     string;
  hasLoadingService?: boolean;   // legacy: true = 1 helper
  helperCount?:    number;       // 0–4 helpers
  insuranceOpted?: boolean;
  stops?:          Array<{ lat: number; lng: number }>;
  bookingId?:      string;       // present when re-validating on booking confirm
}

// ── Internal calculation state ────────────────────────────────────────────────

export interface FareComponents {
  // Distance & routing
  distanceKm:        number;
  durationMinutes:   number;
  distanceSource:    'mapbox' | 'haversine_fallback';

  // Core fare components
  baseFare:          number;
  baseIncludesKm:    number;
  distanceFare:      number;
  timeFare:          number;
  fuelSurcharge:     number;
  surgeMultiplier:   number;

  // Add-ons (not surged)
  loadingCharge:     number;
  insuranceCharge:   number;

  // Subtotal + floor
  subtotal:          number;
  totalFare:         number;   // After minimum fare floor. Before GST.

  // GST breakdown
  freightGst:        number;
  loadingGst:        number;
  insuranceGst:      number;
  totalGst:          number;
  grandTotal:        number;   // totalFare + totalGst

  // Commission & payout
  commissionRate:    number;
  commissionAmount:  number;
  driverPayout:      number;
  subsidyAmount:     number;
}

// ── Vehicle info returned in response ─────────────────────────────────────────

export interface VehicleInfo {
  vehicleType:           string;
  displayName:           string;
  baseFare:              number;
  baseIncludesKm:        number;
  pricePerKm:            number;
  minFare:               number;
  capacityKg:            number;
  capacityDesc:          string;
  estimatedEta:          number;
  imageUrl:              string | null;
  waitingFreeMinutes:    number;
  waitingChargePerBlock: number;
  loadingChargePerHelper:number;
  maxHelpers:            number;
  surgeHardCap:          number;
}

// ── API Response ──────────────────────────────────────────────────────────────

export interface FareEstimateResponse {
  estimatedDistanceKm:      number;
  estimatedDurationMinutes: number;

  fareBreakdown: {
    baseFare:         number;
    baseIncludesKm:   number;
    distanceFare:     number;
    timeFare:         number;
    fuelSurcharge:    number;
    surgeMultiplier:  number;
    surgeActive:      boolean;
    surgeReason:      string | null;
    loadingCharge:    number;
    insuranceCharge:  number;
    subtotal:         number;
  };

  totalFare:   number;   // Before GST

  gstBreakdown: {
    freightGst:    number;
    loadingGst:    number;
    insuranceGst:  number;
    totalGst:      number;
  };

  grandTotal:     number;   // totalFare + totalGst

  waitingInfo: {
    freeMinutes:           number;
    chargePerBlock:        number;
    blockDurationMinutes:  number;
    note:                  string;
  };

  tollInfo: {
    estimatedToll: number;
    note:          string;
  };

  driverPayout:    number;
  platformRevenue: number;

  vehicle:         VehicleInfo;

  distanceSource:  'mapbox' | 'haversine_fallback';
  surgeActive:     boolean;
  estimatedAt:     string;
}

// ── Waiting charge ────────────────────────────────────────────────────────────

export interface WaitingChargeResult {
  waitingMinutes:    number;
  freeMinutes:       number;
  billableMinutes:   number;
  blocks:            number;
  waitingCharge:     number;
  driverEarns:       number;
  platformEarns:     number;
}

// ── Pricing config ────────────────────────────────────────────────────────────

export interface PricingConfigMap {
  platform_commission_rate:              number;
  commission_lifecycle_stage:            string;
  insurance_base_charge:                 number;
  diesel_baseline_price:                 number;
  diesel_current_price:                  number;
  fuel_surcharge_enabled:                boolean;
  fuel_surcharge_threshold_pct:          number;
  fuel_surcharge_max_pct_of_distance_fare: number;
  gst_rate_freight:                      number;
  gst_rate_services:                     number;
  surge_enabled:                         boolean;
  surge_k_parameter:                     number;
  festival_modifier_active:              boolean;
  festival_modifier_value:               number;
  time_charge_enabled:                   boolean;
  waiting_charge_block_minutes:          number;
  max_trip_distance_km:                  number;
  min_trip_distance_km:                  number;
  max_coin_redemption_pct:               number;
  coin_to_rupee_rate:                    number;
}
