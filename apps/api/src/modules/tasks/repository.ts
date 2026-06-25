import type { TaskView, TaskStats, AssignableUser, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query } from '../../platform/db.js';
import { taskScopePredicate, type Scope } from '../../platform/scope/index.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';

/**
 * Out-of-TAT (overdue) predicate (ADR-0044): an OPEN task whose explicit per-task target (`tat_hours`)
 * has elapsed since its CLOCK START — `assigned_at` (NOT created_at). A task with no target or not yet
 * assigned can't be overdue (fail-open: NULL → not overdue). Pure SQL, no params (references only
 * `ct`) → safe to inline as both a list filter and the computed `overdue` column / ORDER BY key.
 */
const OVERDUE_SQL = `(ct.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
  AND ct.tat_hours IS NOT NULL AND ct.assigned_at IS NOT NULL
  AND now() > ct.assigned_at + (ct.tat_hours * interval '1 hour'))`;

/**
 * Pipeline repository — the operational task queue: every `case_task` across all cases, with its
 * case context denormalised. Every join from `ct` is 1:1 (cases/units/clients/products/assignee by
 * PK; primary applicant by partial-unique index) → the COUNT/stats share the full FROM with zero
 * fan-out (CPV envelope precedent).
 */
export interface TaskListOptions {
  status?: string;
  clientId?: number;
  productId?: number;
  assignedTo?: string;
  unitId?: number;
  search?: string;
  /** whitelisted per-column filters (§6/§7) — every column is in the shared FROM. */
  columnFilters?: AppliedFilter[];
  /** data scope (ADR-0022) — composed at TASK level; undefined = no filter. */
  scope?: Scope;
  /** export `selected` mode — restrict to these task ids (already uuid-validated). */
  ids?: string[];
  /** Out-of-TAT bucket (ADR-0044, the "Out of TAT" bucket) — restrict to OPEN tasks past their
   *  explicit `tat_hours` target since `assigned_at`. When set (and no explicit sort requested) the
   *  list orders by urgency. */
  overdue?: boolean;
  /** Commissionable bucket (ADR-0036 slice 5d) — COMPLETED tasks with a resolved commission. */
  commissionable?: boolean;
  /** Expose the derived bill/commission amounts? Only when the actor holds `billing.view` —
   *  commission AMOUNTS are restricted comp data (5a/5b). When false the amounts come back null
   *  (and the laterals are skipped entirely → also cheaper), and the commissionable filter is inert. */
  billing?: boolean;
  sortColumn: string;
  sortOrder: SortOrder;
  /** True when the caller did NOT request an explicit sort (the page default is in effect). Lets the
   *  `overdue` filter substitute an urgency ordering without ever overriding a user-chosen sort. */
  defaultSort?: boolean;
  limit: number;
  offset: number;
}

const TASK_FROM = `
  FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  LEFT JOIN users au ON au.id = ct.assigned_to
  LEFT JOIN case_applicants pa ON pa.case_id = cs.id AND pa.is_primary`;

/** TASK_FROM + the shared billing laterals (ADR-0036 slice 5d). Used by the row SELECT (paginated →
 *  the per-row lateral cost is bounded by page size) and by any read that filters on a resolved
 *  amount (the commissionable bucket). The plain TASK_FROM stays lateral-free for the COUNT/stats. */
const TASK_FROM_BILLING = `${TASK_FROM}
  ${RATE_LATERAL}
  ${COMMISSION_LATERAL}`;

/** Row columns minus the billing-gated amount columns + FROM (both appended per-call). `billable`
 *  is status-derived (not sensitive) so it is always present; the ₹ amounts are billing.view-gated. */
