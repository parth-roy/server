const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const driver = await prisma.driver.findFirst({
    where: { user: { phone: '9000000000' } }
  });

  if (!driver) {
    console.log('Driver not found');
    return;
  }

  // Cancel any active bookings for this driver
  await prisma.booking.updateMany({
    where: {
      driverId: driver.id,
      status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PICKED_UP', 'IN_TRANSIT'] }
    },
    data: { status: 'CANCELLED' }
  });

  // Set driver status to AVAILABLE
  await prisma.driver.update({
    where: { id: driver.id },
    data: { status: 'AVAILABLE' }
  });

  console.log('Driver reset to ONLINE and active trips cancelled.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
