import type { Designation, DesignationOption, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';

/** Includes the joined department name via a correlated subquery (keeps list COUNT join-free). */
const COLS = `id, name, description, department_id,
  (SELECT dp.name FROM departments dp WHERE dp.id = designations.department_id) AS department_name,
  is_active, effective_from, version, created_by, updated_by, created_at, updated_at`;

interface WriteRow {
  name: string;
  description: string;
  departmentId?: number | null | undefined;
  effectiveFrom?: string | undefined;
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface DesignationListOptions {
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
    throw AppError.conflict('DESIGNATION_EXISTS', 'a designation with this name already exists');
  if (pgCode(e) === FK_VIOLATION)
    throw AppError.badRequest('INVALID_REFERENCE', { reason: 'departmentId does not exist' });
  throw e;
};

export const designationRepository = {
  async list(o: DesignationListOptions): Promise<{ items: Designation[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
      if (o.active) where.push(`effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`id = ANY($${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM designations ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<Designation>(
      `SELECT ${COLS} FROM designations ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** USABLE designations for the user-form dropdown (active AND in effect). */
  options(): Promise<DesignationOption[]> {
    return query<DesignationOption>(
      `SELECT id, name FROM designations WHERE is_active AND effective_from <= now() ORDER BY name`,
    );
  },

  async findById(id: number): Promise<Designation | null> {
    const rows = await query<Designation>(`SELECT ${COLS} FROM designations WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: WriteRow, userId: string): Promise<Designation> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Designation>(
          `INSERT INTO designations (name, description, department_id, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $5) RETURNING ${COLS}`,
          [input.name, input.description, input.departmentId ?? null, input.effectiveFrom ?? null, userId],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'designations',
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

  /** OCC-guarded update (ADR-0019); name change is FK-safe (refs are by id). */
  async update(
    id: number,
    input: WriteRow,
    userId: string,
    expectedVersion: number,
    before: Designation,
  ): Promise<Designation> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Designation>(
          `UPDATE designations SET name = $2, description = $3, department_id = $4,
                  effective_from = COALESCE($5::timestamptz, effective_from),
                  version = version + 1, updated_by = $6, updated_at = now()
           WHERE id = $1 AND version = $7 RETURNING ${COLS}`,
          [
            id,
            input.name,
            input.description,
            input.departmentId ?? null,
            input.effectiveFrom ?? null,
            userId,
            expectedVersion,
          ],
        );
        if (!row) {
          const [current] = await q<Designation>(`SELECT ${COLS} FROM designations WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('DESIGNATION_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'designations',
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
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<Designation> {
    return withTransaction(async (q) => {
      const [before] = await q<Designation>(`SELECT ${COLS} FROM designations WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('DESIGNATION_NOT_FOUND');
      const [row] = await q<Designation>(
        `UPDATE designations SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'designations',
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
