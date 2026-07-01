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
};
