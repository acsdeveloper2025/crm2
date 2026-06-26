import type {
  ClientProduct,
  ClientProductView,
  ClientProductVerificationUnit,
  ClientProductVerificationUnitView,
  CpvUnitListQuery,
  SortOrder,
} from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';

const CP_COLS = `id, client_id, product_id, is_active, effective_from, version, created_at, updated_at`;
const CPV_COLS = `id, client_product_id, verification_unit_id, is_active, effective_from, version, created_at, updated_at`;

// Shared FROM for the list COUNT + items — both 1:1 joins (cp.client_id/product_id → PK), so
// count(*) over the join == #client_products rows (no fan-out).
const CP_FROM = `FROM client_products cp
  JOIN clients c ON c.id = cp.client_id
  JOIN products p ON p.id = cp.product_id`;

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface ClientProductListOptions {
  clientId?: number;
  active?: boolean;
  search?: string;
  /** whitelisted per-column filters (§6); columns trusted (joined cols OK — shared CP_FROM). */
  columnFilters?: AppliedFilter[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const clientProductRepository = {
  async list(o: ClientProductListOptions): Promise<{ items: ClientProductView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.clientId !== undefined) {
      params.push(o.clientId);
      where.push(`cp.client_id = $${params.length}`);
    }
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`cp.is_active = $${params.length}`);
      // `active=true` means USABLE = active AND in effect (ADR-0017).
      if (o.active) where.push(`cp.effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      const n = params.length;
      where.push(`(c.code ILIKE $${n} OR c.name ILIKE $${n} OR p.code ILIKE $${n} OR p.name ILIKE $${n})`);
    }
    // Per-column filters (§6/§7/§8) combine with AND; whitelisted columns, bound values.
    where.push(...filterClauses(o.columnFilters ?? [], params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${CP_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate. `cp.id`
    // tiebreaker is qualified (bare `id` is ambiguous across the join).
    const items = await query<ClientProductView>(
      `SELECT cp.id, cp.client_id, cp.product_id, cp.is_active, cp.effective_from, cp.version,
              cp.created_at, cp.updated_at,
              c.code AS client_code, c.name AS client_name,
              p.code AS product_code, p.name AS product_name,
              (SELECT count(*) FROM client_product_verification_units x
               WHERE x.client_product_id = cp.id AND x.is_active)::int AS unit_count
       ${CP_FROM}
       ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, cp.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<ClientProduct | null> {
    const rows = await query<ClientProduct>(`SELECT ${CP_COLS} FROM client_products WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /**
   * USABLE links (active AND in effect — ADR-0017) as `{ id, clientId, productId }`, for the cpv-unit
   * import to map a client+product CODE pair → the existing client_product id (mirrors the USABLE-only
   * `options()` feeds the clientProduct import resolves against; a future/inactive link won't resolve).
   */
  async linkOptionsForImport(): Promise<{ id: number; clientId: number; productId: number }[]> {
    return query<{ id: number; clientId: number; productId: number }>(
      `SELECT id, client_id, product_id FROM client_products
       WHERE is_active AND effective_from <= now()`,
      [],
    );
  },

  async create(
    input: {
      clientId: number;
      productId: number;
      effectiveFrom?: string | undefined;
    },
    userId: string,
  ): Promise<ClientProduct> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<ClientProduct>(
          `INSERT INTO client_products (client_id, product_id, effective_from)
           VALUES ($1, $2, COALESCE($3::timestamptz, now())) RETURNING ${CP_COLS}`,
          [input.clientId, input.productId, input.effectiveFrom ?? null],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'client_products',
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
        throw AppError.conflict('CLIENT_PRODUCT_EXISTS', 'this product is already linked to the client');
      if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
      throw e;
    }
  },

  /**
   * Reschedule effective-from (the only mutable field; client/product keys are immutable).
   * OCC-guarded (ADR-0019): applies at `expectedVersion`; 0 rows → 404 or 409 STALE_UPDATE.
   */
  async updateEffectiveFrom(
    id: number,
    effectiveFrom: string,
    userId: string,
    expectedVersion: number,
  ): Promise<ClientProduct> {
    return withTransaction(async (q) => {
      const [before] = await q<ClientProduct>(`SELECT ${CP_COLS} FROM client_products WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('CLIENT_PRODUCT_NOT_FOUND');
      const [row] = await q<ClientProduct>(
        `UPDATE client_products SET effective_from = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $3 RETURNING ${CP_COLS}`,
        [id, effectiveFrom, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'client_products',
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
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<ClientProduct> {
    return withTransaction(async (q) => {
      const [before] = await q<ClientProduct>(`SELECT ${CP_COLS} FROM client_products WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('CLIENT_PRODUCT_NOT_FOUND');
      const [row] = await q<ClientProduct>(
        `UPDATE client_products SET is_active = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $3 RETURNING ${CP_COLS}`,
        [id, isActive, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'client_products',
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

/**
 * One enabled-unit row carrying the resolvable CODES (client/product/unit) — the export shape. The
 * codes are the keys the cpv-unit import consumes, so an export re-imports losslessly. Names ride
 * alongside for readability (the import ignores them). Not in @crm2/sdk: this is an API-internal
 * export projection (additive; no contract change).
 */
export interface CpvUnitExportRow {
  clientCode: string;
  clientName: string;
  productCode: string;
  productName: string;
  unitCode: string;
  unitName: string;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

/** Resolved, validated export-list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface CpvUnitExportOptions {
  active?: boolean;
  search?: string;
  /** whitelisted per-column filters (§6); columns trusted (joined cols OK — shared CPV_EXPORT_FROM). */
  columnFilters?: AppliedFilter[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

// Shared FROM for the export COUNT + items — all 1:1 joins (FK → PK), so count(*) over the join ==
// #client_product_verification_units rows (no fan-out). Mirrors clientProduct's CP_FROM, one join deeper.
const CPV_EXPORT_FROM = `FROM client_product_verification_units cpvu
  JOIN client_products cp ON cp.id = cpvu.client_product_id
  JOIN clients c ON c.id = cp.client_id
  JOIN products p ON p.id = cp.product_id
  JOIN verification_units vu ON vu.id = cpvu.verification_unit_id`;

export const cpvUnitRepository = {
  /**
   * Export list across ALL client-products (B-13): joins each enabled unit to its client/product/unit
   * CODES so the export re-imports losslessly. Mirrors `clientProductRepository.list` shape
   * (active/search/filters/sort/limit/offset) so the service can drive it with the same export modes.
   */
  async listForExport(o: CpvUnitExportOptions): Promise<{ items: CpvUnitExportRow[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`cpvu.is_active = $${params.length}`);
      // `active=true` means USABLE = active AND in effect (ADR-0017).
      if (o.active) where.push(`cpvu.effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      const n = params.length;
      where.push(
        `(c.code ILIKE $${n} OR c.name ILIKE $${n} OR p.code ILIKE $${n} OR p.name ILIKE $${n} OR vu.code ILIKE $${n} OR vu.name ILIKE $${n})`,
      );
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${CPV_EXPORT_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate. `cpvu.id`
    // tiebreaker is qualified (bare `id` is ambiguous across the join).
    const items = await query<CpvUnitExportRow>(
      `SELECT c.code AS client_code, c.name AS client_name,
              p.code AS product_code, p.name AS product_name,
              vu.code AS unit_code, vu.name AS unit_name,
              cpvu.effective_from, cpvu.created_at, cpvu.updated_at, cpvu.is_active
       ${CPV_EXPORT_FROM}
       ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, cpvu.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async list(q: CpvUnitListQuery): Promise<ClientProductVerificationUnitView[]> {
    const params: unknown[] = [q.clientProductId];
    let clause = `WHERE cpvu.client_product_id = $1`;
    if (q.active !== undefined) {
      params.push(q.active);
      clause += ` AND cpvu.is_active = $${params.length}`;
      // `active=true` means USABLE = active AND in effect (ADR-0017).
      if (q.active) clause += ` AND cpvu.effective_from <= now()`;
    }
    return query<ClientProductVerificationUnitView>(
      `SELECT cpvu.id, cpvu.client_product_id, cpvu.verification_unit_id, cpvu.is_active,
              cpvu.effective_from, cpvu.version, cpvu.created_at, cpvu.updated_at,
              vu.code AS unit_code, vu.name AS unit_name, vu.worker_role AS unit_worker_role
       FROM client_product_verification_units cpvu
       JOIN verification_units vu ON vu.id = cpvu.verification_unit_id
       ${clause}
       ORDER BY vu.sort_order, vu.name`,
      params,
    );
  },

  async findById(id: number): Promise<ClientProductVerificationUnit | null> {
    const rows = await query<ClientProductVerificationUnit>(
      `SELECT ${CPV_COLS} FROM client_product_verification_units WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create(
    input: {
      clientProductId: number;
      verificationUnitId: number;
      effectiveFrom?: string | undefined;
    },
    userId: string,
  ): Promise<ClientProductVerificationUnit> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<ClientProductVerificationUnit>(
          `INSERT INTO client_product_verification_units (client_product_id, verification_unit_id, effective_from)
           VALUES ($1, $2, COALESCE($3::timestamptz, now())) RETURNING ${CPV_COLS}`,
          [input.clientProductId, input.verificationUnitId, input.effectiveFrom ?? null],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'client_product_verification_units',
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
        throw AppError.conflict('CPV_UNIT_EXISTS', 'this unit is already enabled for the client-product');
      if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
      throw e;
    }
  },

  /**
   * Reschedule effective-from (the only mutable field; link/unit keys are immutable).
   * OCC-guarded (ADR-0019): applies at `expectedVersion`; 0 rows → 404 or 409 STALE_UPDATE.
   */
  async updateEffectiveFrom(
    id: number,
    effectiveFrom: string,
    userId: string,
    expectedVersion: number,
  ): Promise<ClientProductVerificationUnit> {
    return withTransaction(async (q) => {
      const [before] = await q<ClientProductVerificationUnit>(
        `SELECT ${CPV_COLS} FROM client_product_verification_units WHERE id = $1`,
        [id],
      );
      if (!before) throw AppError.notFound('CPV_UNIT_NOT_FOUND');
      const [row] = await q<ClientProductVerificationUnit>(
        `UPDATE client_product_verification_units SET effective_from = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $3 RETURNING ${CPV_COLS}`,
        [id, effectiveFrom, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'client_product_verification_units',
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
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<ClientProductVerificationUnit> {
    return withTransaction(async (q) => {
      const [before] = await q<ClientProductVerificationUnit>(
        `SELECT ${CPV_COLS} FROM client_product_verification_units WHERE id = $1`,
        [id],
      );
      if (!before) throw AppError.notFound('CPV_UNIT_NOT_FOUND');
      const [row] = await q<ClientProductVerificationUnit>(
        `UPDATE client_product_verification_units SET is_active = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $3 RETURNING ${CPV_COLS}`,
        [id, isActive, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'client_product_verification_units',
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
