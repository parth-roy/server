/**
 * migrate-pricing.ts — Backfills existing VehicleTypePricing rows
 * with new fields added in the pricing engine v2 migration.
 * Run AFTER: npx prisma migrate dev --name "pricing_engine_v2"
 * Run: npx ts-node -r tsconfig-paths/register src/database/migrate-pricing.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BACKFILL_DEFAULTS: Record<string, object> = {
  BIKE: {
    baseIncludesKm: 2, tcoPerKm: 8.00, surgeHardCap: 1.5,
    timeFreeMinutes: 20, timeChargePerMin: 0.50,
    waitingFreeMinutes: 20, waitingChargePerBlock: 50,
    loadingChargePerHelper: 0, maxHelpers: 0,
  },
  THREE_WHEELER: {
    baseIncludesKm: 3, tcoPerKm: 12.00, surgeHardCap: 1.5,
    timeFreeMinutes: 25, timeChargePerMin: 1.00,
    waitingFreeMinutes: 25, waitingChargePerBlock: 75,
    loadingChargePerHelper: 400, maxHelpers: 1,
  },
  TATA_ACE: {
    baseIncludesKm: 4, tcoPerKm: 15.33, surgeHardCap: 1.5,
    timeFreeMinutes: 30, timeChargePerMin: 1.50,
    waitingFreeMinutes: 30, waitingChargePerBlock: 100,
    loadingChargePerHelper: 400, maxHelpers: 2,
  },
  MINI_TRUCK: {
    baseIncludesKm: 4, tcoPerKm: 19.16, surgeHardCap: 1.5,
    timeFreeMinutes: 40, timeChargePerMin: 1.50,
    waitingFreeMinutes: 40, waitingChargePerBlock: 120,
    loadingChargePerHelper: 500, maxHelpers: 2,
  },
};

async function backfill() {
  console.log('🔧 Backfilling existing VehicleTypePricing rows with pricing engine v2 defaults...');

  for (const [vehicleType, defaults] of Object.entries(BACKFILL_DEFAULTS)) {
    try {
      await (prisma.vehicleTypePricing as any).update({
        where: { vehicleType },
        data: defaults,
      });
      console.log(`  ✅ Backfilled ${vehicleType}`);
    } catch (err) {
      console.log(`  ⚠️  ${vehicleType} not found — may not exist in DB yet (run seed-pricing.ts first)`);
    }
  }

  console.log('\n✅ Backfill complete.');
}

backfill()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
