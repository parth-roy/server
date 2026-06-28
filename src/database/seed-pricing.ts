/**
 * seed-pricing.ts — Seeds all vehicle type pricing and global pricing config.
 * West Bengal 2026 pricing based on GoMyTruck Master Blueprint research.
 * Run: npx ts-node -r tsconfig-paths/register src/database/seed-pricing.ts
 */

import { PrismaClient, VehicleType } from '@prisma/client';

const prisma = new PrismaClient();

const VEHICLE_PRICING = [
  {
    vehicleType: VehicleType.BIKE,
    displayName: 'Bike',
    baseFare: 40, baseIncludesKm: 2, pricePerKm: 10, minFare: 60,
    capacityKg: 30, capacityDesc: '30 kg — Documents, small parcels, medicine',
    estimatedEta: 5, tcoPerKm: 8.00, surgeHardCap: 1.5,
    timeFreeMinutes: 20, timeChargePerMin: 0.50,
    waitingFreeMinutes: 20, waitingChargePerBlock: 50,
    loadingChargePerHelper: 0, maxHelpers: 0,
    isActive: true,
  },
  {
    vehicleType: VehicleType.THREE_WHEELER,
    displayName: '3 Wheeler',
    baseFare: 80, baseIncludesKm: 3, pricePerKm: 15, minFare: 150,
    capacityKg: 500, capacityDesc: '500 kg — Small goods, vegetables, retail',
    estimatedEta: 8, tcoPerKm: 12.00, surgeHardCap: 1.5,
    timeFreeMinutes: 25, timeChargePerMin: 1.00,
    waitingFreeMinutes: 25, waitingChargePerBlock: 75,
    loadingChargePerHelper: 400, maxHelpers: 1,
    isActive: true,
  },
  {
    vehicleType: VehicleType.TATA_ACE,
    displayName: 'Tata Ace (Mini)',
    baseFare: 190, baseIncludesKm: 4, pricePerKm: 19, minFare: 300,
    capacityKg: 750, capacityDesc: '750 kg — Small business, FMCG, Burrabazar loads',
    estimatedEta: 12, tcoPerKm: 15.33, surgeHardCap: 1.5,
    timeFreeMinutes: 30, timeChargePerMin: 1.50,
    waitingFreeMinutes: 30, waitingChargePerBlock: 100,
    loadingChargePerHelper: 400, maxHelpers: 2,
    isActive: true,
  },
  {
    vehicleType: VehicleType.MINI_TRUCK,
    displayName: 'Pickup 8ft (Bolero)',
    baseFare: 270, baseIncludesKm: 4, pricePerKm: 25, minFare: 500,
    capacityKg: 1250, capacityDesc: '1,250 kg — Office shifting, factory supplies',
    estimatedEta: 15, tcoPerKm: 19.16, surgeHardCap: 1.5,
    timeFreeMinutes: 40, timeChargePerMin: 1.50,
    waitingFreeMinutes: 40, waitingChargePerBlock: 120,
    loadingChargePerHelper: 500, maxHelpers: 2,
    isActive: true,
  },
  {
    vehicleType: 'TRUCK_14FT' as VehicleType,
    displayName: 'Tata 407 (14ft)',
    baseFare: 500, baseIncludesKm: 5, pricePerKm: 30, minFare: 900,
    capacityKg: 3500, capacityDesc: '3.5 tons — Factory loads, bulk FMCG, wholesale',
    estimatedEta: 20, tcoPerKm: 30.00, surgeHardCap: 2.0,
    timeFreeMinutes: 60, timeChargePerMin: 2.00,
    waitingFreeMinutes: 60, waitingChargePerBlock: 150,
    loadingChargePerHelper: 600, maxHelpers: 3,
    isActive: true,
  },
  {
    vehicleType: 'TRUCK_17FT' as VehicleType,
    displayName: '17ft Truck',
    baseFare: 700, baseIncludesKm: 5, pricePerKm: 38, minFare: 1400,
    capacityKg: 6500, capacityDesc: '6.5 tons — Heavy industrial, construction',
    estimatedEta: 25, tcoPerKm: 38.00, surgeHardCap: 2.0,
    timeFreeMinutes: 60, timeChargePerMin: 2.50,
    waitingFreeMinutes: 60, waitingChargePerBlock: 150,
    loadingChargePerHelper: 700, maxHelpers: 4,
    isActive: true,
  },
  {
    vehicleType: 'TRUCK_20FT' as VehicleType,
    displayName: '20ft Truck',
    baseFare: 900, baseIncludesKm: 5, pricePerKm: 44, minFare: 1800,
    capacityKg: 8000, capacityDesc: '8 tons — Port cargo, construction material',
    estimatedEta: 30, tcoPerKm: 43.33, surgeHardCap: 2.0,
    timeFreeMinutes: 90, timeChargePerMin: 3.00,
    waitingFreeMinutes: 90, waitingChargePerBlock: 150,
    loadingChargePerHelper: 800, maxHelpers: 4,
    isActive: true,
  },
  {
    vehicleType: 'CONTAINER_32FT' as VehicleType,
    displayName: '32ft Container',
    baseFare: 1500, baseIncludesKm: 5, pricePerKm: 55, minFare: 3000,
    capacityKg: 16000, capacityDesc: '16 tons — National highway, Haldia port containers',
    estimatedEta: 40, tcoPerKm: 50.33, surgeHardCap: 2.0,
    timeFreeMinutes: 120, timeChargePerMin: 4.00,
    waitingFreeMinutes: 120, waitingChargePerBlock: 200,
    loadingChargePerHelper: 800, maxHelpers: 4,
    isActive: true,
  },
];

