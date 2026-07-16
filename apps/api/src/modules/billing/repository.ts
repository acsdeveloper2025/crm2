import type {
  BillingLineRow,
  CommissionSummaryRow,
  CommissionDetailRow,
  CommissionPeriod,
  CommissionGroupBy,
  SortOrder,
} from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query } from '../../platform/db.js';
import { taskScopePredicate, type Scope } from '../../platform/scope/index.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';
import { BILLABLE_STATUS_SQL, COMMISSIONABLE_STATUS_SQL } from '../../platform/billing/status.js';

/*
 * Visibility: every read below is TASK-grain (`FROM case_tasks ct JOIN cases cs`), so they all use the
 * shared TASK-grain predicate — the same one Pipeline (tasks/) and MIS use, so the three surfaces can
 * never disagree about which task rows an actor may see.
 *
 * They previously used a local CASE-grain copy whose hierarchy leg read
 *   `cs.created_by = ANY(ph) OR EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND ...)`
 * — correct over `FROM cases cs` (cases/dashboard), but wrong here: the subquery's own `ct` SHADOWS the
 * outer `ct`, so the EXISTS only asked "does this CASE hold any in-scope task" and never constrained the
 * returned row. A case with task A -> an in-scope agent and task B -> an out-of-scope agent leaked B's
 * row — including `agent_name` + `commission_amount` on /commission-summary and /commission-detail.
 */

// Flat billing-lines list (ADR-0086 redesign): one row per COMPLETED billable task, all detail columns +
// the resolved CLIENT bill. ADR-0086 made the billing surface bill-only — COMMISSION_LATERAL is NOT joined
// here (it stays on SUMMARY_FROM/DETAIL_FROM). RATE_LATERAL is shared with the Pipeline read-model — see
// platform/billing/laterals.ts. `l` = the task's resolved location (task area > pincode > case area >
// pincode). `billing.view` is the gate; the scope predicate is defence-in-depth (operators are office-wide
// today, but stays scope-safe).
const LINES_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  LEFT JOIN users au ON au.id = ct.assigned_to
  LEFT JOIN locations l ON l.id = COALESCE(ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)
  ${RATE_LATERAL}`;

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

export interface BillingLineListOptions {
  scope: Scope;
  clientId?: number;
  completedFrom?: string;
  completedTo?: string;
  search?: string;
  columnFilters?: AppliedFilter[];
  /** export `selected` mode — task ids (ct.id). */
  ids?: string[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

/** Filter-only subset of the line options (no sort/pagination) — shared by the list and the aggregate summary. */
export type BillingLineFilterOptions = Pick<
  BillingLineListOptions,
  'scope' | 'clientId' | 'completedFrom' | 'completedTo' | 'search' | 'columnFilters' | 'ids'
>;

/**
 * Build the WHERE for the flat billing-lines list. COMPLETED-only (a billing line = a billed task); pushes
 * bind values onto `params` (mutated) and returns the full `WHERE …`. FROM contract: `case_tasks ct` /
 * `cases cs` / `clients cl` / `products p` / `verification_units vu` / `users au` / `locations l`. Search +
 * column filters cover the detail columns, so the flat grid replaces the old breakdown panels (ADR-0086).
 */
function buildLinesWhere(o: BillingLineFilterOptions, params: unknown[]): string {
  const where = [BILLABLE_STATUS_SQL];
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
    where.push(
      `(cs.case_number ILIKE $${n} OR cl.name ILIKE $${n} OR p.name ILIKE $${n} OR vu.name ILIKE $${n} OR au.name ILIKE $${n} OR l.pincode ILIKE $${n} OR l.area ILIKE $${n})`,
    );
  }
  where.push(...filterClauses(o.columnFilters ?? [], params));
  if (o.ids && o.ids.length) {
    params.push(o.ids);
    where.push(`ct.id = ANY($${params.length})`);
  }
  const scopePred = taskScopePredicate(params, o.scope);
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

/** FROM for the commission summary — INNER JOIN users (assigned tasks only) + the shared rate/commission
 *  laterals. `rt` = client bill (rates engine) — `rt.client_rate_type` + `rt.bill_amount`; `frt` = the task's
 *  FIELD rate-type code (LOCAL/OGL/OFFICE, from `case_tasks.rate_type_id`); `com` = agent commission. */
const SUMMARY_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  JOIN users au ON au.id = ct.assigned_to
  LEFT JOIN rate_types frt ON frt.id = ct.rate_type_id
  ${RATE_LATERAL}
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
  const where = [COMMISSIONABLE_STATUS_SQL];
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
  const scopePred = taskScopePredicate(params, o.scope);
  if (scopePred) where.push(scopePred);
  return `WHERE ${where.join(' AND ')}`;
}

/** FROM for the per-task commission DETAIL — like SUMMARY_FROM + the verification-unit name join (no aggregation). */
const DETAIL_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  JOIN users au ON au.id = ct.assigned_to
  LEFT JOIN rate_types frt ON frt.id = ct.rate_type_id
  ${RATE_LATERAL}
  ${COMMISSION_LATERAL}`;

export interface CommissionDetailOptions {
  scope: Scope;
  clientId?: number;
  productId?: number;
  /** Earned-at range (COALESCE(submitted_at, completed_at)); ISO strings. */
  from?: string;
  to?: string;
  search?: string;
  limit: number;
  offset: number;
}

/** WHERE for the commission detail — same earned-at/status/client/product filter as the summary; search also
 *  matches case + task numbers. Mutates `params`. */
