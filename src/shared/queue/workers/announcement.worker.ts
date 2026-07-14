import { createWorker, QUEUES } from '../index';
import { logger } from '@shared/logger';
import { prisma } from '@shared/db/prisma';
import { NotificationType } from '@prisma/client';

export function startAnnouncementWorker() {
  createWorker(QUEUES.ANNOUNCEMENT, async (job) => {
    const { target, title, body } = job.data;
    logger.info(`[Announcement Worker] Processing announcement: "${title}" for target: ${target}`);

    try {
      // Find which roles to target based on the target string
      // "ALL_USERS", "CUSTOMER", "DRIVER", "FLEET_OWNER", "WORKFORCE"
      let rolesToTarget: string[] = [];
      if (target === 'ALL_USERS' || target === 'ALL') {
        rolesToTarget = ['CUSTOMER', 'DRIVER', 'FLEET_OWNER', 'WORKFORCE'];
      } else {
        rolesToTarget = [target];
      }

      // Process in chunks of 500 to avoid memory issues and DB lockups
      const CHUNK_SIZE = 500;
      let processedCount = 0;

      for (const role of rolesToTarget) {
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
          const users = await prisma.user.findMany({
            where: { role: role as any, isActive: true },
            select: { id: true },
            skip,
            take: CHUNK_SIZE,
          });

          if (users.length === 0) {
            hasMore = false;
            break;
          }

          const notifications = users.map(u => ({
            userId: u.id,
            title: `📢 ${title}`,
            body,
            type: NotificationType.SYSTEM,
          }));

          await prisma.userNotification.createMany({
            data: notifications,
            skipDuplicates: true,
          });

          processedCount += users.length;
          skip += CHUNK_SIZE;
        }
      }

      logger.info(`[Announcement Worker] Successfully created ${processedCount} in-app notifications`);
    } catch (error) {
      logger.error(`[Announcement Worker] Failed to process announcement notifications: ${error}`);
      throw error; // Let BullMQ retry if needed
    }
  });

  logger.info('🚀 Announcement worker started');
}
