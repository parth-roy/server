/**
 * ulipAuth.service.ts — ULIP JWT Token Manager (Singleton)
 *
 * Responsibilities:
 *  1. Authenticates with ULIP using backend credentials (never exposed to client)
 *  2. Caches the JWT in memory (primary) and Redis (secondary, for multi-instance)
 *  3. Auto-refreshes 2 min before the 30-min ULIP expiry window
 *  4. All VAHAN / SARATHI services call getUlipToken() exclusively
 *
 * SECURITY: ULIP_USERNAME / ULIP_PASSWORD are read from env only.
 *           They NEVER leave the server.
 */

import axios from 'axios';
import https from 'https';
import { env } from '@config/env';
import { getRedis } from '@config/redis';
import { logger } from '@shared/logger';

// ULIP government servers (staging + production) have SSL cert issues
// Bypass SSL verification only for ULIP API calls — all other app SSL is unaffected
const ulipHttpsAgent = new https.Agent({ rejectUnauthorized: false });

const REDIS_KEY = 'ulip:jwt_token';
const REDIS_TTL_SECONDS = 28 * 60; // 28 min (safe buffer before 30-min expiry)
const MEMORY_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min early

// In-memory cache — fastest path, shared within same Node process
let _cachedToken: string | null = null;
let _tokenExpiresAt: number = 0; // epoch ms

/**
 * Returns a valid ULIP JWT token.
 * Uses in-memory → Redis → fresh login (in that order of preference).
 */
export async function getUlipToken(): Promise<string> {
  const now = Date.now();

  // 1. In-memory cache still valid (fastest path)
  if (_cachedToken && now < _tokenExpiresAt - MEMORY_BUFFER_MS) {
    return _cachedToken;
  }

  // 2. Try Redis (useful when multiple server instances share a cache)
  try {
    const redisToken = await getRedis().get(REDIS_KEY);
    if (redisToken) {
      _cachedToken = redisToken;
      _tokenExpiresAt = now + REDIS_TTL_SECONDS * 1000;
      return _cachedToken;
    }
  } catch (err) {
    // Redis unavailable — continue to fresh login (degrade gracefully)
    logger.warn('[ULIP] Redis unavailable for token cache, logging in fresh', { err });
  }

  // 3. Fresh ULIP login
  return _refreshUlipToken();
}

/**
 * Forces a fresh ULIP login and updates both caches.
 * Called internally when token is missing or expired.
 */
async function _refreshUlipToken(): Promise<string> {
  if (!env.ULIP_USERNAME || !env.ULIP_PASSWORD) {
    throw new Error(
      'ULIP credentials not configured. Set ULIP_USERNAME and ULIP_PASSWORD in .env'
    );
  }

  const baseUrl =
    env.ULIP_ENV === 'production' ? env.ULIP_BASE_URL : env.ULIP_STAGING_URL;

  logger.info('[ULIP] Refreshing access token...');

  const response = await axios.post(
    `${baseUrl}/user/login`,
    { username: env.ULIP_USERNAME, password: env.ULIP_PASSWORD },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15_000, // 15s — ULIP can be slow
      httpsAgent: ulipHttpsAgent, // ULIP govt servers have SSL cert issues
    }
  );

  // ULIP API response structure:
  // { response: { id: "<JWT>" }, error: "false", code: "200", message: "..." }
  // The JWT token lives at response.data.response.id
  const token: string = response.data?.response?.id;

  if (!token) {
    logger.error('[ULIP] Could not extract token. Full response: ' + JSON.stringify(response.data));
    throw new Error('[ULIP] Login succeeded but jwtToken missing in response');
  }

  // Update in-memory cache
  _cachedToken = token;
  _tokenExpiresAt = Date.now() + REDIS_TTL_SECONDS * 1000;

  // Update Redis cache (best-effort — don't crash if Redis is down)
  try {
    await getRedis().set(REDIS_KEY, token, 'EX', REDIS_TTL_SECONDS);
  } catch (err) {
    logger.warn('[ULIP] Could not persist token to Redis', { err });
  }

  logger.info('[ULIP] Token refreshed successfully');
  return token;
}

/**
 * Returns the active ULIP base URL based on ULIP_ENV env var.
 * Use this in all VAHAN/SARATHI service calls.
 */
export function getUlipBaseUrl(): string {
  return env.ULIP_ENV === 'production' ? env.ULIP_BASE_URL : env.ULIP_STAGING_URL;
}
