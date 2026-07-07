import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const drivers = await prisma.driver.findMany({ include: { user: true } });
  for (const d of drivers) {
    if (d.status === 'ON_TRIP' || d.user.name?.includes('Demo')) {
      await prisma.driver.update({
        where: { id: d.id },
        data: { status: 'AVAILABLE' }
      });
      console.log(`Reset driver ${d.user.name ?? 'Unknown'} to AVAILABLE`);
    }
  }

  // also let's check bookings for the driver and set them to cancelled if they are active
  const activeBookings = await prisma.booking.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] }
    }
  });
  console.log(`Found ${activeBookings.length} active bookings. Cancelling them...`);
  for (const b of activeBookings) {
    await prisma.booking.update({
      where: { id: b.id },
      data: { status: 'CANCELLED' }
    });
    console.log(`Cancelled booking ${b.id}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
