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

// ─── DIGILOCKER KYC Schemas ───────────────────────────────────────────────────

/**
 * Step 01 — Initiate Digilocker session with Aadhaar demographic data.
 * The backend calls ULIP DIGILOCKER/01 synchronously (not via queue)
 * because the response is needed immediately to decide if OTP step is needed.
 */
export const digilockerInitSchema = z.object({
  uid: z.string()
    .length(12, 'Aadhaar number must be exactly 12 digits')
    .regex(/^\d{12}$/, 'Aadhaar number must contain only digits'),
  name: z.string().min(2, 'Full name is required').max(100),
  dob: z.string()
    .length(8, 'Date of birth must be 8 digits in DDMMYYYY format')
    .regex(/^\d{8}$/, 'DOB must be in DDMMYYYY format (e.g. 01011990)'),
  gender: z.enum(['M', 'F', 'T'], { error: 'Gender must be M, F, or T' }),
  mobile: z.string()
    .length(10, 'Mobile number must be 10 digits')
    .regex(/^\d{10}$/, 'Mobile number must contain only digits'),
  consent: z.literal('Y'),
});

/**
 * Step 02 — Verify OTP (new user signup flow only).
 * The code_challenge and code_verifier are echoed back from the DB
 * (stored during Step 01) to correlate the session.
 */
export const digilockerVerifyOtpSchema = z.object({
  otp: z.string()
    .length(6, 'OTP must be exactly 6 digits')
    .regex(/^\d{6}$/, 'OTP must contain only digits'),
  // Frontend passes these back from Step 01 response OR backend reads from DB
  // Backend reads from DB via workerId, so these are optional from client
});

/**
 * Step 03 (internal) — Token exchange.
 * Called automatically by the backend after Step 01 (returning user)
 * or after Step 02 (new user). Not exposed as a separate endpoint.
 */

/**
 * Step 04+05 — Fetch documents.
 * Worker provides their PAN details to fetch the PAN PDF.
 * Aadhaar is fetched automatically using the stored access_token.
 */
export const digilockerFetchDocsSchema = z.object({
  panno: z.string()
    .length(10, 'PAN number must be exactly 10 characters')
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'PAN must be in format ABCDE1234F'),
  panFullName: z.string().min(2, 'Full name as on PAN card is required').max(100),
  consent: z.literal('Y'),
});

/**
 * Manual upload fallback schema.
 * When Digilocker fails, workers can upload photos of their documents.
 * These go to S3 and are marked MANUAL_REVIEW for admin approval.
 */
export const manualKycUploadSchema = z.object({
  aadhaarUrl: z.string().url('Invalid Aadhaar document URL').optional(),
  panUrl: z.string().url('Invalid PAN document URL').optional(),
}).refine(d => d.aadhaarUrl || d.panUrl, {
  message: 'At least one document URL (aadhaarUrl or panUrl) is required',
});

// Legacy — kept for backward compatibility
export const verifyDigilockerSchema = z.object({
  documentType: z.enum(['DL', 'AADHAAR']).default('DL'),
  documentNumber: z.string().optional(),
});
