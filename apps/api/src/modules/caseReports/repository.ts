import { query } from '../../platform/db.js';

/** A FIELD_PHOTO row enriched with its storage key so the assembly engine can sign a URL per photo
 *  without a per-photo scope check (one scope-guarded read instead of N). The storage key is
 *  server-internal; only the signed URL leaves the API. */
export interface CaseReportPhotoRow {
  id: string;
  taskId: string | null;
  photoType: string | null;
  storageKey: string;
  geoLocation: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    timestamp?: string;
  } | null;
  reverseGeocodedAddress: string | null;
}

export const caseReportRepository = {
  /** ALL of the case's FIELD_PHOTO rows (kind='FIELD_PHOTO', not deleted), with the storage_key so the
   *  service can presign in one pass.
   *
   *  CASE-scoped, NOT per-task-scoped (CEO FLAG-1 reconciliation, 2026-06-17): the case report is a
   *  case-level artifact; its access gate is CASE visibility, which the caller already enforces
   *  (`assemble` → `caseRepository.findById(caseId, scope)` / `enqueueReport` → `caseVisible` → 404).
   *  `findById` returns ALL tasks of a visible case (tasks aren't individually scoped), so the per-task
   *  photo predicate was STRICTER than task visibility — a colleague's task on a case I can see would
   *  show 0 photos while still counting in totals. Once the case is visible, all its field photos
   *  belong in the report. (Distinct from the #7 card's `listFieldPhotos`, which is per-task by design.) */
  async listPhotosForReport(caseId: string): Promise<CaseReportPhotoRow[]> {
    return query<CaseReportPhotoRow>(
      `SELECT ca.id, ca.task_id AS "taskId", ca.photo_type AS "photoType",
              ca.storage_key AS "storageKey", ca.geo_location AS "geoLocation",
              ca.reverse_geocoded_address AS "reverseGeocodedAddress"
       FROM case_attachments ca
       WHERE ca.case_id = $1 AND ca.kind = 'FIELD_PHOTO' AND ca.deleted_at IS NULL
       ORDER BY ca.created_at ASC`,
      [caseId],
    );
  },

  /** Lookup the actor's display name for `generation.generatedByName`. Null when the row is gone
   *  (won't happen for an authenticated request, but the assembly engine degrades gracefully). */
  async userName(userId: string): Promise<string | null> {
    const rows = await query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    return rows[0]?.name ?? null;
  },

  /** Trigger from the case's earliest task (dispatch bank instruction); empty when no tasks. v1's
   *  ReportContext exposes this at the case level; we mirror that. */
  async caseTrigger(caseId: string): Promise<string> {
    const rows = await query<{ trigger: string }>(
      `SELECT trigger FROM case_tasks WHERE case_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [caseId],
    );
    return rows[0]?.trigger ?? '';
  },
};
