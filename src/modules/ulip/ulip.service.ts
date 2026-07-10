/**
 * ulip.service.ts — ULIP API calls (SARATHI, VAHAN, FASTAG, ECHALLAN, DIGILOCKER)
 *
 * Auth is delegated to ulipAuth.service.ts (fleet module) which has:
 *   • Redis token caching (shared across instances)
 *   • 2-minute early refresh buffer
 *   • Graceful Redis fallback
 * Both fleet/* and modules/ulip now share ONE token cache — no duplicate logins.
 *
 * ─── DIGILOCKER FLOW (5 Steps) ──────────────────────────────────────────────
 *
 * The Digilocker flow is a multi-step PKCE-based OAuth flow:
 *
 *   NEW USER (Signup flow): Step 01 → Step 02 (OTP) → Step 03 → Step 04/05
 *   OLD USER (Signin flow): Step 01 → Step 03 → Step 04/05
 *
 *   Step 01 [initDigilockerSession]
 *     POST /DIGILOCKER/01
 *     Input : { uid, name, dob (DDMMYYYY), gender, mobile, consent: "Y" }
 *     Output: { code, code_verifier, code_challenge, mobile }
 *       - If mobile is null  → user already on Digilocker → skip Step 02
 *       - If mobile returned → OTP sent → must call Step 02
 *
 *   Step 02 [verifyDigilockerOtp]  ← NEW USER ONLY
 *     POST /DIGILOCKER/02
 *     Input : { mobile, otp, code_challenge, code_verifier }
 *     Output: { code, code_verifier }
 *
 *   Step 03 [exchangeDigilockerToken]
 *     POST /DIGILOCKER/03
 *     Input : { code, code_verifier }
 *     Output: { access_token (Bearer, 3600s), digilockerid, name, gender, dob, eaadhaar }
 *
 *   Step 04 [fetchDigilockerPan]
 *     POST /DIGILOCKER/04
 *     Input : { panno, PANFullName, consent: "Y", token }
 *     Output: { data: "<base64 PDF string>" }  ← raw PAN PDF
 *
 *   Step 05 [fetchDigilockerAadhaar]
 *     POST /DIGILOCKER/05
 *     Input : { token }
 *     Output: { eaadhaarData: "<XML string>" }  ← XML with <Poi> demographics + <Pht> base64 JPEG photo
 */

import axios from 'axios';
import https from 'https';
import { env } from '@config/env';
import { logger } from '@shared/logger';
import { getUlipToken, getUlipBaseUrl } from '@modules/fleet/ulipAuth.service';

// ULIP government servers (staging + production) have SSL cert issues
// Bypass SSL verification only for ULIP API calls — all other app SSL is unaffected
const ulipHttpsAgent = new https.Agent({ rejectUnauthorized: false });
const getUlipHttpsAgent = () => ulipHttpsAgent;


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

// ─── FASTAG ──────────────────────────────────────────────────────────────────

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

// ─── ECHALLAN ────────────────────────────────────────────────────────────────

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

// ─── DIGILOCKER — Step 01: Initiate Session ──────────────────────────────────
//
// Sends user's Aadhaar demographic data to ULIP DIGILOCKER/01.
// Returns PKCE code/verifier/challenge + whether OTP was triggered.
//
// Called by: POST /api/v1/ulip/digilocker/init

export interface DigilockerInitInput {
  uid: string;       // 12-digit Aadhaar number
  name: string;      // Full name as on Aadhaar
  dob: string;       // DDMMYYYY (8 digits)
  gender: string;    // "M", "F", or "T"
  mobile: string;    // 10-digit mobile number
  consent: 'Y';
}

export interface DigilockerInitResult {
  code: string;
  codeVerifier: string;
  codeChallenge: string;
  mobile: string | null;   // null = existing user (skip OTP step), string = OTP sent to this mobile
  requiresOtp: boolean;    // true = new user flow, false = returning user
}

