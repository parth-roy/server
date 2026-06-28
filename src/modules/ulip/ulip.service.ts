/**
 * ulip.service.ts — ULIP API calls (SARATHI, VAHAN, FASTAG, ECHALLAN, DIGILOCKER)
 *
 * Auth is delegated to ulipAuth.service.ts (fleet module) which has:
 *   • Redis token caching (shared across instances)
 *   • 2-minute early refresh buffer
 *   • Graceful Redis fallback
 * Both fleet/* and modules/ulip now share ONE token cache — no duplicate logins.
 */
import axios from 'axios';
import { logger } from '@shared/logger';
import { getUlipToken, getUlipBaseUrl } from '@modules/fleet/ulipAuth.service';
import { env } from '@config/env';

// ─── SARATHI (Driving License) ──────────────────────────────────────────────

export interface SarathiResponse {
  response: {
    response: {
      dldetobj?: Array<{
        dlobj?: {
          dlStatus: string;          // "Active" or "Inactive"
          dlLicno: string;
          dlIssuedt: string;
          dlNtValdtoDt: string;      // Non-transport validity
          dlTrValdtoDt: string;      // Transport validity
          stateName: string;
          olaName: string;
          [key: string]: any;
        };
        dlcovs?: Array<{
          covabbrv: string;          // e.g. "LMV", "TRANS", "MCWG"
          covdesc: string;
          dcCovStatus: string;       // "A" = active
          dcIssuedt: string;
          [key: string]: any;
        }>;
        bioObj?: {
          bioFullName: string;
          bioDob: string;
          bioGenderDesc: string;
          bioBloodGroupname: string;
          [key: string]: any;
        };
        bioImgObj?: {
          biPhoto: string;           // base64 photo
          [key: string]: any;
        };
        [key: string]: any;
      }>;
      errorcd?: number;
      erormsg?: string | null;
      [key: string]: any;
    }
  }[];
  error?: boolean | string;
  message?: string;
}

