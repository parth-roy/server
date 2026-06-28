/**
 * sarathi.service.ts — ULIP SARATHI Driving License Verification (AUTHAPI/03)
 *
 * Verifies a driver's DL and permit against MoRTH's SARATHI database.
 *
 * INPUT  : dlnumber + dob (mandatory) | driverName + permit (optional, send both)
 * OUTPUT : SarathiVerifResult with driver name and each permit's status
 *
 * ULIP Response shape (driver verified):
 *   { responseStatus: "SUCCESS", response: { driverName: "Verified" } }
 *
 * ULIP Response shape (DL not in SARATHI — pre-digital era DLs):
 *   { response: [{ response: { errorDesc: "No Response From Sarathi API" } }] }
 *
 * PERMIT codes (common for logistics):
 *   LMV, HMV, TRANS, MCWG, MGV
 *
 * DOCS REF: ULIP_SARATHI_AUTH_Integration_Requirement.pdf — AUTHAPI/03
 */

import axios, { AxiosError } from 'axios';
import { getUlipToken, getUlipBaseUrl } from './ulipAuth.service';
import { logger } from '@shared/logger';

// ── Types ────────────────────────────────────────────────────────────

export interface SarathiVerifInput {
  dlnumber: string;    // Mandatory. Format: "WB01 20210001234"
  dob: string;         // Mandatory. Format: "yyyy-mm-dd" — strict!
  driverName?: string; // Recommended: full name as on license
  permit?: string;     // Recommended: comma-separated codes e.g. "LMV,HMV"
}

export interface SarathiFieldResult {
  driverName?: 'Verified' | 'Verification failed' | string;
  permitLmv?: 'Verified' | 'Verification Failed' | string;
  permitHmv?: 'Verified' | 'Verification Failed' | string;
  permitMcwg?: 'Verified' | 'Verification Failed' | string;
  permitTrans?: 'Verified' | 'Verification Failed' | string;
  permitMgv?: 'Verified' | 'Verification Failed' | string;
  errorDesc?: string;
  [key: string]: string | undefined; // other permit fields
}

export interface SarathiVerifResult {
  /** Raw ULIP JSON — stored as-is in DB for legal audit trail */
  rawResponse: unknown;
  /** True if driverName came back as "Verified" from SARATHI */
  isDriverVerified: boolean;
  /** True if DL is not found in SARATHI (likely pre-digital era DL) */
  isNotInSarathi: boolean;
  /** Per-field results from SARATHI */
  fields: SarathiFieldResult;
}

// ── Validation helper ─────────────────────────────────────────────────

/**
 * Validates DOB is in yyyy-mm-dd format.
 * CRITICAL: Wrong format (dd-mm-yyyy) fails silently on SARATHI — it returns
 * wrong results instead of an error. We must catch this before calling ULIP.
 */
export function validateDobFormat(dob: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dob);
}

// ── Main function ─────────────────────────────────────────────────────

export async function verifyDriverWithSarathi(
  input: SarathiVerifInput
): Promise<SarathiVerifResult> {
  // Strict DOB format guard — must happen before calling ULIP
  if (!validateDobFormat(input.dob)) {
    throw new Error(
      `Invalid DOB format: "${input.dob}". SARATHI requires yyyy-mm-dd (e.g. 1990-05-15).`
    );
  }

  const baseUrl = getUlipBaseUrl();
  const token = await getUlipToken();

  let formattedDl = input.dlnumber.trim().toUpperCase();
  // Auto-insert space for formats like "MP4420100005566" to "MP44 20100005566"
  if (/^[A-Z]{2}\d{13}$/.test(formattedDl)) {
    formattedDl = formattedDl.substring(0, 4) + ' ' + formattedDl.substring(4);
  }

  // Build request body - ONLY SEND MANDATORY FIELDS
  // Sending optional fields like driverName/permit often causes 412 Precondition Failed
  // from the ULIP API Gateway due to strict/undocumented regex matching on their end.
  const body: Record<string, string> = {
    dlnumber: formattedDl,
    dob: input.dob,
  };

  logger.info('[SARATHI] Calling AUTHAPI/03', { dlnumber: body.dlnumber });

  let rawResponse: unknown;

  try {
    const response = await axios.post(`${baseUrl}/AUTHAPI/03`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15_000,
    });
    rawResponse = response.data;
  } catch (err) {
    const axiosErr = err as AxiosError;
    logger.error('[SARATHI] AUTHAPI/03 HTTP error', {
      status: axiosErr.response?.status,
      data: axiosErr.response?.data,
    });
    throw err;
  }

  // ── Parse ULIP response ─────────────────────────────────────────
  // SARATHI has two different response shapes (per official docs):
  //
  // Shape A (verified / failed): { responseStatus: "SUCCESS", response: { driverName: "Verified" } }
  // Shape B (DL not found):      { response: [{ response: { errorDesc: "No Response From Sarathi API" } }] }

  const raw = rawResponse as any;
  let fields: SarathiFieldResult = {};
  let isDriverVerified = false;
  let isNotInSarathi = false;

  if (raw?.responseStatus === 'SUCCESS' && raw?.response && !Array.isArray(raw.response)) {
    // Shape A — direct response object
    fields = raw.response as SarathiFieldResult;
    isDriverVerified = fields.driverName === 'Verified';
  } else if (Array.isArray(raw?.response)) {
    // Shape B — array wrapper (DL not found or permit result)
    const inner = raw.response[0]?.response ?? {};
    fields = inner as SarathiFieldResult;
    isNotInSarathi = !!inner.errorDesc;
    if (!isNotInSarathi) {
      isDriverVerified = fields.driverName === 'Verified';
    }
  }

  logger.info('[SARATHI] Result', {
    dlnumber: body.dlnumber,
    isDriverVerified,
    isNotInSarathi,
    fields,
  });

  return { rawResponse, isDriverVerified, isNotInSarathi, fields };
}
