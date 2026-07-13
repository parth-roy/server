const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE bookings CASCADE;`);
    console.log(`Deleted all bookings and related data (Cascade).`);

    // Reset all drivers back to AVAILABLE
    await prisma.driver.updateMany({
      data: { status: 'AVAILABLE' }
    });
    console.log('Reset all drivers to AVAILABLE status.');
    
  } catch (error) {
    console.error('Error clearing trips:', error.message);
  }
}

main().finally(() => prisma.$disconnect());
