import { z } from 'zod';

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

export const SendOtpSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number'),
  fcmToken: z.string().optional(),
});

export const VerifyOtpSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  fcmToken: z.string().optional(),
  name: z.string().min(2).max(80).optional(),
});

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────

export const UpdateStatusSchema = z.object({
  status: z.enum(['OFFLINE', 'AVAILABLE']),
});

export const UpdateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const UpdatePreferencesSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  maxWeightKg: z.number().min(1).max(500).optional(),
  preferredTypes: z.array(z.enum(['LOADING', 'UNLOADING', 'BOTH'])).optional(),
  bankAccountNo: z.string().min(9).max(18).optional(),
  bankIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code').optional(),
  bankName: z.string().min(2).max(80).optional(),
  fcmToken: z.string().optional(),
});

export const UploadDocumentsSchema = z.object({
  aadhaarUrl: z.string().url().optional(),
  panUrl: z.string().url().optional(),
});

// ─────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────

export const AvailableJobsQuerySchema = z.object({
  laborType:   z.enum(['LOADING', 'UNLOADING', 'BOTH']).optional(),
  sortBy:      z.enum(['distance', 'payout', 'recent']).optional().default('distance'),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(50).default(20),
  minPayout:   z.coerce.number().min(0).optional(),
  maxDistance: z.coerce.number().min(1).max(100).optional(),
});

export const DeclineJobSchema = z.object({
  reason: z.string().max(200).optional(),
});

export const CompleteJobSchema = z.object({
  otp: z.string().length(4, 'Completion OTP must be 4 digits'),
});

export const JobRadarQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(50).default(5),
});

// ─────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────

export const WithdrawSchema = z.object({
  amount: z.number().int().min(100, 'Minimum withdrawal is ₹100').max(100000, 'Maximum withdrawal is ₹100,000'),
});

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────

export const HistoryQuerySchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─────────────────────────────────────────────
// EARNINGS CHART
// ─────────────────────────────────────────────

export const EarningsChartQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
});

// ─────────────────────────────────────────────
// SAFETY
// ─────────────────────────────────────────────

export const SosSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  message: z.string().max(300).optional(),
});

// Type exports
export type SendOtpInput = z.infer<typeof SendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type UpdateStatusInput = z.infer<typeof UpdateStatusSchema>;
export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>;
export type UploadDocumentsInput = z.infer<typeof UploadDocumentsSchema>;
export type AvailableJobsQuery = z.infer<typeof AvailableJobsQuerySchema>;
export type DeclineJobInput = z.infer<typeof DeclineJobSchema>;
export type CompleteJobInput = z.infer<typeof CompleteJobSchema>;
export type JobRadarQuery = z.infer<typeof JobRadarQuerySchema>;
export type WithdrawInput = z.infer<typeof WithdrawSchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export type EarningsChartQuery = z.infer<typeof EarningsChartQuerySchema>;
export type SosInput = z.infer<typeof SosSchema>;

