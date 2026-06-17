import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * Reverse-geocode seam (ADR-0026). Callers depend on this interface, never on Google directly. The
 * factory returns a real Google-backed geocoder only when a key is configured; otherwise a disabled
 * geocoder that resolves to `null` (NOT an error — a missing address degrades the UI to raw coords +
 * a Maps link, it never breaks the page). Deferred-activation: the code ships, the key is a deploy step.
 */
export interface Geocoder {
  /** coord → human address, or null when unresolved (no key / Google miss / failure). */
  reverse(lat: number, lng: number): Promise<string | null>;
}

const disabledGeocoder: Geocoder = {
  reverse: () => Promise.resolve(null),
};

/** True when a Google Geocoding key is provisioned for this deployment. */
export function geocodeConfigured(env: Env = loadEnv()): boolean {
  return !!env.GOOGLE_GEOCODING_API_KEY;
}

let override: Geocoder | null = null;
let cached: Geocoder | null = null;

/** For tests: inject a fake geocoder (mirrors setPool/setStorage). Pass null to restore the factory. */
export function setGeocoder(g: Geocoder | null): void {
  override = g;
  cached = null;
}

/** The active geocoder: real Google when keyed, else the disabled null-geocoder. */
export function getGeocoder(env: Env = loadEnv()): Geocoder {
  if (override) return override;
  if (cached) return cached;
  cached = geocodeConfigured(env)
    ? createGoogleGeocoder(env.GOOGLE_GEOCODING_API_KEY as string)
    : disabledGeocoder;
  return cached;
}

const GEOCODE_TIMEOUT_MS = 5000;
const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

interface GoogleGeocodeResponse {
  status: string;
  results?: { formatted_address?: string }[];
}

/**
 * The real provider — Google Geocoding API over global fetch with a hard timeout. Any non-OK status,
 * empty result, network error or timeout resolves to `null` (the UI degrades to coords); failures are
 * never cached, so a transient outage self-heals on the next lookup.
 */
function createGoogleGeocoder(apiKey: string): Geocoder {
  return {
    async reverse(lat, lng) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
      try {
        const url = `${GEOCODE_ENDPOINT}?latlng=${lat},${lng}&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        const body = (await res.json()) as GoogleGeocodeResponse;
        if (body.status !== 'OK') return null;
        return body.results?.[0]?.formatted_address ?? null;
      } catch (e) {
        logger.warn('reverse geocode failed', { error: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
