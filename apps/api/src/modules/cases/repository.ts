import type {
  Case,
  CaseView,
  CaseDetail,
  CaseApplicant,
  CaseTaskView,
  AvailableUnit,
  Option,
  DuplicateMatch,
  CreateCaseInput,
  AddApplicantInput,
  DedupeQuery,
  AssignableUser,
  AssignTaskInput,
  ReassignTaskInput,
  CaseVerdictEvent,
  DeviceAttachment,
  CompleteTaskInput,
  CaseAttachment,
  CaseFieldPhoto,
  SortOrder,
} from '@crm2/sdk';
import { randomUUID } from 'node:crypto';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction, type TxQuery } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import {
  getScopedUserIds,
  composeScopePredicate,
  taskScopePredicate,
  type Actor,
  type Scope,
} from '../../platform/scope/index.js';
import { COMMISSION_LATERAL } from '../../platform/billing/laterals.js';
import { REWORK_TAT_HOURS, TASK_OVERDUE_SQL } from '../../platform/tat/overdue.js';

/** A field photo as a downloadable file (ADR-0060) — storage key + the inputs the server uses to build
 *  the canonical `<caseNumber>_<taskNumber>_<NN>[_<photoType>].<ext>` filename. `seq` is the stable
 *  1-based per-case index (shared by the zip stream and the single-photo download). */
export interface FieldPhotoFile {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string | null;
  photoType: string | null;
  caseNumber: string;
  taskNumber: string | null;
  seq: number;
  // ADR-0075: the inputs the download composites into the baked GPS-Map-Camera overlay.
  geoLocation: { latitude?: number; longitude?: number; accuracy?: number; timestamp?: string } | null;
  reverseGeocodedAddress: string | null;
  unitName: string | null;
}

/**
 * Snapshot the resolved field commission onto the task (ADR-0046 §4 persisted form; ADR-0047 freezes it
 * at SUBMIT). Reuses COMMISSION_LATERAL so the stored value matches the read-model resolver. The anchor
 * resolves the rate + band as-of `submitted_at` (the field executive earns at submit), falling back to
 * `completed_at`/now() for office-only/desk tasks with no submit leg. **First-stamp-wins:** the
 * `commission_amount IS NULL` guard means submit freezes the field commission and the later office
 * COMPLETE never re-stamps it — while a desk task that goes ASSIGNED→COMPLETED directly is stamped at
 * its completion. Runs in the writer's transaction (`q`). The task's location (area_id/pincode_id) must
 * be set by submit/completion time (true in prod — set at case/task creation) for the cascade to resolve.
 */