export async function verifySarathi(dlnumber: string, dob: string, driverName?: string, permit?: string): Promise<SarathiResponse> {
  // If local development IP is not whitelisted, return MOCK response
  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP] MOCK_ULIP is true. Returning simulated SARATHI response.');
    return {
      response: [{
        response: {
          dlnumber,
          dob,
          ownerName: driverName || "MOCK DRIVER NAME",
          validity: { nonTransport: "31-12-2040", transport: "31-12-2030" },
          covDetails: [{ cov: "LMV", issueDate: "01-01-2015" }, { cov: "TRANS", issueDate: "01-01-2018" }],
          status: "ACTIVE"
        }
      }]
    };
  }

  const token = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  // ULIP staging is slow — retry up to 2 times on 502 (Bad Gateway)
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[ULIP] SARATHI attempt ${attempt}/${maxRetries}`);
      const response = await axios.post(
        `${baseUrl}/SARATHI/01`,
        // SARATHI/01 accepts max 2 keys only: dlnumber + dob (confirmed by ULIP support curl example)
        { dlnumber, dob },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          // ULIP government APIs are slow — 90 seconds to handle staging delays
          timeout: 90000
        }
      );
      // Log raw ULIP response for test case documentation and debugging
      logger.info(`[ULIP] SARATHI raw response: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`[ULIP] SARATHI attempt ${attempt} failed (HTTP ${status ?? 'TIMEOUT'}): ${errorData}`);
      // Retry on 502 Bad Gateway or timeout — ULIP staging is unreliable
      if (attempt < maxRetries && (status === 502 || !status)) {
        logger.warn(`[ULIP] Retrying SARATHI in 5 seconds...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('[ULIP] SARATHI exhausted all retries');
}

// ─── VAHAN (Vehicle RC) ─────────────────────────────────────────────────────

export interface VahanResponse {
  response: {
    response: {
      rc_regn_no: string;
      rc_owner_name: string;
      rc_chasi_no: string;
      rc_eng_no: string;
      rc_vh_class_desc: string;
      rc_maker_model: string;
      rc_fit_upto: string;
      rc_insurance_upto: string;
      rc_pucc_upto: string;
      rc_status_as_on: string;
    }
  }[];
  error?: boolean;
  message?: string;
}

export async function verifyVahan(vehiclenumber: string, ownername?: string, chasisnumber?: string, enginenumber?: string): Promise<VahanResponse> {
  // If local development IP is not whitelisted, return MOCK response
  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP] MOCK_ULIP is true. Returning simulated VAHAN response.');
    return {
      response: [{
        response: {
          rc_regn_no: vehiclenumber,
          rc_owner_name: ownername || "MOCK OWNER NAME",
          rc_chasi_no: chasisnumber || "MOCKCHASSIS123456",
          rc_eng_no: enginenumber || "MOCKENGINE789",
          rc_vh_class_desc: "Light Goods Vehicle",
          rc_maker_model: "TATA ACE",
          rc_fit_upto: "31-12-2030",
          rc_insurance_upto: "31-12-2027",
          rc_pucc_upto: "31-12-2025",
          rc_status_as_on: "ACTIVE"
        }
      }]
    };
  }

  const token = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  // ULIP staging is slow — retry up to 2 times on 502 (Bad Gateway)
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[ULIP] VAHAN attempt ${attempt}/${maxRetries}`);
      const response = await axios.post(
        `${baseUrl}/VAHAN/01`,
        { vehiclenumber },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          // ULIP government APIs are slow — 90 seconds to handle staging delays
          timeout: 90000
        }
      );
      logger.info(`[ULIP] VAHAN raw response: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`[ULIP] VAHAN attempt ${attempt} failed (HTTP ${status ?? 'TIMEOUT'}): ${errorData}`);
      // Retry on 502 Bad Gateway or timeout — ULIP staging is unreliable
      if (attempt < maxRetries && (status === 502 || !status)) {
        logger.warn(`[ULIP] Retrying VAHAN in 5 seconds...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('[ULIP] VAHAN exhausted all retries');
}

// ─── FASTAG, ECHALLAN, DIGILOCKER ────────────────────────────────────────────

export async function verifyFastag(vehiclenumber: string): Promise<any> {
  const token = await getUlipToken();
  const baseUrl = getUlipBaseUrl();
  logger.info(`[ULIP] Initiating FASTAG verification for vehicle ${vehiclenumber}`);
  try {
    const response = await axios.post(
      `${baseUrl}/FASTAG/01`,
      { vehiclenumber },
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    logger.info(`[ULIP] FASTAG raw response: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP] FASTAG failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}

export async function verifyEchallan(vehiclenumber: string): Promise<any> {
  const token = await getUlipToken();
  const baseUrl = getUlipBaseUrl();
  logger.info(`[ULIP] Initiating ECHALLAN verification for vehicle ${vehiclenumber}`);
  try {
    const response = await axios.post(
      `${baseUrl}/ECHALLAN/01`,
      { vehiclenumber },
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    logger.info(`[ULIP] ECHALLAN raw response: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP] ECHALLAN failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}

export async function verifyDigilocker(documentNumber: string, documentType: string, dob?: string): Promise<any> {
  const token = await getUlipToken();
  const baseUrl = getUlipBaseUrl();
  logger.info(`[ULIP] Initiating DIGILOCKER verification for ${documentType} ${documentNumber}`);
  try {
    // DOB is required for DL verification. It must come from the driver's profile,
    // NOT be hardcoded — a hardcoded DOB would silently fail or match the wrong person.
    const payload = documentType === 'DL'
      ? { dlnumber: documentNumber, dob: dob ?? (() => { throw new Error('DOB required for DL DigiLocker verification'); })() }
      : { aadharnumber: documentNumber };
    const response = await axios.post(
      `${baseUrl}/DIGILOCKER/01`,
      payload,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    logger.info(`[ULIP] DIGILOCKER raw response: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP] DIGILOCKER failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}
