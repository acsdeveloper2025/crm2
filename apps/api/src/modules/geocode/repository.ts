import { query } from '../../platform/db.js';

/**
 * Reverse-geocode cache (ADR-0026). One row per 6-dp coordinate. Write-once/frozen: the first
 * resolver wins (ON CONFLICT DO NOTHING), so a coordinate's address never changes once stored.
 */
export const geocodeRepository = {
  async getCached(lat: number, lng: number): Promise<string | null> {
    const rows = await query<{ address: string }>(
      `SELECT address FROM geocode_cache WHERE lat = $1 AND lng = $2`,
      [lat, lng],
    );
    return rows[0]?.address ?? null;
  },

  async putCached(lat: number, lng: number, address: string): Promise<void> {
    await query(
      `INSERT INTO geocode_cache (lat, lng, address) VALUES ($1, $2, $3)
       ON CONFLICT (lat, lng) DO NOTHING`,
      [lat, lng, address],
    );
  },

  /** Dead-letter a reverse-geocode that exhausted retries (ADR-0040 S4 Slice B). One OPEN row per
   *  attachment (partial unique on replayed_at IS NULL); a re-fail bumps attempts + refreshes the error. */
  async insertReverseGeocodeDlq(
    attachmentId: string,
    lat: number,
    lng: number,
    error: string,
  ): Promise<void> {
    await query(
      `INSERT INTO reverse_geocode_dlq (attachment_id, latitude, longitude, error, attempts)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (attachment_id) WHERE replayed_at IS NULL
       DO UPDATE SET error = EXCLUDED.error, attempts = reverse_geocode_dlq.attempts + 1, created_at = now()`,
      [attachmentId, lat, lng, error],
    );
  },

  /** Open (not-yet-replayed) DLQ rows — admin observability + replay source. */
  async openReverseGeocodeDlq(): Promise<
    {
      id: string;
      attachmentId: string;
      lat: number;
      lng: number;
      error: string;
      attempts: number;
      createdAt: string;
    }[]
  > {
    return query(
      `SELECT id, attachment_id AS "attachmentId", latitude::double precision AS lat,
              longitude::double precision AS lng, error, attempts, created_at AS "createdAt"
       FROM reverse_geocode_dlq WHERE replayed_at IS NULL ORDER BY created_at ASC`,
    );
  },

  /** Stamp a DLQ row replayed (so the partial-unique slot frees for a future failure). */
  async markReverseGeocodeDlqReplayed(id: string): Promise<void> {
    await query(`UPDATE reverse_geocode_dlq SET replayed_at = now() WHERE id = $1 AND replayed_at IS NULL`, [
      id,
    ]);
  },
};
