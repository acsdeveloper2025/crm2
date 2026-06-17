import type { Location, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const COLS = `id, pincode, area, city, state, country, is_active, effective_from, version, created_by, updated_by, created_at, updated_at`;

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface LocationListOptions {
  active?: boolean;
  /** exact pincode — the rate cascade lists the areas under a pincode. */
  pincode?: string;
  search?: string;
  /** whitelisted per-column filters (§6); columns trusted, values bound (trgm-indexed). */
  columnFilters?: AppliedFilter[];
  /** restrict to these ids (export `mode:'selected'`); applied on top of scope/filters, bound as a param. */
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const locationRepository = {
  // The catalog holds the full all-India directory (~157k rows); always paginated server-side.
  async list(o: LocationListOptions): Promise<{ items: Location[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
      // `active=true` means USABLE = active AND in effect (ADR-0017).
      if (o.active) where.push(`effective_from <= now()`);
    }
    if (o.pincode) {
      params.push(o.pincode);
      where.push(`pincode = $${params.length}`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(
        `(pincode ILIKE $${params.length} OR area ILIKE $${params.length} OR city ILIKE $${params.length} OR state ILIKE $${params.length})`,
      );
    }
    // Per-column filters (§6/§8) combine with AND; whitelisted columns, bound values.
    where.push(...filterClauses(o.columnFilters ?? [], params));
    // Selected-rows export (mode:'selected') — bound id list, ANDed on top of scope/filters
    // (integer PK, index-served; does not disturb the trgm-indexed filter clauses above).
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`id = ANY($${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM locations ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<Location>(
      `SELECT ${COLS} FROM locations ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** Distinct pincodes matching a prefix — for the cascade's searchable pincode picker. */
  async pincodes(q: string | undefined): Promise<string[]> {
    const params: unknown[] = [];
    // Operational read (rate cascade): only USABLE rows (ADR-0017).
    let clause = 'WHERE is_active AND effective_from <= now()';
    if (q) {
      params.push(`${q}%`);
      clause += ` AND pincode LIKE $${params.length}`;
    }
    const rows = await query<{ pincode: string }>(
      `SELECT DISTINCT pincode FROM locations ${clause} ORDER BY pincode LIMIT 50`,
      params,
    );
    return rows.map((r) => r.pincode);
  },

  async findById(id: number): Promise<Location | null> {
    const rows = await query<Location>(`SELECT ${COLS} FROM locations WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** Resolve a USABLE location by its pincode + area (case-insensitive) — for rate import code→id. */
  async findByPincodeArea(pincode: string, area: string): Promise<Location | null> {
    const rows = await query<Location>(
      `SELECT ${COLS} FROM locations
       WHERE pincode = $1 AND lower(area) = lower($2) AND is_active AND effective_from <= now()
       ORDER BY id LIMIT 1`,
      [pincode, area],
    );
    return rows[0] ?? null;
  },

  async create(
    input: {
      pincode: string;
      area: string;
      city: string;
      state: string;
      country: string;
      effectiveFrom?: string | undefined;
    },
    userId: string,
  ): Promise<Location> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Location>(
          `INSERT INTO locations (pincode, area, city, state, country, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $7) RETURNING ${COLS}`,
          [
            input.pincode,
            input.area,
            input.city,
            input.state,
            input.country,
            input.effectiveFrom ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'locations',
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
        throw AppError.conflict(
          'LOCATION_EXISTS',
          `pincode+area already exists: ${input.pincode}/${input.area}`,
        );
      throw e;
    }
  },

  /** OCC-guarded update (ADR-0019): applies only at `expectedVersion`; 0 rows → 404 or 409 STALE_UPDATE. */
  /** True if any row references this location (ADR-0020 lock check: rates). */
  async hasDependents(id: number): Promise<boolean> {
    const [row] = await query<{ used: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM rates WHERE location_id = $1) AS used`,
      [id],
    );
    return row?.used ?? false;
  },

  async update(
    id: number,
    input: {
      pincode?: string | undefined;
      area: string;
      city: string;
      state: string;
      country: string;
      effectiveFrom?: string | undefined;
    },
    userId: string,
    expectedVersion: number,
    before: Location,
  ): Promise<Location> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Location>(
          `UPDATE locations SET pincode = COALESCE($2, pincode), area = $3, city = $4, state = $5, country = $6,
                  effective_from = COALESCE($7::timestamptz, effective_from),
                  version = version + 1, updated_by = $8, updated_at = now()
           WHERE id = $1 AND version = $9 RETURNING ${COLS}`,
          [
            id,
            input.pincode ?? null,
            input.area,
            input.city,
            input.state,
            input.country,
            input.effectiveFrom ?? null,
            userId,
            expectedVersion,
          ],
        );
        if (!row) {
          const [current] = await q<Location>(`SELECT ${COLS} FROM locations WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('LOCATION_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'locations',
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
      if (isUniqueViolation(e))
        throw AppError.conflict('LOCATION_EXISTS', 'another location already uses this pincode+area');
      throw e;
    }
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(id: number, isActive: boolean, userId: string, expectedVersion: number): Promise<Location> {
    return withTransaction(async (q) => {
      const [before] = await q<Location>(`SELECT ${COLS} FROM locations WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('LOCATION_NOT_FOUND');
      const [row] = await q<Location>(
        `UPDATE locations SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'locations',
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
