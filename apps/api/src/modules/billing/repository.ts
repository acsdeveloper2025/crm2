import type {
  BillingCaseRow,
  BillingTaskLine,
  BillingBreakdown,
  BillingLocationGroup,
  BillingBandGroup,
  SortOrder,
} from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query } from '../../platform/db.js';
import { composeScopePredicate, type Scope } from '../../platform/scope/index.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';

/**
 * CASE-grain visibility predicate (mirrors the cases/dashboard leg; kept local to respect module
 * boundaries): a case is visible when the actor created it OR an in-scope user holds one of its
 * tasks. `''` = no filter (SUPER_ADMIN / hierarchy ALL). FROM contract: `cases cs`.
 */
function caseScopePredicate(params: unknown[], scope: Scope): string {
  return composeScopePredicate(
    params,
    scope,
    (ph) =>
      `cs.created_by = ANY(${ph}) OR EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND ct.assigned_to = ANY(${ph}))`,
    'CASE',
  );
}

// Per-case list: aggregate the resolved per-task amounts over COMPLETED tasks.
// RATE_LATERAL/COMMISSION_LATERAL are shared with the Pipeline read-model — see platform/billing/laterals.ts. `billing.view` is the
// gate; the scope predicate is defence-in-depth (operators are office-wide today, but stays scope-safe).
const CASES_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  ${RATE_LATERAL}
  ${COMMISSION_LATERAL}`;

/**
 * Completed-in TAT band derivation (ADR-0046 §4.2) — the smallest active `tat_policies` band that
 * still covers the task's completed-elapsed minutes, as-of `completed_at` (point-in-time stable).
 * `-1` = out of every band; `NULL` = task carries no elapsed minutes. Mirrors COMMISSION_LATERAL's
 * inner band lookup — do NOT fork the logic.
 */
export const COMPLETED_BAND = `COALESCE(
    (SELECT tp.tat_hours FROM tat_policies tp
       WHERE tp.is_active
         AND tp.effective_from <= COALESCE(ct.completed_at, now())
         AND (tp.effective_to IS NULL OR tp.effective_to > COALESCE(ct.completed_at, now()))
         AND tp.tat_hours >= CEIL(ct.completed_elapsed_minutes / 60.0)
       ORDER BY tp.tat_hours ASC LIMIT 1),
    CASE WHEN ct.completed_elapsed_minutes IS NULL THEN NULL ELSE -1 END)`;

export interface BillingCaseListOptions {
  scope: Scope;
  clientId?: number;
  completedFrom?: string;
  completedTo?: string;
  search?: string;
  columnFilters?: AppliedFilter[];
  ids?: string[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

/** The filter options shared by `listCases` and `breakdown` (everything but sort/pagination). */
type BillingFilterOptions = Pick<
  BillingCaseListOptions,
  'scope' | 'clientId' | 'completedFrom' | 'completedTo' | 'search' | 'columnFilters' | 'ids'
>;

/**
 * Build the COMPLETED-task WHERE clause shared by `listCases` and `breakdown` (DRY: one place owns the
 * filter logic). Pushes bind values onto `params` (caller's array, mutated) and returns the full
 * `WHERE …` string. FROM contract: `case_tasks ct` / `cases cs` / `clients cl` / `products p`.
 */
function buildBillingWhere(o: BillingFilterOptions, params: unknown[]): string {
  // ADR-0047: field commission is frozen at SUBMIT, client bill at COMPLETE. Include SUBMITTED rows so
  // the field commission surfaces; the bill-side aggregates below are FILTERed back to COMPLETED.
  const where = [`ct.status IN ('SUBMITTED', 'COMPLETED')`];
  const add = (clause: string, val: unknown) => {
    params.push(val);
    where.push(clause.replace('$?', `$${params.length}`));
  };
  if (o.clientId !== undefined) add('cs.client_id = $?', o.clientId);
  if (o.completedFrom !== undefined) add('ct.completed_at >= $?', o.completedFrom);
  if (o.completedTo !== undefined) add('ct.completed_at <= $?', o.completedTo);
  if (o.search) {
    params.push(likeContains(o.search));
    const n = params.length;
    where.push(`(cs.case_number ILIKE $${n} OR cl.name ILIKE $${n} OR p.name ILIKE $${n})`);
  }
  where.push(...filterClauses(o.columnFilters ?? [], params));
  if (o.ids && o.ids.length) {
    params.push(o.ids);
    where.push(`cs.id = ANY($${params.length})`);
  }
  const scopePred = caseScopePredicate(params, o.scope);
  if (scopePred) where.push(scopePred);
  return `WHERE ${where.join(' AND ')}`;
}

export const billingRepository = {
  async listCases(o: BillingCaseListOptions): Promise<{ items: BillingCaseRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const clause = buildBillingWhere(o, params);

    const [countRow] = await query<{ count: number }>(
      `SELECT count(DISTINCT cs.id)::int AS count ${CASES_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<BillingCaseRow>(
      `SELECT cs.id AS case_id, cs.case_number, cl.name AS client_name, p.name AS product_name,
              cs.status,
              count(*) FILTER (WHERE ct.status = 'COMPLETED')::int AS completed_task_count,
              COALESCE(SUM(ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED'), 0)::int AS billable_units,
              COALESCE(SUM(rt.bill_amount * ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED'), 0)::float8 AS bill_total,
              COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)::float8 AS commission_total,
              max(ct.completed_at) AS last_completed_at
       ${CASES_FROM} ${clause}
       GROUP BY cs.id, cs.case_number, cl.name, p.name, cs.status
       ORDER BY ${o.sortColumn} ${o.sortOrder}, cs.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** Is the case visible to this scope? (scope-guard for the per-case lines read). */
  async caseVisible(caseId: string, scope: Scope): Promise<boolean> {
    const params: unknown[] = [caseId];
    const scopePred = caseScopePredicate(params, scope);
    const clause = scopePred ? `AND (${scopePred})` : '';
    const rows = await query<{ one: number }>(
      `SELECT 1 AS one FROM cases cs WHERE cs.id = $1 ${clause} LIMIT 1`,
      params,
    );
    return rows.length > 0;
  },

  /** The COMPLETED-task billing lines for one case (accordion detail). Caller guards visibility. */
  async caseTasks(caseId: string): Promise<BillingTaskLine[]> {
    return query<BillingTaskLine>(
      `SELECT ct.id AS task_id, ct.task_number, vu.name AS unit_name, au.name AS assignee_name,
              ct.task_origin AS billing_class, ct.visit_type, rt.rate_type,
              CASE WHEN ct.status = 'COMPLETED' THEN rt.bill_amount END AS bill_amount,
              COALESCE(ct.commission_amount, com.commission_amount) AS commission_amount,
              ct.bill_count, ${COMPLETED_BAND} AS tat_band,
              ct.completed_at
       FROM case_tasks ct
       JOIN cases cs ON cs.id = ct.case_id
       JOIN verification_units vu ON vu.id = ct.verification_unit_id
       LEFT JOIN users au ON au.id = ct.assigned_to
       ${RATE_LATERAL}
       ${COMMISSION_LATERAL}
       WHERE ct.status IN ('SUBMITTED', 'COMPLETED') AND cs.id = $1
       ORDER BY ct.task_number`,
      [caseId],
    );
  },

  /**
   * Completed-task bill/commission totals over the SAME filter as `listCases`, grouped two ways:
   * by the task's resolved location (pincode/area) and by the completed-in TAT band (ADR-0046 §4.3).
   * One round-trip per grouping; both share `buildBillingWhere`. Gated `billing.view` (page-level).
   */
  async breakdown(o: BillingFilterOptions): Promise<BillingBreakdown> {
    const locParams: unknown[] = [];
    const locClause = buildBillingWhere(o, locParams);
    const byLocation = await query<BillingLocationGroup>(
      `SELECT COALESCE(ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id) AS location_id,
              l.pincode, l.area,
              count(*)::int                                                AS completed_task_count,
              COALESCE(SUM(ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED'), 0)::int AS billable_units,
              COALESCE(SUM(rt.bill_amount * ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED'), 0)::float8 AS bill_total,
              COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)::float8 AS commission_total
       ${CASES_FROM}
       LEFT JOIN locations l ON l.id = COALESCE(ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)
       ${locClause}
       GROUP BY 1, l.pincode, l.area
       ORDER BY commission_total DESC`,
      locParams,
    );

    const bandParams: unknown[] = [];
    const bandClause = buildBillingWhere(o, bandParams);
    const byBand = await query<BillingBandGroup>(
      `SELECT ${COMPLETED_BAND} AS band,
              count(*)::int                                                AS completed_task_count,
              COALESCE(SUM(ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED'), 0)::int AS billable_units,
              COALESCE(SUM(rt.bill_amount * ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED'), 0)::float8 AS bill_total,
              COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)::float8 AS commission_total
       ${CASES_FROM} ${bandClause}
       GROUP BY 1 ORDER BY 1`,
      bandParams,
    );

    return { byLocation, byBand };
  },
};