async function stampCommissionSnapshot(q: TxQuery, taskId: string): Promise<void> {
  await q(
    `UPDATE case_tasks t
       SET commission_amount = sub.commission_amount
     FROM (
       SELECT com.commission_amount
       FROM case_tasks ct
       JOIN cases cs ON cs.id = ct.case_id
       ${COMMISSION_LATERAL}
       WHERE ct.id = $1
     ) sub
     WHERE t.id = $1 AND t.commission_amount IS NULL`,
    [taskId],
  );
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface CaseListOptions {
  status?: string;
  clientId?: number;
  productId?: number;
  search?: string;
  /** whitelisted per-column filters (§6/§7); only count-FROM columns (cs/pa) — see CASE_PAGE_SPEC. */
  columnFilters?: AppliedFilter[];
  /** data-scope (Epic F): restricts visible cases to the actor's hierarchy; undefined = no filter. */
  scope?: Scope;
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const pgConstraint = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { constraint?: string }).constraint : undefined;
const FK_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
/** Partial-unique index guarding at most one OPEN revisit per parent (mig 0054). */
const ACTIVE_REVISIT_INDEX = 'uq_case_tasks_active_revisit';

/** Per-applicant call-routing token (ADR-0023): `CC-<base36 epoch>-<rand>`, display-only. */
const CC_PREFIX = 'CC-';
const CC_RAND_LEN = 8;
const BASE36 = 36;
const nextCallingCode = (): string =>
  `${CC_PREFIX}${Date.now().toString(BASE36)}-${randomUUID().replace(/-/g, '').slice(0, CC_RAND_LEN)}`;

const CASE_COLS = `id, case_number, client_id, product_id, status, backend_contact_number,
  dedupe_checked, dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers,
  verification_outcome, result_remark, completed_at, version,
  created_by, updated_by, created_at, updated_at`;

const CASE_VIEW_SELECT = `
  SELECT cs.id, cs.case_number, cs.client_id, cs.product_id, cs.status, cs.backend_contact_number,
         cs.dedupe_checked, cs.dedupe_decision, cs.dedupe_rationale, cs.dedupe_matched_case_numbers,
         cs.verification_outcome, cs.result_remark, cs.completed_at, cs.version,
         ccb.name AS completed_by_name,
         cs.created_by, cs.updated_by, cs.created_at, cs.updated_at,
         cl.name AS client_name, p.name AS product_name,
         pa.name AS primary_name, pa.mobile AS primary_mobile, pa.pan AS primary_pan,
         (SELECT count(*)::int FROM case_applicants a WHERE a.case_id = cs.id) AS applicant_count,
         (SELECT count(*)::int FROM case_tasks ct WHERE ct.case_id = cs.id) AS task_count
  FROM cases cs
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  LEFT JOIN users ccb ON ccb.id = cs.completed_by
  LEFT JOIN case_applicants pa ON pa.case_id = cs.id AND pa.is_primary`;

/**
 * Recompute a case's status from its tasks (ADR-0032 — the single CASE-status writer). Runs INSIDE
 * the caller's transaction (after the task write), so it sees the just-written task. It takes the
 * cases-row lock (SELECT … FOR UPDATE) BEFORE reading the task aggregate, so concurrent task writers
 * serialize here and each recompute reads the latest committed task states (fixes the "both see
 * one-active → stuck IN_PROGRESS" race). Deadlock-free because the lock order across the whole
 * transaction is consistent: the caller's task-row write locks the task row first, then this locks
 * the cases row — every writer follows task-row → cases-row.
 *
 * Ladder: 0 tasks → NEW · any active (PENDING/ASSIGNED/IN_PROGRESS) → IN_PROGRESS · else ≥1 COMPLETED
 * → AWAITING_COMPLETION · else (all REVOKED/CANCELLED) → IN_PROGRESS (degenerate; office handles).
 * NEVER sets COMPLETED (only case.finalize does) and NEVER touches a REVOKED case (manual terminal).
 * Any move to a non-COMPLETED status clears the verdict columns — re-opening a COMPLETED case (a
 * revisit/recheck adds an active task) invalidates the stale verdict (ADR-0032 §4 anti-staleness).
 */
async function recomputeCaseStatus(q: TxQuery, caseId: string, actorId: string): Promise<void> {
  const [cur] = await q<{ status: string }>(`SELECT status FROM cases WHERE id = $1 FOR UPDATE`, [caseId]);
  if (!cur || cur.status === 'REVOKED') return; // missing or manual-terminal → leave untouched
  const [agg] = await q<{ total: number; active: number; completed: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('PENDING','ASSIGNED','IN_PROGRESS','SUBMITTED'))::int AS active,
            count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed
     FROM case_tasks WHERE case_id = $1`,
    [caseId],
  );
  const computed =
    !agg || agg.total === 0
      ? 'NEW'
      : agg.active > 0
        ? 'IN_PROGRESS'
        : agg.completed > 0
          ? 'AWAITING_COMPLETION'
          : 'IN_PROGRESS';
  await q(
    `UPDATE cases
       SET status = $2,
           verification_outcome = NULL, result_remark = NULL, completed_at = NULL, completed_by = NULL,
           version = version + 1, updated_by = $3, updated_at = now()
     WHERE id = $1 AND status <> 'REVOKED' AND status <> $2`,
    [caseId, computed, actorId],
  );
}

/**
 * ADR-0056: resolve a FIELD executive's trip band (`field_rate_type`, LOCAL/OGL) for a task — derived
 * from the executive's OWN active commission rows at the task location. NOT client-supplied. Mirrors
 * `COMMISSION_LATERAL` (ADR-0050 §2) MINUS the `field_rate_type` equality (we are deriving it) and MINUS
 * `tat_band` (the band is a completion-time amount concern; it does not change the trip type). Same
 * location set + most-specific ORDER as the resolver, so the derived band is guaranteed to resolve a
 * commission amount downstream. Returns null ⇒ the executive has no commission here ⇒ the caller BLOCKS.
 * OFFICE rows are excluded (desk work auto-stamps 'OFFICE' separately).
 */
async function deriveFieldRateTypeForTask(
  q: TxQuery,
  caseId: string,
  taskId: string,
  assigneeId: string,
): Promise<string | null> {
  const [row] = await q<{ fieldRateType: string }>(
    `WITH t AS (
       SELECT ct.verification_unit_id AS unit, ct.area_id, ct.pincode_id,
              cs.client_id, cs.product_id, cs.area_id AS c_area, cs.pincode_id AS c_pincode
       FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
       WHERE ct.id = $2 AND ct.case_id = $3)
     SELECT rt.code AS field_rate_type FROM commission_rates cmr JOIN rate_types rt ON rt.id = cmr.rate_type_id, t
      WHERE cmr.user_id = $1 AND cmr.is_active
        AND rt.code <> 'OFFICE'
        AND (cmr.client_id IS NULL OR cmr.client_id = t.client_id)
        AND (cmr.product_id IS NULL OR cmr.product_id = t.product_id)
        AND (cmr.verification_unit_id IS NULL OR cmr.verification_unit_id = t.unit)
        AND cmr.location_id IN (t.area_id, t.pincode_id, t.c_area, t.c_pincode)
        AND cmr.effective_from <= now() AND (cmr.effective_to IS NULL OR cmr.effective_to > now())
      ORDER BY cmr.client_id DESC NULLS LAST, cmr.product_id DESC NULLS LAST,
               cmr.verification_unit_id DESC NULLS LAST,
               (CASE WHEN cmr.location_id = t.area_id   THEN 4 WHEN cmr.location_id = t.pincode_id THEN 3
                     WHEN cmr.location_id = t.c_area    THEN 2 WHEN cmr.location_id = t.c_pincode  THEN 1
                     ELSE 0 END) DESC,
               -- Among otherwise-tied rows prefer a tat_band-universal (NULL) band: it resolves a
               -- commission amount at ANY submit band, so the derived band can't strand the task at ₹0
               -- when the only same-specificity alternative is a tat-band-specific row (ADR-0056 B-1).
               (cmr.tat_band IS NULL) DESC,
               cmr.id DESC
      LIMIT 1`,
    [assigneeId, taskId, caseId],
  );
  return row?.fieldRateType ?? null;
}

/** ADR-0056: same derivation for a not-yet-created task (assign-at-create) — the location ids come from
 *  the input (area = pincode = the chosen `locations` row) + the case-level fallback. See above. */
async function deriveFieldRateTypeForNewTask(
  q: TxQuery,
  caseId: string,
  assigneeId: string,
  verificationUnitId: number,
  areaId: number | null,
  pincodeId: number | null,
): Promise<string | null> {
  const [row] = await q<{ fieldRateType: string }>(
    `WITH c AS (SELECT client_id, product_id, area_id AS c_area, pincode_id AS c_pincode FROM cases WHERE id = $2)
     SELECT rt.code AS field_rate_type FROM commission_rates cmr JOIN rate_types rt ON rt.id = cmr.rate_type_id, c
      WHERE cmr.user_id = $1 AND cmr.is_active
        AND rt.code <> 'OFFICE'
        AND (cmr.client_id IS NULL OR cmr.client_id = c.client_id)
        AND (cmr.product_id IS NULL OR cmr.product_id = c.product_id)
        AND (cmr.verification_unit_id IS NULL OR cmr.verification_unit_id = $3)
        AND cmr.location_id IN ($4, $5, c.c_area, c.c_pincode)
        AND cmr.effective_from <= now() AND (cmr.effective_to IS NULL OR cmr.effective_to > now())
      ORDER BY cmr.client_id DESC NULLS LAST, cmr.product_id DESC NULLS LAST,
               cmr.verification_unit_id DESC NULLS LAST,
               (CASE WHEN cmr.location_id = $4 THEN 4 WHEN cmr.location_id = $5 THEN 3
                     WHEN cmr.location_id = c.c_area THEN 2 WHEN cmr.location_id = c.c_pincode THEN 1
                     ELSE 0 END) DESC,
               -- Prefer a tat_band-universal (NULL) band among ties — always resolves downstream (B-1).
               (cmr.tat_band IS NULL) DESC,
               cmr.id DESC
      LIMIT 1`,
    [assigneeId, caseId, verificationUnitId, areaId, pincodeId],
  );
  return row?.fieldRateType ?? null;
}

/** Task-view columns shared by the by-case and by-id reads (dispatch fields + applicant + assignee).
 *  `rate_type` (ADR-0024) is resolved live from rate management for this case's client+product and
 *  the task's unit — the BEST-available active rate for that CPV, preferring the most specific
 *  location (task area > task pincode > case area > case pincode > a location-less default > any),
 *  honouring the temporal window. Null ONLY when no active rate exists for the CPV at all. */
const TASK_VIEW_COLS = `ct.id, ct.case_id, cs.case_number, ct.verification_unit_id, vu.code AS unit_code, vu.name AS unit_name,
         ct.task_number, ct.task_origin, ct.parent_task_id, ct.applicant_id, ap.name AS applicant_name,
         ct.address, ct.trigger, ct.document_number, ct.document_holder_name, ct.document_details, ct.priority,
         ct.status, ct.assigned_to, au.name AS assigned_to_name,
         ct.visit_type, (SELECT code FROM rate_types WHERE id = ct.rate_type_id) AS field_rate_type, ct.bill_count, ct.pincode_id, ct.area_id,
         (SELECT rt.code FROM rates r
            LEFT JOIN rate_types rt ON rt.id = r.rate_type_id
            WHERE r.client_id = cs.client_id
              AND (r.product_id IS NULL OR r.product_id = cs.product_id)
              AND (r.verification_unit_id IS NULL OR r.verification_unit_id = ct.verification_unit_id)
              AND r.is_active
              AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
            ORDER BY r.product_id DESC NULLS LAST,
                     r.verification_unit_id DESC NULLS LAST,
                     (CASE
                       WHEN r.location_id = ct.area_id    THEN 5
                       WHEN r.location_id = ct.pincode_id THEN 4
                       WHEN r.location_id = cs.area_id    THEN 3
                       WHEN r.location_id = cs.pincode_id THEN 2
                       WHEN r.location_id IS NULL         THEN 1
                       ELSE 0 END) DESC,
                     r.location_id, r.id DESC
            LIMIT 1) AS client_rate_type,
         -- ⚠ location rank mirrors RATE_LATERAL (ADR-0048, §G-8): a CASE rank so the location-less
         -- default outranks a non-matching scoped rate. Keep in sync with platform/billing/laterals.ts.
         ct.assigned_at,
         ct.submitted_at, ct.submitted_elapsed_minutes,
         ct.verification_outcome, ct.remark, ct.completed_at, cb.name AS completed_by_name,
         ct.completed_elapsed_minutes,
         COALESCE((SELECT tp.tat_hours FROM tat_policies tp
            WHERE tp.is_active AND tp.effective_from <= now()
              AND tp.tat_hours >= CEIL(ct.completed_elapsed_minutes / 60.0)
            ORDER BY tp.tat_hours ASC LIMIT 1),
            CASE WHEN ct.completed_elapsed_minutes IS NULL THEN NULL ELSE -1 END) AS completed_tat_band,
         ct.tat_hours AS tat_hours,
         (ct.assigned_at + (ct.tat_hours * interval '1 hour')) AS due_at,
         ${TASK_OVERDUE_SQL} AS overdue,
         ct.version, ct.created_at, ct.updated_at,
         -- ADR-0085: derived export state (the verifier's relay), ops-visible on the case page.
         -- At most one first-export row exists (partial unique) — plain subqueries, no fan-out.
         (SELECT e.created_at FROM task_export_events e
           WHERE e.task_id = ct.id AND NOT e.is_reexport) AS exported_at,
         (SELECT eu.name FROM task_export_events e JOIN users eu ON eu.id = e.exported_by
           WHERE e.task_id = ct.id AND NOT e.is_reexport) AS exported_by_name`;

const TASK_VIEW_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  JOIN case_applicants ap ON ap.id = ct.applicant_id
  LEFT JOIN users au ON au.id = ct.assigned_to
  LEFT JOIN users cb ON cb.id = ct.completed_by`;

/** Task rows for one case, in creation order. Params: [caseId]. Tasks added in one batch share
 *  created_at, so the per-case task sequence (the numeric suffix of task_number) is the deterministic
 *  tie-break — ct.created_at alone is ambiguous within a batch. */
const TASK_VIEW_BY_CASE = `SELECT ${TASK_VIEW_COLS} ${TASK_VIEW_FROM}
  WHERE ct.case_id = $1
  ORDER BY ct.created_at, (regexp_replace(ct.task_number, '^.*-', ''))::int`;

/** Single task row. Params: [taskId]. */
const TASK_VIEW_BY_ID = `SELECT ${TASK_VIEW_COLS} ${TASK_VIEW_FROM} WHERE ct.id = $1`;

/** DeviceAttachment projection (ADR-0034) — aliased so the query helper camelCases to the SDK shape. */
const FIELD_ATTACH_COLS = `id, original_name, mime_type, file_size AS size, photo_type,
         geo_location, storage_key AS url, thumbnail_key AS thumbnail_url, created_at AS uploaded_at`;

/**
 * Case-visibility scope predicate (ADR-0022): composed by the central scope seam from the actor's
 * resolved scope — `(hierarchy OR expand-dimensions) AND restrict-dimensions`. The hierarchy leg is
 * cases-specific: the actor created the case OR one of its tasks is assigned to an in-scope user
 * (correlated EXISTS → no row multiplication, safe in the COUNT too). `''` = no filter.
 */
function caseScopePredicate(params: unknown[], scope: Scope | undefined): string {
  if (!scope) return '';
  return composeScopePredicate(
    params,
    scope,
    (ph) =>
      `cs.created_by = ANY(${ph}) OR EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND ct.assigned_to = ANY(${ph}))`,
  );
}

// ── Dedupe (shared by the in-create gate + the standalone page) ──
const DEDUPE_CAP = '200'; // hard row bound for the flat gate result (exact match → few rows)
const DEDUPE_FROM = `FROM case_applicants a
       JOIN cases cs ON cs.id = a.case_id
       JOIN clients cl ON cl.id = cs.client_id`;
const DEDUPE_SELECT = `SELECT cs.id AS case_id, cs.case_number, a.name AS applicant_name, a.mobile, a.pan,
              a.company_name, cs.status, cl.name AS client_name, cs.created_at`;

/** Build the OR-combined exact-match WHERE for the provided identifiers; `''` when none given. */
function dedupeConditions(c: DedupeQuery): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (c.pan) {
    params.push(c.pan.trim().toUpperCase());
    conditions.push(`upper(a.pan) = $${params.length}`);
  }
  if (c.mobile) {
    params.push(c.mobile.trim());
    conditions.push(`a.mobile = $${params.length}`);
  }
  if (c.name) {
    params.push(c.name.trim().toUpperCase());
    conditions.push(`upper(a.name) = $${params.length}`);
  }
  if (c.company) {
    params.push(c.company.trim().toLowerCase());
    conditions.push(`lower(a.company_name) = $${params.length}`);
  }
  return { sql: conditions.join(' OR '), params };
}

/** Tag each row with which identifier(s) it matched on (PAN/MOBILE/NAME/COMPANY). */
function withMatchType(c: DedupeQuery, rows: DuplicateMatch[]): DuplicateMatch[] {
  const pan = c.pan?.trim().toUpperCase();
  const mobile = c.mobile?.trim();
  const name = c.name?.trim().toUpperCase();
  const company = c.company?.trim().toLowerCase();
  return rows.map((r) => {
    const matchType: string[] = [];
    if (pan && r.pan?.toUpperCase() === pan) matchType.push('PAN');
    if (mobile && r.mobile === mobile) matchType.push('MOBILE');
    if (name && r.applicantName.toUpperCase() === name) matchType.push('NAME');
    if (company && r.companyName?.toLowerCase() === company) matchType.push('COMPANY');
    return { ...r, matchType };
  });
}

export const caseRepository = {
  /** Dedupe (in-create gate): exact match on any provided identifier (OR), across ALL applicants. */
  async searchDuplicates(c: DedupeQuery): Promise<DuplicateMatch[]> {
    const { sql, params } = dedupeConditions(c);
    if (!sql) return [];
    const rows = await query<DuplicateMatch>(
      `${DEDUPE_SELECT} ${DEDUPE_FROM} WHERE ${sql} ORDER BY cs.created_at DESC, cs.id DESC LIMIT ${DEDUPE_CAP}`,
      params,
    );
    return withMatchType(c, rows);
  },

  /** Dedupe (standalone Dedupe Check page): the SAME cross-case exact match, paginated + counted.
   *  Cross-scope BY DESIGN (a duplicate must be findable anywhere) — gated by `dedupe.view`, not
   *  case.view. `sortColumn` is whitelisted by the service's PageSpec (safe to interpolate). */
  async searchDuplicatesPaged(
    c: DedupeQuery,
    o: { sortColumn: string; sortOrder: SortOrder; limit: number; offset: number },
  ): Promise<{ items: DuplicateMatch[]; totalCount: number }> {
    const { sql, params } = dedupeConditions(c);
    if (!sql) return { items: [], totalCount: 0 };
    const countRows = await query<{ n: number }>(
      `SELECT count(*)::int AS n ${DEDUPE_FROM} WHERE ${sql}`,
      params,
    );
    const order = o.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const rows = await query<DuplicateMatch>(
      `${DEDUPE_SELECT} ${DEDUPE_FROM} WHERE ${sql}
       ORDER BY ${o.sortColumn} ${order}, cs.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items: withMatchType(c, rows), totalCount: countRows[0]?.n ?? 0 };
  },

  async create(input: CreateCaseInput, userId: string): Promise<Case> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Case>(
          `INSERT INTO cases (case_number, client_id, product_id, backend_contact_number,
                              dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers,
                              pincode_id, area_id, created_by, updated_by)
           VALUES ('CASE-' || lpad(nextval('case_number_seq')::text, 6, '0'),
                   $1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
           RETURNING ${CASE_COLS}`,
          [
            input.clientId,
            input.productId,
            input.backendContactNumber,
            input.dedupeDecision,
            input.dedupeRationale ?? null,
            input.dedupeMatches ?? [],
            input.pincodeId ?? null,
            input.areaId ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        for (const [i, a] of input.applicants.entries()) {
          // calling_code (ADR-0023): per-applicant call-routing token, dispatched per task.
          await q(
            `INSERT INTO case_applicants (case_id, name, mobile, pan, company_name, applicant_type, is_primary, calling_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              row.id,
              a.name,
              a.mobile ?? null,
              a.pan ?? null,
              a.companyName ?? null,
              i === 0 ? 'APPLICANT' : 'CO_APPLICANT',
              i === 0,
              nextCallingCode(),
            ],
          );
        }
        await appendAudit(
          { entityType: 'case', entityId: row.id, action: 'CREATE', actorId: userId, after: row },
          q,
        );
        return row;
      });
    } catch (e) {
      if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
      throw e;
    }
  },

  async clientProductOf(caseId: string): Promise<{ clientId: number; productId: number } | null> {
    const rows = await query<{ clientId: number; productId: number }>(
      `SELECT client_id, product_id FROM cases WHERE id = $1`,
      [caseId],
    );
    return rows[0] ?? null;
  },

  /** A case's current status — for open-state guards (ADR-0053 add-applicant). */
  async caseStatusOf(caseId: string): Promise<string | null> {
    const rows = await query<{ status: string }>(`SELECT status FROM cases WHERE id = $1`, [caseId]);
    return rows[0]?.status ?? null;
  },

  /** Add ONE co-applicant to an existing case (ADR-0053). Always CO_APPLICANT / non-primary; carries
   *  its own dedupe verdict. The service has already validated the case is open. */
  async addApplicant(caseId: string, input: AddApplicantInput, userId: string): Promise<CaseApplicant> {
    return await withTransaction(async (q) => {
      const [row] = await q<CaseApplicant>(
        `INSERT INTO case_applicants
           (case_id, name, mobile, pan, company_name, applicant_type, is_primary, calling_code,
            dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers)
         VALUES ($1, $2, $3, $4, $5, 'CO_APPLICANT', false, $6, $7, $8, $9)
         RETURNING id, case_id, name, mobile, pan, company_name, applicant_type, is_primary,
                   calling_code, created_at, dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers`,
        [
          caseId,
          input.name,
          input.mobile ?? null,
          input.pan ?? null,
          input.companyName ?? null,
          nextCallingCode(),
          input.dedupeDecision,
          input.dedupeRationale ?? null,
          input.dedupeMatches ?? [],
        ],
      );
      if (!row) throw AppError.internal('insert returned no row');
      await appendAudit(
        { entityType: 'case_applicant', entityId: row.id, action: 'CREATE', actorId: userId, after: row },
        q,
      );
      return row;
    });
  },

  /** Products ENABLED for a client (via client_products), for the case-creation product picker — a
   *  product appears only if that client actually has it (the owner's "client must have that product"
   *  rule). Optionally narrowed to `productIds` (the actor's PRODUCT scope); `[]` ⇒ none (fail-closed). */
  async productsForClient(clientId: number, productIds?: number[]): Promise<Option[]> {
    if (productIds !== undefined && productIds.length === 0) return [];
    return query<Option>(
      `SELECT DISTINCT p.id, p.code, p.name
         FROM client_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.client_id = $1
          AND cp.is_active AND cp.effective_from <= now()
          AND p.is_active AND p.effective_from <= now()
          AND ($2::int[] IS NULL OR p.id = ANY($2))
        ORDER BY p.name ASC`,
      [clientId, productIds ?? null],
    );
  },

  /** Units enabled (CPV) for a client+product — the case-creation unit picker. ADR-0074: a Universal CPV
   *  mapping (verification_unit_id IS NULL) enables EVERY active unit; else only the specifically-mapped
   *  ones. Same rule as cpvUnitRepository.availableUnits — keep them in sync. */
  async availableUnits(clientId: number, productId: number): Promise<AvailableUnit[]> {
    return query<AvailableUnit>(
      `SELECT vu.id AS verification_unit_id, vu.code, vu.name, vu.worker_role, vu.category
       FROM verification_units vu
       WHERE vu.is_active AND vu.effective_from <= now()
         AND (
           EXISTS (SELECT 1 FROM client_product_verification_units cpvu
                     JOIN client_products cp ON cp.id = cpvu.client_product_id
                    WHERE cp.client_id = $1 AND cp.product_id = $2 AND cpvu.verification_unit_id IS NULL
                      AND cpvu.is_active AND cp.is_active AND cp.effective_from <= now() AND cpvu.effective_from <= now())
           OR EXISTS (SELECT 1 FROM client_product_verification_units cpvu
                       JOIN client_products cp ON cp.id = cpvu.client_product_id
                      WHERE cp.client_id = $1 AND cp.product_id = $2 AND cpvu.verification_unit_id = vu.id
                        AND cpvu.is_active AND cp.is_active AND cp.effective_from <= now() AND cpvu.effective_from <= now())
         )
       ORDER BY vu.sort_order, vu.name`,
      [clientId, productId],
    );
  },

  /** Rate-type preview during task creation (ADR-0050 + ADR-0056): the CLIENT rate type mapped in Rate
   *  Management for this client+product+unit at the chosen location (most-specific: exact location >
   *  location-less default — a display label), and the FIELD rate type(s) from active Commission rows at
   *  that location. ADR-0056: when `assigneeId` is given the FIELD side is scoped to THAT executive (0/1
   *  band — the office picks no band; OFFICE excluded); without it, the location-wide union. Types only. */
  async ratePreview(
    clientId: number,
    productId: number,
    verificationUnitId: number,
    locationId: number,
    assigneeId: string | null,
  ): Promise<{ clientRateType: string | null; fieldRateTypes: string[] }> {
    const [clientRow] = await query<{ clientRateType: string | null }>(
      // product/unit wildcard-matched, most-specific wins (ADR-0071) — a specific rate outranks a Universal one.
      `SELECT rt.code AS client_rate_type
         FROM rates r
         LEFT JOIN rate_types rt ON rt.id = r.rate_type_id
        WHERE r.client_id = $1
          AND (r.product_id IS NULL OR r.product_id = $2)
          AND (r.verification_unit_id IS NULL OR r.verification_unit_id = $3)
          AND r.is_active
          AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
        ORDER BY r.product_id DESC NULLS LAST, r.verification_unit_id DESC NULLS LAST,
                 (CASE WHEN r.location_id = $4 THEN 2 WHEN r.location_id IS NULL THEN 1 ELSE 0 END) DESC,
                 r.location_id, r.id DESC
        LIMIT 1`,
      [clientId, productId, verificationUnitId, locationId],
    );
    const fieldRows = await query<{ fieldRateType: string }>(
      `SELECT DISTINCT rt.code AS field_rate_type
         FROM commission_rates cmr
         JOIN rate_types rt ON rt.id = cmr.rate_type_id
        WHERE cmr.is_active AND cmr.location_id = $4
          AND rt.code <> 'OFFICE'
          AND ($5::uuid IS NULL OR cmr.user_id = $5::uuid)
          AND cmr.effective_from <= now() AND (cmr.effective_to IS NULL OR cmr.effective_to > now())
          AND (cmr.client_id IS NULL OR cmr.client_id = $1)
          AND (cmr.product_id IS NULL OR cmr.product_id = $2)
          AND (cmr.verification_unit_id IS NULL OR cmr.verification_unit_id = $3)
        ORDER BY rt.code`,
      [clientId, productId, verificationUnitId, locationId, assigneeId],
    );
    return {
      clientRateType: clientRow?.clientRateType ?? null,
      fieldRateTypes: fieldRows.map((r) => r.fieldRateType),
    };
  },

  /** True if every unit id is CPV-enabled for the client+product. ADR-0074: a Universal CPV mapping
   *  (verification_unit_id IS NULL) enables every unit; else every unit id must be specifically mapped. */
  async allUnitsEnabled(clientId: number, productId: number, unitIds: number[]): Promise<boolean> {
    const [row] = await query<{ universal: boolean; mappedCount: number }>(
      `SELECT
         EXISTS (SELECT 1 FROM client_product_verification_units cpvu
                   JOIN client_products cp ON cp.id = cpvu.client_product_id
                  WHERE cp.client_id = $1 AND cp.product_id = $2 AND cpvu.verification_unit_id IS NULL
                    AND cpvu.is_active AND cp.is_active AND cp.effective_from <= now() AND cpvu.effective_from <= now()) AS universal,
         (SELECT count(DISTINCT cpvu.verification_unit_id)::int
            FROM client_product_verification_units cpvu
            JOIN client_products cp ON cp.id = cpvu.client_product_id
           WHERE cp.client_id = $1 AND cp.product_id = $2 AND cpvu.is_active AND cp.is_active
             AND cp.effective_from <= now() AND cpvu.effective_from <= now()
             AND cpvu.verification_unit_id = ANY($3::int[])) AS "mappedCount"`,
      [clientId, productId, unitIds],
    );
    return (row?.universal ?? false) || (row?.mappedCount ?? 0) === new Set(unitIds).size;
  },

  /** Applicant ids belonging to a case — for validating per-task `applicantId` (no cross-case leak). */
  async caseApplicantIds(caseId: string): Promise<string[]> {
    const rows = await query<{ id: string }>(`SELECT id FROM case_applicants WHERE case_id = $1`, [caseId]);
    return rows.map((r) => r.id);
  },

  /**
   * Add explicit per-task specs (ADR-0023): each carries the applicant it verifies + dispatch
   * address/trigger/priority. `task_number` = case_number-<per-case ordinal> (display-only). The
   * service has already validated CPV-enablement + applicant ownership.
   */
  async addTasks(
    caseId: string,
    tasks: {
      verificationUnitId: number;
      applicantId: string;
      address: string;
      latitude?: number | undefined;
      longitude?: number | undefined;
      trigger: string;
      priority: string;
      // Target TAT in hours (ADR-0044) — optional override; when omitted the INSERT derives it from
      // `priority` using the locked mapping (URGENT 4 · HIGH 8 · MEDIUM 24 · LOW 48 · else 24).
      tatHours?: number | undefined;
      // ADR-0024 assign-at-create (service has re-checked eligibility): when assigneeId is set the
      // task is born ASSIGNED with its pool (visitType) + location; otherwise it stays PENDING.
      visitType?: string | undefined;
      // ADR-0056: an explicit override; normally absent — the server derives from the assignee's commission.
      fieldRateType?: string | undefined;
      pincodeId?: number | undefined;
      areaId?: number | undefined;
      assigneeId?: string | undefined;
      // ADR-0085 unified KYC document fields — nullable; FIELD tasks omit them.
      documentNumber?: string | undefined;
      documentHolderName?: string | undefined;
      documentDetails?: Record<string, string> | undefined;
    }[],
    userId: string,
  ): Promise<CaseTaskView[]> {
    try {
      return await withTransaction(async (q) => {
        // Per-case task-number ordinal continues from any existing tasks (UNIQUE (case_id, task_number)).
        const [countRow] = await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM case_tasks WHERE case_id = $1`,
          [caseId],
        );
        let seq = countRow?.n ?? 0;
        for (const t of tasks) {
          seq += 1;
          const assignee = t.assigneeId ?? null;
          // ADR-0056: derive the FIELD trip band from the assignee's commission at the task location when
          // the client didn't supply one (the web never does); no commission there ⇒ block the FIELD
          // assign. An explicit value is honored. OFFICE is auto-stamped 'OFFICE' by the INSERT CASE.
          let fieldRateType: string | null = t.fieldRateType ?? null;
          if (assignee && t.visitType === 'FIELD' && !fieldRateType) {
            fieldRateType = await deriveFieldRateTypeForNewTask(
              q,
              caseId,
              assignee,
              t.verificationUnitId,
              t.areaId ?? null,
              t.pincodeId ?? null,
            );
            if (!fieldRateType)
              throw AppError.badRequest('NO_FIELD_COMMISSION', {
                assigneeId: assignee,
                areaId: t.areaId ?? null,
                pincodeId: t.pincodeId ?? null,
              });
          }
          const [inserted] = await q<{ id: string }>(
            `INSERT INTO case_tasks
               (case_id, verification_unit_id, applicant_id, address, trigger, priority,
                visit_type, rate_type_id, pincode_id, area_id, assigned_to,
                assigned_by, assigned_at, status,
                task_number, created_by, updated_by, latitude, longitude, tat_hours,
                document_number, document_holder_name, document_details)
             VALUES ($1, $2, $3, $4, $5, $6,
                     -- ADR-0050/0068: an OFFICE task's rate type is auto-stamped 'OFFICE' (desk work
                     -- has no LOCAL/OGL trip band); FIELD uses the picked $16 (LOCAL/OGL). The code is
                     -- resolved to rate_types.id (NULL code → NULL id, e.g. KYC).
                     -- $7::varchar: $7 also feeds the varchar visit_type col above, so the literal
                     -- compare must not re-deduce it as text (else inconsistent types for parameter $7).
                     $7, (SELECT id FROM rate_types WHERE code = CASE WHEN $7::varchar = 'OFFICE' THEN 'OFFICE' ELSE $16 END), $8, $9, $10,
                     CASE WHEN $10::uuid IS NULL THEN NULL ELSE $11::uuid END,
                     CASE WHEN $10::uuid IS NULL THEN NULL ELSE now() END,
                     CASE WHEN $10::uuid IS NULL THEN 'PENDING' ELSE 'ASSIGNED' END,
                     (SELECT case_number FROM cases WHERE id = $1) || '-' || $12::text, $11, $11, $13, $14,
                     -- ADR-0044: explicit target wins; else derive from priority (locked mapping).
                     -- $6::varchar: $6 also feeds the varchar priority col, so the simple-CASE literal
                     -- compare must not re-deduce it as text (else inconsistent types for parameter $6).
                     COALESCE($15::int, CASE $6::varchar
                       WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 8 WHEN 'MEDIUM' THEN 24 WHEN 'LOW' THEN 48
                       ELSE 24 END),
                     $17, $18, $19::jsonb)
             RETURNING id`,
            [
              caseId,
              t.verificationUnitId,
              t.applicantId,
              t.address,
              t.trigger,
              t.priority,
              t.visitType ?? null,
              t.pincodeId ?? null,
              t.areaId ?? null,
              assignee,
              userId,
              seq,
              t.latitude ?? null,
              t.longitude ?? null,
              t.tatHours ?? null,
              fieldRateType,
              t.documentNumber ?? null,
              t.documentHolderName ?? null,
              t.documentDetails ? JSON.stringify(t.documentDetails) : null,
            ],
          );
          // Append-only assignment history for a task assigned at creation (first event = ASSIGNED).
          if (assignee && inserted) {
            await q(
              `INSERT INTO task_assignment_history
                 (task_id, case_id, action, assigned_to, previous_assigned_to, visit_type, assigned_by)
               VALUES ($1, $2, 'ASSIGNED', $3, NULL, $4, $5)`,
              [inserted.id, caseId, assignee, t.visitType ?? null, userId],
            );
          }
        }
        // ADR-0032: the single case-status writer. Rolls NEW→IN_PROGRESS on the first task, and
        // re-opens a COMPLETED case (→IN_PROGRESS, verdict invalidated) when a revisit/recheck lands.
        await recomputeCaseStatus(q, caseId, userId);
        return q<CaseTaskView>(TASK_VIEW_BY_CASE, [caseId]);
      });
    } catch (e) {
      // Two concurrent add-tasks on one just-created case can read the same count → the
      // uq_case_task_number UNIQUE catches the collision (no corruption); surface a retryable 409.
      if (pgCode(e) === UNIQUE_VIOLATION) throw AppError.conflict('TASK_NUMBER_CONFLICT');
      if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
      throw e;
    }
  },

  async list(o: CaseListOptions): Promise<{ items: CaseView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.status) {
      params.push(o.status);
      where.push(`cs.status = $${params.length}`);
    }
    if (o.clientId !== undefined) {
      params.push(o.clientId);
      where.push(`cs.client_id = $${params.length}`);
    }
    if (o.productId !== undefined) {
      params.push(o.productId);
      where.push(`cs.product_id = $${params.length}`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`(pa.name ILIKE $${params.length} OR cs.case_number ILIKE $${params.length})`);
    }
    // Per-column filters (§6/§7/§8) combine with AND; whitelisted to cs/pa columns (in the count FROM).
    where.push(...filterClauses(o.columnFilters ?? [], params));
    // Data scope (Epic F): hierarchy (created/assigned) OR field territory. Correlated EXISTS → no row
    // multiplication (safe in the COUNT too). Empty for SUPER_ADMIN.
    const scopePred = caseScopePredicate(params, o.scope);
    if (scopePred) where.push(scopePred);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // COUNT only needs the cases + primary-applicant join (search references pa.name);
    // one primary per case (partial-unique) so the LEFT JOIN never multiplies rows.
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM cases cs LEFT JOIN case_applicants pa ON pa.case_id = cs.id AND pa.is_primary ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<CaseView>(
      `${CASE_VIEW_SELECT} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, cs.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** Data scope (Epic F): an out-of-scope case resolves to null → the service maps it to 404, so a
   *  case id outside the actor's hierarchy is indistinguishable from a non-existent one (IDOR-safe). */
  async findById(id: string, scope?: Scope): Promise<CaseDetail | null> {
    const headParams: unknown[] = [id];
    const scopePred = caseScopePredicate(headParams, scope);
    const scopeClause = scopePred ? `AND ${scopePred}` : '';
    const rows = await query<CaseView>(`${CASE_VIEW_SELECT} WHERE cs.id = $1 ${scopeClause}`, headParams);
    const head = rows[0];
    if (!head) return null;
    const applicants = await query<CaseApplicant>(
      `SELECT id, case_id, name, mobile, pan, company_name, applicant_type, is_primary, calling_code, created_at,
              dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers
       FROM case_applicants WHERE case_id = $1 ORDER BY is_primary DESC, created_at`,
      [id],
    );
    const tasks = await query<CaseTaskView>(TASK_VIEW_BY_CASE, [id]);
    return { ...head, applicants, tasks };
  },

  /**
   * Executives eligible for assignment within the actor's hierarchy scope (ADR-0022): the worker
   * POOL is data-driven — users whose role is some unit's `worker_role` (admin-extensible via the
   * roles catalog + the unit registry, no role names in code). The actor's visibility comes from
   * their role's hierarchy mode: ALL → whole pool · SUBTREE/DIRECT_TEAM → their subtree ∩ pool ·
   * SELF → themselves ∩ pool (reachability is separately gated by the case.assign permission).
   */
  async assignableUsers(actor: Actor): Promise<AssignableUser[]> {
    // Only USABLE users are assignable (active AND in effect — ADR-0017).
    const base = `SELECT id, username, name, role FROM users
                  WHERE is_active AND effective_from <= now()
                    AND role IN (SELECT DISTINCT worker_role FROM verification_units WHERE is_active)`;
    const ids = await getScopedUserIds(actor);
    if (ids === undefined) return query<AssignableUser>(`${base} ORDER BY name`, []);
    return query<AssignableUser>(`${base} AND id = ANY($1::uuid[]) ORDER BY name`, [ids]);
  },

  /**
   * The eligible pool for a NOT-yet-created task (ADR-0024) — the operator picks the pool by visit
   * type, so the role is resolved from the `assignment_pool_roles` mapping (data, no role literal):
   *  1. USABLE user, 2. role = the pool role for `visitType`,
   *  3. FIELD: the user holds an ACTIVE territory assignment matching the picked area/pincode (id-equality,
   *     the same shape as the visibility engine's geo legs); OFFICE (ADR-0073): the user is GRANTED the
   *     task's verification unit (`user_kyc_unit_access`) — desk work has no territory but is unit-gated.
   *  ADR-0078: the assignee pool is NOT capped by the actor's org-hierarchy — the territory (FIELD) /
   *  unit grant (OFFICE) IS the access control for WHO can work the task. The actor still needs
   *  case.assign + (for writes) case visibility; that gates which cases the actor touches, not the pool.
   */
  async eligibleAssigneesForNew(
    visitType: string,
    pincodeId: number | undefined,
    areaId: number | undefined,
    verificationUnitId: number | undefined,
  ): Promise<AssignableUser[]> {
    const params: unknown[] = [visitType, areaId ?? null, pincodeId ?? null, verificationUnitId ?? null];
    return query<AssignableUser>(
      `SELECT u.id, u.username, u.name, u.role
       FROM users u
       WHERE u.is_active AND u.effective_from <= now()
         AND u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = $1)
         AND CASE WHEN $1 = 'OFFICE'
           -- ADR-0073: OFFICE assignable only to a KYC user GRANTED the task's unit ($4).
           THEN EXISTS (
             SELECT 1 FROM user_kyc_unit_access k
             WHERE k.user_id = u.id AND k.verification_unit_id = $4 AND k.is_active
           )
           ELSE EXISTS (
             SELECT 1 FROM user_scope_assignments usa
             WHERE usa.user_id = u.id AND usa.is_active
               AND ((usa.dimension_code = 'AREA' AND usa.entity_id = $2)
                 OR (usa.dimension_code = 'PINCODE' AND usa.entity_id = $3))
           )
         END
       ORDER BY u.name`,
      params,
    );
  },

  /** Scoped task lookup before an assignment write: out-of-scope ≡ missing (null → 404, IDOR-safe —
   *  the same TASK-grain predicate as the Pipeline list, so write reachability ≡ list visibility). */
  async taskAssignmentState(
    caseId: string,
    taskId: string,
    scope?: Scope,
  ): Promise<{
    status: string;
    assignedTo: string | null;
    assignedBy: string | null;
    version: number;
  } | null> {
    const params: unknown[] = [taskId, caseId];
    const scopePred = taskScopePredicate(params, scope);
    const rows = await query<{
      status: string;
      assignedTo: string | null;
      assignedBy: string | null;
      version: number;
    }>(
      `SELECT ct.status, ct.assigned_to, ct.assigned_by, ct.version
       FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
       WHERE ct.id = $1 AND ct.case_id = $2 ${scopePred ? `AND ${scopePred}` : ''}`,
      params,
    );
    return rows[0] ?? null;
  },

  /** OCC-guarded assign (CONCURRENCY standard): applies only at `expectedVersion` (0 rows → 404 or
   *  409 STALE_UPDATE w/ current) + appends the task_assignment_history event in the SAME tx
   *  (ASSIGNED when previously unassigned, REASSIGNED otherwise — history is never overwritten). */
  async assignTask(
    caseId: string,
    taskId: string,
    input: AssignTaskInput,
    actorId: string,
    expectedVersion: number,
  ): Promise<CaseTaskView> {
    try {
      return await withTransaction(async (q) => {
        // ADR-0056: derive the FIELD trip band from the assignee's commission at the task location when the
        // client didn't supply one (the web never does); block if none. Covers single assign AND bulk-assign
        // (which calls this method). An explicit value is honored. OFFICE → SQL CASE stamps 'OFFICE'.
        let fieldRateType: string | null = input.fieldRateType ?? null;
        if (input.visitType === 'FIELD' && !fieldRateType) {
          fieldRateType = await deriveFieldRateTypeForTask(q, caseId, taskId, input.assignedTo);
          if (!fieldRateType)
            throw AppError.badRequest('NO_FIELD_COMMISSION', { assigneeId: input.assignedTo });
        }
        const [updated] = await q<{ id: string; previousAssignedTo: string | null }>(
          `UPDATE case_tasks
           SET assigned_to = $3, status = 'ASSIGNED', visit_type = $4,
               -- ADR-0050/0068: OFFICE auto-stamps 'OFFICE' (desk work has no LOCAL/OGL); FIELD uses $5.
               -- The code resolves to rate_types.id (NULL code → NULL id).
               -- $4::varchar: $4 also feeds the varchar visit_type col, so the literal compare must
               -- not re-deduce it as text (else inconsistent types for parameter $4).
               rate_type_id = (SELECT id FROM rate_types WHERE code = CASE WHEN $4::varchar = 'OFFICE' THEN 'OFFICE' ELSE $5 END),
               bill_count = $6, assigned_by = $7, assigned_at = now(),
               version = version + 1, updated_by = $7, updated_at = now()
           FROM (SELECT id, assigned_to AS prev FROM case_tasks WHERE id = $1 AND case_id = $2) p
           WHERE case_tasks.id = p.id AND case_tasks.version = $8
           RETURNING case_tasks.id, p.prev AS previous_assigned_to`,
          [
            taskId,
            caseId,
            input.assignedTo,
            input.visitType,
            fieldRateType,
            input.billCount,
            actorId,
            expectedVersion,
          ],
        );
        if (!updated) {
          const [current] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
          if (!current || current.caseId !== caseId) throw AppError.notFound('TASK_NOT_FOUND');
          throw AppError.stale(current);
        }
        await q(
          `INSERT INTO task_assignment_history
             (task_id, case_id, action, assigned_to, previous_assigned_to,
              visit_type, field_rate_type, bill_count, assigned_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            taskId,
            caseId,
            updated.previousAssignedTo === null ? 'ASSIGNED' : 'REASSIGNED',
            input.assignedTo,
            updated.previousAssignedTo,
            input.visitType,
            fieldRateType,
            input.billCount,
            actorId,
          ],
        );
        await recomputeCaseStatus(q, caseId, actorId); // re-open invalidation if case was COMPLETED
        const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!row) throw AppError.internal('assign returned no row');
        return row;
      });
    } catch (e) {
      if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_ASSIGNEE');
      throw e;
    }
  },

  /** A2026-0623-16: a task's required-vs-attached document count, for the completion gate. requiredDocs
   *  = the largest `min` across its unit's required_attachments DOCUMENT entries (0 ⇒ no requirement, e.g.
   *  every FIELD_VISIT unit, whose required_attachments is []); attachedDocs = its non-deleted office
   *  reference docs (kind='OFFICE_REF', i.e. the KYC documents). */
  async taskDocumentRequirement(taskId: string): Promise<{ requiredDocs: number; attachedDocs: number }> {
    const [row] = await query<{ requiredDocs: number; attachedDocs: number }>(
      `SELECT
         COALESCE((SELECT max((e->>'min')::int)
                     FROM jsonb_array_elements(vu.required_attachments) e
                    WHERE e->>'type' = 'DOCUMENT'), 0) AS required_docs,
         (SELECT count(*)::int FROM case_attachments ca
            WHERE ca.task_id = ct.id AND ca.kind = 'OFFICE_REF' AND ca.deleted_at IS NULL) AS attached_docs
       FROM case_tasks ct JOIN verification_units vu ON vu.id = ct.verification_unit_id
       WHERE ct.id = $1`,
      [taskId],
    );
    return row ?? { requiredDocs: 0, attachedDocs: 0 };
  },

  /** OCC-guarded finalize (ADR-0025): records the official result + remark and moves the task to
   *  COMPLETED. The service has already scope-checked the task and validated the source-status
   *  transition; the version guard catches a concurrent writer (every status writer bumps version),
   *  so a 0-row update is a true stale/missing case. Writes an append-only audit row in the same tx. */
  async completeTask(
    caseId: string,
    taskId: string,
    input: CompleteTaskInput,
    actorId: string,
    expectedVersion: number,
  ): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE case_tasks
         SET status = 'COMPLETED', verification_outcome = $3, remark = $4,
             completed_by = $5, completed_at = now(),
             completed_elapsed_minutes = CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(assigned_at, created_at))) / 60)::int,
             version = version + 1, updated_by = $5, updated_at = now()
         WHERE id = $1 AND case_id = $2 AND version = $6
         RETURNING id`,
        [taskId, caseId, input.result, input.remark, actorId, expectedVersion],
      );
      if (!updated) {
        const [current] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!current || current.caseId !== caseId) throw AppError.notFound('TASK_NOT_FOUND');
        throw AppError.stale(current);
      }
      await stampCommissionSnapshot(q, taskId);
      await appendAudit(
        {
          entityType: 'case_task',
          entityId: taskId,
          action: 'UPDATE',
          actorId,
          after: { status: 'COMPLETED', verificationOutcome: input.result, remark: input.remark },
        },
        q,
      );
      // ADR-0032: a task COMPLETED may push the case to AWAITING_COMPLETION (all tasks done).
      await recomputeCaseStatus(q, caseId, actorId);
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('complete returned no row');
      return row;
    });
  },

  /** Scope-guarded case state for the finalize pre-check (status + OCC version). Out-of-scope or
   *  missing → null (the service maps to 404, IDOR-safe — same as taskAssignmentState). */
  async caseFinalizeState(
    caseId: string,
    scope: Scope | undefined,
  ): Promise<{ status: string; version: number } | null> {
    const params: unknown[] = [caseId];
    const pred = caseScopePredicate(params, scope);
    const where = pred ? `cs.id = $1 AND (${pred})` : `cs.id = $1`;
    const [row] = await query<{ status: string; version: number }>(
      `SELECT cs.status, cs.version FROM cases cs WHERE ${where}`,
      params,
    );
    return row ?? null;
  },

  /** OCC-guarded case finalize (ADR-0032): records the ONE final verdict + optional remark and
   *  closes the case (AWAITING_COMPLETION → COMPLETED). The service has scope-checked + transition-
   *  checked; the version guard catches a concurrent writer (rollup + finalize both bump version),
   *  so a 0-row update is a true stale/wrong-status case. Appends an audit row in the same tx. */
  async finalizeCase(
    caseId: string,
    outcome: string,
    remark: string | null,
    actorId: string,
    expectedVersion: number,
  ): Promise<void> {
    await withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE cases
           SET status = 'COMPLETED', verification_outcome = $2, result_remark = $3,
               completed_by = $4, completed_at = now(),
               version = version + 1, updated_by = $4, updated_at = now()
         WHERE id = $1 AND version = $5 AND status = 'AWAITING_COMPLETION'
         RETURNING id`,
        [caseId, outcome, remark, actorId, expectedVersion],
      );
      if (!updated) {
        const [cur] = await q<{ status: string; version: number }>(
          `SELECT status, version FROM cases WHERE id = $1`,
          [caseId],
        );
        if (!cur) throw AppError.notFound('CASE_NOT_FOUND');
        if (cur.status !== 'AWAITING_COMPLETION') throw AppError.conflict('INVALID_TRANSITION');
        throw AppError.stale(cur); // version mismatch
      }
      await appendAudit(
        {
          entityType: 'case',
          entityId: caseId,
          action: 'UPDATE',
          actorId,
          after: { status: 'COMPLETED', verificationOutcome: outcome, resultRemark: remark },
        },
        q,
      );
    });
  },

  /** Record the per-task office RESULT on an already-COMPLETED task (ADR-0032 D3) — the field task
   *  was completed by the device with no result; the office now records its official outcome. Status
   *  stays COMPLETED (no rollup; the case is already AWAITING_COMPLETION). completed_by becomes the
   *  office resulter; completed_at (the field-completion time) is preserved. OCC-guarded; audited. */
  async recordTaskResult(
    caseId: string,
    taskId: string,
    result: string,
    remark: string | null,
    actorId: string,
    expectedVersion: number,
  ): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE case_tasks
           SET verification_outcome = $3, remark = $4, completed_by = $5,
               version = version + 1, updated_by = $5, updated_at = now()
         WHERE id = $1 AND case_id = $2 AND version = $6 AND status = 'COMPLETED'
         RETURNING id`,
        [taskId, caseId, result, remark, actorId, expectedVersion],
      );
      if (!updated) {
        const [cur] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!cur || cur.caseId !== caseId) throw AppError.notFound('TASK_NOT_FOUND');
        if (cur.status !== 'COMPLETED') throw AppError.conflict('INVALID_TRANSITION');
        throw AppError.stale(cur); // version mismatch
      }
      await appendAudit(
        {
          entityType: 'case_task',
          entityId: taskId,
          action: 'UPDATE',
          actorId,
          after: { verificationOutcome: result, remark },
        },
        q,
      );
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('record result returned no row');
      return row;
    });
  },

  /** Case verdict history (ADR-0033): every `finalize` of the case, newest first, from the append-only
   *  audit log. A revisit re-opens the case + the office re-finalizes, so the history shows the
   *  before/after verdict. Only finalize rows carry `after_data.verificationOutcome` (the rollup writes
   *  no audit row; CREATE has a null outcome) → that key being non-null is the exact filter. The case
   *  is already visibility-checked by the service (one case → no per-row scope needed). */
  async verdictHistory(caseId: string): Promise<CaseVerdictEvent[]> {
    return query<CaseVerdictEvent>(
      `SELECT a.after_data->>'verificationOutcome' AS result,
              a.after_data->>'resultRemark'        AS remark,
              a.created_at                          AS at,
              u.name                                AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON u.id::text = a.actor_id
       WHERE a.entity_type = 'case' AND a.entity_id = $1
         AND a.after_data->>'verificationOutcome' IS NOT NULL
       ORDER BY a.created_at DESC, a.id DESC`,
      [caseId],
    );
  },

  // ── Office task intervention: revisit / reassign-after-revoke (ADR-0033, ADR-0032 slice 3) ──

  /** True when an OPEN revisit of this parent already exists — blocks a duplicate follow-up (and the
   *  double-bill it would cause) until the first revisit is completed or revoked. */
  async hasActiveRevisitOf(parentTaskId: string): Promise<boolean> {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM case_tasks
        WHERE parent_task_id = $1 AND task_origin = 'REVISIT'
          AND status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS')`,
      [parentTaskId],
    );
    return (rows[0]?.n ?? 0) > 0;
  },

  /** REVISIT a COMPLETED task (ADR-0033): the client asked for more after delivery → a NEW task that
   *  CLONES the parent's targeting (CPV + applicant + address + trigger + priority + visit type +
   *  location), born PENDING (the office dispatches it via the normal assign flow), linked via
   *  parent_task_id + task_origin='REVISIT' (billed separately, slice 5). Re-opens the case
   *  (→ IN_PROGRESS) + invalidates the stale verdict through the SINGLE rollup writer. The service has
   *  scope- + status-guarded the parent (COMPLETED). Rework is ALWAYS a new task, never an in-place
   *  re-open of a delivered one (mobile landmine #2 — the device purges a re-activated task's work). */
  async revisitTask(
    caseId: string,
    parentTaskId: string,
    actorId: string,
    reason: string | null,
  ): Promise<CaseTaskView> {
    try {
      return await withTransaction(async (q) => {
        // Per-case task-number ordinal continues from existing tasks (UNIQUE (case_id, task_number)).
        const [seqRow] = await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM case_tasks WHERE case_id = $1`,
          [caseId],
        );
        const seq = (seqRow?.n ?? 0) + 1;
        const [inserted] = await q<{ id: string }>(
          `INSERT INTO case_tasks
             (case_id, verification_unit_id, applicant_id, address, trigger, priority,
              visit_type, pincode_id, area_id, status, tat_hours,
              task_number, parent_task_id, task_origin, created_by, updated_by,
              document_number, document_holder_name, document_details)
           -- Re-work gets a FRESH full TAT window (owner 2026-07-15). Omitting tat_hours here left it
           -- NULL (no column DEFAULT), which made every revisit invisible to Out-of-TAT forever.
           SELECT p.case_id, p.verification_unit_id, p.applicant_id, p.address, p.trigger, p.priority,
                  p.visit_type, p.pincode_id, p.area_id, 'PENDING', ${REWORK_TAT_HOURS},
                  (SELECT case_number FROM cases WHERE id = $1) || '-' || $3::text,
                  p.id, 'REVISIT', $4, $4,
                  p.document_number, p.document_holder_name, p.document_details
           FROM case_tasks p
           WHERE p.id = $2 AND p.case_id = $1
           RETURNING id`,
          [caseId, parentTaskId, seq, actorId],
        );
        if (!inserted) throw AppError.notFound('TASK_NOT_FOUND');
        await appendAudit(
          {
            entityType: 'case_task',
            entityId: inserted.id,
            action: 'CREATE',
            actorId,
            after: { taskOrigin: 'REVISIT', parentTaskId, reason },
          },
          q,
        );
        await recomputeCaseStatus(q, caseId, actorId);
        const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [inserted.id]);
        if (!row) throw AppError.internal('revisit returned no row');
        return row;
      });
    } catch (e) {
      if (pgCode(e) === UNIQUE_VIOLATION) {
        // The active-revisit partial-unique index is the race backstop for the service pre-check —
        // a concurrent second revisit of the same parent loses here (no double-bill). The task-number
        // UNIQUE is the other collision (a concurrent add-tasks sharing the seq) → retryable.
        if (pgConstraint(e) === ACTIVE_REVISIT_INDEX) throw AppError.conflict('ACTIVE_REVISIT_EXISTS');
        throw AppError.conflict('TASK_NUMBER_CONFLICT');
      }
      throw e;
    }
  },

  /** REASSIGN-AFTER-REVOKE (ADR-0033): a field user REVOKED their task; the office dispatches a
   *  REPLACEMENT — a NEW task cloning the revoked task's CPV + applicant + address + trigger, born
   *  ASSIGNED to the chosen executive with the operator's re-picked pool/territory/bill, linked via
   *  parent_task_id and KEEPING the parent's task_origin (NO extra commission — it is the redo of
   *  revoked work, not additional scope). Records the first ASSIGNED history event (previous_assigned_to
   *  = the revoked assignee). Re-opens the case via the rollup. The service has scope-guarded the parent
   *  (REVOKED) + eligibility-checked the assignee. */
  async reassignRevokedTask(
    caseId: string,
    revokedTaskId: string,
    input: ReassignTaskInput,
    actorId: string,
  ): Promise<CaseTaskView> {
    try {
      return await withTransaction(async (q) => {
        const [parent] = await q<{ id: string; assignedTo: string | null }>(
          `SELECT id, assigned_to FROM case_tasks WHERE id = $1 AND case_id = $2`,
          [revokedTaskId, caseId],
        );
        if (!parent) throw AppError.notFound('TASK_NOT_FOUND');
        // ADR-0056: derive the FIELD trip band from the assignee's commission at the (revoked) task's
        // location when the client didn't supply one; block if none. An explicit value is honored.
        let fieldRateType: string | null = input.fieldRateType ?? null;
        if (input.visitType === 'FIELD' && !fieldRateType) {
          fieldRateType = await deriveFieldRateTypeForTask(q, caseId, revokedTaskId, input.assignedTo);
          if (!fieldRateType)
            throw AppError.badRequest('NO_FIELD_COMMISSION', { assigneeId: input.assignedTo });
        }
        const [seqRow] = await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM case_tasks WHERE case_id = $1`,
          [caseId],
        );
        const seq = (seqRow?.n ?? 0) + 1;
        const [inserted] = await q<{ id: string }>(
          `INSERT INTO case_tasks
             (case_id, verification_unit_id, applicant_id, address, trigger, priority,
              visit_type, pincode_id, area_id, rate_type_id, bill_count, assigned_to,
              assigned_by, assigned_at, status, tat_hours,
              task_number, parent_task_id, task_origin, created_by, updated_by,
              document_number, document_holder_name, document_details)
           SELECT p.case_id, p.verification_unit_id, p.applicant_id, p.address, p.trigger, p.priority,
                  -- ADR-0050/0068: a reassigned OFFICE task also auto-stamps 'OFFICE' (else its desk
                  -- commission can't resolve); the code resolves to rate_types.id (NULL code → NULL id).
                  -- $3::varchar guards the SELECT-list/compare reuse.
                  $3, p.pincode_id, p.area_id, (SELECT id FROM rate_types WHERE code = CASE WHEN $3::varchar = 'OFFICE' THEN 'OFFICE' ELSE $4 END), $5, $6,
                  -- Fresh full TAT window on the replacement (owner 2026-07-15); the clock starts now().
                  $7, now(), 'ASSIGNED', ${REWORK_TAT_HOURS},
                  (SELECT case_number FROM cases WHERE id = $1) || '-' || $8::text,
                  p.id, p.task_origin, $7, $7,
                  p.document_number, p.document_holder_name, p.document_details
           FROM case_tasks p
           WHERE p.id = $2 AND p.case_id = $1
           RETURNING id`,
          [
            caseId,
            revokedTaskId,
            input.visitType,
            fieldRateType,
            input.billCount,
            input.assignedTo,
            actorId,
            seq,
          ],
        );
        if (!inserted) throw AppError.notFound('TASK_NOT_FOUND');
        await q(
          `INSERT INTO task_assignment_history
             (task_id, case_id, action, assigned_to, previous_assigned_to,
              visit_type, field_rate_type, bill_count, assigned_by)
           VALUES ($1, $2, 'ASSIGNED', $3, $4, $5, $6, $7, $8)`,
          [
            inserted.id,
            caseId,
            input.assignedTo,
            parent.assignedTo,
            input.visitType,
            fieldRateType,
            input.billCount,
            actorId,
          ],
        );
        await appendAudit(
          {
            entityType: 'case_task',
            entityId: inserted.id,
            action: 'CREATE',
            actorId,
            after: {
              parentTaskId: revokedTaskId,
              reassignedFrom: revokedTaskId,
              assignedTo: input.assignedTo,
              reason: input.reason ?? null,
            },
          },
          q,
        );
        await recomputeCaseStatus(q, caseId, actorId);
        const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [inserted.id]);
        if (!row) throw AppError.internal('reassign returned no row');
        return row;
      });
    } catch (e) {
      if (pgCode(e) === UNIQUE_VIOLATION) throw AppError.conflict('TASK_NUMBER_CONFLICT');
      if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_ASSIGNEE');
      throw e;
    }
  },

  // ── Field execution: device-driven task lifecycle (ADR-0032 slice 2c) ──

  /** The task IFF it is assigned to this actor (the device only ever acts on its own work). Returns
   *  null otherwise → the service maps to 404 (IDOR-safe; ownership is enforced here, not just the
   *  `task.execute` perm). The contract `:id` is the task UUID. */
  async taskForAssignee(taskId: string, actorId: string): Promise<{ caseId: string; status: string } | null> {
    const [row] = await query<{ caseId: string; status: string }>(
      `SELECT case_id, status FROM case_tasks WHERE id = $1 AND assigned_to = $2::uuid`,
      [taskId, actorId],
    );
    return row ?? null;
  },

  /** Read-only CaseTaskView by id — the caller has already established ownership/access. Used by the
   *  device priority ack (a numeric drag-reorder returns the current view without a write). */
  async caseTaskViewById(taskId: string): Promise<CaseTaskView> {
    const [row] = await query<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
    if (!row) throw AppError.notFound('TASK_NOT_FOUND');
    return row;
  },

  /**
   * Device status writers (ADR-0032). Idempotent by state (the device retries with an
   * Idempotency-Key but sends no OCC version — it doesn't track case_tasks.version): a transition
   * already satisfied returns the current row (the caller's 200), an illegal one throws 409
   * INVALID_TRANSITION (the device treats 409 as success on start/complete/revoke). Each bumps
   * version (web OCC) and, when the case bucket can change (complete/revoke), runs the rollup.
   */
  async startTaskByDevice(caseId: string, taskId: string, actorId: string): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE case_tasks
           SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, now()),
               version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND case_id = $2 AND status = 'ASSIGNED'
         RETURNING id`,
        [taskId, caseId, actorId],
      );
      if (!updated) {
        const [cur] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!cur) throw AppError.notFound('TASK_NOT_FOUND');
        if (cur.status !== 'IN_PROGRESS') throw AppError.conflict('INVALID_TRANSITION'); // idempotent only from IN_PROGRESS
        return cur;
      }
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('start returned no row');
      return row; // ASSIGNED→IN_PROGRESS keeps the case active → no rollup needed
    });
  },

  /** Device submit (ADR-0047): {ASSIGNED,IN_PROGRESS}→SUBMITTED — the field executive's terminal. Field
   *  records NO result (single-layer, ADR-0032 D1) — verification_outcome stays null; the office records
   *  the per-task result at COMPLETE. Stamps submitted_at + submitted_elapsed_minutes and FREEZES the
   *  field commission here (stampCommissionSnapshot, first-stamp-wins). Rolls the case up — SUBMITTED is
   *  active, so the case stays IN_PROGRESS until the office completes every task. */
  async submitTaskByDevice(caseId: string, taskId: string, actorId: string): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE case_tasks
           SET status = 'SUBMITTED', submitted_at = now(),
               submitted_elapsed_minutes = CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(assigned_at, created_at))) / 60)::int,
               version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND case_id = $2 AND status IN ('ASSIGNED', 'IN_PROGRESS')
         RETURNING id`,
        [taskId, caseId, actorId],
      );
      if (!updated) {
        const [cur] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!cur) throw AppError.notFound('TASK_NOT_FOUND');
        if (cur.status !== 'SUBMITTED') throw AppError.conflict('INVALID_TRANSITION');
        return cur; // idempotent re-submit
      }
      await stampCommissionSnapshot(q, taskId); // freeze the field commission as-of submit
      await appendAudit(
        {
          entityType: 'case_task',
          entityId: taskId,
          action: 'UPDATE',
          actorId,
          after: { status: 'SUBMITTED' },
        },
        q,
      );
      await recomputeCaseStatus(q, caseId, actorId);
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('device submit returned no row');
      return row;
    });
  },

  /** Revoke a task IN PLACE: {ASSIGNED,IN_PROGRESS}→REVOKED (the reason replaces the remark). SHARED
   *  by the device revoke (slice 2c-1, ownership-bound) and the office/backend revoke (ADR-0033, v1
   *  parity, scope-bound) — the DB transition is identical, only the caller's auth differs. A COMPLETED
   *  task cannot be revoked (COMPLETED→REVOKED forbidden; → 409); a PENDING task isn't revocable here
   *  (use unassign); an already-REVOKED task is idempotent. The last assignee is KEPT on the REVOKED row
   *  (v2 lineage — reassign-after-revoke reads it; v1 nulled it). No commission. Rolls the case up. */
  async revokeTaskInPlace(
    caseId: string,
    taskId: string,
    actorId: string,
    reason: string,
  ): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        // revoked_at (mig 0119) ends the agent's hold — with assigned_at it yields how long he actually
        // held the task. COALESCE keeps the first revoke's stamp if this ever re-runs (the guard above
        // makes a real re-revoke idempotent, so this is belt-and-braces on a money-adjacent audit fact).
        `UPDATE case_tasks
           SET status = 'REVOKED', remark = $4, version = version + 1, updated_by = $3, updated_at = now(),
               revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1 AND case_id = $2 AND status IN ('ASSIGNED', 'IN_PROGRESS')
         RETURNING id`,
        [taskId, caseId, actorId, reason],
      );
      if (!updated) {
        const [cur] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!cur) throw AppError.notFound('TASK_NOT_FOUND');
        if (cur.status !== 'REVOKED') throw AppError.conflict('INVALID_TRANSITION');
        return cur; // idempotent re-revoke
      }
      await appendAudit(
        {
          entityType: 'case_task',
          entityId: taskId,
          action: 'UPDATE',
          actorId,
          after: { status: 'REVOKED', reason },
        },
        q,
      );
      await recomputeCaseStatus(q, caseId, actorId);
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('revoke returned no row');
      return row;
    });
  },

  /** Device form-submit (ADR-0032 slice 2c-2b): persist the submitted verification form under
   *  `form_data[<formType>]` (EVIDENCE only — the device's `verificationOutcome` rides along in the
   *  blob but is NOT the official result; D1 single-layer). Idempotent (resubmit overwrites the slug
   *  key — the device retries on any non-2xx). Allowed while the task is non-terminal OR already
   *  COMPLETED (the form upload can arrive after `complete`, queued separately); REVOKED/CANCELLED →
   *  409. Status is unchanged (submit ≠ complete); no rollup. */
  async submitVerificationForm(
    caseId: string,
    taskId: string,
    actorId: string,
    formType: string,
    formData: string,
  ): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE case_tasks
           SET form_data = jsonb_set(COALESCE(form_data, '{}'::jsonb), ARRAY[$4], $5::jsonb, true),
               version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND case_id = $2 AND status IN ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED')
         RETURNING id`,
        [taskId, caseId, actorId, formType, formData],
      );
      if (!updated) {
        const [cur] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
        if (!cur || cur.caseId !== caseId) throw AppError.notFound('TASK_NOT_FOUND');
        throw AppError.conflict('INVALID_TRANSITION'); // REVOKED/CANCELLED — can't submit evidence
      }
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('form submit returned no row');
      return row;
    });
  },

  /** Device priority change — metadata only, on a non-terminal task. NOT idempotent-as-success: a
   *  terminal task → 409 INVALID_TRANSITION (the device does NOT treat priority 409 as success). */
  async setTaskPriorityByDevice(
    caseId: string,
    taskId: string,
    actorId: string,
    priority: string,
  ): Promise<CaseTaskView> {
    return withTransaction(async (q) => {
      const [updated] = await q<{ id: string }>(
        `UPDATE case_tasks
           SET priority = $4, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND case_id = $2 AND status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS')
         RETURNING id`,
        [taskId, caseId, actorId, priority],
      );
      if (!updated) throw AppError.conflict('INVALID_TRANSITION');
      const [row] = await q<CaseTaskView>(TASK_VIEW_BY_ID, [taskId]);
      if (!row) throw AppError.internal('priority returned no row');
      return row;
    });
  },

  // ── Reference attachments (ADR-0025 B2) ──

  /** True when the case is visible to the actor (case-scope) — the upload/list/serve gate. */
  async caseVisible(caseId: string, scope: Scope | undefined): Promise<boolean> {
    const params: unknown[] = [caseId];
    const pred = caseScopePredicate(params, scope);
    const rows = await query<{ ok: number }>(
      `SELECT 1 AS ok FROM cases cs WHERE cs.id = $1 ${pred ? `AND ${pred}` : ''}`,
      params,
    );
    return rows.length > 0;
  },

  /** True when `taskId` is a task of `caseId` (validates a task-level upload target). */
  async taskInCase(caseId: string, taskId: string): Promise<boolean> {
    const rows = await query<{ ok: number }>(
      `SELECT 1 AS ok FROM case_tasks WHERE id = $1 AND case_id = $2`,
      [taskId, caseId],
    );
    return rows.length > 0;
  },

  async insertAttachment(
    a: {
      caseId: string;
      taskId: string | null;
      originalName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
      sha256: string;
    },
    userId: string,
  ): Promise<CaseAttachment> {
    const [row] = await query<CaseAttachment>(
      `INSERT INTO case_attachments
         (case_id, task_id, original_name, mime_type, file_size, storage_key, sha256, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, case_id, task_id, original_name, mime_type, file_size,
                 (SELECT name FROM users WHERE id = $8) AS uploaded_by_name, created_at`,
      [a.caseId, a.taskId, a.originalName, a.mimeType, a.fileSize, a.storageKey, a.sha256, userId],
    );
    if (!row) throw AppError.internal('attachment insert returned no row');
    return row;
  },

  // ── Device FIELD-PHOTO attachments (ADR-0034, ADR-0032 slice 2c-2) ──

  /** Insert one device field photo (kind='FIELD_PHOTO') with its evidence + idempotency metadata.
   *  `sha256` is the SERVER hash of the stored (EXIF-stripped) bytes; `clientSha256` the device's
   *  transit hash; `hashVerified` whether the device's hash matched the bytes we received. */
  async insertFieldAttachment(
    a: {
      caseId: string;
      taskId: string;
      originalName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
      thumbnailKey: string | null;
      sha256: string;
      clientSha256: string | null;
      hashVerified: boolean;
      geoLocation: unknown;
      photoType: string;
      submissionId: string | null;
      verificationType: string | null;
      operationId: string;
    },
    userId: string,
  ): Promise<DeviceAttachment> {
    const [row] = await query<DeviceAttachment>(
      `INSERT INTO case_attachments
         (case_id, task_id, kind, original_name, mime_type, file_size, storage_key, thumbnail_key,
          sha256, client_sha256, hash_verified, geo_location, photo_type, submission_id,
          verification_type, operation_id, uploaded_by)
       VALUES ($1, $2, 'FIELD_PHOTO', $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
       RETURNING ${FIELD_ATTACH_COLS}`,
      [
        a.caseId,
        a.taskId,
        a.originalName,
        a.mimeType,
        a.fileSize,
        a.storageKey,
        a.thumbnailKey,
        a.sha256,
        a.clientSha256,
        a.hashVerified,
        a.geoLocation == null ? null : JSON.stringify(a.geoLocation),
        a.photoType,
        a.submissionId,
        a.verificationType,
        a.operationId,
        userId,
      ],
    );
    if (!row) throw AppError.internal('field attachment insert returned no row');
    return row;
  },

  /** All field photos already stored for a device upload (idempotency replay — keyed by the base
   *  operation id, before the per-file `:index` suffix). Empty → first delivery. */
  async fieldAttachmentsByOperation(operationBase: string): Promise<DeviceAttachment[]> {
    return query<DeviceAttachment>(
      `SELECT ${FIELD_ATTACH_COLS} FROM case_attachments
        WHERE kind = 'FIELD_PHOTO' AND deleted_at IS NULL
          AND split_part(operation_id, ':', 1) = $1
        ORDER BY created_at ASC, operation_id ASC`,
      [operationBase],
    );
  },

  /** Case-level (task_id NULL) + task-level attachments the actor can reach (their own assigned/created
   *  tasks — need-to-know per task, mirroring v1). Admins (no scope) see all. Excludes soft-deleted.
   *  Excludes device FIELD_PHOTO rows — those are the field agent's verification photos, surfaced
   *  separately in the Field Photos card (`listFieldPhotos`), not the general attachments list. */
  async listAttachments(caseId: string, scope: Scope | undefined): Promise<CaseAttachment[]> {
    const params: unknown[] = [caseId];
    let taskLeg = '';
    if (scope) {
      const pred = taskScopePredicate(params, scope);
      taskLeg = pred
        ? `AND (ca.task_id IS NULL
                OR EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                           WHERE ct.id = ca.task_id AND ${pred}))`
        : '';
    }
    return query<CaseAttachment>(
      `SELECT ca.id, ca.case_id, ca.task_id, ca.original_name, ca.mime_type, ca.file_size,
              u.name AS uploaded_by_name, ca.created_at
       FROM case_attachments ca
       LEFT JOIN users u ON u.id = ca.uploaded_by
       WHERE ca.case_id = $1 AND ca.deleted_at IS NULL
         AND ca.kind IS DISTINCT FROM 'FIELD_PHOTO' ${taskLeg}
       ORDER BY ca.created_at DESC`,
      params,
    );
  },

  /** Device FIELD-PHOTO attachments for a case (ADR-0034) — the field agent's submitted photos, with
   *  their task's verification unit + photo-type/geo metadata. Scope-guarded (same task-leg as
   *  listAttachments). Images are served via the existing /attachments/:id/url presigned route. */
  async listFieldPhotos(caseId: string, scope: Scope | undefined): Promise<CaseFieldPhoto[]> {
    const params: unknown[] = [caseId];
    let taskLeg = '';
    if (scope) {
      const pred = taskScopePredicate(params, scope);
      taskLeg = pred
        ? `AND EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                       WHERE ct.id = ca.task_id AND ${pred})`
        : '';
    }
    return query<CaseFieldPhoto>(
      `SELECT ca.id, ca.task_id AS "taskId", vu.name AS "unitName", ca.photo_type AS "photoType",
              ca.original_name AS "originalName", ca.geo_location AS "geoLocation",
              ca.reverse_geocoded_address AS "reverseGeocodedAddress", ca.created_at AS "createdAt"
       FROM case_attachments ca
       LEFT JOIN case_tasks ct ON ct.id = ca.task_id
       LEFT JOIN verification_units vu ON vu.id = ct.verification_unit_id
       WHERE ca.case_id = $1 AND ca.kind = 'FIELD_PHOTO' AND ca.deleted_at IS NULL ${taskLeg}
       ORDER BY ca.created_at DESC`,
      params,
    );
  },

  /** Every field photo of a case as a downloadable FILE row (storage key + naming inputs), with a
   *  STABLE 1-based per-case `seq` (ROW_NUMBER over the scope-visible set, ordered created_at,id). The
   *  zip endpoint streams all of them; the single-photo download `.find`s its row in the SAME list, so
   *  both resolve to an identical filename (ADR-0060). Scope-guarded via the same task-leg as
   *  listFieldPhotos (out-of-scope photos are excluded AND don't consume a seq). */
  async listFieldPhotoFiles(caseId: string, scope: Scope | undefined): Promise<FieldPhotoFile[]> {
    const params: unknown[] = [caseId];
    let taskLeg = '';
    if (scope) {
      const pred = taskScopePredicate(params, scope);
      taskLeg = pred
        ? `AND EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                       WHERE ct.id = ca.task_id AND ${pred})`
        : '';
    }
    return query<FieldPhotoFile>(
      `WITH visible AS (
         SELECT ca.id, ca.storage_key AS "storageKey", ca.original_name AS "originalName",
                ca.mime_type AS "mimeType", ca.photo_type AS "photoType",
                csm.case_number AS "caseNumber", ctm.task_number AS "taskNumber", ca.created_at,
                ca.geo_location AS "geoLocation", ca.reverse_geocoded_address AS "reverseGeocodedAddress",
                vu.name AS "unitName"
         FROM case_attachments ca
           JOIN cases csm ON csm.id = ca.case_id
           LEFT JOIN case_tasks ctm ON ctm.id = ca.task_id
           LEFT JOIN verification_units vu ON vu.id = ctm.verification_unit_id
         WHERE ca.case_id = $1 AND ca.kind = 'FIELD_PHOTO' AND ca.deleted_at IS NULL ${taskLeg}
       )
       SELECT id, "storageKey", "originalName", "mimeType", "photoType", "caseNumber", "taskNumber",
              "geoLocation", "reverseGeocodedAddress", "unitName",
              (ROW_NUMBER() OVER (ORDER BY created_at, id))::int AS seq
       FROM visible
       ORDER BY seq`,
      params,
    );
  },

  /** Reference attachments the field device shows for an OWNED task (mobile parity): the case-level
   *  docs (task_id NULL) + this task's docs, scoped by ownership (ct.assigned_to = device user). The
   *  caller has already established ownership; the assigned_to filter is belt-and-braces.
   *  OFFICE_REF only — the agent's own FIELD_PHOTO rows must never appear in the Attachments list
   *  (attachment ⟂ photo invariant; CASE-000024 leak, 2026-07-03). */
  async attachmentsForDeviceTask(
    taskId: string,
    userId: string,
  ): Promise<
    {
      id: string;
      originalName: string;
      mimeType: string;
      fileSize: number;
      createdAt: string;
      storageKey: string;
    }[]
  > {
    return query<{
      id: string;
      originalName: string;
      mimeType: string;
      fileSize: number;
      createdAt: string;
      storageKey: string;
    }>(
      `SELECT ca.id, ca.original_name, ca.mime_type, ca.file_size, ca.created_at, ca.storage_key
       FROM case_attachments ca
       JOIN case_tasks ct ON ct.case_id = ca.case_id
       WHERE ct.id = $1 AND ct.assigned_to = $2 AND ca.deleted_at IS NULL
         AND ca.kind = 'OFFICE_REF'
         AND (ca.task_id IS NULL OR ca.task_id = ct.id)
       ORDER BY ca.created_at DESC`,
      [taskId, userId],
    );
  },

  /** ONE office reference doc from the device list above (same visibility: owned task, OFFICE_REF,
   *  case-level or this task) — for the device's authenticated content download. Null → 404, IDOR-safe. */
  async officeRefAttachmentForDeviceTask(
    taskId: string,
    userId: string,
    attachmentId: string,
  ): Promise<{ storageKey: string; originalName: string; mimeType: string } | null> {
    const rows = await query<{ storageKey: string; originalName: string; mimeType: string }>(
      `SELECT ca.storage_key, ca.original_name, ca.mime_type
       FROM case_attachments ca
       JOIN case_tasks ct ON ct.case_id = ca.case_id
       WHERE ca.id = $3 AND ct.id = $1 AND ct.assigned_to = $2 AND ca.deleted_at IS NULL
         AND ca.kind = 'OFFICE_REF'
         AND (ca.task_id IS NULL OR ca.task_id = ct.id)`,
      [taskId, userId, attachmentId],
    );
    return rows[0] ?? null;
  },

  /** ONE of the field agent's OWN field photos on a still-OPEN task — for the device's pre-submit
   *  "delete a bad capture". Returns the object keys to purge, or null (→ 404, IDOR-safe). Restricted
   *  to the actor's assigned task in ASSIGNED/IN_PROGRESS: once SUBMITTED the evidence is frozen. */
  async deletableFieldPhotoForDeviceTask(
    taskId: string,
    userId: string,
    attachmentId: string,
  ): Promise<{ storageKey: string; thumbnailKey: string | null } | null> {
    const rows = await query<{ storageKey: string; thumbnailKey: string | null }>(
      `SELECT ca.storage_key AS "storageKey", ca.thumbnail_key AS "thumbnailKey"
       FROM case_attachments ca
       JOIN case_tasks ct ON ct.id = ca.task_id
       WHERE ca.id = $3 AND ct.id = $1 AND ct.assigned_to = $2 AND ca.deleted_at IS NULL
         AND ca.kind = 'FIELD_PHOTO'
         AND ct.status IN ('ASSIGNED', 'IN_PROGRESS')`,
      [taskId, userId, attachmentId],
    );
    return rows[0] ?? null;
  },

  /** A single attachment the actor can reach (case-level, or a task they can see) — for serve/delete.
   *  Returns the storage key + metadata, or null (→ 404, IDOR-safe). */
  async attachmentForAccess(
    caseId: string,
    attachmentId: string,
    scope: Scope | undefined,
  ): Promise<{ storageKey: string; originalName: string } | null> {
    const params: unknown[] = [attachmentId, caseId];
    let taskLeg = '';
    if (scope) {
      const pred = taskScopePredicate(params, scope);
      taskLeg = pred
        ? `AND (ca.task_id IS NULL
                OR EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                           WHERE ct.id = ca.task_id AND ${pred}))`
        : '';
    }
    const rows = await query<{ storageKey: string; originalName: string }>(
      `SELECT ca.storage_key, ca.original_name
       FROM case_attachments ca
       WHERE ca.id = $1 AND ca.case_id = $2 AND ca.deleted_at IS NULL ${taskLeg}`,
      params,
    );
    return rows[0] ?? null;
  },

  /** Soft-delete (DPDP erasure) — keeps the row, stamps deleted_at. */
  async softDeleteAttachment(attachmentId: string): Promise<void> {
    await query(`UPDATE case_attachments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [
      attachmentId,
    ]);
  },

  /** One FIELD_PHOTO (scope-guarded → null=404) for reverse-geocode resolve: its coords + frozen
   *  address. OFFICE_REF rows are excluded — reverse-geocode is a field-photo concern only (ADR-0040). */
  async fieldPhotoForGeocode(
    caseId: string,
    attachmentId: string,
    scope: Scope | undefined,
  ): Promise<{
    geoLocation: { latitude?: number; longitude?: number } | null;
    address: string | null;
  } | null> {
    const params: unknown[] = [attachmentId, caseId];
    let taskLeg = '';
    if (scope) {
      const pred = taskScopePredicate(params, scope);
      taskLeg = pred
        ? `AND (ca.task_id IS NULL
                OR EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                           WHERE ct.id = ca.task_id AND ${pred}))`
        : '';
    }
    const rows = await query<{
      geoLocation: { latitude?: number; longitude?: number } | null;
      address: string | null;
    }>(
      `SELECT ca.geo_location AS "geoLocation", ca.reverse_geocoded_address AS "address"
       FROM case_attachments ca
       WHERE ca.id = $1 AND ca.case_id = $2 AND ca.kind = 'FIELD_PHOTO' AND ca.deleted_at IS NULL ${taskLeg}`,
      params,
    );
    return rows[0] ?? null;
  },

  /** The current frozen address for a field photo (UN-scoped — the async worker is a system job keyed
   *  by the just-inserted id, no actor). undefined = row absent; null = present-but-unresolved. */
  async fieldPhotoAddressById(attachmentId: string): Promise<string | null | undefined> {
    const rows = await query<{ address: string | null }>(
      `SELECT reverse_geocoded_address AS address FROM case_attachments
       WHERE id = $1 AND kind = 'FIELD_PHOTO' AND deleted_at IS NULL`,
      [attachmentId],
    );
    return rows.length === 0 ? undefined : (rows[0]!.address ?? null);
  },

  /** Freeze-safe write-through: set the address only when still NULL (the trigger blocks any rewrite).
   *  Returns the frozen value (the one just set, or the pre-existing one on a concurrent race). */
  async setFieldPhotoReverseGeocodedAddress(attachmentId: string, address: string): Promise<string | null> {
    await query(
      `UPDATE case_attachments SET reverse_geocoded_address = $2
       WHERE id = $1 AND kind = 'FIELD_PHOTO' AND reverse_geocoded_address IS NULL`,
      [attachmentId, address],
    );
    const rows = await query<{ address: string | null }>(
      `SELECT reverse_geocoded_address AS address FROM case_attachments WHERE id = $1`,
      [attachmentId],
    );
    return rows[0]?.address ?? null;
  },
};
