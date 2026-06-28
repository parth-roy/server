import { z } from 'zod';

export const verifyDlSchema = z.object({
  dlNumber: z.string().min(5, 'Driving License number is required'),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be in YYYY-MM-DD format'),
  driverName: z.string().optional(),
  permit: z.string().optional(),
});

export const verifyRcSchema = z.object({
  vehicleId: z.string().uuid('Valid Vehicle ID is required'),
  ownerName: z.string().optional(),
  chassisNumber: z.string().optional(),
  engineNumber: z.string().optional(),
});

export const verifyFastagSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  vehicleNumber: z.string().optional(),
}).refine(d => d.vehicleId || d.vehicleNumber, { message: 'vehicleId or vehicleNumber is required' });

export const verifyEchallanSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  vehicleNumber: z.string().optional(),
}).refine(d => d.vehicleId || d.vehicleNumber, { message: 'vehicleId or vehicleNumber is required' });

export const verifyDigilockerSchema = z.object({
  documentType: z.enum(['DL', 'AADHAAR']).default('DL'),
  documentNumber: z.string().optional(),
});