const TASK_SELECT_BASE = `
  SELECT ct.id, ct.case_id, cs.case_number, ct.task_number, cs.client_id, cl.name AS client_name,
         p.name AS product_name, pa.name AS primary_name,
         ct.verification_unit_id, vu.code AS unit_code, vu.name AS unit_name, vu.kind AS unit_kind,
         ct.status, ct.assigned_to, au.name AS assigned_to_name,
         ct.visit_type, ct.field_rate_type, ct.bill_count, ct.assigned_at,
         ct.version, ct.created_at, ct.updated_at,
         ct.tat_hours AS tat_hours,
         (ct.assigned_at + (ct.tat_hours * interval '1 hour')) AS due_at,
         ${OVERDUE_SQL} AS overdue,
         ct.completed_elapsed_minutes AS completed_elapsed_minutes,
         COALESCE((SELECT tp.tat_hours FROM tat_policies tp
            WHERE tp.is_active AND tp.effective_from <= now()
              AND tp.tat_hours >= CEIL(ct.completed_elapsed_minutes / 60.0)
            ORDER BY tp.tat_hours ASC LIMIT 1),
            CASE WHEN ct.completed_elapsed_minutes IS NULL THEN NULL ELSE -1 END) AS completed_tat_band,
         (ct.status = 'COMPLETED') AS billable`;

/** Amount columns — resolved via the laterals when billing-visible, else nulled (laterals skipped). */
// COALESCE the frozen snapshot (ct.commission_amount) over the live lateral so the pipeline resolves
// the SAME commission as billing & MIS (ADR-0047/0050; audit H-1 — do NOT read live-only here).
const BILLING_AMOUNT_COLS = `, rt.bill_amount, COALESCE(ct.commission_amount, com.commission_amount) AS commission_amount`;
const NULL_AMOUNT_COLS = `, NULL::float8 AS bill_amount, NULL::float8 AS commission_amount`;

