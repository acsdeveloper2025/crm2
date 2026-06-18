import type { TatPolicy, TatPolicyView, CreateTatPolicyInput, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505'; // uq_tat_policies_hours_active (active band already exists for tat_hours)

// camelCase aliases so pg returns the SDK `TatPolicy` shape directly.
const COLS = `id, tat_hours AS "tatHours", label, is_active AS "isActive",
  effective_from AS "effectiveFrom", effective_to AS "effectiveTo", version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const mapWriteError = (e: unknown, tatHours: number): never => {
  if (pgCode(e) === UNIQUE_VIOLATION)
    throw AppError.conflict('TAT_POLICY_EXISTS', `an active TAT policy already exists for ${tatHours} hours`);
  throw e;
};

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface TatPolicyListOptions {
  active?: boolean;
  /** include superseded (end-dated) versions; default current rows only. */
  history?: boolean;
  search?: string;
  columnFilters?: AppliedFilter[];
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const tatPolicyRepository = {
  async list(o: TatPolicyListOptions): Promise<{ items: TatPolicyView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`label ILIKE $${params.length}`);
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`id = ANY($${params.length})`);
    }
    // default: current rows only (not end-dated); history=true includes superseded versions
    if (!o.history) where.push(`(effective_to IS NULL OR effective_to > now())`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tat_policies ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<TatPolicyView>(
      `SELECT ${COLS} FROM tat_policies ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<TatPolicy | null> {
    const rows = await query<TatPolicy>(`SELECT ${COLS} FROM tat_policies WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** Ascending list of usable (active AND in effect) band hours — used by the TAT classifier (no endpoint). */
  async listUsableHours(): Promise<number[]> {
    const rows = await query<{ tatHours: number }>(
      `SELECT tat_hours AS "tatHours" FROM tat_policies
        WHERE is_active AND effective_from <= now()
        ORDER BY tat_hours ASC`,
    );
    return rows.map((r) => r.tatHours);
  },

  async create(input: CreateTatPolicyInput, userId: string): Promise<TatPolicy> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<TatPolicy>(
          `INSERT INTO tat_policies (tat_hours, label, effective_from, created_by, updated_by)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $4)
           RETURNING ${COLS}`,
          [input.tatHours, input.label, input.effectiveFrom ?? null, userId],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'tat_policies',
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
      return mapWriteError(e, input.tatHours);
    }
  },

  /** Effective-dated revision: end-date the current row, insert a new dated version (same tat_hours). */
  async revise(
    id: number,
    label: string,
    effectiveFrom: string | null,
    userId: string,
    expectedVersion: number,
  ): Promise<TatPolicy> {
    let tatHours = 0;
    try {
      return await withTransaction(async (q) => {
        const [cur] = await q<TatPolicy>(`SELECT ${COLS} FROM tat_policies WHERE id = $1 FOR UPDATE`, [id]);
        if (!cur) throw AppError.notFound('TAT_POLICY_NOT_FOUND');
        if (cur.version !== expectedVersion) throw AppError.stale(cur);
        if (!cur.isActive)
          throw AppError.conflict('TAT_POLICY_NOT_ACTIVE', 'cannot revise an inactive policy');
        tatHours = cur.tatHours;
        // end-date the current row FIRST (so the new open-ended row doesn't violate the active-hours unique index)
        await q(
          `UPDATE tat_policies SET effective_to = COALESCE($2::timestamptz, now()), is_active = false,
             version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1`,
          [id, effectiveFrom, userId],
        );
        const [next] = await q<TatPolicy>(
          `INSERT INTO tat_policies (tat_hours, label, effective_from, created_by, updated_by)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $4)
           RETURNING ${COLS}`,
          [cur.tatHours, label, effectiveFrom, userId],
        );
        if (!next) throw AppError.internal('revise insert returned no row');
        await appendAudit(
          {
            entityType: 'tat_policies',
            entityId: next.id,
            action: 'UPDATE',
            actorId: userId,
            before: cur,
            after: next,
            versionAfter: next.version,
          },
          q,
        );
        return next;
      });
    } catch (e) {
      return mapWriteError(e, tatHours);
    }
  },

  /** Activate/deactivate — version-guarded (ADR-0019); 0 rows → 404 or 409 STALE_UPDATE. */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<TatPolicy> {
    let tatHours = 0;
    try {
      return await withTransaction(async (q) => {
        const [before] = await q<TatPolicy>(`SELECT ${COLS} FROM tat_policies WHERE id = $1`, [id]);
        if (!before) throw AppError.notFound('TAT_POLICY_NOT_FOUND');
        tatHours = before.tatHours;
        const [row] = await q<TatPolicy>(
          `UPDATE tat_policies SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
          [id, isActive, userId, expectedVersion],
        );
        if (!row) throw AppError.stale(before);
        await appendAudit(
          {
            entityType: 'tat_policies',
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
    } catch (e) {
      return mapWriteError(e, tatHours);
    }
  },
};
