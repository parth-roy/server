/**
 * seed-gig-pricing.ts — Seeds the GigPricingConfig table with default values.
 * Run with: npx ts-node -r tsconfig-paths/register src/database/seed-gig-pricing.ts
 */

import { prisma } from '@shared/db/prisma';

const GIG_PRICING_DEFAULTS: { key: string; value: string; description: string }[] = [
  {
    key: 'gig_platform_commission_rate',
    value: '0.12',
    description: 'Platform commission added on top of worker earnings (12%). Customer pays this.',
  },
  {
    key: 'gig_travel_fee_per_km',
    value: '15',
    description: 'Travel fee per km beyond the first free 5 km (₹15/km).',
  },
  {
    key: 'gig_travel_free_km',
    value: '5',
    description: 'Number of km from worker to job site that are free (no travel charge).',
  },
  {
    key: 'gig_festival_surge_active',
    value: 'false',
    description: 'Toggle festival surge (+25%). Set to true during Durga Puja, Eid, Diwali etc.',
  },
  {
    key: 'gig_rain_surge_active',
    value: 'false',
    description: 'Toggle rain/weather surge (+15%). Set to true during heavy rain days.',
  },
  {
    key: 'gig_high_demand_threshold',
    value: '10',
    description: 'Number of simultaneous PENDING gig jobs in a zone to trigger high-demand surge (+10%).',
  },
  {
    key: 'gig_base_rate_metro',
    value: '130',
    description: 'Base hourly rate (₹/hr) for Metro zone (Kolkata + suburbs). Read-only in MVP.',
  },
  {
    key: 'gig_base_rate_tier2',
    value: '110',
    description: 'Base hourly rate (₹/hr) for Tier-2 zone (Durgapur, Siliguri etc). Read-only in MVP.',
  },
  {
    key: 'gig_base_rate_rural',
    value: '90',
    description: 'Base hourly rate (₹/hr) for Rural zone (all other WB districts). Read-only in MVP.',
  },
];

async function main() {
  console.log('🌱 Seeding GigPricingConfig...');

  let upserted = 0;
  for (const entry of GIG_PRICING_DEFAULTS) {
    await (prisma as any).gigPricingConfig.upsert({
      where:  { key: entry.key },
      update: { description: entry.description }, // don't overwrite admin-set values
      create: { key: entry.key, value: entry.value, description: entry.description },
    });
    upserted++;
  }

  console.log(`✅ Seeded ${upserted} GigPricingConfig entries.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
