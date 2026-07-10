import { prisma } from '@shared/db/prisma';
import { eventBus } from '@shared/eventbus';

export async function getActiveAnnouncements() {
    const now = new Date();
    return prisma.announcement.findMany({
        where: {
            isActive: true,
            OR: [
                { startsAt: null },
                { startsAt: { lte: now } }
            ],
            AND: [
                {
                    OR: [
                        { endsAt: null },
                        { endsAt: { gte: now } }
                    ]
                }
            ]
        },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createAnnouncement(data: {
    title: string;
    body: string;
    imageUrl?: string;
    startsAt?: Date;
    endsAt?: Date;
    target?: string;
}) {
    const announcement = await prisma.announcement.create({ data: { ...data, isActive: true } });

    // Broadcast push to all users via FCM topic
    eventBus.emit('announcement.created', { title: data.title, body: data.body });

    return announcement;
}
