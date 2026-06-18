import { query } from '../../platform/db.js';
import { taskScopePredicate, type Scope } from '../../platform/scope/index.js';

/** Flat row from the down-sync query (camelized by db.query). One row per assigned task. */
export interface SyncTaskRow {
  id: string;
  caseId: string;
  taskNumber: string;
  address: string;
  trigger: string;
  priority: string;
  status: string;
  assignedAt: string | null;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  backendContactNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerCallingCode: string;
  companyName: string | null;
  applicantType: string;
  unitId: number;
  unitCode: string;
  unitName: string;
  clientId: number;
  clientCode: string;
  clientName: string;
  productId: number;
  productCode: string;
  productName: string;
  createdByName: string | null;
  assignedToName: string | null;
  revisedByName: string | null;
  attachmentCount: number;
  verificationOutcome: string | null;
  formData: Record<string, unknown> | null;
  remark: string | null;
  addressPincode: string | null;
  latitude: string | null;
  longitude: string | null;
}

/**
 * The mobile down-sync read model (ADR-0012; locked dispatch contract §3). One row per task
 * assigned to the device user — `assigned_to = $deviceUser` is the contract filter AND the tightest
 * possible scope (a device can only ever receive its own assigned tasks → inherently leak-proof,
 * byte-identical to v1). The scope seam is composed as defense-in-depth; as wired today FIELD_AGENT
 * only holds EXPAND dimensions (PINCODE/AREA) so the predicate can only OR-broaden within the pinned
 * assignment, never subtract. DON'T-REGRESS (audit F2): if a RESTRICT dimension is ever wired onto a
 * field role, re-test down-sync — a zero-assignment RESTRICT would hide validly-assigned tasks.
 *
 * Live LATERAL-free query (all joins 1:1 PK / partial-unique → COUNT is exact). Delta watermark on
 * `COALESCE(ct.updated_at, cs.updated_at)`; deterministic order for offset paging.
 */
const SYNC_SELECT = `
  SELECT ct.id, cs.case_number AS case_id, ct.task_number,
         ct.address, ct.trigger, ct.priority, ct.status, ct.assigned_at, ct.updated_at,
         ct.started_at, ct.completed_at, ct.verification_outcome, ct.form_data, ct.remark,
         ct.latitude, ct.longitude,
         cs.backend_contact_number,
         ap.name AS customer_name, ap.mobile AS customer_phone,
         ap.calling_code AS customer_calling_code, ap.company_name, ap.applicant_type,
         vu.id AS unit_id, vu.code AS unit_code, vu.name AS unit_name,
         cl.id AS client_id, cl.code AS client_code, cl.name AS client_name,
         p.id AS product_id, p.code AS product_code, p.name AS product_name,
         creator.name AS created_by_name, assignee.name AS assigned_to_name,
         reviser.name AS revised_by_name, loc.pincode AS address_pincode,
         (SELECT count(*)::int FROM case_attachments ca
            WHERE ca.case_id = cs.id AND ca.deleted_at IS NULL
              AND (ca.task_id IS NULL OR ca.task_id = ct.id)) AS attachment_count`;

const SYNC_FROM = `
  FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN case_applicants ap ON ap.id = ct.applicant_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  LEFT JOIN users creator ON creator.id = cs.created_by
  LEFT JOIN users assignee ON assignee.id = ct.assigned_to
  LEFT JOIN users reviser ON reviser.id = ct.updated_by
  LEFT JOIN locations loc ON loc.id = ct.pincode_id`;

export const syncRepository = {
  /** Returns the assigned-task page + the total matching (for hasMore). */
  async downloadForUser(
    userId: string,
    scope: Scope | undefined,
    cutoff: Date,
    limit: number,
    offset: number,
  ): Promise<{ rows: SyncTaskRow[]; total: number }> {
    const params: unknown[] = [userId, cutoff.toISOString()];
    // Contract filter: only this device user's assigned tasks, changed since the watermark.
    const where = [`ct.assigned_to = $1`, `COALESCE(ct.updated_at, cs.updated_at) > $2`];
    const scopePred = taskScopePredicate(params, scope);
    if (scopePred) where.push(scopePred);
    const clause = `WHERE ${where.join(' AND ')}`;

    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${SYNC_FROM} ${clause}`,
      params,
    );
    const rows = await query<SyncTaskRow>(
      `${SYNC_SELECT} ${SYNC_FROM} ${clause}
       ORDER BY COALESCE(ct.updated_at, cs.updated_at) ASC, cs.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return { rows, total: countRow?.count ?? 0 };
  },

  /**
   * Tasks the device user WAS assigned but no longer is (reassigned or unassigned away) since the
   * watermark → the device must purge these orphans (they fall out of the `assigned_to = me` `cases`
   * filter, so they'd otherwise rot locally). Sourced from the append-only task_assignment_history:
   * a row whose `previous_assigned_to` is the user, created after the cutoff, where the task's CURRENT
   * assignee is no longer the user (covers REASSIGNED-away and UNASSIGNED; excludes reassigned-then-back,
   * which still flows in `cases`). Returns task UUIDs — the device matches these on `verification_task_id`.
   * A REVOKED-but-still-assigned task is NOT here: it keeps `assigned_to = me` and reaches the device via
   * `cases` with `isRevoked = true` (the device's keep-the-row cleanup path, not a purge). The EXISTS
   * guard restricts to tasks the user was ever the ACTUAL assignee of — a reassign-after-revoke clones the
   * revoked task's assignee into the REPLACEMENT task's `previous_assigned_to`, so without the guard the
   * replacement (a task the device never held) would falsely surface as a purge id (cross-task leak).
   */
  async revokedAssignmentIdsForUser(userId: string, cutoff: Date): Promise<string[]> {
    const rows = await query<{ id: string }>(
      `SELECT DISTINCT h.task_id AS id
         FROM task_assignment_history h
         JOIN case_tasks ct ON ct.id = h.task_id
        WHERE h.previous_assigned_to = $1
          AND h.created_at > $2
          AND ct.assigned_to IS DISTINCT FROM $1
          AND EXISTS (
            SELECT 1 FROM task_assignment_history h2
             WHERE h2.task_id = h.task_id AND h2.assigned_to = $1
          )`,
      [userId, cutoff.toISOString()],
    );
    return rows.map((r) => r.id);
  },
};
