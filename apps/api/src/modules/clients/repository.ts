import type { Client, Option, SortOrder } from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';

const SELECT_COLS = `id, code, name, is_active, effective_from, version, created_by, updated_by, created_at, updated_at`;

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface ClientListOptions {
  active?: boolean;
  search?: string;
  /** whitelisted per-column filters (§6); `column` is trusted, `value` is bound as a param. */
  columnFilters?: AppliedFilter[];
  /** restrict to these ids (export `mode:'selected'`); applied on top of scope/filters, bound as a param. */
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const clientRepository = {
  async list(o: ClientListOptions): Promise<{ items: Client[]; totalCount: number }> {
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
      where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    // Per-column filters (§6/§7/§8) combine with AND; whitelisted columns, bound values.
    where.push(...filterClauses(o.columnFilters ?? [], params));
    // Selected-rows export (mode:'selected') — bound id list, ANDed on top of scope/filters.
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`id = ANY($${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM clients ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<Client>(
      `SELECT ${SELECT_COLS} FROM clients ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<Client | null> {
    const rows = await query<Client>(`SELECT ${SELECT_COLS} FROM clients WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** Unpaginated USABLE (active AND in effect — ADR-0017) options for dropdowns (B-22). Optionally
   *  scoped to the actor's portfolio: `ids === undefined` = unrestricted; `[]` = none (fail-closed). */
  async options(ids?: number[]): Promise<Option[]> {
    if (ids !== undefined && ids.length === 0) return [];
    return query<Option>(
      `SELECT id, code, name FROM clients
       WHERE is_active AND effective_from <= now()
         AND ($1::int[] IS NULL OR id = ANY($1))
       ORDER BY name ASC`,
      [ids ?? null],
    );
  },

  async create(
    input: { code: string; name: string; effectiveFrom?: string | undefined },
    userId: string,
  ): Promise<Client> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Client>(
          `INSERT INTO clients (code, name, effective_from, created_by, updated_by)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $4) RETURNING ${SELECT_COLS}`,
          [input.code, input.name, input.effectiveFrom ?? null, userId],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'clients',
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
      if (isUniqueViolation(e))
        throw AppError.conflict('CLIENT_CODE_EXISTS', `code already exists: ${input.code}`);
      throw e;
    }
  },

  /** True if any row references this client (ADR-0020 lock check: CPV links, rates, cases). */
  async hasDependents(id: number): Promise<boolean> {
    const [row] = await query<{ used: boolean }>(
      `SELECT (EXISTS(SELECT 1 FROM client_products WHERE client_id = $1)
            OR EXISTS(SELECT 1 FROM rates WHERE client_id = $1)
            OR EXISTS(SELECT 1 FROM cases WHERE client_id = $1)) AS used`,
      [id],
    );
    return row?.used ?? false;
  },

  /**
   * OCC-guarded update (ADR-0019): applies only at `expectedVersion`; 0 rows → 404 or 409 STALE_UPDATE.
   * `code` is corrected only when provided (ADR-0020 — the service gates it on `hasDependents`).
   */
  async updateRow(
    id: number,
    code: string | undefined,
    name: string,
    effectiveFrom: string | undefined,
    userId: string,
    expectedVersion: number,
    before: Client,
  ): Promise<Client> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Client>(
          `UPDATE clients SET code = COALESCE($2, code), name = $3,
                  effective_from = COALESCE($4::timestamptz, effective_from),
                  version = version + 1, updated_by = $5, updated_at = now()
           WHERE id = $1 AND version = $6 RETURNING ${SELECT_COLS}`,
          [id, code ?? null, name, effectiveFrom ?? null, userId, expectedVersion],
        );
        if (!row) {
          const [current] = await q<Client>(`SELECT ${SELECT_COLS} FROM clients WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('CLIENT_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'clients',
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
      if (isUniqueViolation(e)) throw AppError.conflict('CLIENT_CODE_EXISTS', `code already exists: ${code}`);
      throw e;
    }
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(id: number, isActive: boolean, userId: string, expectedVersion: number): Promise<Client> {
    return withTransaction(async (q) => {
      const [before] = await q<Client>(`SELECT ${SELECT_COLS} FROM clients WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('CLIENT_NOT_FOUND');
      const [row] = await q<Client>(
        `UPDATE clients SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${SELECT_COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'clients',
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
