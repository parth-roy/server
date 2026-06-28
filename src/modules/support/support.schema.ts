import { z } from 'zod';

export const createTicketSchema = z.object({
    subject: z.string().min(5).max(200),
    bookingId: z.string().uuid().optional(),
    initialMessage: z.string().min(5),
});

export const addMessageSchema = z.object({
    content: z.string().min(1),
    attachmentUrl: z.string().url().optional(),
});
