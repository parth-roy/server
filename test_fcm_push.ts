import { PrismaClient } from '@prisma/client';
import { notificationService } from './src/modules/notifications/notification.service';
import { logger } from './src/config/logger';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { phone: '9000000000' }
  });

  if (!user || !user.fcmToken) {
    console.log('Driver 9000000000 not found or no FCM token');
    return;
  }

  console.log(`Driver FCM Token: ${user.fcmToken}`);
  console.log('Sending test push notification...');

  const result = await notificationService.sendToDevice(user.fcmToken, {
    title: 'Test Notification',
    body: 'This is a test notification to check if FCM is working properly.',
    data: { type: 'TEST' }
  });

  console.log('Result:', result);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
