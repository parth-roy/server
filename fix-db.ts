import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.driver.updateMany({
    where: { dlVerifStatus: 'VERIFIED' },
    data: { isDocVerified: true }
  });
  console.log('Fixed driver documents verified status!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
