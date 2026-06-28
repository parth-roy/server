/**
 * fleet-owner.schema.ts — Zod validation for Fleet Owner APIs
 */

import { z } from 'zod';

// ── Fleet Owner Registration ──────────────────────────────────────────

export const registerFleetOwnerSchema = z.object({
  companyName: z.string().min(2).max(100),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
    .optional(),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
    .optional(),
});

export type RegisterFleetOwnerInput = z.infer<typeof registerFleetOwnerSchema>;

// ── Add Fleet Truck ───────────────────────────────────────────────────

export const addFleetTruckSchema = z.object({
  registrationNo: z
    .string()
    .min(6)
    .max(15)
    .transform((v) => v.toUpperCase().replace(/\s/g, '')),
  type: z.enum(['BIKE', 'THREE_WHEELER', 'TATA_ACE', 'MINI_TRUCK']),
  make: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  color: z.string().max(30).optional(),
  capacityKg: z.number().positive(),
  imageUrl: z.string().url().optional(),
});

export type AddFleetTruckInput = z.infer<typeof addFleetTruckSchema>;

// ── Update Fleet Truck ────────────────────────────────────────────────

export const updateFleetTruckSchema = z.object({
  color: z.string().max(30).optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
  rcDocUrl: z.string().url().optional(),
  insuranceDocUrl: z.string().url().optional(),
  fitnessDocUrl: z.string().url().optional(),
  pucDocUrl: z.string().url().optional(),
  permitDocUrl: z.string().url().optional(),
  insuranceExpiry: z.string().datetime().optional(),
  fitnessExpiry: z.string().datetime().optional(),
  pucExpiry: z.string().datetime().optional(),
  permitExpiry: z.string().datetime().optional(),
});

export type UpdateFleetTruckInput = z.infer<typeof updateFleetTruckSchema>;

// ── Invite / Add Driver to Fleet ──────────────────────────────────────

export const addFleetDriverSchema = z.object({
  phone: z
    .string()
    .regex(/^\+?[0-9]{10,13}$/, 'Invalid phone number'),
});

export type AddFleetDriverInput = z.infer<typeof addFleetDriverSchema>;

// ── Assign Truck to Booking ───────────────────────────────────────────

export const assignTruckSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
  truckId: z.string().uuid('Invalid truck ID'),
  fleetDriverId: z.string().uuid('Invalid fleet driver ID'),
});

export type AssignTruckInput = z.infer<typeof assignTruckSchema>;

// ── Set Current Driver for a Truck ───────────────────────────────────

export const setTruckDriverSchema = z.object({
  fleetDriverId: z.string().uuid().nullable(),
});

export type SetTruckDriverInput = z.infer<typeof setTruckDriverSchema>;

// ── List Pending Bookings Query ───────────────────────────────────────

export const listPendingBookingsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  vehicleType: z.enum(['BIKE', 'THREE_WHEELER', 'TATA_ACE', 'MINI_TRUCK']).optional(),
});

export type ListPendingBookingsQuery = z.infer<typeof listPendingBookingsSchema>;

// ── Fleet Earnings Query ──────────────────────────────────────────────

export const fleetEarningsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type FleetEarningsQuery = z.infer<typeof fleetEarningsQuerySchema>;

// ── Add Maintenance ───────────────────────────────────────────────────

export const addMaintenanceSchema = z.object({
  truckId: z.string().uuid('Invalid truck ID'),
  serviceType: z.string().min(2).max(100),
  cost: z.number().positive().max(1_000_000),
  notes: z.string().max(500).optional(),
  servicedAt: z.string().datetime({ message: 'Invalid date format — use ISO 8601' }),
  nextDueDate: z.string().datetime().optional(),
});

export type AddMaintenanceInput = z.infer<typeof addMaintenanceSchema>;

// ── Add Fuel Log ──────────────────────────────────────────────────────

export const addFuelLogSchema = z.object({
  truckId: z.string().uuid('Invalid truck ID'),
  litresFilled: z.number().positive().max(2000),
  pricePerLitre: z.number().positive().max(1000),
  filledAt: z.string().datetime({ message: 'Invalid date format — use ISO 8601' }),
  location: z.string().max(200).optional(),
});

export type AddFuelLogInput = z.infer<typeof addFuelLogSchema>;

// ── Add Truck Document ────────────────────────────────────────────────

export const addTruckDocumentSchema = z.object({
  documentType: z.string().min(2).max(50),
  fileUrl: z.string().url('Invalid file URL'),
  expiryDate: z.string().datetime().optional(),
  notes: z.string().max(300).optional(),
});

export type AddTruckDocumentInput = z.infer<typeof addTruckDocumentSchema>;

// ── Update Maintenance ────────────────────────────────────────────────

export const updateMaintenanceSchema = z.object({
  serviceType: z.string().min(2).max(100).optional(),
  cost: z.number().positive().max(1_000_000).optional(),
  notes: z.string().max(500).optional(),
  servicedAt: z.string().datetime().optional(),
  nextDueDate: z.string().datetime().optional(),
});

export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;

// ── Update Fleet Truck (Full PATCH) ──────────────────────────────────

export const updateFleetTruckFullSchema = z.object({
  make: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  year: z.number().int().min(1980).max(new Date().getFullYear() + 1).optional(),
  capacityKg: z.number().positive().optional(),
  color: z.string().max(30).optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
  rcDocUrl: z.string().url().optional(),
  insuranceDocUrl: z.string().url().optional(),
  insuranceExpiry: z.string().datetime().optional(),
  pollutionDocUrl: z.string().url().optional(),
  pollutionExpiry: z.string().datetime().optional(),
});

export type UpdateFleetTruckFullInput = z.infer<typeof updateFleetTruckFullSchema>;
