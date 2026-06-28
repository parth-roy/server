import { prisma } from '@shared/db/prisma';


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
