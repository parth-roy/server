import axios from 'axios';
import { MAPBOX_API_KEY } from '@config/maps';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { getRedis } from '@config/redis';

// ── Exported type so serviceability.service.ts can safely destructure ─────────
export interface ReverseGeocodeResult {
  address:     string;
  placeId:     string;
  lat:         number;
  lng:         number;
  countryCode: string | null;
  country:     string | null;
  stateCode:   string | null;
  state:       string | null;
  city:        string | null;
  pincode:     string | null;
}

// ── Cache TTL constants ────────────────────────────────────────────────────────
const AUTOCOMPLETE_TTL  = 60 * 60 * 24;     // 24 hours — place names rarely change
const REVERSE_GEO_TTL   = 60 * 60 * 6;      // 6 hours  — address at coords is stable
const PLACE_DETAILS_TTL = 60 * 60 * 24 * 7; // 7 days   — place ID → coords is permanent

// ── Redis cache helpers ────────────────────────────────────────────────────────

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // Redis unavailable — fall through to API
  }
}

async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Redis write failure is non-fatal — next request will call Mapbox
  }
}

export const mapsService = {
  /**
   * Get autocomplete predictions for a given input string using Mapbox Geocoding API.
   * Results are cached in local Redis for 24 hours.
   */
  autocomplete: async (input: string, sessionToken?: string) => {
    const cacheKey = `mapbox:autocomplete:${input.toLowerCase().trim()}`;

    // Try cache first (sub-1ms response for repeated searches)
    const cached = await cacheGet<any[]>(cacheKey);
    if (cached) {
      logger.debug(`[Maps] Autocomplete cache HIT for "${input}"`);
      return cached;
    }

    try {
      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(input)}.json`,
        {
          params: {
            access_token: MAPBOX_API_KEY,
            autocomplete: true,
            country: 'in', // Restrict to India
            limit: 5,
          },
        }
      );

      const result = response.data.features.map((f: any) => ({
        placeId: f.id,
        description: f.place_name,
        mainText: f.text,
        secondaryText: f.place_name.replace(`${f.text}, `, ''),
      }));

      await cacheSet(cacheKey, result, AUTOCOMPLETE_TTL);
      return result;
    } catch (error: any) {
      logger.error('Mapbox Autocomplete Error:', error.response?.data || error.message);
      throw AppError.internal('Failed to fetch place suggestions');
    }
  },

  /**
   * Get detailed information (geometry/location) for a place.
   * Results are cached in local Redis for 7 days (place ID → coords never changes).
   */
  placeDetails: async (placeId: string, sessionToken?: string) => {
    const cacheKey = `mapbox:place:${placeId}`;

    const cached = await cacheGet<object>(cacheKey);
    if (cached) {
      logger.debug(`[Maps] Place details cache HIT for ${placeId}`);
      return cached;
    }

    try {
      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(placeId)}.json`,
        {
          params: {
            access_token: MAPBOX_API_KEY,
          },
        }
      );

      const features = response.data.features;
      if (!features || features.length === 0) {
        throw new Error('No geometry found');
      }

      const result = features[0];
      const payload = {
        lat: result.center[1], // Mapbox returns [lng, lat]
        lng: result.center[0],
        name: result.text,
        address: result.place_name,
      };

      await cacheSet(cacheKey, payload, PLACE_DETAILS_TTL);
      return payload;
    } catch (error: any) {
      logger.error('Mapbox Place Details Error:', error.response?.data || error.message);
      throw AppError.internal('Failed to fetch place details');
    }
  },

  /**
   * Get a formatted address and structured geographic context from lat/lng.
   * Results are cached in local Redis for 6 hours.
   */
  reverseGeocode: async (lat: number, lng: number): Promise<ReverseGeocodeResult | null> => {
    // Round to 4 decimal places (~11m precision) to improve cache hit rate
    const rLat = Math.round(lat * 10000) / 10000;
    const rLng = Math.round(lng * 10000) / 10000;
    const cacheKey = `mapbox:reverse:${rLat},${rLng}`;

    const cached = await cacheGet<ReverseGeocodeResult>(cacheKey);
    if (cached) {
      logger.debug(`[Maps] Reverse geocode cache HIT for (${rLat},${rLng})`);
      return cached;
    }

    try {
      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${rLng},${rLat}.json`,
        {
          params: {
            access_token: MAPBOX_API_KEY,
            limit: 1,
            types: 'address,place,region,country',
          },
        }
      );

      const features = response.data.features;
      if (!features || features.length === 0) {
        return null;
      }

      const feature = features[0];
      const context: Array<{ id: string; text: string; short_code?: string }> = feature.context ?? [];

      const getContext = (prefix: string) => context.find(c => c.id.startsWith(prefix));

      const countryCtx  = getContext('country.');
      const regionCtx   = getContext('region.');
      const placeCtx    = getContext('place.');
      const postcodeCtx = getContext('postcode.');

      const payload = {
        address:     feature.place_name,
        placeId:     feature.id,
        lat:         rLat,
        lng:         rLng,
        countryCode: countryCtx?.short_code ?? null,
        country:     countryCtx?.text ?? null,
        stateCode:   regionCtx?.short_code ?? null,
        state:       regionCtx?.text ?? null,
        city:        placeCtx?.text ?? null,
        pincode:     postcodeCtx?.text ?? null,
      };

      await cacheSet(cacheKey, payload, REVERSE_GEO_TTL);
      return payload;
    } catch (error: any) {
      logger.error('Mapbox Reverse Geocode Error:', error.response?.data || error.message);
      throw AppError.internal('Failed to reverse geocode coordinates');
    }
  },

  /**
   * Calculate distance and duration between two points using Mapbox Directions API.
   * NOTE: Directions are NOT cached (route depends on live traffic conditions).
   */
  getDistanceMatrix: async (originLat: number, originLng: number, destLat: number, destLng: number) => {
    const MAX_RETRIES = 2;
    let lastError: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.get(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}`,
          {
            params: { access_token: MAPBOX_API_KEY, geometries: 'geojson', overview: 'false' },
            timeout: 5000,
          }
        );
        const route = response.data.routes[0];
        if (!route) throw new Error('No route found');
        return {
          distanceKm: route.distance / 1000,
          durationMinutes: Math.round(route.duration / 60),
        };
      } catch (error: any) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          logger.warn(`Mapbox Directions attempt ${attempt} failed — retrying in ${600 * attempt}ms`);
          await new Promise(r => setTimeout(r, 600 * attempt));
        }
      }
    }

    // Fallback: Haversine straight-line distance with 25% road-factor approximation
    logger.error('Mapbox Directions failed after retries — using Haversine fallback:', lastError?.message);
    const R = 6371;
    const dLat = ((destLat - originLat) * Math.PI) / 180;
    const dLng = ((destLng - originLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((originLat * Math.PI) / 180) *
      Math.cos((destLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    const straightLineKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const estimatedRoadKm = Math.round(straightLineKm * 1.25 * 10) / 10;
    const estimatedMinutes = Math.round((estimatedRoadKm / 30) * 60);
    return { distanceKm: estimatedRoadKm, durationMinutes: estimatedMinutes };
  },
};
