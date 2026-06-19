import type { ReportLayoutColumn, ColumnDataType } from '@crm2/sdk';
import { query } from '../../platform/db.js';
import { composeScopePredicate, type Scope } from '../../platform/scope/index.js';
import { likeContains } from '../../platform/pagination.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';
import { resolveColumns } from './resolver.js';

/**
 * CASE-grain visibility predicate, local copy (mirrors billing/repository.ts by design — module
 * boundary). FROM contract: `cases cs`.
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

// Base FROM — same table aliases that RATE_LATERAL / COMMISSION_LATERAL assume.
const BASE_FROM = `FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id`;

export interface MisColumn {
  key: string;
  header: string;
  dataType: ColumnDataType;
}

export interface MisRowsOptions {
  /** Already money-filtered by the service. */
  columns: ReportLayoutColumn[];
  scope: Scope;
  clientId: number;
  productId: number;
  completedFrom?: string;
  completedTo?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface MisRowsResult {
  rows: Array<Record<string, unknown>>;
  totalCount: number;
  columns: MisColumn[];
}

/**
 * Append WHERE conditions to `params` (mutates). Numbering continues from `params.length + 1`.
 */
function buildMisWhere(o: MisRowsOptions, params: unknown[]): string {
  const where: string[] = [`ct.status = 'COMPLETED'`];
  const add = (clause: string, val: unknown) => {
    params.push(val);
    where.push(clause.replace('$?', `$${params.length}`));
  };

  add('cs.client_id = $?', o.clientId);
  add('cs.product_id = $?', o.productId);

  if (o.completedFrom !== undefined) add('ct.completed_at >= $?', o.completedFrom);
  if (o.completedTo !== undefined) add('ct.completed_at <= $?', o.completedTo);

  if (o.search) {
    params.push(likeContains(o.search));
    const n = params.length;
    where.push(
      `(cs.case_number ILIKE $${n} OR cl.name ILIKE $${n} OR p.name ILIKE $${n} OR ct.task_number ILIKE $${n})`,
    );
  }

  const scopePred = caseScopePredicate(params, o.scope);
  if (scopePred) where.push(scopePred);

  return `WHERE ${where.join(' AND ')}`;
}

export const misRepository = {
  async misRows(o: MisRowsOptions): Promise<MisRowsResult> {
    // --- COUNT (fresh params, no SELECT phase) ---
    const countParams: unknown[] = [];
    const countWhere = buildMisWhere(o, countParams);
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${BASE_FROM} ${countWhere}`,
      countParams,
    );
    const totalCount = countRow?.count ?? 0;

    if (o.columns.length === 0) {
      return { rows: [], totalCount, columns: [] };
    }

    // --- ROWS: SELECT params first ($1..$k), WHERE continues at $(k+1) ---
    const rowParams: unknown[] = [];
    const resolved = resolveColumns(o.columns, rowParams);
    // k = rowParams.length (after resolveColumns pushes any FREE-source params)

    const rowWhere = buildMisWhere(o, rowParams);

    // Conditional JOINs
    const joins: string[] = [
      // Always include vu + au (TASK_FIELD unit_name / assignee_name need them)
      'JOIN verification_units vu ON vu.id = ct.verification_unit_id',
      'LEFT JOIN users au ON au.id = ct.assigned_to',
    ];
    if (resolved.needsApplicant) {
      joins.push('LEFT JOIN case_applicants ap ON ap.id = ct.applicant_id');
    }
    if (resolved.needsDataEntry) {
      joins.push('LEFT JOIN case_data_entries de ON de.case_id = cs.id');
    }
    if (resolved.needsRate) {
      joins.push(RATE_LATERAL);
    }
    if (resolved.needsCommission) {
      joins.push(COMMISSION_LATERAL);
    }

    const limitN = rowParams.length + 1;
    const offsetN = rowParams.length + 2;
    const selectList = resolved.selects.join(', ');

    const rawRows = await query<Record<string, unknown>>(
      `SELECT ${selectList}
       ${BASE_FROM}
       ${joins.join('\n       ')}
       ${rowWhere}
       ORDER BY ct.completed_at DESC, ct.id DESC
       LIMIT $${limitN} OFFSET $${offsetN}`,
      [...rowParams, o.limit, o.offset],
    );

    // Map positional aliases "c0","c1",… back to layout columnKey for the client response.
    // The query helper camelCases keys — "c0" has no underscore so it passes through unchanged.
    const keyedRows = rawRows.map((row) => {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < o.columns.length; i++) {
        const layoutCol = o.columns[i]!;
        out[layoutCol.columnKey] = row[`c${i}`] ?? null;
      }
      return out;
    });

    // Build the client-facing column descriptors (using columnKey + headerLabel from the layout).
    const columns: MisColumn[] = o.columns.map((c) => ({
      key: c.columnKey,
      header: c.headerLabel,
      dataType: c.dataType,
    }));

    return { rows: keyedRows, totalCount, columns };
  },
};
