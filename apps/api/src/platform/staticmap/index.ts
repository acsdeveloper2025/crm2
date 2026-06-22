import type { Env } from '@crm2/config';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * Static-map seam (ADR-0060) — a coordinate → small map-thumbnail PNG, mirroring the reverse-geocode
 * seam (`platform/geocode`). Callers depend on this interface, never on Google directly. The factory
 * returns a real Google-Static-Maps-backed provider only when a key is configured; otherwise a disabled
 * provider that resolves to `null` (NOT an error — a missing thumbnail degrades the GPS-Map-Camera
 * overlay to a coordinate placeholder, it never breaks the page). The KEY STAYS SERVER-SIDE (ADR-0040
 * invariant: the device/browser never holds the Google key) — the web fetches the PNG through an
 * authed proxy route, the report inlines it as a data URI.
 *
 * Reuses `GOOGLE_GEOCODING_API_KEY` (the same project key already provisioned for reverse-geocode;
 * Static Maps is a sibling Google Maps Platform API). No new env var; if the key is unset or Static
 * Maps is not enabled on it, every lookup degrades to `null`.
 */
export interface StaticMapProvider {
  /** coord → PNG bytes, or null when unavailable (no key / Static Maps disabled / failure). */
  thumbnail(lat: number, lng: number): Promise<Buffer | null>;
}

const disabledStaticMap: StaticMapProvider = {
  thumbnail: () => Promise.resolve(null),
};

/** True when a Google key is provisioned for this deployment (shared with reverse-geocode). */
export function staticMapConfigured(env: Env = loadEnv()): boolean {
  return !!env.GOOGLE_GEOCODING_API_KEY;
}

let override: StaticMapProvider | null = null;
let cached: StaticMapProvider | null = null;

/** For tests: inject a fake provider (mirrors setGeocoder). Pass null to restore the factory. */
export function setStaticMapProvider(p: StaticMapProvider | null): void {
  override = p;
  cached = null;
}

/** The active provider: real Google when keyed, else the disabled null-provider. */
export function getStaticMapProvider(env: Env = loadEnv()): StaticMapProvider {
  if (override) return override;
  if (cached) return cached;
  cached = staticMapConfigured(env)
    ? createGoogleStaticMap(env.GOOGLE_GEOCODING_API_KEY as string)
    : disabledStaticMap;
  return cached;
}

const STATIC_MAP_TIMEOUT_MS = 5000;
const STATIC_MAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';
// A compact, retina map thumbnail centred on the fix with a single marker — sized for the overlay inset.
const STATIC_MAP_PARAMS = 'zoom=16&size=240x160&scale=2&maptype=roadmap';

/**
 * The real provider — Google Static Maps over global fetch with a hard timeout. Any non-OK status,
 * non-image body, network error or timeout resolves to `null` (the overlay degrades to coords); the
 * disabled/null result is never cached on the failure path, so a transient outage self-heals.
 */
function createGoogleStaticMap(apiKey: string): StaticMapProvider {
  return {
    async thumbnail(lat, lng) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STATIC_MAP_TIMEOUT_MS);
      try {
        const center = `${lat},${lng}`;
        const url =
          `${STATIC_MAP_ENDPOINT}?center=${center}&${STATIC_MAP_PARAMS}` +
          `&markers=${encodeURIComponent(`color:red|${center}`)}&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        const type = res.headers.get('content-type') ?? '';
        if (!type.startsWith('image/')) return null; // Google returns a text error body on quota/disabled
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        logger.warn('static map fetch failed', { error: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
