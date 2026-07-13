const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { phone: { in: ['9000000000', '9000000001', '9852364101'] } }
  });
  console.log(users);
  
  // Fix the role if it's wrong
  const fleetDemo = users.find(u => u.phone === '9000000001');
  if (fleetDemo && fleetDemo.role !== 'FLEET_OWNER') {
    await prisma.user.update({
      where: { id: fleetDemo.id },
      data: { role: 'FLEET_OWNER' }
    });
    console.log('Fixed fleet demo user role to FLEET_OWNER');
  }

  await prisma.$disconnect();
}
main();
