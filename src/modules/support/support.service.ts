import { prisma } from '@shared/db/prisma';
import { PrismaClient, SupportTicketStatus } from '@prisma/client';
import { AppError } from '@shared/errors/AppError';


export async function createTicket(userId: string, data: any) {
    return prisma.supportTicket.create({
        data: {
            userId,
            subject: data.subject,
            bookingId: data.bookingId,
            messages: {
                create: {
                    senderId: userId,
                    content: data.initialMessage,
                }
            }
        },
        include: { messages: true }
    });
}

export async function getTickets(userId: string) {
    return prisma.supportTicket.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, // preview last message
    });
}

export async function getTicketDetails(ticketId: string, userId: string) {
    const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { messages: { orderBy: { createdAt: 'asc' } } }
    });

    if (!ticket) throw AppError.notFound('Ticket not found');
    if (ticket.userId !== userId) throw AppError.forbidden('Access denied');

    return ticket;
}

export async function addMessage(ticketId: string, userId: string, data: any) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw AppError.notFound('Ticket not found');
    if (ticket.userId !== userId) throw AppError.forbidden('Access denied');
    if (ticket.status === SupportTicketStatus.CLOSED) {
        throw AppError.badRequest('Cannot add messages to a closed ticket');
    }

    return prisma.supportMessage.create({
        data: {
            ticketId,
            senderId: userId,
            content: data.content,
            attachmentUrl: data.attachmentUrl,
        }
    });
}
