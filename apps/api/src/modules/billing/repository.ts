import type {
  BillingCaseRow,
  BillingTaskLine,
  BillingBreakdown,
  BillingLocationGroup,
  BillingBandGroup,
  CommissionSummaryRow,
  CommissionPeriod,
  CommissionGroupBy,
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

/**
 * Business timezone for payroll-period bucketing (ADR-0081). A single-country (India) CRM, so period
 * boundaries are the IST calendar — making it explicit removes the dependency on the PG session timezone,
 * so week/fortnight/month/quarter boundaries (and the from/to filter) are deterministic across server/CI.
 */
const BUSINESS_TZ = 'Asia/Kolkata';

/**
 * Commission-summary "earned-at" anchor (ADR-0081, fixes audit FC-5): field commission freezes at SUBMIT
 * (ADR-0047), so both the period bucket AND the date-range filter key on COALESCE(submitted_at, completed_at)
 * — NOT completed_at (which would drop SUBMITTED-not-completed rows and misattribute cross-period tasks).
 * `AT TIME ZONE` yields the IST wall-clock instant so the calendar buckets land on IST day/week/month edges.
 */
const EARNED_AT = `(COALESCE(ct.submitted_at, ct.completed_at) AT TIME ZONE '${BUSINESS_TZ}')`;

/**
 * Whitelisted period → SQL `{ key, start }` (the `period` value is validated by the service against this
 * map's keys — it is NEVER interpolated raw). `key` is the human label; `start` the sortable bucket-start.
 * `fortnight` = the twice-monthly Indian payroll cycle (1st–15th = H1, 16th–EOM = H2), NOT rolling-14-day.
 */
const PERIOD_SQL: Readonly<Record<CommissionPeriod, { key: string; start: string }>> = {
  week: {
    key: `to_char(date_trunc('week', ${EARNED_AT}), 'IYYY-"W"IW')`,
    start: `date_trunc('week', ${EARNED_AT})`,
  },
  fortnight: {
    key: `to_char(${EARNED_AT}, 'YYYY-MM') || CASE WHEN extract(day from ${EARNED_AT}) <= 15 THEN '-H1' ELSE '-H2' END`,
    start: `date_trunc('month', ${EARNED_AT}) + CASE WHEN extract(day from ${EARNED_AT}) > 15 THEN interval '15 days' ELSE interval '0 days' END`,
  },
  month: { key: `to_char(${EARNED_AT}, 'YYYY-MM')`, start: `date_trunc('month', ${EARNED_AT})` },
  quarter: {
    key: `to_char(${EARNED_AT}, 'YYYY') || '-Q' || to_char(${EARNED_AT}, 'Q')`,
    start: `date_trunc('quarter', ${EARNED_AT})`,
  },
};

/** FROM for the commission summary — INNER JOIN users (assigned tasks only) + the shared commission lateral. */
const SUMMARY_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  JOIN users au ON au.id = ct.assigned_to
  ${COMMISSION_LATERAL}`;

export interface CommissionSummaryOptions {
  scope: Scope;
  period: CommissionPeriod;
  groupBy: CommissionGroupBy;
  clientId?: number;
  productId?: number;
  /** Earned-at range (COALESCE(submitted_at, completed_at)); ISO strings. */
  from?: string;
  to?: string;
  search?: string;
  limit: number;
  offset: number;
}

/** WHERE for the commission summary (mutates `params`). Earned-at range + status + client/product + scope. */
function buildCommissionSummaryWhere(o: CommissionSummaryOptions, params: unknown[]): string {
  const where = [`ct.status IN ('SUBMITTED', 'COMPLETED')`];
  const add = (clause: string, val: unknown) => {
    params.push(val);
    where.push(clause.replace('$?', `$${params.length}`));
  };
  if (o.from !== undefined) add(`${EARNED_AT} >= $?`, o.from);
  if (o.to !== undefined) add(`${EARNED_AT} <= $?`, o.to);
  if (o.clientId !== undefined) add('cs.client_id = $?', o.clientId);
  if (o.productId !== undefined) add('cs.product_id = $?', o.productId);
  if (o.search) {
    params.push(likeContains(o.search));
    const n = params.length;
    where.push(`(au.name ILIKE $${n} OR cl.name ILIKE $${n} OR p.name ILIKE $${n})`);
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
              ct.task_origin AS billing_class, ct.visit_type, rt.client_rate_type,
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

  /**
   * Periodic per-field-user agent-commission rollup (ADR-0081) — the export/payout view the per-case list
   * could not give (no agent grain, no period bucket). Groups by agent × period bucket, optionally also by
   * client + product. Amount = the same `COALESCE(snapshot, live)` commission × bill_count the Billing page
   * sums. `period`/`groupBy` are whitelisted by the service. One round-trip for count, one for the page.
   */
  async commissionSummary(
    o: CommissionSummaryOptions,
  ): Promise<{ items: CommissionSummaryRow[]; totalCount: number }> {
    const period = PERIOD_SQL[o.period];
    const grouped = o.groupBy === 'agentClientProduct';
    const groupDims = grouped ? ', cs.client_id, cl.name, cs.product_id, p.name' : '';
    const clientSel = grouped ? 'cs.client_id, cl.name' : 'NULL::int, NULL::text';
    const productSel = grouped ? 'cs.product_id, p.name' : 'NULL::int, NULL::text';

    const params: unknown[] = [];
    const clause = buildCommissionSummaryWhere(o, params);

    // count = number of group rows (agent × period [× client × product]).
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (
         SELECT 1 ${SUMMARY_FROM} ${clause}
         GROUP BY ct.assigned_to, au.name${groupDims}, ${period.key}, ${period.start}
       ) g`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const items = await query<CommissionSummaryRow>(
      `SELECT ct.assigned_to AS agent_id, au.name AS agent_name,
              ${clientSel.split(', ')[0]} AS client_id, ${clientSel.split(', ')[1]} AS client_name,
              ${productSel.split(', ')[0]} AS product_id, ${productSel.split(', ')[1]} AS product_name,
              ${period.key} AS period_key,
              to_char(${period.start}, 'YYYY-MM-DD') AS period_start,
              count(*)::int AS task_count,
              COALESCE(SUM(ct.bill_count), 0)::int AS billable_units,
              COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)::float8 AS commission_total
       ${SUMMARY_FROM} ${clause}
       GROUP BY ct.assigned_to, au.name${groupDims}, ${period.key}, ${period.start}
       ORDER BY ${period.start} DESC, au.name ASC${grouped ? ', cl.name ASC, p.name ASC' : ''}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },
};
