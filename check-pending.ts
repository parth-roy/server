import { PrismaClient } from '@prisma/client';
import { getPendingWorkerDocuments } from './src/modules/admin/admin.service';

const prisma = new PrismaClient();

async function main() {
  try {
    const data = await getPendingWorkerDocuments();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
