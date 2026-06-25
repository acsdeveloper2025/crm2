import type { RateType, RateTypeOption, RateTypeCategory, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';

const COLS = `id, code, name, description, category, sort_order, is_active,
  effective_from, version, created_by, updated_by, created_at, updated_at`;

interface CreateRow {
  code: string;
  name: string;
  description?: string | null | undefined;
  category: RateTypeCategory;
  sortOrder?: number | undefined;
  effectiveFrom?: string | undefined;
}
interface UpdateRow {
  name: string;
  description?: string | null | undefined;
  category: RateTypeCategory;
  sortOrder?: number | undefined;
  effectiveFrom?: string | undefined;
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface RateTypeListOptions {
  active?: boolean;
  search?: string;
  columnFilters?: AppliedFilter[];
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

const mapWriteError = (e: unknown): never => {
  if (pgCode(e) === UNIQUE_VIOLATION)
    throw AppError.conflict('RATE_TYPE_EXISTS', 'a rate type with this code already exists');
  throw e;
};

export const rateTypeRepository = {
  async list(o: RateTypeListOptions): Promise<{ items: RateType[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
      if (o.active) where.push(`effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(
        `(code ILIKE $${params.length} OR name ILIKE $${params.length} OR description ILIKE $${params.length})`,
      );
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`id = ANY($${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM rate_types ${clause}`,
      params,
    );
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<RateType>(
      `SELECT ${COLS} FROM rate_types ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount: countRow?.count ?? 0 };
  },

  /** USABLE rate types for a dropdown (active AND in effect). Replaces the old bare list(). */
  options(activeOnly = true): Promise<RateTypeOption[]> {
    const clause = activeOnly ? 'WHERE is_active AND effective_from <= now()' : '';
    return query<RateTypeOption>(
      `SELECT id, code, category FROM rate_types ${clause} ORDER BY sort_order, code`,
    );
  },

  /** Rate types AVAILABLE for a (client × product × verification_unit) combo (ADR-0067, Phase B):
   *  the active assignments, intersected with usable (active + in-effect) rate types. */
  available(clientId: number, productId: number, unitId: number): Promise<RateTypeOption[]> {
    return query<RateTypeOption>(
      `SELECT rt.id, rt.code, rt.category
         FROM rate_type_assignments a
         JOIN rate_types rt ON rt.id = a.rate_type_id
        WHERE a.client_id = $1 AND a.product_id = $2 AND a.verification_unit_id = $3
          AND a.is_active AND rt.is_active AND rt.effective_from <= now()
        ORDER BY rt.sort_order, rt.code`,
      [clientId, productId, unitId],
    );
  },

  async findById(id: number): Promise<RateType | null> {
    const rows = await query<RateType>(`SELECT ${COLS} FROM rate_types WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: CreateRow, userId: string): Promise<RateType> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<RateType>(
          `INSERT INTO rate_types (code, name, description, category, sort_order, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6::timestamptz, now()), $7, $7) RETURNING ${COLS}`,
          [
            input.code,
            input.name,
            input.description ?? null,
            input.category,
            input.sortOrder ?? null,
            input.effectiveFrom ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'rate_types',
            entityId: row.id,
            action: 'CREATE',
            actorId: userId,
            after: row,
            versionAfter: row.version,
          },
          q,
        );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** OCC-guarded update (ADR-0019). `code` is NOT updatable (it is the FK key). */
  async update(
    id: number,
    input: UpdateRow,
    userId: string,
    expectedVersion: number,
    before: RateType,
  ): Promise<RateType> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<RateType>(
          `UPDATE rate_types SET name = $2, description = $3, category = $4,
                  sort_order = COALESCE($5, sort_order),
                  effective_from = COALESCE($6::timestamptz, effective_from),
                  version = version + 1, updated_by = $7, updated_at = now()
           WHERE id = $1 AND version = $8 RETURNING ${COLS}`,
          [
            id,
            input.name,
            input.description ?? null,
            input.category,
            input.sortOrder ?? null,
            input.effectiveFrom ?? null,
            userId,
            expectedVersion,
          ],
        );
        if (!row) {
          const [current] = await q<RateType>(`SELECT ${COLS} FROM rate_types WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'rate_types',
            entityId: id,
            action: 'UPDATE',
            actorId: userId,
            before,
            after: row,
            versionAfter: row.version,
          },
          q,
        );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(id: number, isActive: boolean, userId: string, expectedVersion: number): Promise<RateType> {
    return withTransaction(async (q) => {
      const [before] = await q<RateType>(`SELECT ${COLS} FROM rate_types WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
      const [row] = await q<RateType>(
        `UPDATE rate_types SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'rate_types',
          entityId: id,
          action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
          actorId: userId,
          before,
          after: row,
          versionAfter: row.version,
        },
        q,
      );
      return row;
    });
  },
};