/** Shared WHERE builder — list, COUNT, stats and export all run the SAME conditions. */
function buildWhere(
  o: Pick<
    TaskListOptions,
    | 'status'
    | 'clientId'
    | 'productId'
    | 'assignedTo'
    | 'unitId'
    | 'search'
    | 'columnFilters'
    | 'scope'
    | 'ids'
    | 'overdue'
    | 'commissionable'
  >,
  params: unknown[],
): string {
  const where: string[] = [];
  if (o.status) {
    params.push(o.status);
    where.push(`ct.status = $${params.length}`);
  }
  if (o.clientId !== undefined) {
    params.push(o.clientId);
    where.push(`cs.client_id = $${params.length}`);
  }
  if (o.productId !== undefined) {
    params.push(o.productId);
    where.push(`cs.product_id = $${params.length}`);
  }
  if (o.assignedTo) {
    params.push(o.assignedTo);
    where.push(`ct.assigned_to = $${params.length}::uuid`);
  }
  if (o.unitId !== undefined) {
    params.push(o.unitId);
    where.push(`ct.verification_unit_id = $${params.length}`);
  }
  if (o.search) {
    params.push(likeContains(o.search));
    where.push(
      `(cs.case_number ILIKE $${params.length} OR pa.name ILIKE $${params.length} OR vu.name ILIKE $${params.length})`,
    );
  }
  if (o.ids) {
    params.push(o.ids);
    where.push(`ct.id = ANY($${params.length}::uuid[])`);
  }
  if (o.overdue) where.push(OVERDUE_SQL); // param-free out-of-TAT (overdue) predicate
  // Commissionable: a COMPLETED task whose assignee has a resolved commission (references the
  // COMMISSION_LATERAL `com` → the caller's FROM must be TASK_FROM_BILLING). Param-free.
  if (o.commissionable) where.push(`ct.status = 'COMPLETED' AND com.commission_amount IS NOT NULL`);
  where.push(...filterClauses(o.columnFilters ?? [], params));
  const scopePred = taskScopePredicate(params, o.scope);
  if (scopePred) where.push(scopePred);
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

export const taskRepository = {
  async list(o: TaskListOptions): Promise<{ items: TaskView[]; totalCount: number }> {
    const billing = o.billing ?? false;
    // The commissionable filter references the COMMISSION_LATERAL → it can only run when billing is
    // visible (and the laterals are in FROM). Normalise so a stray flag can never reach the WHERE
    // without its lateral.
    const commissionable = billing && !!o.commissionable;
    const params: unknown[] = [];
    const clause = buildWhere({ ...o, commissionable }, params);
    // COUNT stays lateral-free unless the commissionable filter is active.
    const countFrom = commissionable ? TASK_FROM_BILLING : TASK_FROM;
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${countFrom} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate. The amount
    // columns are NOT sortable (they live only in the billing FROM), so the sort never needs it.
    const selectFrom = billing ? TASK_FROM_BILLING : TASK_FROM;
    const amountCols = billing ? BILLING_AMOUNT_COLS : NULL_AMOUNT_COLS;
    // The overdue filter defaults to an urgency ordering (overdue first, then soonest-due) — but ONLY
    // when the caller hasn't picked an explicit sort, so a user-chosen column always wins. Both keys are
    // param-free SQL (OVERDUE_SQL references only `ct`; due_at = assigned_at + tat_hours).
    const orderBy =
      o.overdue && o.defaultSort
        ? `ORDER BY ${OVERDUE_SQL} DESC, (ct.assigned_at + (ct.tat_hours * interval '1 hour')) ASC NULLS LAST, ct.id ${o.sortOrder}`
        : `ORDER BY ${o.sortColumn} ${o.sortOrder}, ct.id ${o.sortOrder}`;
    const items = await query<TaskView>(
      `${TASK_SELECT_BASE}${amountCols} ${selectFrom} ${clause}
       ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** Bucket counts over the SAME conditions (minus the `status`/`overdue` bucket params themselves).
   *  One row of conditional aggregates → REVOKED + the cross-status "Out of TAT" count + total. */
  async stats(
    o: Pick<
      TaskListOptions,
      'clientId' | 'productId' | 'assignedTo' | 'unitId' | 'search' | 'columnFilters' | 'scope' | 'billing'
    >,
  ): Promise<TaskStats> {
    // The status/overdue buckets are cheap, param-free predicates → ONE lateral-free aggregate over
    // TASK_FROM (no perf regression to existing buckets).
    const params: unknown[] = [];
    const clause = buildWhere(o, params);
    const [row] = await query<Omit<TaskStats, 'commissionable'>>(
      `SELECT count(*) FILTER (WHERE ct.status = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE ct.status = 'ASSIGNED')::int AS assigned,
              count(*) FILTER (WHERE ct.status = 'IN_PROGRESS')::int AS in_progress,
              count(*) FILTER (WHERE ct.status = 'SUBMITTED')::int AS submitted,
              count(*) FILTER (WHERE ct.status = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE ct.status = 'REVOKED')::int AS revoked,
              count(*) FILTER (WHERE ${OVERDUE_SQL})::int AS overdue,
              count(*)::int AS total
       ${TASK_FROM} ${clause}`,
      params,
    );
    // Commissionable is a billing.view-only bucket (comp data). Skip it entirely for non-billing
    // actors (0). When visible: isolate it in its own query PRE-FILTERED to COMPLETED so the lateral
    // resolution runs only over completed rows (not the whole pipeline).
    let commissionable = 0;
    if (o.billing) {
      const cParams: unknown[] = [];
      const cClause = buildWhere(o, cParams);
      const cPred = `ct.status = 'COMPLETED' AND com.commission_amount IS NOT NULL`;
      const cWhere = cClause ? `${cClause} AND ${cPred}` : `WHERE ${cPred}`;
      const [cRow] = await query<{ count: number }>(
        `SELECT count(*)::int AS count ${TASK_FROM_BILLING} ${cWhere}`,
        cParams,
      );
      commissionable = cRow?.count ?? 0;
    }
    const base = row ?? {
      pending: 0,
      assigned: 0,
      inProgress: 0,
      submitted: 0,
      completed: 0,
      revoked: 0,
      overdue: 0,
      total: 0,
    };
    return { ...base, commissionable };
  },

  /** The given tasks, restricted to the actor's scope (assignment writes go through this lookup so
   *  write reachability ≡ list visibility — an out-of-scope id is indistinguishable from missing). */
  async tasksForAssignment(
    taskIds: string[],
    scope: Scope | undefined,
  ): Promise<
    Array<{
      id: string;
      caseId: string;
      status: string;
      assignedTo: string | null;
      version: number;
      unitKind: string;
    }>
  > {
    const params: unknown[] = [taskIds];
    const scopePred = taskScopePredicate(params, scope);
    return query(
      // vu.kind feeds the bulk-assign visitType↔kind binding (A2026-0623-05).
      `SELECT ct.id, ct.case_id, ct.status, ct.assigned_to, ct.version, vu.kind AS unit_kind
       FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
       JOIN verification_units vu ON vu.id = ct.verification_unit_id
       WHERE ct.id = ANY($1::uuid[]) ${scopePred ? `AND ${scopePred}` : ''}`,
      params,
    );
  },

  /**
   * Executives eligible for EVERY one of the given tasks (ADR-0024) — the SAME pool model as the
   * Add Task picker, so list visibility, reassign and bulk-assign never disagree. Zero role names:
   *  1. USABLE user, 2. role = the pool role for the chosen `visitType` (assignment_pool_roles, data),
   *  3. inside the ACTOR's hierarchy scope, 4. FIELD only: the candidate covers EVERY field task's
   *  OWN location (id-equality vs the task's pincode_id/area_id — a task without a location can be
   *  covered by no one, fail-closed). OFFICE skips the territory leg (desk pool).
   */
  async eligibleAssignees(
    taskIds: string[],
    visitType: string,
    scopeUserIds: string[] | undefined,
  ): Promise<AssignableUser[]> {
    const params: unknown[] = [taskIds, visitType];
    let hierarchy = '';
    if (scopeUserIds !== undefined) {
      params.push(scopeUserIds);
      hierarchy = `AND u.id = ANY($${params.length}::uuid[])`;
    }
    return query<AssignableUser>(
      `SELECT u.id, u.username, u.name, u.role
       FROM users u
       WHERE u.is_active AND u.effective_from <= now() ${hierarchy}
         AND u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = $2)
         AND NOT EXISTS (
           SELECT 1 FROM case_tasks t
           WHERE t.id = ANY($1::uuid[])
             AND $2 = 'FIELD'
             AND (t.area_id IS NOT NULL OR t.pincode_id IS NOT NULL) -- unlocated task ⇒ no territory gate
             AND NOT EXISTS (
               SELECT 1 FROM user_scope_assignments usa
               WHERE usa.user_id = u.id AND usa.is_active
                 AND ((usa.dimension_code = 'AREA' AND usa.entity_id = t.area_id)
                   OR (usa.dimension_code = 'PINCODE' AND usa.entity_id = t.pincode_id))
             )
         )
       ORDER BY u.name`,
      params,
    );
  },

  /** The subset of `taskIds` for which `assigneeId` passes the SAME ADR-0024 eligibility (per-row
   *  bulk/reassign check): pool role for `visitType` ∩ hierarchy ∩ (FIELD) that task's own location. */
  async eligibleTaskIdsForAssignee(
    taskIds: string[],
    assigneeId: string,
    visitType: string,
    scopeUserIds: string[] | undefined,
  ): Promise<string[]> {
    const params: unknown[] = [taskIds, assigneeId, visitType];
    let hierarchy = '';
    if (scopeUserIds !== undefined) {
      params.push(scopeUserIds);
      hierarchy = `AND u.id = ANY($${params.length}::uuid[])`;
    }
    const rows = await query<{ id: string }>(
      `SELECT t.id
       FROM case_tasks t
       JOIN users u ON u.id = $2::uuid
       WHERE t.id = ANY($1::uuid[])
         AND u.is_active AND u.effective_from <= now() ${hierarchy}
         AND u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = $3)
         AND (
           $3 = 'OFFICE'
           OR (t.area_id IS NULL AND t.pincode_id IS NULL) -- unlocated task ⇒ no territory gate
           OR EXISTS (
             SELECT 1 FROM user_scope_assignments usa
             WHERE usa.user_id = u.id AND usa.is_active
               AND ((usa.dimension_code = 'AREA' AND usa.entity_id = t.area_id)
                 OR (usa.dimension_code = 'PINCODE' AND usa.entity_id = t.pincode_id))
           )
         )`,
      params,
    );
    return rows.map((r) => r.id);
  },
};
