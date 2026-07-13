import { PrismaClient } from '@prisma/client';
import { getJobHistory } from './src/modules/workforce/workforce.service';

const prisma = new PrismaClient();

async function run() {
  try {
    // Find a worker ID to test
    const worker = await prisma.worker.findFirst();
    if (!worker) {
      console.log('No worker found to test');
      return;
    }
    console.log('Testing with worker:', worker.id, 'userId:', worker.userId);

    const result = await getJobHistory(worker.userId, { page: 1, limit: 20 } as any);
    console.log('Success!', result.assignments.length, 'assignments');
  } catch (error) {
    console.error('Error in getJobHistory:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
