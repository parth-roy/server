import { z } from 'zod';
import { LeadStatus } from '@prisma/client';

export const CreateLeadSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  companyName: z.string().max(100).optional(),
  phone: z.string().regex(/^\d{10}$/, 'Must be a valid 10-digit phone number'),
  city: z.string().min(2, 'City is required').max(100),
  role: z.string().min(2, 'Role is required').max(50),
});

export const UpdateLeadStatusSchema = z.object({
  status: z.nativeEnum(LeadStatus),
  notes: z.string().max(1000).optional()
});

export const GetLeadsQuerySchema = z.object({
  status: z.nativeEnum(LeadStatus).optional(),
  page: z.string().regex(/^\d+$/).optional().transform(v => v ? Number(v) : undefined),
  limit: z.string().regex(/^\d+$/).optional().transform(v => v ? Number(v) : undefined)
});