export async function initDigilockerSession(input: DigilockerInitInput): Promise<DigilockerInitResult> {
  const ulipToken = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  // MOCK mode for local dev (IP not whitelisted)
  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP-DIGI] MOCK_ULIP=true — returning simulated DIGILOCKER/01 response');
    return {
      code: 'mock_auth_code_a039416c',
      codeVerifier: 'mock_HhE3228YCVTYNFUDXXzgb4d34ON',
      codeChallenge: 'mock_dpht-mp4eeVufaaqJP2ckCmumf',
      mobile: null,      // null = skip OTP (simulate returning user)
      requiresOtp: false,
    };
  }

  logger.info(`[ULIP-DIGI] Step 01 — Initiating session for UID ending in ...${input.uid.slice(-4)}`);
  try {
    const response = await axios.post(
      `${baseUrl}/DIGILOCKER/01`,
      {
        uid: input.uid,
        name: input.name,
        dob: input.dob,         // DDMMYYYY format
        gender: input.gender,
        mobile: input.mobile,
        consent: input.consent,
      },
      {
        headers: {
          'Authorization': `Bearer ${ulipToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 90000,
        httpsAgent: getUlipHttpsAgent(),
      }
    );

    const raw = response.data?.response?.[0]?.response;
    logger.info(`[ULIP-DIGI] Step 01 raw response: ${JSON.stringify(response.data)}`);
    if (!raw?.code) throw new Error('[ULIP-DIGI] Step 01 returned no authorization code');

    logger.info(`[ULIP-DIGI] Step 01 success — requiresOtp: ${raw.mobile !== null}`);
    return {
      code: raw.code,
      codeVerifier: raw.code_verifier,
      codeChallenge: raw.code_challenge,
      mobile: raw.mobile ?? null,
      requiresOtp: raw.mobile !== null,  // mobile != null means OTP was triggered
    };
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP-DIGI] Step 01 failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}

// ─── DIGILOCKER — Step 02: Verify OTP (NEW USER ONLY) ────────────────────────
//
// Submits the OTP received by the user's mobile.
// Only required when initDigilockerSession returns requiresOtp=true.
//
// Called by: POST /api/v1/ulip/digilocker/verify-otp

export interface DigilockerOtpInput {
  mobile: string;
  otp: string;           // 6-digit OTP
  codeChallenge: string; // from Step 01
  codeVerifier: string;  // from Step 01
}

export interface DigilockerOtpResult {
  code: string;
  codeVerifier: string;
}

export async function verifyDigilockerOtp(input: DigilockerOtpInput): Promise<DigilockerOtpResult> {
  const ulipToken = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP-DIGI] MOCK_ULIP=true — returning simulated DIGILOCKER/02 response');
    return { code: 'mock_otp_verified_code', codeVerifier: input.codeVerifier };
  }

  logger.info(`[ULIP-DIGI] Step 02 — Verifying OTP for mobile ending ...${input.mobile.slice(-4)}`);
  try {
    const response = await axios.post(
      `${baseUrl}/DIGILOCKER/02`,
      {
        mobile: input.mobile,
        otp: input.otp,
        code_challenge: input.codeChallenge,
        code_verifier: input.codeVerifier,
      },
      {
        headers: {
          'Authorization': `Bearer ${ulipToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const raw = response.data?.response?.[0]?.response;
    if (!raw?.code) throw new Error('[ULIP-DIGI] Step 02 returned no code after OTP verification');

    logger.info(`[ULIP-DIGI] Step 02 OTP verified successfully`);
    return { code: raw.code, codeVerifier: raw.code_verifier ?? input.codeVerifier };
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP-DIGI] Step 02 failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}

// ─── DIGILOCKER — Step 03: Exchange Code for Access Token ────────────────────
//
// Exchanges the authorization code for a Digilocker access_token (valid 3600s).
// This token is then used to fetch PAN (Step 04) and Aadhaar (Step 05).
//
// Called internally by controllers after Step 01 or Step 02.

export interface DigilockerTokenInput {
  code: string;
  codeVerifier: string;
}

export interface DigilockerTokenResult {
  accessToken: string;        // Bearer token for Steps 04/05
  expiresIn: number;          // Seconds (typically 3600)
  digiLockerId: string;       // Digilocker user UUID
  name: string;
  gender: string;
  dob: string;
  eaadhaar: string;           // "Y" = Aadhaar linked
}

export async function exchangeDigilockerToken(input: DigilockerTokenInput): Promise<DigilockerTokenResult> {
  const ulipToken = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP-DIGI] MOCK_ULIP=true — returning simulated DIGILOCKER/03 response');
    return {
      accessToken: 'mock_access_token_f7c8f9b0ec4ef793',
      expiresIn: 3600,
      digiLockerId: 'mock-6b119fa2-ad2b-5345-8676',
      name: 'Mock Worker Name',
      gender: 'M',
      dob: '1995-01-01',
      eaadhaar: 'Y',
    };
  }

  logger.info(`[ULIP-DIGI] Step 03 — Exchanging code for access_token`);
  try {
    const requestBody = {
      code: input.code,
      code_verifier: input.codeVerifier,
    };
    logger.info(`[ULIP-DIGI] Step 03 URL: ${baseUrl}/DIGILOCKER/03`);
    logger.info(`[ULIP-DIGI] Step 03 body: ${JSON.stringify(requestBody)}`);
    const response = await axios.post(
      `${baseUrl}/DIGILOCKER/03`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${ulipToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 60000,
        httpsAgent: getUlipHttpsAgent(),
      }
    );

    const raw = response.data?.response?.[0]?.response;
    if (!raw?.access_token) throw new Error('[ULIP-DIGI] Step 03 returned no access_token');

    logger.info(`[ULIP-DIGI] Step 03 access_token obtained. DigiLockerId: ${raw.digilockerid}`);
    return {
      accessToken: raw.access_token,
      expiresIn: raw.expires_in ?? 3600,
      digiLockerId: raw.digilockerid,
      name: raw.name ?? '',
      gender: raw.gender ?? '',
      dob: raw.dob ?? '',
      eaadhaar: raw.eaadhaar ?? 'N',
    };
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    const headers = error.response?.headers ? JSON.stringify(error.response.headers) : 'none';
    logger.error(`[ULIP-DIGI] Step 03 failed (HTTP ${httpStatus}): ${body} | headers: ${headers}`);
    logger.error(`[ULIP-DIGI] Step 03 request was: code=${input.code?.slice(0,10)}... verifier=${input.codeVerifier?.slice(0,10)}...`);
    throw error;
  }
}

// ─── DIGILOCKER — Step 04: Fetch PAN Card ────────────────────────────────────
//
// Fetches PAN document from Income Tax via Digilocker.
// Returns Base64-encoded PDF string (starts with JVBERi0xLjc = PDF header).
//
// Called by: POST /api/v1/ulip/digilocker/fetch-documents (internal)

export interface DigilockerPanInput {
  panno: string;       // PAN number e.g. "ABCDE1234F"
  panFullName: string; // Full name exactly as on PAN
  accessToken: string; // Bearer token from Step 03
}

export interface DigilockerPanResult {
  base64Pdf: string;   // Raw base64 PDF content — caller must decode & upload to S3
}

export async function fetchDigilockerPan(input: DigilockerPanInput): Promise<DigilockerPanResult> {
  const ulipToken = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP-DIGI] MOCK_ULIP=true — returning simulated DIGILOCKER/04 (PAN) response');
    return { base64Pdf: 'JVBERi0xLjc_MOCK_PDF_BASE64_DATA' };
  }

  logger.info(`[ULIP-DIGI] Step 04 — Fetching PAN for ${input.panno}`);
  try {
    const response = await axios.post(
      `${baseUrl}/DIGILOCKER/04`,
      {
        panno: input.panno,
        PANFullName: input.panFullName,
        consent: 'Y',
        token: input.accessToken,
      },
      {
        headers: {
          'Authorization': `Bearer ${ulipToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const raw = response.data?.response?.[0]?.response;
    if (!raw?.data) throw new Error('[ULIP-DIGI] Step 04 returned no PAN PDF data');

    logger.info(`[ULIP-DIGI] Step 04 PAN PDF fetched — base64 length: ${raw.data.length}`);
    return { base64Pdf: raw.data };
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP-DIGI] Step 04 PAN fetch failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}

// ─── DIGILOCKER — Step 05: Fetch Aadhaar Data ────────────────────────────────
//
// Fetches e-Aadhaar XML from UIDAI via Digilocker.
// Returns an XML string. Key tags:
//   <Poi name="" dob="" gender=""/>       → demographic info
//   <Poa house="" street="" dist="" .../>  → address
//   <Pht>base64JPEG</Pht>                 → profile photo
//
// Called by: POST /api/v1/ulip/digilocker/fetch-documents (internal)

export interface DigilockerAadhaarInput {
  accessToken: string;  // Bearer token from Step 03
}

export interface DigilockerAadhaarResult {
  eaadhaarXml: string;  // Raw XML — caller parses <Poi/> and extracts <Pht> for photo
  photoBase64: string;  // Extracted from <Pht> tag — base64 JPEG
  name: string;         // From <Poi name="..."/>
  dob: string;          // From <Poi dob="..."/>
  gender: string;       // From <Poi gender="..."/>
  address: string;      // Formatted from <Poa>
  uid: string;          // Masked UID from uid attribute (e.g. "xxxxxxxx9858")
}

export async function fetchDigilockerAadhaar(input: DigilockerAadhaarInput): Promise<DigilockerAadhaarResult> {
  const ulipToken = await getUlipToken();
  const baseUrl = getUlipBaseUrl();

  if (env.MOCK_ULIP === 'true') {
    logger.warn('[ULIP-DIGI] MOCK_ULIP=true — returning simulated DIGILOCKER/05 (Aadhaar) response');
    return {
      eaadhaarXml: '<Certificate><CertificateData><KycRes ret="Y"><UidData uid="xxxxxxxx9858"><Poi name="Mock Worker" dob="1995-01-01" gender="M"/><Poa house="123" street="Test Street" dist="Mumbai" state="Maharashtra" pc="400001"/><Pht>/9j/MOCK_JPEG_BASE64</Pht></UidData></KycRes></CertificateData></Certificate>',
      photoBase64: '/9j/MOCK_JPEG_BASE64',
      name: 'Mock Worker',
      dob: '1995-01-01',
      gender: 'M',
      address: '123, Test Street, Mumbai, Maharashtra - 400001',
      uid: 'xxxxxxxx9858',
    };
  }

  logger.info(`[ULIP-DIGI] Step 05 — Fetching e-Aadhaar XML`);
  try {
    const response = await axios.post(
      `${baseUrl}/DIGILOCKER/05`,
      { token: input.accessToken },
      {
        headers: {
          'Authorization': `Bearer ${ulipToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const raw = response.data?.response;
    const xmlString = raw?.eaadhaarData;
    if (!xmlString) throw new Error('[ULIP-DIGI] Step 05 returned no Aadhaar XML data');

    // ── Parse the XML string inline (no xml2js needed — use regex for key fields) ──
    const extractAttr = (tag: string, attr: string): string => {
      const match = xmlString.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
      return match?.[1] ?? '';
    };
    const extractTag = (tag: string): string => {
      const match = xmlString.match(new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`, 'i'));
      return match?.[1] ?? '';
    };

    const name = extractAttr('Poi', 'name');
    const dob = extractAttr('Poi', 'dob');
    const gender = extractAttr('Poi', 'gender');
    const uid = extractAttr('UidData', 'uid');
    const photoBase64 = extractTag('Pht');

    // Build address from <Poa> tag attributes
    const house = extractAttr('Poa', 'house');
    const street = extractAttr('Poa', 'street');
    const dist = extractAttr('Poa', 'dist');
    const state = extractAttr('Poa', 'state');
    const pc = extractAttr('Poa', 'pc');
    const address = [house, street, dist, state, pc].filter(Boolean).join(', ');

    logger.info(`[ULIP-DIGI] Step 05 Aadhaar XML fetched — UID: ${uid}, Name: ${name}`);
    return { eaadhaarXml: xmlString, photoBase64, name, dob, gender, address, uid };
  } catch (error: any) {
    const httpStatus = error.response?.status ?? 'TIMEOUT/NETWORK';
    const body = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[ULIP-DIGI] Step 05 Aadhaar fetch failed (HTTP ${httpStatus}): ${body}`);
    throw error;
  }
}
