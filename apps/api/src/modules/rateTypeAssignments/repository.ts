import type {
  CreateRateTypeAssignmentInput,
  RateTypeAssignment,
  RateTypeAssignmentView,
  SortOrder,
} from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const FK_VIOLATION = '23503';

// Bare-row columns (camelCased) for the create/deactivate RETURNING. The rate_types display fields are
// resolved via correlated subqueries (NOT a JOIN) so a single INSERT/UPDATE … RETURNING emits the code +
// name without a self-join — a data-modifying CTE's own write isn't visible to a same-statement table scan
// (snapshot is pre-statement), so the commission pattern of correlated subqueries is the correct one.
const RETURNING_COLS = `id, client_id AS "clientId", product_id AS "productId",
  verification_unit_id AS "verificationUnitId", rate_type_id AS "rateTypeId",
  (SELECT code FROM rate_types WHERE id = rate_type_assignments.rate_type_id) AS "rateTypeCode",
  (SELECT name FROM rate_types WHERE id = rate_type_assignments.rate_type_id) AS "rateTypeName",
  is_active AS "isActive", created_by AS "createdBy", updated_by AS "updatedBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

// Shared FROM + joins for the list/record view. client is required (INNER); product/unit are LEFT —
// NULL = Universal (mig 0096), so their display names come back NULL.
const RTA_FROM = `FROM rate_type_assignments a
  JOIN rate_types rt ON rt.id = a.rate_type_id
  LEFT JOIN clients c ON c.id = a.client_id
  LEFT JOIN products p ON p.id = a.product_id
  LEFT JOIN verification_units vu ON vu.id = a.verification_unit_id`;

// Full view columns (list + record page) — bare row + the joined client/product/unit display names.
const VIEW_COLS = `a.id, a.client_id AS "clientId", a.product_id AS "productId",
  a.verification_unit_id AS "verificationUnitId", a.rate_type_id AS "rateTypeId",
  rt.code AS "rateTypeCode", rt.name AS "rateTypeName",
  a.is_active AS "isActive", a.created_by AS "createdBy", a.updated_by AS "updatedBy",
  a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  c.code AS "clientCode", c.name AS "clientName",
  p.code AS "productCode", p.name AS "productName",
  vu.name AS "verificationUnitName"`;

const mapWriteError = (e: unknown): never => {
  if (pgCode(e) === FK_VIOLATION)
    throw AppError.badRequest(
      'INVALID_ASSIGNMENT_REF',
      'unknown client, product, verification unit, or rate type',
    );
  throw e;
};

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface RateTypeAssignmentListOptions {
  clientId?: number;
  active?: boolean;
  search?: string;
  columnFilters?: AppliedFilter[];
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const rateTypeAssignmentRepository = {
  async list(
    o: RateTypeAssignmentListOptions,
  ): Promise<{ items: RateTypeAssignmentView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, val: unknown) => {
      params.push(val);
      where.push(clause.replace('$?', `$${params.length}`));
    };
    if (o.clientId !== undefined) add('a.client_id = $?', o.clientId);
    if (o.active !== undefined) add('a.is_active = $?', o.active);
    if (o.search) {
      params.push(likeContains(o.search));
      const n = params.length;
      where.push(
        `(c.name ILIKE $${n} OR c.code ILIKE $${n} OR p.name ILIKE $${n} OR p.code ILIKE $${n} OR vu.name ILIKE $${n} OR rt.code ILIKE $${n} OR rt.name ILIKE $${n})`,
      );
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`a.id = ANY($${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${RTA_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<RateTypeAssignmentView>(
      `SELECT ${VIEW_COLS} ${RTA_FROM} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, a.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** A single assignment joined with its display fields (the record-page loader). */
  async findView(id: number): Promise<RateTypeAssignmentView | null> {
    const rows = await query<RateTypeAssignmentView>(`SELECT ${VIEW_COLS} ${RTA_FROM} WHERE a.id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** Idempotent create: re-creating the same (client × product × unit × rate_type) combo re-activates it
   *  (NULLS-NOT-DISTINCT unique key, mig 0096) rather than inserting a duplicate. */
  async create(input: CreateRateTypeAssignmentInput, userId: string): Promise<RateTypeAssignment> {
    try {
      const [row] = await query<RateTypeAssignment>(
        `INSERT INTO rate_type_assignments
           (client_id, product_id, verification_unit_id, rate_type_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (client_id, product_id, verification_unit_id, rate_type_id)
         DO UPDATE SET is_active = true, updated_by = $5, updated_at = now()
         RETURNING ${RETURNING_COLS}`,
        [input.clientId, input.productId, input.verificationUnitId, input.rateTypeId, userId],
      );
      if (!row) throw AppError.internal('insert returned no row');
      return row;
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Deactivate by id (soft toggle; no OCC — assignments are simple active flags). 0 rows → 404. */
  async deactivate(id: number, userId: string): Promise<RateTypeAssignment> {
    const [row] = await query<RateTypeAssignment>(
      `UPDATE rate_type_assignments SET is_active = false, updated_by = $2, updated_at = now()
        WHERE id = $1 RETURNING ${RETURNING_COLS}`,
      [id, userId],
    );
    if (!row) throw AppError.notFound('RATE_TYPE_ASSIGNMENT_NOT_FOUND');
    return row;
  },

  /** Bulk deactivate (UX-11): no version column, so no per-row OCC — one `UPDATE ... WHERE id =
   *  ANY($1)` deactivates every matching row in a single statement; a NOT_FOUND id is whatever's in
   *  the input set but absent from the RETURNING ids (never existed, or was already deactivated —
   *  the WHERE also requires `is_active` so a re-deactivate isn't reported as OK). */
  async bulkDeactivate(ids: number[], userId: string): Promise<{ okIds: number[]; notFoundIds: number[] }> {
    const rows = await query<{ id: number }>(
      `UPDATE rate_type_assignments SET is_active = false, updated_by = $2, updated_at = now()
        WHERE id = ANY($1) AND is_active RETURNING id`,
      [ids, userId],
    );
    const okSet = new Set(rows.map((r) => r.id));
    const notFoundIds = ids.filter((id) => !okSet.has(id));
    return { okIds: [...okSet], notFoundIds };
  },
};
