import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

async function main() {
  try {
    const prisma = new PrismaClient();
    
    const booking = await prisma.booking.findFirst({
      where: { status: { in: ['PICKED_UP', 'IN_TRANSIT'] } },
      include: { stops: true }
    });

    if (!booking) {
      console.log('No active booking found waiting for delivery.');
      return;
    }

    const stop = booking.stops[0];
    
    const redis = new Redis(process.env.REDIS_URL || '');
    const otp = await redis.get(`POD_OTP:${booking.id}:${stop.id}`);
    
    console.log('\n=============================================');
    console.log(`THE DELIVERY OTP IS: ${otp}`);
    console.log('=============================================\n');

    await redis.quit();
    await prisma.$disconnect();
  } catch (err) {
    console.error(err);
  }
}
main();
