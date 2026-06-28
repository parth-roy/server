import { prisma } from '@shared/db/prisma';
import { PrismaClient, NotificationType } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';


// ─────────────────────────────────────────────
// CREATE IN-APP NOTIFICATION (internal helper)
// Called by booking events, payment events, etc.
// ─────────────────────────────────────────────

export async function createNotification(
    userId: string,
    title: string,
    body: string,
    type: NotificationType = NotificationType.SYSTEM,
    referenceId?: string,
) {
    try {
        return await prisma.userNotification.create({
            data: { userId, title, body, type, referenceId },
        });
    } catch (err) {
        logger.error('Failed to create notification:', err);
    }
}

// ─────────────────────────────────────────────
// LIST USER NOTIFICATIONS (paginated)
// ─────────────────────────────────────────────

export async function listNotifications(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await prisma.$transaction([
        prisma.userNotification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.userNotification.count({ where: { userId } }),
        prisma.userNotification.count({ where: { userId, isRead: false } }),
    ]);

    return {
        notifications,
        unreadCount,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// ─────────────────────────────────────────────
// MARK ONE AS READ
// ─────────────────────────────────────────────

export async function markOneRead(notificationId: string, userId: string) {
    const notification = await prisma.userNotification.findUnique({
        where: { id: notificationId },
    });

    if (!notification) throw AppError.notFound('Notification not found');
    if (notification.userId !== userId) throw AppError.forbidden('Access denied');

    return prisma.userNotification.update({
        where: { id: notificationId },
        data: { isRead: true },
    });
}

// ─────────────────────────────────────────────
// MARK ALL AS READ
// ─────────────────────────────────────────────

export async function markAllRead(userId: string) {
    const result = await prisma.userNotification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
    });

    return { updatedCount: result.count };
}
