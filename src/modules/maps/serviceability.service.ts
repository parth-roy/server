/**
 * serviceability.service.ts — Service area validation for bookings.
 *
 * Architecture:
 *   Primary:  Mapbox reverse geocode → extract country → check ServiceabilityConfig table
 *   Fallback: India bounding box (if Mapbox is down — fail open, not fail closed)
 *   Cache:    Redis with 24h TTL (same lat/lng is same location every time)
 *
 * Designed for extensibility — future stages add STATE/CITY/PINCODE/ZONE checks
 * by inserting rows into ServiceabilityConfig without touching this code.
 */

import { prisma } from '@shared/db/prisma';
import { mapsService } from './maps.service';
import { logger } from '@shared/logger';
import { getRedis } from '@config/redis';

// ── India bounding box — FALLBACK ONLY (used when Mapbox is unavailable) ─────
const INDIA_BOUNDS = { latMin: 6.4, latMax: 37.6, lngMin: 68.1, lngMax: 97.4 };
// Andaman & Nicobar exception (outside main bounding box)
const ANDAMAN_BOUNDS = { latMin: 6.0, latMax: 14.5, lngMin: 92.0, lngMax: 94.5 };

function isInIndiaBoundingBox(lat: number, lng: number): boolean {
    if (lat >= ANDAMAN_BOUNDS.latMin && lat <= ANDAMAN_BOUNDS.latMax &&
        lng >= ANDAMAN_BOUNDS.lngMin && lng <= ANDAMAN_BOUNDS.lngMax) return true;
    return lat >= INDIA_BOUNDS.latMin && lat <= INDIA_BOUNDS.latMax &&
           lng >= INDIA_BOUNDS.lngMin && lng <= INDIA_BOUNDS.lngMax;
}

