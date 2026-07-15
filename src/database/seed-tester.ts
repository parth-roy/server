import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phone = '9999999999';
  
  let user = await prisma.user.findUnique({ where: { phone } });
  
  if (!user) {
    user = await prisma.user.create({
      data: {
        phone,
        name: 'PlayStore Tester',
        role: 'WORKFORCE',
        profileComplete: true,
      }
    });
    console.log('Created User for PlayStore Tester:', user.id);
  } else {
    console.log('User already exists:', user.id);
  }

  let worker = await prisma.worker.findUnique({ where: { userId: user.id } });
  
  if (!worker) {
    worker = await prisma.worker.create({
      data: {
        userId: user.id,
        isDocVerified: true,
      }
    });
    console.log('Created Worker Profile for PlayStore Tester:', worker.id);
  } else {
    worker = await prisma.worker.update({
      where: { id: worker.id },
      data: { isDocVerified: true }
    });
    console.log('Updated Worker Profile to Verified:', worker.id);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
