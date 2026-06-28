/**
 * vahan.service.ts — ULIP VAHAN Vehicle Verification (AUTHAPI/02)
 *
 * Verifies a vehicle's Registration Certificate (RC) against MoRTH's VAHAN database.
 *
 * INPUT  : vehiclenumber (mandatory) + at least one of ownerName/chassisNumber/engineNumber
 * OUTPUT : VahanVerifResult with each field's verification status
 *
 * ULIP Response shape (success):
 *   { response: [{ response: { enginenumber: "Verified"|"Failed", ... }, responseStatus: "SUCCESS" }] }
 *
 * ULIP Response shape (not found):
 *   { response: [{ response: { errorDescription: "Vehicle Details not Found" }, responseStatus: "SUCCESS" }] }
 *
 * DOCS REF: ULIP_VAHAN_AUTH_Integration_Requirement.pdf — AUTHAPI/02
 */

import axios, { AxiosError } from 'axios';
import { getUlipToken, getUlipBaseUrl } from './ulipAuth.service';
import { logger } from '@shared/logger';

// ── Types ────────────────────────────────────────────────────────────

export interface VahanVerifInput {
  vehiclenumber: string; // Mandatory. Sanitized to UPPERCASE, no spaces.
  ownerName?: string;
  chassisNumber?: string;
  engineNumber?: string;
}

export interface VahanFieldResult {
  ownername?: 'Verified' | 'Failed' | string;
  chasisnumber?: 'Verified' | 'Failed' | string;
  enginenumber?: 'Verified' | 'Failed' | string;
  errorDescription?: string;
}

export interface VahanVerifResult {
  /** The raw JSON from ULIP — stored as-is in the DB for legal audit trail */
  rawResponse: unknown;
  /** True if at least one provided field came back as "Verified" from VAHAN */
  isVerified: boolean;
  /** True if vehicle registration number was not found in VAHAN at all */
  isNotFound: boolean;
  /** Per-field results */
  fields: VahanFieldResult;
}

// ── Main function ─────────────────────────────────────────────────────

export async function verifyVehicleWithVahan(
  input: VahanVerifInput
): Promise<VahanVerifResult> {
  const baseUrl = getUlipBaseUrl();
  const token = await getUlipToken();

  // Sanitize vehiclenumber: UPPERCASE, strip spaces/hyphens (per ULIP spec)
  const sanitizedVehicleNo = input.vehiclenumber
    .toUpperCase()
    .replace(/[\s-]/g, '');

  // Build request body — include optional fields only if provided
  const body: Record<string, string> = { vehiclenumber: sanitizedVehicleNo };
  if (input.ownerName) body.ownername = input.ownerName.toUpperCase().trim();
  if (input.chassisNumber)
    body.chasisnumber = input.chassisNumber.toUpperCase().trim();
  if (input.engineNumber)
    body.enginenumber = input.engineNumber.toUpperCase().trim();

  logger.info('[VAHAN] Calling AUTHAPI/02', { vehiclenumber: sanitizedVehicleNo });

  let rawResponse: unknown;

  try {
    const response = await axios.post(`${baseUrl}/AUTHAPI/02`, body, {
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
    // 401/403 = token expired mid-request (edge case). Caller should retry.
    logger.error('[VAHAN] AUTHAPI/02 HTTP error', {
      status: axiosErr.response?.status,
      data: axiosErr.response?.data,
    });
    throw err;
  }

  // ── Parse ULIP response ─────────────────────────────────────────
  const responseArray = (rawResponse as any)?.response;
  const innerResponse: VahanFieldResult =
    responseArray?.[0]?.response ?? {};

  const isNotFound = !!innerResponse.errorDescription;
  const isVerified =
    !isNotFound &&
    Object.values(innerResponse).some((v) => v === 'Verified');

  logger.info('[VAHAN] Result', {
    vehiclenumber: sanitizedVehicleNo,
    isVerified,
    isNotFound,
    fields: innerResponse,
  });

  return { rawResponse, isVerified, isNotFound, fields: innerResponse };
}