function buildCommissionDetailWhere(o: CommissionDetailOptions, params: unknown[]): string {
  const where = [COMMISSIONABLE_STATUS_SQL];
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
    where.push(
      `(au.name ILIKE $${n} OR cl.name ILIKE $${n} OR p.name ILIKE $${n} OR cs.case_number ILIKE $${n} OR ct.task_number ILIKE $${n})`,
    );
  }
  const scopePred = taskScopePredicate(params, o.scope);
  if (scopePred) where.push(scopePred);
  return `WHERE ${where.join(' AND ')}`;
}

export const billingRepository = {
  async listLines(o: BillingLineListOptions): Promise<{ items: BillingLineRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const clause = buildLinesWhere(o, params);

    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${LINES_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<BillingLineRow>(
      `SELECT ct.id AS task_id, ct.task_number, cs.id AS case_id, cs.case_number,
              cl.name AS client_name, p.name AS product_name, vu.name AS unit_name,
              au.name AS assignee_name, rt.client_rate_type,
              ${COMPLETED_BAND} AS tat_band,
              l.pincode, l.area,
              ct.bill_count, rt.bill_amount,
              (rt.bill_amount * ct.bill_count)::float8 AS bill_total,
              ct.completed_at
       ${LINES_FROM} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, ct.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** Filter-aware aggregate for the flat billing grid footer (ADR-0086): the ₹ bill total + line count over
   *  ALL matching lines (not just the page). Reuses `buildLinesWhere` so it honours the exact same filters. */
  async linesSummary(o: BillingLineFilterOptions): Promise<{ billTotal: number; lineCount: number }> {
    const params: unknown[] = [];
    const clause = buildLinesWhere(o, params);
    const [row] = await query<{ billTotal: number; lineCount: number }>(
      `SELECT COALESCE(SUM(rt.bill_amount * ct.bill_count), 0)::float8 AS bill_total,
              count(*)::int AS line_count
       ${LINES_FROM} ${clause}`,
      params,
    );
    return { billTotal: row?.billTotal ?? 0, lineCount: row?.lineCount ?? 0 };
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
    // Three grain levels: agent · +client/product · +client-rate-type/field-rate-type (byRT ⟹ byCP).
    const byCP = o.groupBy === 'agentClientProduct' || o.groupBy === 'agentClientProductRateType';
    const byRT = o.groupBy === 'agentClientProductRateType';
    const cpDims = byCP ? ', cs.client_id, cl.name, cs.product_id, p.name' : '';
    const rtDims = byRT ? ', rt.client_rate_type, frt.code' : '';
    const groupDims = cpDims + rtDims;
    const orderExtra =
      (byCP ? ', cl.name ASC, p.name ASC' : '') + (byRT ? ', rt.client_rate_type ASC, frt.code ASC' : '');

    const params: unknown[] = [];
    const clause = buildCommissionSummaryWhere(o, params);

    // count = number of group rows (agent × period [× client × product [× rate types]]).
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
              ${byCP ? 'cs.client_id' : 'NULL::int'} AS client_id, ${byCP ? 'cl.name' : 'NULL::text'} AS client_name,
              ${byCP ? 'cs.product_id' : 'NULL::int'} AS product_id, ${byCP ? 'p.name' : 'NULL::text'} AS product_name,
              ${byRT ? 'rt.client_rate_type' : 'NULL::text'} AS client_rate_type,
              ${byRT ? 'frt.code' : 'NULL::text'} AS field_rate_type,
              ${period.key} AS period_key,
              to_char(${period.start}, 'YYYY-MM-DD') AS period_start,
              count(*)::int AS task_count,
              COALESCE(SUM(ct.bill_count), 0)::int AS billable_units,
              COALESCE(SUM(rt.bill_amount * ct.bill_count) FILTER (WHERE ${BILLABLE_STATUS_SQL}), 0)::float8 AS bill_total,
              COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)::float8 AS commission_total
       ${SUMMARY_FROM} ${clause}
       GROUP BY ct.assigned_to, au.name${groupDims}, ${period.key}, ${period.start}
       ORDER BY ${period.start} DESC, au.name ASC${orderExtra}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /**
   * Per-task commission/billing DETAIL (ADR-0081, v1 line-export parity) — one row per commissioned task
   * over the same earned-at filter as the summary: agent, client, product, unit, case/task, BOTH rate types
   * (client bill vs field commission), the resolved client bill rate, and the commission. Flat + paginated.
   */
  async commissionDetail(
    o: CommissionDetailOptions,
  ): Promise<{ items: CommissionDetailRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const clause = buildCommissionDetailWhere(o, params);

    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${DETAIL_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const items = await query<CommissionDetailRow>(
      `SELECT ct.id AS task_id, ct.task_number, cs.case_number,
              ct.assigned_to AS agent_id, au.name AS agent_name,
              cl.name AS client_name, p.name AS product_name, vu.name AS unit_name,
              ct.visit_type, rt.client_rate_type, frt.code AS field_rate_type,
              CASE WHEN ${BILLABLE_STATUS_SQL} THEN rt.bill_amount END AS bill_amount,
              COALESCE(ct.commission_amount, com.commission_amount) AS commission_amount,
              ct.bill_count, ct.status,
              to_char(${EARNED_AT}, 'YYYY-MM-DD') AS earned_on,
              ct.submitted_at, ct.completed_at
       ${DETAIL_FROM} ${clause}
       ORDER BY ${EARNED_AT} DESC, ct.task_number
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },
};
