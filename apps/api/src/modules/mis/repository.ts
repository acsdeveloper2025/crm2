import type { MisRow, SortOrder } from '@crm2/sdk';
import { filterClauses, type AppliedFilter } from '../../platform/pagination.js';
import { query } from '../../platform/db.js';
import { taskScopePredicate, type Scope } from '../../platform/scope/index.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';
import type { MisColumn } from './reportTypes.js';

/**
 * MIS TASK_OPERATIONAL repository (ADR-0084). All joins are 1:1 (or the assigned/applicant LEFT joins)
 * so no row fans out; case_tasks stays the row grain. The billing laterals (rt/com) are appended to the
 * FROM ONLY when the actor holds billing.view (`billing`) — the money-gate is lateral-presence, not a
 * SELECT-time null-swap, so a non-billing query never even resolves rate/commission. The scope predicate
 * (out-of-scope ⇒ 0 rows) and the bound column filters are shared between the COUNT and the page.
 */
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

/** Grouped aggregates for the Summary format. Money totals reuse billing's exact idioms:
 *  bill = `SUM(bill_amount × bill_count) FILTER (COMPLETED)`, commission = `SUM(COALESCE(snapshot,
 *  live) × bill_count) FILTER (SUBMITTED|COMPLETED)`. FROM stays 1:1 + LATERAL…LIMIT 1, so the sums
 *  are exact (no fan-out). Without billing.view the money totals are NULL (laterals not even joined). */
const SUMMARY_AGG = `
  count(*)::int AS count,
  count(*) FILTER (WHERE ct.status = 'COMPLETED')::int AS completed,
  count(*) FILTER (WHERE ct.verification_outcome = 'POSITIVE')::int AS positive,
  count(*) FILTER (WHERE ct.verification_outcome = 'NEGATIVE')::int AS negative,
  count(*) FILTER (WHERE ct.verification_outcome = 'REFER')::int AS refer,
  count(*) FILTER (WHERE ct.verification_outcome = 'FRAUD')::int AS fraud`;
const MONEY_AGG = `,
  SUM(rt.bill_amount * ct.bill_count) FILTER (WHERE ct.status = 'COMPLETED')::float8 AS "billTotal",
  SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count)
    FILTER (WHERE ct.status IN ('SUBMITTED','COMPLETED'))::float8 AS "commissionTotal"`;
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

export interface MisSummaryOptions {
  groupColumn: string; // registry SQL expression (whitelisted, safe to interpolate)
  billing: boolean;
  filters: AppliedFilter[];
  scope: Scope;
  limit: number;
}

export interface MisRowsOptions {
  columns: MisColumn[]; // resolved + allowed (money already gated by the service)
  billing: boolean; // laterals joined?
  filters: AppliedFilter[];
  scope: Scope;
  sortColumn: string; // registry SQL expression (whitelisted, safe to interpolate)
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const misRepository = {
  async rows(o: MisRowsOptions): Promise<{ items: MisRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const where: string[] = [];
    const scopePred = taskScopePredicate(params, o.scope);
    if (scopePred) where.push(scopePred);
    where.push(...filterClauses(o.filters, params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // COUNT over the base 1:1 FROM (no laterals): every filterable column is on a base join (money is
    // never filterable), so the count is exact and the laterals stay off the count path.
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${MIS_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const selectList = o.columns.map((c) => `${c.sql} AS "${c.key}"`).join(', ');
    const from = o.billing ? MIS_FROM_BILLING : MIS_FROM;
    const items = await query<MisRow>(
      `SELECT ${selectList} ${from} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, ct.id ${o.sortOrder}
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
    const scopePred = taskScopePredicate(params, o.scope);
    if (scopePred) where.push(scopePred);
    where.push(...filterClauses(o.filters, params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = o.billing ? MIS_FROM_BILLING : MIS_FROM;
    const money = o.billing ? MONEY_AGG : NULL_MONEY_AGG;

    const rows = await query<MisSummaryAgg & { group: string | null }>(
      `SELECT ${o.groupColumn} AS "group", ${SUMMARY_AGG}${money}
       ${from} ${clause}
       GROUP BY ${o.groupColumn}
       ORDER BY count(*) DESC, ${o.groupColumn} ASC NULLS LAST
       LIMIT $${params.length + 1}`,
      [...params, o.limit],
    );
    // Grand total over ALL matching rows (not just the capped groups) — a separate ungrouped aggregate.
    const [grand] = await query<MisSummaryAgg>(`SELECT ${SUMMARY_AGG}${money} ${from} ${clause}`, params);
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
};
