import { prisma } from '@shared/db/prisma';
import { eventBus } from '@shared/eventbus';

export async function getActiveAnnouncements(role?: string) {
    const now = new Date();
    
    // Build target conditions based on user role
    const targetConditions: any[] = [{ target: 'ALL_USERS' }, { target: 'ALL' }];
    if (role) {
        targetConditions.push({ target: role });
    }

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
                },
                {
                    OR: targetConditions
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
    eventBus.emit('announcement.created', { 
        target: announcement.target, 
        title: announcement.title, 
        body: announcement.body 
    });

    return announcement;
}
