import type { MisRow, SortOrder } from '@crm2/sdk';
import { filterClauses, type AppliedFilter } from '../../platform/pagination.js';
import { query } from '../../platform/db.js';
import { composeScopePredicate, taskScopePredicate, type Scope } from '../../platform/scope/index.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';
import { BILLABLE_STATUS_SQL, COMMISSIONABLE_STATUS_SQL } from '../../platform/billing/status.js';
import type { MisColumn } from './reportTypes.js';

/**
 * MIS repository (ADR-0084). Two grains, one query builder:
 *  - task  (TASK_OPERATIONAL): one row per case_task. Money is per-row via the billing laterals,
 *    appended to FROM ONLY with billing.view (never sortable/filterable → no oracle). Scope leg =
 *    task-visibility.
 *  - case  (CASE_OPERATIONAL): one row per case. Rollups + money totals are CORRELATED SUBQUERIES on
 *    the case's tasks (self-contained; money subqueries only appear when the money column is selected,
 *    which the service gates by billing.view). Scope leg = case-visibility.
 * Every base FROM is 1:1 (no fan-out) so count(*) and the money sums stay exact.
 */

type Grain = 'task' | 'case';

const MIS_FROM = `
  FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  LEFT JOIN users au ON au.id = ct.assigned_to
  LEFT JOIN case_applicants ta ON ta.id = ct.applicant_id
  LEFT JOIN field_reports fr ON fr.case_task_id = ct.id
  LEFT JOIN rate_types frt ON frt.id = ct.rate_type_id`;
const MIS_FROM_BILLING = `${MIS_FROM}
  ${RATE_LATERAL}
  ${COMMISSION_LATERAL}`;
const CASE_FROM = `
  FROM cases cs
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  LEFT JOIN case_applicants pa ON pa.case_id = cs.id AND pa.is_primary
  LEFT JOIN users cb ON cb.id = cs.completed_by`;

/** SELECT/count FROM for the page (task grain gets the money laterals only with billing.view). */
function fromFor(grain: Grain, billing: boolean): string {
  if (grain === 'case') return CASE_FROM;
  return billing ? MIS_FROM_BILLING : MIS_FROM;
}
/** Count/scope FROM — never needs the task money laterals (money is never a filter). */
function baseFrom(grain: Grain): string {
  return grain === 'case' ? CASE_FROM : MIS_FROM;
}
/** Row-scope: out-of-scope ⇒ 0 rows (never IDOR). Task-visibility vs case-visibility leg by grain. */
function scopePredicate(params: unknown[], scope: Scope, grain: Grain): string {
  if (grain === 'case')
    return composeScopePredicate(
      params,
      scope,
      (ph) =>
        `cs.created_by = ANY(${ph}) OR EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND ct.assigned_to = ANY(${ph}))`,
      'CASE',
    );
  return taskScopePredicate(params, scope);
}

// Summary aggregates — task grain counts tasks (ct.*), case grain counts cases (cs.*).
const TASK_SUMMARY_AGG = `
  count(*)::int AS count,
  count(*) FILTER (WHERE ct.status = 'COMPLETED')::int AS completed,
  count(*) FILTER (WHERE ct.verification_outcome = 'POSITIVE')::int AS positive,
  count(*) FILTER (WHERE ct.verification_outcome = 'NEGATIVE')::int AS negative,
  count(*) FILTER (WHERE ct.verification_outcome = 'REFER')::int AS refer,
  count(*) FILTER (WHERE ct.verification_outcome = 'FRAUD')::int AS fraud`;
const TASK_MONEY_AGG = `,
  SUM(rt.bill_amount * ct.bill_count) FILTER (WHERE ${BILLABLE_STATUS_SQL})::float8 AS "billTotal",
  SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count)
    FILTER (WHERE ${COMMISSIONABLE_STATUS_SQL})::float8 AS "commissionTotal"`;
const CASE_SUMMARY_AGG = `
  count(*)::int AS count,
  count(*) FILTER (WHERE cs.status = 'COMPLETED')::int AS completed,
  count(*) FILTER (WHERE cs.verification_outcome = 'POSITIVE')::int AS positive,
  count(*) FILTER (WHERE cs.verification_outcome = 'NEGATIVE')::int AS negative,
  count(*) FILTER (WHERE cs.verification_outcome = 'REFER')::int AS refer,
  count(*) FILTER (WHERE cs.verification_outcome = 'FRAUD')::int AS fraud`;
