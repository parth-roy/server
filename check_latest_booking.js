const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestBooking = await prisma.booking.findFirst({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      bookingNumber: true,
      status: true,
      vehicleType: true,
      pickupLat: true,
      pickupLng: true,
      createdAt: true,
      paymentMethod: true,
      driverId: true
    }
  });

  console.log('Latest Booking:', latestBooking);

  if (latestBooking) {
    const drivers = await prisma.driver.findMany({
      where: {
        status: 'AVAILABLE',
        vehicle: { type: latestBooking.vehicleType }
      },
      select: {
        id: true,
        currentLat: true,
        currentLng: true,
        user: { select: { phone: true } }
      }
    });

    console.log(`Available Drivers for ${latestBooking.vehicleType}:`);
    for (const driver of drivers) {
      // Calculate rough distance
      const dLat = driver.currentLat - latestBooking.pickupLat;
      const dLng = driver.currentLng - latestBooking.pickupLng;
      const dist = Math.sqrt(dLat*dLat + dLng*dLng) * 111; // rough km
      console.log(`- Driver ${driver.user.phone} (${driver.id}): Lat ${driver.currentLat}, Lng ${driver.currentLng} -> Distance: ~${dist.toFixed(2)} km`);
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