// ── Cache key (3 decimal places ≈ 110m grid — same location = same serviceability) ─
function cacheKey(lat: number, lng: number): string {
    return `serviceability:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

const CACHE_TTL = 24 * 60 * 60; // 24 hours

export interface ServiceabilityResult {
    allowed:     boolean;
    countryCode: string | null;
    country:     string | null;
    state:       string | null;
    city:        string | null;
    pincode:     string | null;
    source:      'mapbox' | 'bounding_box_fallback' | 'cache';
    reason?:     string;
}

/**
 * Check if a coordinate is serviceable.
 *
 * Stage 1: verifies country = India using Mapbox reverse geocode.
 * Future stages: additional rows in ServiceabilityConfig enable
 *   state/city/pincode/zone checks without any code changes.
 */
export async function checkServiceability(lat: number, lng: number): Promise<ServiceabilityResult> {
    const redis = getRedis();

    // ── [1] Cache check ───────────────────────────────────────────────────────
    try {
        const cached = await redis.get(cacheKey(lat, lng));
        if (cached) {
            const result = JSON.parse(cached) as ServiceabilityResult;
            return { ...result, source: 'cache' };
        }
    } catch { /* Redis unavailable — skip cache */ }

    // ── [2] Mapbox reverse geocode (primary) ──────────────────────────────────
    let geoData: Awaited<ReturnType<typeof mapsService.reverseGeocode>> = null;
    let source: ServiceabilityResult['source'] = 'mapbox';

    try {
        geoData = await mapsService.reverseGeocode(lat, lng);
    } catch (err) {
        logger.warn(`[Serviceability] Mapbox failed for (${lat},${lng}) — using bounding box fallback:`, err);
        source = 'bounding_box_fallback';
    }

    // ── [3] Determine serviceability ──────────────────────────────────────────
    let result: ServiceabilityResult;

    if (source === 'bounding_box_fallback' || !geoData) {
        // Mapbox failed — use bounding box as fallback (fail open)
        const allowed = isInIndiaBoundingBox(lat, lng);
        result = {
            allowed,
            countryCode: allowed ? 'in' : null,
            country:     allowed ? 'India (unverified)' : null,
            state:       null,
            city:        null,
            pincode:     null,
            source:      'bounding_box_fallback',
            reason:      allowed ? undefined : 'Location appears to be outside India',
        };
    } else {
        // ── [3a] Country-level check ──────────────────────────────────────────
        const countryCode = geoData.countryCode;

        // Load active serviceability config from DB (cached internally by future cache layer)
        let countryAllowed = false;
        try {
            const countryRule = await (prisma as any).serviceabilityConfig.findUnique({
                where: { level_value: { level: 'COUNTRY', value: countryCode ?? '' } },
            });
            
            if (countryRule) {
                // If a rule exists, use its allowed status
                countryAllowed = countryRule.isAllowed === true && countryRule.isActive === true;
            } else {
                // Default fallback if no rule is explicitly defined in DB
                countryAllowed = countryCode?.toLowerCase() === 'in';
            }
        } catch {
            // DB unavailable or table missing — fall back to checking if country is India by code
            countryAllowed = countryCode?.toLowerCase() === 'in';
        }

        if (!countryAllowed) {
            result = {
                allowed:     false,
                countryCode: geoData.countryCode,
                country:     geoData.country,
                state:       geoData.state,
                city:        geoData.city,
                pincode:     geoData.pincode,
                source:      'mapbox',
                reason:      `We currently operate only in India. Detected: ${geoData.country ?? 'Unknown country'}`,
            };
        } else {
            // ── [3b] Future: state-level check ────────────────────────────────
            // If any STATE rules exist, check them. If none exist, pass through.
            // This is the extensibility hook — no code change needed when adding state rules.
            let stateAllowed = true;
            if (geoData.stateCode) {
                try {
                    const stateRule = await (prisma as any).serviceabilityConfig.findUnique({
                        where: { level_value: { level: 'STATE', value: geoData.stateCode } },
                    });
                    if (stateRule) {
                        stateAllowed = stateRule.isAllowed === true && stateRule.isActive === true;
                    }
                    // If no STATE rule exists for this code, default = allowed (only country check matters in Stage 1)
                } catch { /* DB unavailable — assume allowed */ }
            }

            if (!stateAllowed) {
                result = {
                    allowed:     false,
                    countryCode: geoData.countryCode,
                    country:     geoData.country,
                    state:       geoData.state,
                    city:        geoData.city,
                    pincode:     geoData.pincode,
                    source:      'mapbox',
                    reason:      `We do not currently operate in ${geoData.state ?? 'this state'}`,
                };
            } else {
                // ── [3c] Future: city-level check ──────────────────────────────
                // Same pattern: if a CITY rule exists and says not allowed, reject.
                // Stage 1: no CITY rules exist → passes through.
                result = {
                    allowed:     true,
                    countryCode: geoData.countryCode,
                    country:     geoData.country,
                    state:       geoData.state,
                    city:        geoData.city,
                    pincode:     geoData.pincode,
                    source:      'mapbox',
                };
            }
        }
    }

    // ── [4] Cache result ──────────────────────────────────────────────────────
    try {
        await redis.setex(cacheKey(lat, lng), CACHE_TTL, JSON.stringify(result));
    } catch { /* non-fatal */ }

    if (!result.allowed) {
        logger.warn(`[Serviceability] Rejected (${lat},${lng}): ${result.reason}`);
    }

    return result;
}

/**
 * Seed Stage 1 serviceability rules.
 * Call from seed-pricing.ts or a dedicated seed file.
 */
export async function seedServiceabilityConfig() {
    await (prisma as any).serviceabilityConfig.upsert({
        where: { level_value: { level: 'COUNTRY', value: 'in' } },
        update: { isAllowed: true, isActive: true },
        create: {
            level:       'COUNTRY',
            value:       'in',
            displayName: 'India',
            isAllowed:   true,
            isActive:    true,
            note:        'Stage 1: India is the only serviceable country.',
        },
    });
}
