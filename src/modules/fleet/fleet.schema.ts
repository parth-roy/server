/**
 * fleet.schema.ts — Zod validation schemas for all fleet/ULIP endpoints
 *
 * All validation happens here before any business logic runs.
 * This is the contract boundary between the HTTP layer and the service layer.
 */

import { z } from 'zod';

// ── Driver Registration ───────────────────────────────────────────────

export const registerDriverSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  profileImageUrl: z.string().url().optional(),
  language: z.enum(['en', 'hi', 'bn']).default('en'),
});

export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;

// ── Vehicle Registration ──────────────────────────────────────────────

export const registerVehicleSchema = z.object({
  registrationNo: z
    .string()
    .min(5)
    .max(11)
    .trim()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, '')),
  type: z.enum(['BIKE', 'THREE_WHEELER', 'TATA_ACE', 'MINI_TRUCK']),
  make: z.string().min(1).max(50).trim(),
  model: z.string().min(1).max(50).trim(),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  color: z.string().min(1).max(30).optional(),
  capacityKg: z.number().positive(),
});

export type RegisterVehicleInput = z.infer<typeof registerVehicleSchema>;

// ── DL Verification (SARATHI / AUTHAPI/03) ────────────────────────────

export const verifyLicenseSchema = z.object({
  dlNumber: z
    .string()
    .min(8)
    .max(20)
    .trim()
    .transform((v) => v.toUpperCase()),
  dob: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'DOB must be in yyyy-mm-dd format (e.g. 1990-05-15). Wrong format fails silently on SARATHI.'
    ),
  driverName: z.string().min(2).max(100).trim().optional(),
  // permit: comma-separated codes e.g. "LMV,HMV"
  permit: z
    .string()
    .regex(
      /^[A-Z,]+$/,
      'permit must be uppercase permit codes separated by commas (e.g. LMV,HMV)'
    )
    .optional(),
});

export type VerifyLicenseInput = z.infer<typeof verifyLicenseSchema>;

// ── RC Verification (VAHAN / AUTHAPI/02) ─────────────────────────────

export const verifyVehicleRcSchema = z
  .object({
    vehicleId: z.string().uuid(),
    ownerName: z.string().min(2).max(100).trim().optional(),
    chassisNumber: z
      .string()
      .min(1)
      .max(20)
      .trim()
      .transform((v) => v.toUpperCase())
      .optional(),
    engineNumber: z
      .string()
      .min(1)
      .max(20)
      .trim()
      .transform((v) => v.toUpperCase())
      .optional(),
  })
  .refine(
    (data) => data.ownerName || data.chassisNumber || data.engineNumber,
    {
      message:
        'At least one of ownerName, chassisNumber, or engineNumber is required by VAHAN (AUTHAPI/02)',
    }
  );

export type VerifyVehicleRcInput = z.infer<typeof verifyVehicleRcSchema>;

// ── Update Driver Status ──────────────────────────────────────────────

export const updateDriverStatusSchema = z.object({
  status: z.enum(['OFFLINE', 'AVAILABLE']),
  // Drivers cannot set themselves ON_TRIP or BREAK — only system does that
});

export type UpdateDriverStatusInput = z.infer<typeof updateDriverStatusSchema>;
