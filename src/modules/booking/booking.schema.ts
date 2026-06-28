import { z } from 'zod';
import { VehicleType, BookingStatus } from '@prisma/client';

const stopSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().min(5, 'Stop address is too short').max(500),
    receiverName: z.string().min(2).max(100).optional(),
    receiverPhone: z
        .string()
        .regex(/^[6-9]\d{9}$/, 'Invalid receiver phone number')
        .optional(),
});

export const createBookingSchema = z.object({
    vehicleType: z.nativeEnum(VehicleType),
    pickupLat: z.number().min(-90).max(90),
    pickupLng: z.number().min(-180).max(180),
    pickupAddress: z.string().min(5, 'Pickup address too short').max(500),
    stops: z
        .array(stopSchema)
        .min(1, 'At least one delivery stop is required')
        .max(10, 'Maximum 10 stops allowed per booking'),
    hasLoadingService: z.boolean().default(false),
    receiverName: z.string().min(2).max(100).optional(),
    receiverPhone: z
        .string()
        .regex(/^[6-9]\d{9}$/, 'Invalid receiver phone number')
        .optional(),
    gstin: z.string().optional(),
    gstBusinessName: z.string().optional(),
    insuranceOpted: z.boolean().default(false),
    insuranceProvider: z.string().optional(),
    insuranceAmount: z.number().optional(),
    // Fare from the pricing engine — stored as totalFare until Pricing Engine is fully server-side
    estimatedFare: z.number().positive().optional(),
    estimatedDistanceKm: z.number().positive().optional(),
    // Extra fields sent by app but not stored — accepted to avoid validation errors
    dropLat: z.number().optional(),
    dropLng: z.number().optional(),
    dropAddress: z.string().optional(),
});

export const cancelBookingSchema = z.object({
    reason: z.string().min(5, 'Please provide a reason for cancellation').max(300),
});

export const rateBookingSchema = z.object({
    driverRating: z
        .number()
        .min(1, 'Minimum rating is 1')
        .max(5, 'Maximum rating is 5'),
    customerNote: z.string().max(500).optional(),
});

// Query params come as strings — use string().default().transform() pattern
export const listBookingsQuerySchema = z.object({
    page: z.string().default('1').transform(Number),
    limit: z.string().default('10').transform(Number),
    status: z.nativeEnum(BookingStatus).optional(),
});

// ─── Bidding (Enterprise) ───
export const createBidSchema = z.object({
    amount: z.number().min(10, 'Bid amount must be valid'),
    note: z.string().max(300).optional(),
});

export const acceptBidSchema = z.object({
    bidId: z.string().uuid('Invalid bid ID'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type RateBookingInput = z.infer<typeof rateBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
export type CreateBidInput = z.infer<typeof createBidSchema>;