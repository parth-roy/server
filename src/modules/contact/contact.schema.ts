import { z } from 'zod';

export const createContactMessageSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name is required").max(100),
    phone: z.string().min(10, "Valid phone number is required").max(15),
    message: z.string().min(10, "Message must be at least 10 characters").max(1000),
  }),
});

export const updateContactMessageStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid message ID"),
  }),
  body: z.object({
    status: z.enum(['UNREAD', 'READ', 'RESOLVED']),
  }),
});