const CASE_MONEY_AGG = `,
  SUM((SELECT COALESCE(SUM(rt.bill_amount * ct.bill_count), 0) FROM case_tasks ct ${RATE_LATERAL}
       WHERE ct.case_id = cs.id AND ${BILLABLE_STATUS_SQL}))::float8 AS "billTotal",
  SUM((SELECT COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)
       FROM case_tasks ct ${COMMISSION_LATERAL}
       WHERE ct.case_id = cs.id AND ${COMMISSIONABLE_STATUS_SQL}))::float8 AS "commissionTotal"`;
const NULL_MONEY_AGG = `, NULL::float8 AS "billTotal", NULL::float8 AS "commissionTotal"`;

export interface MisSummaryAgg {
  count: number;
  completed: number;
  positive: number;
  negative: number;
  refer: number;
  fraud: number;
  billTotal: number | null;
  commissionTotal: number | null;
}

export interface MisRowsOptions {
  grain: Grain;
  columns: MisColumn[]; // resolved + allowed (money already gated by the service)
  billing: boolean; // task-grain laterals joined?
  filters: AppliedFilter[];
  scope: Scope;
  sortColumn: string; // registry SQL expression (whitelisted, safe to interpolate)
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export interface MisSummaryOptions {
  grain: Grain;
  groupColumn: string; // registry SQL expression (whitelisted)
  billing: boolean;
  filters: AppliedFilter[];
  scope: Scope;
  limit: number;
}

export const misRepository = {
  async rows(o: MisRowsOptions): Promise<{ items: MisRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const where: string[] = [];
    const sp = scopePredicate(params, o.scope, o.grain);
    if (sp) where.push(sp);
    where.push(...filterClauses(o.filters, params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${baseFrom(o.grain)} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const selectList = o.columns.map((c) => `${c.sql} AS "${c.key}"`).join(', ');
    const tie = o.grain === 'case' ? 'cs.id' : 'ct.id';
    const items = await query<MisRow>(
      `SELECT ${selectList} ${fromFor(o.grain, o.billing)} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, ${tie} ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async summary(
    o: MisSummaryOptions,
  ): Promise<{ rows: Array<MisSummaryAgg & { group: string | null }>; grandTotal: MisSummaryAgg }> {
    const params: unknown[] = [];
    const where: string[] = [];
    const sp = scopePredicate(params, o.scope, o.grain);
    if (sp) where.push(sp);
    where.push(...filterClauses(o.filters, params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const agg = o.grain === 'case' ? CASE_SUMMARY_AGG : TASK_SUMMARY_AGG;
    const money = o.billing ? (o.grain === 'case' ? CASE_MONEY_AGG : TASK_MONEY_AGG) : NULL_MONEY_AGG;
    const from = fromFor(o.grain, o.billing);

    const rows = await query<MisSummaryAgg & { group: string | null }>(
      `SELECT ${o.groupColumn} AS "group", ${agg}${money}
       ${from} ${clause}
       GROUP BY ${o.groupColumn}
       ORDER BY count(*) DESC, ${o.groupColumn} ASC NULLS LAST
       LIMIT $${params.length + 1}`,
      [...params, o.limit],
    );
    const [grand] = await query<MisSummaryAgg>(`SELECT ${agg}${money} ${from} ${clause}`, params);
    const grandTotal: MisSummaryAgg = grand ?? {
      count: 0,
      completed: 0,
      positive: 0,
      negative: 0,
      refer: 0,
      fraud: 0,
      billTotal: null,
      commissionTotal: null,
    };
    return { rows, grandTotal };
  },

  /** Scoped + filtered match count — the export guard's pre-check so a ≥threshold set 413s BEFORE the
   *  full projection is fetched. */
  async count(o: { grain: Grain; filters: AppliedFilter[]; scope: Scope }): Promise<number> {
    const params: unknown[] = [];
    const where: string[] = [];
    const sp = scopePredicate(params, o.scope, o.grain);
    if (sp) where.push(sp);
    where.push(...filterClauses(o.filters, params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [row] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${baseFrom(o.grain)} ${clause}`,
      params,
    );
    return row?.count ?? 0;
  },
};
