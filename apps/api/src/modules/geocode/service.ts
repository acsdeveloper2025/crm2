import type { ReverseGeocodeResult } from '@crm2/sdk';
import { geocodeRepository as repo } from './repository.js';
import { getGeocoder } from '../../platform/geocode/index.js';
import { enqueueReverseGeocode } from '../../platform/geocode/queue.js';
import { AppError } from '../../platform/errors.js';

const COORD_DECIMALS = 6;
const LAT_MAX = 90;
const LNG_MAX = 180;

/** Round to the cache's 6-dp grid so lookups and writes share one canonical key. */
function round6(n: number): number {
  return Number(n.toFixed(COORD_DECIMALS));
}

/**
 * Reverse-geocode service (ADR-0026). Cache-first: a hit returns the frozen address; a miss calls
 * the active geocoder (real Google when keyed, else the disabled geocoder → null) and freezes a
 * successful result. A null (unconfigured / Google miss) is NOT cached — the UI degrades to raw
 * coords and the lookup self-heals once a key is provisioned.
 */
export const geocodeService = {
  async reverse(rawLat: unknown, rawLng: unknown): Promise<ReverseGeocodeResult> {
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > LAT_MAX || Math.abs(lng) > LNG_MAX)
      throw AppError.badRequest('INVALID_COORDINATES', { lat: rawLat, lng: rawLng });

    const rlat = round6(lat);
    const rlng = round6(lng);
    const hit = await repo.getCached(rlat, rlng);
    if (hit !== null) return { address: hit, cached: true };

    const address = await getGeocoder().reverse(rlat, rlng);
    if (address !== null) await repo.putCached(rlat, rlng, address);
    return { address, cached: false };
  },

  /** Open reverse-geocode DLQ rows (ADR-0040 Slice B) — failed async geocodes awaiting replay. */
  dlq() {
    return repo.openReverseGeocodeDlq();
  },

  /** Re-enqueue every open DLQ row + stamp it replayed; returns how many were requeued. The on-view
   *  fallback also recovers these, so replay is a bulk pre-warm, not the only recovery path. */
  async replayDlq(): Promise<{ replayed: number }> {
    const open = await repo.openReverseGeocodeDlq();
    for (const row of open) {
      await enqueueReverseGeocode({ attachmentId: row.attachmentId, lat: row.lat, lng: row.lng });
      await repo.markReverseGeocodeDlqReplayed(row.id);
    }
    return { replayed: open.length };
  },
};
