import { z } from 'zod';

export const createGigSchema = z.object({
    gigType: z.string().min(2, 'Gig type is too short').max(50),
    description: z.string().max(500).optional(),
    locationLat: z.number().min(-90).max(90),
    locationLng: z.number().min(-180).max(180),
    locationAddress: z.string().min(5, 'Location address too short').max(500),
    workersNeeded: z.number().int().min(1).max(20).default(1),
});

export const updateGigStatusSchema = z.object({
    status: z.enum(['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});
