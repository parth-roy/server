const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Find driver by phone
  const user = await prisma.user.findFirst({
    where: { phone: '9000000000' },
    select: { id: true, name: true }
  });
  if (!user) { console.log('❌ User not found'); return; }
  console.log('✅ User:', user.name, user.id);

  const driver = await prisma.driver.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true }
  });
  if (!driver) { console.log('❌ Driver profile not found'); return; }
  console.log('📋 Current driver status:', driver.status);

  // 2. Find any active bookings assigned to this driver
  const activeBookings = await prisma.booking.findMany({
    where: {
      driverId: driver.id,
      status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PICKED_UP', 'IN_TRANSIT'] }
    },
    select: { id: true, bookingNumber: true, status: true }
  });
  console.log(`📦 Active bookings found: ${activeBookings.length}`);

  // 3. Cancel each active booking (unassign driver, revert to CONFIRMED so it can be re-dispatched)
  for (const b of activeBookings) {
    await prisma.booking.update({
      where: { id: b.id },
      data: {
        status: 'CONFIRMED',
        driverId: null,
        pickupOtp: null,
      }
    });
    console.log(`  ↩️  Reset booking ${b.bookingNumber} (${b.status}) → CONFIRMED`);
  }

  // 4. Reset driver to AVAILABLE
  await prisma.driver.update({
    where: { id: driver.id },
    data: {
      status: 'AVAILABLE',
      currentLat: 22.7667,
      currentLng: 88.3667,
    }
  });
  console.log('✅ Driver reset → AVAILABLE at Barrackpur (22.7667, 88.3667)');
  console.log('🚀 Driver is ready to accept test bookings!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
