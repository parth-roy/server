import { PrismaClient, BadgeTier, BadgeMetric } from '@prisma/client';

const prisma = new PrismaClient();

const BADGES = [
  {
    code: 'FIRST_STEP',
    name: 'First Step',
    description: 'Completed your very first job',
    icon: 'Icons.check_circle',
    tier: BadgeTier.BRONZE,
    metric: BadgeMetric.TOTAL_JOBS,
    targetValue: 1,
    pointsReward: 50,
  },
  {
    code: 'RISING_STAR',
    name: 'Rising Star',
    description: 'Completed 10 jobs',
    icon: 'Icons.star',
    tier: BadgeTier.SILVER,
    metric: BadgeMetric.TOTAL_JOBS,
    targetValue: 10,
    pointsReward: 100,
  },
  {
    code: 'VETERAN_LOADER',
    name: 'Veteran Loader',
    description: 'Completed 50 jobs',
    icon: 'Icons.local_shipping',
    tier: BadgeTier.GOLD,
    metric: BadgeMetric.TOTAL_JOBS,
    targetValue: 50,
    pointsReward: 250,
  },
  {
    code: 'CENTURY_CLUB',
    name: 'Century Club',
    description: 'Completed 100 jobs',
    icon: 'Icons.emoji_events',
    tier: BadgeTier.PLATINUM,
    metric: BadgeMetric.TOTAL_JOBS,
    targetValue: 100,
    pointsReward: 500,
  },
  {
    code: 'TOP_RATED',
    name: 'Top Rated',
    description: 'Maintained a rating of 4.8 or above',
    icon: 'Icons.thumb_up',
    tier: BadgeTier.GOLD,
    metric: BadgeMetric.RATING,
    targetValue: 4.8,
    pointsReward: 200,
  },
  {
    code: 'RELIABLE_WORKER',
    name: 'Reliable Worker',
    description: 'Maintained an acceptance rate above 90%',
    icon: 'Icons.handshake',
    tier: BadgeTier.SILVER,
    metric: BadgeMetric.ACCEPTANCE_RATE,
    targetValue: 90,
    pointsReward: 150,
  },
  {
    code: 'ON_TIME_PRO',
    name: 'On Time Pro',
    description: 'Maintain 100% on-time rate',
    icon: 'Icons.timer',
    tier: BadgeTier.DIAMOND,
    metric: BadgeMetric.ON_TIME_RATE,
    targetValue: 100,
    pointsReward: 1000,
  }
];

async function seedBadges() {
  console.log('Seeding badges...');
  for (const badge of BADGES) {
    await prisma.badge.upsert({
      where: { code: badge.code },
      update: badge,
      create: badge,
    });
  }
  console.log('Badges seeded successfully!');
}

seedBadges()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
