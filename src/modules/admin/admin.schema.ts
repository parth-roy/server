import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Admin Auth Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin API Query Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page:  z.string().optional().transform(v => Math.max(1, parseInt(v ?? '1', 10))),
  limit: z.string().optional().transform(v => Math.min(100, Math.max(1, parseInt(v ?? '25', 10)))),
});

export const bookingsQuerySchema = paginationSchema.extend({
  status:        z.string().optional(),
  vehicleType:   z.string().optional(),
  paymentStatus: z.string().optional(),
  search:        z.string().optional(),   // booking number or customer phone
  unassigned:    z.string().optional().transform(v => v === 'true'),
  from:          z.string().optional(),
  to:            z.string().optional(),
});

export const usersQuerySchema = paginationSchema.extend({
  role:    z.string().optional(),
  isActive: z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
  search:  z.string().optional(),
});

export const driversQuerySchema = paginationSchema.extend({
  status:         z.string().optional(),
  dlVerifStatus:  z.string().optional(),
  rcVerifStatus:  z.string().optional(),
  plan:           z.string().optional(),
  isDocVerified:  z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
  search:         z.string().optional(),
});

export const fleetQuerySchema = paginationSchema.extend({
  search:     z.string().optional(),
  isVerified: z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
  isActive:   z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
});

export const financeQuerySchema = paginationSchema.extend({
  from:    z.string().optional(),
  to:      z.string().optional(),
  driverId:z.string().optional(),
  fleetId: z.string().optional(),
  plan:    z.string().optional(),
  isActive:z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
  reason:  z.string().optional(),
  userId:  z.string().optional(),
});

export const ticketsQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  search: z.string().optional(),
});

export const assignDriverSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
});

export const cancelBookingSchema = z.object({
  reason: z.string().min(3, 'Cancellation reason is required'),
});

export const refundSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  note:   z.string().min(1, 'Note is required'),
});

export const walletCreditSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  note:   z.string().min(1, 'Note is required'),
});

export const docStatusSchema = z.object({
  status:         z.enum(['VERIFIED', 'REJECTED']),
  rejectedReason: z.string().optional(),
});

export const docVerifiedSchema = z.object({
  isDocVerified: z.boolean(),
});

export const fleetStatusSchema = z.object({
  isVerified: z.boolean().optional(),
  isActive:   z.boolean().optional(),
});

export const userStatusSchema = z.object({
  isActive: z.boolean(),
});

export const ticketReplySchema = z.object({
  content: z.string().min(1, 'Reply content is required'),
});

export const ticketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
});

export const pricingUpdateSchema = z.object({
  baseFare:      z.number().positive().optional(),
  pricePerKm:    z.number().positive().optional(),
  minFare:       z.number().positive().optional(),
  capacityKg:    z.number().positive().optional(),
  capacityDesc:  z.string().optional(),
  estimatedEta:  z.number().int().positive().optional(),
  displayName:   z.string().optional(),
  imageUrl:      z.string().url().optional(),
  isActive:      z.boolean().optional(),
});

export const announcementSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  imageUrl: z.string().url().nullable().optional(),
  linkUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
  target: z.string().default('CUSTOMER'),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

export const broadcastNotificationSchema = z.object({
  title:       z.string().min(1).max(100),
  body:        z.string().min(1).max(300),
  target:      z.enum(['ALL', 'CUSTOMERS', 'DRIVERS', 'FLEET_OWNERS', 'SPECIFIC']),
  type:        z.enum(['BOOKING_STATUS', 'PAYMENT', 'PROMO', 'SYSTEM']),
  referenceId: z.string().optional(),
  targetUserId:z.string().optional(), // for SPECIFIC target
});

export const subscriptionUpdateSchema = z.object({
  plan:           z.enum(['BASIC', 'STANDARD', 'PRO', 'PREMIUM']).optional(),
  endDate:        z.string().datetime().optional(),
  isActive:       z.boolean().optional(),
});

export const ulipLogsQuerySchema = paginationSchema.extend({
  entityType: z.string().optional(),
  status:     z.string().optional(),
  from:       z.string().optional(),
  to:         z.string().optional(),
});

export type LoginInput            = z.infer<typeof loginSchema>;
export type ForgotPasswordInput   = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput    = z.infer<typeof resetPasswordSchema>;
export type RefreshInput          = z.infer<typeof refreshSchema>;
export type BookingsQuery         = z.infer<typeof bookingsQuerySchema>;
export type UsersQuery            = z.infer<typeof usersQuerySchema>;
export type DriversQuery          = z.infer<typeof driversQuerySchema>;
export type FleetQuery            = z.infer<typeof fleetQuerySchema>;
export type FinanceQuery          = z.infer<typeof financeQuerySchema>;
export type TicketsQuery          = z.infer<typeof ticketsQuerySchema>;
export type AssignDriverInput     = z.infer<typeof assignDriverSchema>;
export type CancelBookingInput    = z.infer<typeof cancelBookingSchema>;
export type RefundInput           = z.infer<typeof refundSchema>;
export type WalletCreditInput     = z.infer<typeof walletCreditSchema>;
export type DocStatusInput        = z.infer<typeof docStatusSchema>;
export type DocVerifiedInput      = z.infer<typeof docVerifiedSchema>;
export type PricingUpdateInput    = z.infer<typeof pricingUpdateSchema>;
export type AnnouncementInput     = z.infer<typeof announcementSchema>;
export type BroadcastInput        = z.infer<typeof broadcastNotificationSchema>;
export type SubscriptionUpdate    = z.infer<typeof subscriptionUpdateSchema>;
export type UlipLogsQuery         = z.infer<typeof ulipLogsQuerySchema>;
