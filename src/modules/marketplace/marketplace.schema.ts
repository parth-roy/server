import { z } from 'zod';

const termsList = z.array(z.string().trim().min(1).max(120)).max(12);

export const opportunitiesQuerySchema = z.object({
  page: z.string().default('1').transform(Number).pipe(z.number().int().min(1)),
  limit: z.string().default('20').transform(Number).pipe(z.number().int().min(1).max(50)),
});

const commercialTermsSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  pickupCommitmentAt: z.string().datetime(),
  transitMinutes: z.number().int().min(15).max(30 * 24 * 60),
  validForMinutes: z.number().int().min(1).max(60),
  vehicleId: z.string().uuid().optional(),
  inclusions: termsList,
  exclusions: termsList,
  note: z.string().trim().max(500).optional(),
});

export const submitBidSchema = commercialTermsSchema.extend({
  idempotencyKey: z.string().uuid(),
  validForMinutes: z.number().int().min(1).max(60).default(10),
  inclusions: termsList.default([]),
  exclusions: termsList.default([]),
});

export const createRevisionSchema = commercialTermsSchema.partial().extend({
  idempotencyKey: z.string().uuid(),
  expectedLatestRevisionId: z.string().uuid(),
}).refine(
  (value) => ['amount', 'pickupCommitmentAt', 'transitMinutes', 'validForMinutes', 'vehicleId', 'inclusions', 'exclusions', 'note']
    .some((key) => value[key as keyof typeof value] !== undefined),
  { message: 'At least one commercial term must change' },
);

export const sendBidMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000),
});

export type OpportunitiesQuery = z.infer<typeof opportunitiesQuerySchema>;
export type SubmitBidInput = z.infer<typeof submitBidSchema>;
export type CreateRevisionInput = z.infer<typeof createRevisionSchema>;
export type SendBidMessageInput = z.infer<typeof sendBidMessageSchema>;
