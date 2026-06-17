import { withTransaction } from '../../platform/db.js';

/** The persisted-fix identity returned to the device (its offline queue keys off `success`). */
export interface CapturedLocationRow {
  id: string;
  recordedAt: string;
  accuracy: number | null;
}

export interface CaptureInput {
  userId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: string;
  source: string;
  caseId: string | null;
  taskId: string | null;
  requestedBy: string | null;
  operationId: string | null;
}

/**
 * Device location ingest (ADR-0026). Dual write in ONE transaction: append the event to
 * `device_locations` (idempotent on `operation_id` — FCM+socket deliver the same ADMIN_PING)
 * and upsert the per-agent `latest_device_location` projection with a freshness guard
 * (`recorded_at <= EXCLUDED.recorded_at` drops out-of-order older replays). GPS lives here,
 * NEVER in the `locations` pincode catalog.
 */
export const locationRepository = {
  async capture(p: CaptureInput): Promise<CapturedLocationRow> {
    return withTransaction(async (q) => {
      let rows = await q<CapturedLocationRow>(
        `INSERT INTO device_locations
           (user_id, latitude, longitude, accuracy, recorded_at, source,
            case_id, task_id, requested_by_user_id, operation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (operation_id) WHERE operation_id IS NOT NULL DO NOTHING
         RETURNING id, recorded_at, accuracy::float8 AS accuracy`,
        [
          p.userId,
          p.latitude,
          p.longitude,
          p.accuracy,
          p.recordedAt,
          p.source,
          p.caseId,
          p.taskId,
          p.requestedBy,
          p.operationId,
        ],
      );
      // Conflict (duplicate operation_id) → the first row already exists; return it (idempotent).
      if (rows.length === 0 && p.operationId) {
        rows = await q<CapturedLocationRow>(
          `SELECT id, recorded_at, accuracy::float8 AS accuracy FROM device_locations WHERE operation_id = $1`,
          [p.operationId],
        );
      }
      const row = rows[0];
      if (!row) throw new Error('capture insert produced no row');

      await q(
        `INSERT INTO latest_device_location (user_id, latitude, longitude, accuracy, recorded_at, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE
           SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
               accuracy = EXCLUDED.accuracy, recorded_at = EXCLUDED.recorded_at,
               source = EXCLUDED.source, updated_at = now()
         WHERE latest_device_location.recorded_at <= EXCLUDED.recorded_at`,
        [p.userId, p.latitude, p.longitude, p.accuracy, p.recordedAt, p.source],
      );

      return { id: String(row.id), recordedAt: row.recordedAt, accuracy: row.accuracy };
    });
  },
};
