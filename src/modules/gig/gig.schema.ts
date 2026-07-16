import { z } from 'zod';

const GIG_SKILLS = [
  'HELPER', 'LOADER', 'FURNITURE_MOVER', 'HEAVY_LOADER',
  'PACKER', 'CLEANER', 'ELECTRICIAN', 'RIGGER',
] as const;

const GIG_URGENCIES = ['IMMEDIATE', 'WITHIN_HOUR', 'SCHEDULED'] as const;

export const createGigSchema = z.object({
  gigType:        z.string().min(2).max(50).optional(), // legacy, kept for backwards compat
  gigCategory:    z.enum(GIG_SKILLS).default('HELPER'),
  description:    z.string().max(500).optional(),
  locationLat:    z.number().min(-90).max(90),
  locationLng:    z.number().min(-180).max(180),
  locationAddress:z.string().min(5).max(500),
  workersNeeded:  z.number().int().min(1).max(20).default(1),
  durationHours:  z.number().int().min(1).max(12).default(2),
  urgency:        z.enum(GIG_URGENCIES).default('SCHEDULED'),
  scheduledHour:  z.number().int().min(0).max(23).optional(), // for night surge detection
});

export const estimateGigSchema = z.object({
  gigCategory:    z.enum(GIG_SKILLS).default('HELPER'),
  locationLat:    z.number().min(-90).max(90),
  locationLng:    z.number().min(-180).max(180),
  workersNeeded:  z.number().int().min(1).max(20).default(1),
  durationHours:  z.number().int().min(1).max(12).default(2),
  urgency:        z.enum(GIG_URGENCIES).default('SCHEDULED'),
  scheduledHour:  z.number().int().min(0).max(23).optional(),
});

export const updateGigStatusSchema = z.object({
  status: z.enum(['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});
