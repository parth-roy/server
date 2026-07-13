import { z } from 'zod';
import { VehicleType, BookingStatus, BookingMode, LaborType } from '@prisma/client';

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
    bookingMode: z.nativeEnum(BookingMode).default(BookingMode.INSTANT),
    bidWindowMinutes: z.number().int().min(5).max(60).default(10),
    vehicleType: z.nativeEnum(VehicleType),
    pickupLat: z.number().min(-90).max(90),
    pickupLng: z.number().min(-180).max(180),
    pickupAddress: z.string().min(5, 'Pickup address too short').max(500),
    stops: z
        .array(stopSchema)
        .min(1, 'At least one delivery stop is required')
        .max(10, 'Maximum 10 stops allowed per booking'),
    hasLoadingService: z.boolean().default(false),
    goodsType: z.string().trim().min(2).max(80).default('General Goods'),
    goodsDescription: z.string().trim().min(2).max(500),
    goodsWeightKg: z.number().positive().max(100_000),
    goodsQuantity: z.number().int().min(1).max(10_000).default(1),
    goodsLengthCm: z.number().positive().max(5_000).optional(),
    goodsWidthCm: z.number().positive().max(5_000).optional(),
    goodsHeightCm: z.number().positive().max(5_000).optional(),
    declaredGoodsValue: z.number().min(0).max(1_000_000_000).optional(),
    handlingInstructions: z.string().trim().max(1_000).optional(),
    containsRestrictedGoods: z.boolean().default(false),
    goodsImageUrls: z.array(z.string().url()).max(5).default([]),
    laborRequired: z.boolean().default(false),
    laborersCount: z.number().int().min(1).max(10).optional(),
    laborType: z.nativeEnum(LaborType).optional(),
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
}).superRefine((value, ctx) => {
    const dimensions = [value.goodsLengthCm, value.goodsWidthCm, value.goodsHeightCm];
    const suppliedDimensions = dimensions.filter((dimension) => dimension !== undefined).length;
    if (suppliedDimensions > 0 && suppliedDimensions < 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['goodsLengthCm'],
            message: 'Provide length, width and height together, or leave all dimensions empty',
        });
    }
    if (value.laborRequired && value.laborersCount === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['laborersCount'],
            message: 'Number of labourers is required when workforce help is selected',
        });
    }
    if (value.laborRequired && value.laborType === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['laborType'],
            message: 'Labour type is required when workforce help is selected',
        });
    }
    if (!value.laborRequired && (value.laborersCount !== undefined || value.laborType !== undefined)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['laborRequired'],
            message: 'Enable workforce help before providing labour details',
        });
    }
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
