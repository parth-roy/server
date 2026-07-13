const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { phone: '9000000000' },
    include: { driver: { include: { vehicle: true } } }
  });
  
  if (user && user.driver) {
    console.log(`Driver ID: ${user.driver.id}`);
    console.log(`Vehicle Type: ${user.driver.vehicle ? user.driver.vehicle.type : 'NONE'}`);
    console.log(`Status: ${user.driver.status}`);
    console.log(`Is Verified: ${user.driver.isDocVerified}`);
    console.log(`Location: Lat ${user.driver.currentLat}, Lng ${user.driver.currentLng}`);
  } else {
    console.log('Driver not found or not a driver.');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
