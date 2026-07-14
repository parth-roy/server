const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

async function main() {
  try {
    const prisma = new PrismaClient();
    
    // Find active booking in PICKED_UP or IN_TRANSIT
    const booking = await prisma.booking.findFirst({
      where: {
        status: { in: ['PICKED_UP', 'IN_TRANSIT'] }
      },
      include: {
        stops: true
      }
    });

    if (!booking) {
      console.log('No active booking found waiting for delivery.');
      return;
    }

    const stop = booking.stops[0];
    console.log('Found Booking:', booking.id);
    console.log('Found Stop:', stop.id);

    // Get Redis OTP
    const redis = new Redis(process.env.REDIS_URL || '');
    const otp = await redis.get('POD_OTP:' + booking.id + ':' + stop.id);
    console.log('=== THE DELIVERY OTP IS: ' + otp + ' ===');

    await redis.quit();
    await prisma.$disconnect();
  } catch (err) {
    console.error(err);
  }
}
main();