const PRICING_CONFIG = [
  { key: 'platform_commission_rate', value: '0.10', description: 'Current platform commission rate (0.0 to 1.0). Market Entry stage: 5-10%.' },
  { key: 'commission_lifecycle_stage', value: 'MARKET_ENTRY', description: 'MARKET_ENTRY | DENSITY | MATURITY' },
  { key: 'insurance_base_charge', value: '49', description: '₹49 flat cargo insurance opt-in charge' },
  { key: 'diesel_baseline_price', value: '90.00', description: '90-day trailing diesel price baseline (₹/litre, West Bengal)' },
  { key: 'diesel_current_price', value: '92.00', description: 'Current diesel price (₹/litre). Update weekly.' },
  { key: 'fuel_surcharge_enabled', value: 'true', description: 'Enable/disable fuel surcharge module' },
  { key: 'fuel_surcharge_threshold_pct', value: '5', description: '% above baseline that triggers fuel surcharge' },
  { key: 'fuel_surcharge_max_pct_of_distance_fare', value: '20', description: 'Max fuel surcharge as % of distance fare (anti-gouging cap)' },
  { key: 'gst_rate_freight', value: '0.05', description: 'GST rate for freight transport (HSN 9965)' },
  { key: 'gst_rate_services', value: '0.18', description: 'GST rate for loading/insurance/platform services (HSN 8428/9983/9971)' },
  { key: 'surge_enabled', value: 'false', description: 'Enable surge pricing engine (Stage 2+). false = M(θ)=1.0 always.' },
  { key: 'surge_k_parameter', value: '0.25', description: 'Surge sensitivity k in M(θ) = 1 + k×ln(θ)' },
  { key: 'surge_default_hard_cap', value: '1.5', description: 'Default surge hard cap (vehicle-specific caps override this)' },
  { key: 'festival_modifier_active', value: 'false', description: 'Toggle during Durga Puja / major festival weeks' },
  { key: 'festival_modifier_value', value: '1.35', description: 'Surge modifier during festival (1.35 = 35% higher base)' },
  { key: 'weather_surge_enabled', value: 'false', description: 'Enable weather-based surge modifier (Stage 2+)' },
  { key: 'cancellation_fee_after_assigned', value: '50', description: '₹ penalty if customer cancels after driver assigned' },
  { key: 'cancellation_fee_after_arriving', value: '100', description: '₹ penalty if customer cancels after driver marks arriving' },
  { key: 'max_trip_distance_km', value: '500', description: 'Maximum allowed trip distance in km' },
  { key: 'min_trip_distance_km', value: '1', description: 'Minimum trip distance to avoid zero-fare bookings' },
  { key: 'max_coin_redemption_pct', value: '20', description: 'Max % of fare that can be paid with coins' },
  { key: 'coin_to_rupee_rate', value: '0.90', description: '1 coin = ₹0.90 in fare reduction' },
  { key: 'time_charge_enabled', value: 'true', description: 'Enable per-minute congestion charge component' },
  { key: 'waiting_charge_block_minutes', value: '30', description: 'Size of each waiting charge billing block (minutes)' },
  { key: 'vehicle_pricing_cache_ttl_seconds', value: '300', description: 'Redis TTL for vehicle pricing cache (seconds)' },
  { key: 'config_cache_ttl_seconds', value: '120', description: 'Redis TTL for pricing config cache (seconds)' },
];

async function seedPricing() {
  console.log('🚛 Seeding pricing engine v2...');

  // Upsert all vehicle pricing rows
  for (const v of VEHICLE_PRICING) {
    await (prisma.vehicleTypePricing as any).upsert({
      where: { vehicleType: v.vehicleType },
      update: v,
      create: v,
    });
    console.log(`  ✅ ${v.displayName} (${v.vehicleType})`);
  }

  // Upsert all config rows
  for (const c of PRICING_CONFIG) {
    await (prisma as any).pricingConfig.upsert({
      where: { key: c.key },
      update: { value: c.value, description: c.description },
      create: c,
    });
  }
  console.log(`  ✅ ${PRICING_CONFIG.length} pricing config keys seeded`);

  // Seed serviceability config
  await (prisma as any).serviceabilityConfig.upsert({
    where: { level_value: { level: 'COUNTRY', value: 'in' } },
    update: { isAllowed: true, isActive: true },
    create: {
      level:       'COUNTRY',
      value:       'in',
      displayName: 'India',
      isAllowed:   true,
      isActive:    true,
      note:        'Stage 1: India is the only serviceable country. Add STATE/CITY/PINCODE rows for expansion.',
    },
  });
  console.log('  ✅ Serviceability config seeded (India → allowed)');

  console.log('\n✅ Pricing engine seed complete.');
  console.log('   8 vehicle types | ' + PRICING_CONFIG.length + ' config keys | 1 serviceability rule');
  console.log('   West Bengal 2026 rates applied (research document Phase 3)');
}

seedPricing()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
