import type { Department, DepartmentOption, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';

const COLS = `id, name, description, is_active, effective_from, version,
  created_by, updated_by, created_at, updated_at`;

interface CreateRow {
  name: string;
  description: string;
  effectiveFrom?: string | undefined;
}
interface UpdateRow {
  name: string;
  description: string;
  effectiveFrom?: string | undefined;
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface DepartmentListOptions {
  active?: boolean;
  search?: string;
  columnFilters?: AppliedFilter[];
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const departmentRepository = {
  async list(o: DepartmentListOptions): Promise<{ items: Department[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
      // `active=true` means USABLE = active AND in effect (ADR-0017).
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
      `SELECT count(*)::int AS count FROM departments ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<Department>(
      `SELECT ${COLS} FROM departments ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** USABLE departments for the user-form dropdown (active AND in effect). */
  options(): Promise<DepartmentOption[]> {
    return query<DepartmentOption>(
      `SELECT id, name FROM departments WHERE is_active AND effective_from <= now() ORDER BY name`,
    );
  },

  async findById(id: number): Promise<Department | null> {
    const rows = await query<Department>(`SELECT ${COLS} FROM departments WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: CreateRow, userId: string): Promise<Department> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Department>(
          `INSERT INTO departments (name, description, effective_from, created_by, updated_by)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $4) RETURNING ${COLS}`,
          [input.name, input.description, input.effectiveFrom ?? null, userId],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'departments',
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
      if (pgCode(e) === UNIQUE_VIOLATION)
        throw AppError.conflict('DEPARTMENT_EXISTS', 'a department with this name already exists');
      throw e;
    }
  },

  /** OCC-guarded update (ADR-0019); name change is FK-safe (refs are by id). */
  async update(
    id: number,
    input: UpdateRow,
    userId: string,
    expectedVersion: number,
    before: Department,
  ): Promise<Department> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Department>(
          `UPDATE departments SET name = $2, description = $3,
                  effective_from = COALESCE($4::timestamptz, effective_from),
                  version = version + 1, updated_by = $5, updated_at = now()
           WHERE id = $1 AND version = $6 RETURNING ${COLS}`,
          [id, input.name, input.description, input.effectiveFrom ?? null, userId, expectedVersion],
        );
        if (!row) {
          const [current] = await q<Department>(`SELECT ${COLS} FROM departments WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('DEPARTMENT_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'departments',
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
      if (pgCode(e) === UNIQUE_VIOLATION)
        throw AppError.conflict('DEPARTMENT_EXISTS', 'a department with this name already exists');
      throw e;
    }
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<Department> {
    return withTransaction(async (q) => {
      const [before] = await q<Department>(`SELECT ${COLS} FROM departments WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('DEPARTMENT_NOT_FOUND');
      const [row] = await q<Department>(
        `UPDATE departments SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'departments',
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
