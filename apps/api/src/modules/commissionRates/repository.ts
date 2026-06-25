import type { CommissionRate, CommissionRateView, CreateCommissionRateInput, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const FK_VIOLATION = '23503';
const EXCLUSION_VIOLATION = '23P01'; // commission_rates_no_overlap (overlapping active period)

// amount is numeric(12,2); cast to float8 so pg returns a JS number, not a string.
// Dimension columns (location/product/VU/tat_band) are nullable = "applies generally" (ADR-0046).
// ADR-0068: field_rate_type is now rate_types.id; resolve the code via a correlated subquery so the
// bare-table SELECT/RETURNING still emit the string code (works without a JOIN).
const COLS = `id, user_id,
  (SELECT code FROM rate_types WHERE id = commission_rates.rate_type_id) AS field_rate_type, client_id,
  location_id, product_id, verification_unit_id, tat_band,
  amount::float8 AS amount, currency, is_active,
  effective_from, effective_to, version, created_by, updated_by, created_at, updated_at`;

// Shared FROM + joins for the list view (used by both the COUNT and the page query). The dimension
// joins (product/VU/location) are LEFT — null when the rate applies generally to that dimension.
const CR_FROM = `FROM commission_rates cr
  JOIN users u ON u.id = cr.user_id
  LEFT JOIN clients c ON c.id = cr.client_id
  LEFT JOIN products p2 ON p2.id = cr.product_id
  LEFT JOIN verification_units vu2 ON vu2.id = cr.verification_unit_id
  LEFT JOIN locations l2 ON l2.id = cr.location_id
  LEFT JOIN rate_types rt ON rt.id = cr.rate_type_id`;

const mapWriteError = (e: unknown): never => {
  if (pgCode(e) === EXCLUSION_VIOLATION)
    throw AppError.conflict(
      'COMMISSION_RATE_EXISTS',
      'an active commission rate already overlaps this user + location + client + product + unit + TAT band + classification + period',
    );
  if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
  throw e;
};

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface CommissionRateListOptions {
  userId?: string;
  clientId?: number;
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

export const commissionRateRepository = {
  async list(o: CommissionRateListOptions): Promise<{ items: CommissionRateView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, val: unknown) => {
      params.push(val);
      where.push(clause.replace('$?', `$${params.length}`));
    };
    if (o.userId !== undefined) add('cr.user_id = $?', o.userId);
    if (o.clientId !== undefined) add('cr.client_id = $?', o.clientId);
    if (o.active !== undefined) add('cr.is_active = $?', o.active);
    if (o.search) {
      params.push(likeContains(o.search));
      const n = params.length;
      where.push(
        `(u.name ILIKE $${n} OR u.email ILIKE $${n} OR c.name ILIKE $${n} OR c.code ILIKE $${n} OR rt.code ILIKE $${n})`,
      );
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`cr.id = ANY($${params.length})`);
    }
    // default: current rows only (not end-dated); history=true includes superseded versions
    if (!o.history) where.push(`(cr.effective_to IS NULL OR cr.effective_to > now())`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${CR_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<CommissionRateView>(
      `SELECT cr.id, cr.user_id, rt.code AS field_rate_type, cr.client_id,
              cr.location_id, cr.product_id, cr.verification_unit_id, cr.tat_band,
              cr.amount::float8 AS amount, cr.currency, cr.is_active,
              cr.effective_from, cr.effective_to, cr.version,
              cr.created_by, cr.updated_by, cr.created_at, cr.updated_at,
              u.name AS user_name, u.email AS user_email,
              c.code AS client_code, c.name AS client_name,
              p2.code AS product_code, p2.name AS product_name,
              vu2.name AS verification_unit_name,
              l2.pincode AS pincode, l2.area AS area
       ${CR_FROM}
       ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, cr.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<CommissionRate | null> {
    const rows = await query<CommissionRate>(`SELECT ${COLS} FROM commission_rates WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** A single rate joined with its display fields (the record-page loader) — mirrors the list SELECT
   *  filtered by id, so the dimension names (user/client/product/unit/location) come back too. Returns
   *  any version (current OR superseded): the record page must be able to load a historical row by id. */
  async findView(id: number): Promise<CommissionRateView | null> {
    const rows = await query<CommissionRateView>(
      `SELECT cr.id, cr.user_id, rt.code AS field_rate_type, cr.client_id,
              cr.location_id, cr.product_id, cr.verification_unit_id, cr.tat_band,
              cr.amount::float8 AS amount, cr.currency, cr.is_active,
              cr.effective_from, cr.effective_to, cr.version,
              cr.created_by, cr.updated_by, cr.created_at, cr.updated_at,
              u.name AS user_name, u.email AS user_email,
              c.code AS client_code, c.name AS client_name,
              p2.code AS product_code, p2.name AS product_name,
              vu2.name AS verification_unit_name,
              l2.pincode AS pincode, l2.area AS area
       ${CR_FROM}
       WHERE cr.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create(input: CreateCommissionRateInput, userId: string): Promise<CommissionRate> {
    try {
      const [row] = await query<CommissionRate>(
        // ADR-0068: resolve the field_rate_type code → rate_types.id (NULL/blank code → NULL id).
        `INSERT INTO commission_rates
           (user_id, rate_type_id, client_id, location_id, product_id, verification_unit_id, tat_band,
            amount, currency, effective_from, created_by, updated_by)
         VALUES ($1, (SELECT id FROM rate_types WHERE code = UPPER($2)), $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()), $11, $11)
         RETURNING ${COLS}`,
        [
          input.userId,
          input.fieldRateType ?? null,
          input.clientId ?? null,
          input.locationId ?? null,
          input.productId ?? null,
          input.verificationUnitId ?? null,
          input.tatBand ?? null,
          input.amount,
          input.currency ?? 'INR',
          input.effectiveFrom ?? null,
          userId,
        ],
      );
      if (!row) throw AppError.internal('insert returned no row');
      return row;
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Effective-dated revision: end-date the current row, insert a new dated version. */
  async revise(
    id: number,
    amount: number,
    effectiveFrom: string | null,
    userId: string,
    expectedVersion: number,
  ): Promise<CommissionRate> {
    try {
      return await withTransaction(async (q) => {
        const [cur] = await q<CommissionRate>(
          `SELECT ${COLS} FROM commission_rates WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!cur) throw AppError.notFound('COMMISSION_RATE_NOT_FOUND');
        if (cur.version !== expectedVersion) throw AppError.stale(cur);
        if (!cur.isActive)
          throw AppError.conflict('COMMISSION_RATE_NOT_ACTIVE', 'cannot revise an inactive rate');
        // end-date the current row FIRST (so the new open-ended row doesn't overlap it)
        await q(
          `UPDATE commission_rates SET effective_to = COALESCE($2::timestamptz, now()),
             version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1`,
          [id, effectiveFrom, userId],
        );
        // Carry ALL dimensions forward (ADR-0046 §4): revise only changes amount + effective_from;
        // the new effective-dated version preserves location/product/VU/tat_band/field_rate_type/client.
        const [next] = await q<CommissionRate>(
          // ADR-0068: carry the rate type forward as a code → rate_types.id resolution (NULL code → NULL id).
          `INSERT INTO commission_rates
             (user_id, rate_type_id, client_id, location_id, product_id, verification_unit_id, tat_band,
              amount, currency, effective_from, created_by, updated_by)
           VALUES ($1, (SELECT id FROM rate_types WHERE code = UPPER($2)), $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()), $11, $11)
           RETURNING ${COLS}`,
          [
            cur.userId,
            cur.fieldRateType,
            cur.clientId,
            cur.locationId,
            cur.productId,
            cur.verificationUnitId,
            cur.tatBand,
            amount,
            cur.currency,
            effectiveFrom,
            userId,
          ],
        );
        if (!next) throw AppError.internal('revise insert returned no row');
        return next;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Activate/deactivate — version-guarded (ADR-0019); 0 rows → 404 or 409 STALE_UPDATE. */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<CommissionRate> {
    try {
      const [before] = await query<CommissionRate>(`SELECT ${COLS} FROM commission_rates WHERE id = $1`, [
        id,
      ]);
      if (!before) throw AppError.notFound('COMMISSION_RATE_NOT_FOUND');
      const [row] = await query<CommissionRate>(
        `UPDATE commission_rates SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      return row;
    } catch (e) {
      return mapWriteError(e);
    }
  },
};
