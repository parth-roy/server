const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find driver by phone
  const user = await prisma.user.findFirst({
    where: { phone: '9000000000' },
    select: { id: true, name: true }
  });
  console.log('User:', JSON.stringify(user));
  if (!user) return;

  const driver = await prisma.driver.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true, vehicleType: true }
  });
  console.log('Driver:', JSON.stringify(driver));
  if (!driver) return;

  const bookings = await prisma.booking.findMany({
    where: {
      driverId: driver.id,
      status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PICKED_UP', 'IN_TRANSIT'] }
    },
    select: { id: true, bookingNumber: true, status: true, createdAt: true }
  });
  console.log('Active bookings:', JSON.stringify(bookings, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
