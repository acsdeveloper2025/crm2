import type { BulkRateRow, Rate, RateView, RateHistory, CreateRateInput, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const FK_VIOLATION = '23503';
const EXCLUSION_VIOLATION = '23P01'; // rates_no_overlap GiST exclusion (overlapping active period)

// amount is numeric(10,2); cast to float8 so pg returns a JS number, not a string.
// ADR-0068: client_rate_type is now rate_types.id; resolve the code via a correlated subquery so the
// bare-table SELECT/RETURNING still emit the string code (works without a JOIN).
const COLS = `id, client_id, product_id, verification_unit_id, location_id,
  (SELECT code FROM rate_types WHERE id = rates.rate_type_id) AS client_rate_type,
  amount::float8 AS amount, currency, is_active, effective_from, effective_to,
  version, created_by, updated_by, created_at, updated_at`;

// Shared FROM + joins for the list view (used by both the COUNT and the page query).
// product/unit are LEFT JOINs: a Universal rate (ADR-0071) has NULL product_id/verification_unit_id, so
// an INNER JOIN would drop the row from the list/view — the join is for display names only.
const RATE_FROM = `FROM rates r
  JOIN clients c ON c.id = r.client_id
  LEFT JOIN products p ON p.id = r.product_id
  LEFT JOIN verification_units vu ON vu.id = r.verification_unit_id
  LEFT JOIN locations l ON l.id = r.location_id
  LEFT JOIN rate_types rt ON rt.id = r.rate_type_id`;

// Shared SELECT list for the joined RateView (list page + single-row finder share this so the
// record-page loader sees the SAME shape — with client/product/unit/location names, not just ids).
const RATE_VIEW_COLS = `r.id, r.client_id, r.product_id, r.verification_unit_id, r.location_id, rt.code AS client_rate_type,
       r.amount::float8 AS amount, r.currency, r.is_active, r.effective_from, r.effective_to,
       r.version, r.created_by, r.updated_by, r.created_at, r.updated_at,
       c.code AS client_code, c.name AS client_name,
       p.code AS product_code, p.name AS product_name,
       vu.code AS unit_code, vu.name AS unit_name,
       l.pincode, l.area`;

const mapWriteError = (e: unknown): never => {
  if (pgCode(e) === EXCLUSION_VIOLATION)
    throw AppError.conflict('RATE_EXISTS', 'an active rate already overlaps this scope + period');
  if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
  throw e;
};

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface RateListOptions {
  clientId?: number;
  productId?: number;
  verificationUnitId?: number;
  active?: boolean;
  /** include superseded (end-dated) versions; default current rows only. */
  history?: boolean;
  search?: string;
  /** whitelisted per-column filters (§6/§7); columns trusted (joined cols OK — shared RATE_FROM). */
  columnFilters?: AppliedFilter[];
  /** restrict to these ids (export `mode:'selected'`); applied on top of scope/filters, bound as a param. */
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const rateRepository = {
  async list(o: RateListOptions): Promise<{ items: RateView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, val: unknown) => {
      params.push(val);
      where.push(clause.replace('$?', `$${params.length}`));
    };
    if (o.clientId !== undefined) add('r.client_id = $?', o.clientId);
    if (o.productId !== undefined) add('r.product_id = $?', o.productId);
    if (o.verificationUnitId !== undefined) add('r.verification_unit_id = $?', o.verificationUnitId);
    if (o.active !== undefined) add('r.is_active = $?', o.active);
    if (o.search) {
      params.push(likeContains(o.search));
      const n = params.length;
      where.push(
        `(c.name ILIKE $${n} OR c.code ILIKE $${n} OR p.name ILIKE $${n} OR p.code ILIKE $${n} OR vu.name ILIKE $${n} OR l.pincode ILIKE $${n} OR l.area ILIKE $${n} OR rt.code ILIKE $${n})`,
      );
    }
    // Per-column filters (§6/§7/§8) combine with AND; whitelisted columns, bound values.
    where.push(...filterClauses(o.columnFilters ?? [], params));
    // Selected-rows export (mode:'selected') — bound id list, ANDed on top of scope/filters.
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`r.id = ANY($${params.length})`);
    }
    // default: current rows only (not end-dated); history=true includes superseded versions
    if (!o.history) where.push(`(r.effective_to IS NULL OR r.effective_to > now())`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${RATE_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<RateView>(
      `SELECT ${RATE_VIEW_COLS}
       ${RATE_FROM}
       ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, r.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<Rate | null> {
    const rows = await query<Rate>(`SELECT ${COLS} FROM rates WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** Single joined RateView (record-page loader) — same SELECT/joins the list returns, scoped to one
   *  id (bound, never interpolated). Returns the mapped view or null. */
  async findViewById(id: number): Promise<RateView | null> {
    const rows = await query<RateView>(`SELECT ${RATE_VIEW_COLS} ${RATE_FROM} WHERE r.id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: CreateRateInput, userId: string): Promise<Rate> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<Rate>(
          // ADR-0068: resolve the client_rate_type code → rate_types.id (NULL/blank code → NULL id, e.g. KYC).
          `INSERT INTO rates
             (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount, currency, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, $4, (SELECT id FROM rate_types WHERE code = UPPER($5)), $6, $7, COALESCE($8::timestamptz, now()), $9, $9)
           RETURNING ${COLS}`,
          [
            input.clientId,
            input.productId ?? null, // null ⇒ Universal product (ADR-0071)
            input.verificationUnitId ?? null, // null ⇒ Universal unit (ADR-0071)
            input.locationId ?? null,
            input.clientRateType ?? null,
            input.amount,
            input.currency ?? 'INR',
            input.effectiveFrom ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await q(
          `INSERT INTO rate_history (rate_id, action, new_amount, new_effective_from, changed_by)
           VALUES ($1, 'CREATE', $2, $3, $4)`,
          [row.id, row.amount, row.effectiveFrom, userId],
        );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** A rate-type catalog row by code — the bulk guard's category lookup (unknown code → undefined). */
  async rateTypeByCode(code: string): Promise<{ id: number; category: string } | undefined> {
    const rows = await query<{ id: number; category: string }>(
      `SELECT id, category FROM rate_types WHERE code = UPPER($1)`,
      [code],
    );
    return rows[0];
  },

  /** Owner rule (2026-07-11): one active rate per (client, product, unit, location) slot. Returns the
   *  locations among `locationIds` that already carry a CURRENT active rate of a DIFFERENT type at
   *  this exact slot (with the existing type's code, for the error message). `IS DISTINCT FROM` so a
   *  typeless existing rate (rate_type_id NULL) conflicts with a typed new save AND a typeless new
   *  save conflicts with a typed existing rate — neither slips past (a same-type/same-typeless save
   *  is left to the DB overlap → EXISTS). `rateTypeId` is the NEW rate's type, null for a typeless
   *  save. Product/unit COALESCE to the same -1 sentinels as `rates_no_overlap`, so a Universal dim
   *  only conflicts with Universal. Guard on new saves + reactivation only — payout resolution
   *  (RATE_LATERAL) is untouched and legacy multi-type rows still resolve. */
  async otherTypeAtSlot(
    clientId: number,
    productId: number | null,
    verificationUnitId: number | null,
    locationIds: number[],
    rateTypeId: number | null,
  ): Promise<{ locationId: number; code: string | null }[]> {
    return query<{ locationId: number; code: string | null }>(
      `SELECT DISTINCT r.location_id AS location_id, rt.code
       FROM rates r
       LEFT JOIN rate_types rt ON rt.id = r.rate_type_id
       WHERE r.client_id = $1
         AND COALESCE(r.product_id, -1) = COALESCE($2::int, -1)
         AND COALESCE(r.verification_unit_id, -1) = COALESCE($3::int, -1)
         AND r.location_id = ANY($4::int[])
         AND r.is_active
         AND (r.effective_to IS NULL OR r.effective_to > now())
         AND r.rate_type_id IS DISTINCT FROM $5::int`,
      [clientId, productId, verificationUnitId, locationIds, rateTypeId],
    );
  },

  /** Bulk create: one client bill-rate fanned across many locations. SAVEPOINT-per-row so a per-row
   *  overlap (23P01 → EXISTS, skipped not overwritten) or bad FK (23503 → ERROR) is captured without
   *  aborting the batch; a location already holding a different rate type at the slot is a per-row
   *  HAS_OTHER_RATE_TYPE error. Each created row also appends its rate_history CREATE entry —
   *  identical to N single creates. One wrapping transaction — mirrors the commission bulk pattern. */
  async bulkCreate(
    input: {
      clientId: number;
      productId?: number | null | undefined;
      verificationUnitId?: number | null | undefined;
      clientRateType: string;
      amount: number;
      currency: string;
      effectiveFrom?: string | undefined;
    },
    locationIds: number[],
    otherType: Set<number>,
    actorId: string,
  ): Promise<BulkRateRow[]> {
    return withTransaction(async (q) => {
      const out: BulkRateRow[] = [];
      for (const [i, locationId] of locationIds.entries()) {
        // Owner rule 2026-07-11: one (client, product, unit, location) = one rate type — a location
        // that already holds a different type at this slot is a per-row error, never a second line.
        if (otherType.has(locationId)) {
          out.push({ locationId, status: 'ERROR', rateId: null, error: 'HAS_OTHER_RATE_TYPE' });
          continue;
        }
        const sp = `sp_rate_bulk_${i}`;
        await q(`SAVEPOINT ${sp}`);
        try {
          const [row] = await q<{ id: number; amount: number; effectiveFrom: string }>(
            `INSERT INTO rates
               (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount, currency, effective_from, created_by, updated_by)
             VALUES ($1, $2, $3, $4, (SELECT id FROM rate_types WHERE code = UPPER($5)), $6, $7, COALESCE($8::timestamptz, now()), $9, $9)
             RETURNING id, amount::float8 AS amount, effective_from`,
            [
              input.clientId,
              input.productId ?? null,
              input.verificationUnitId ?? null,
              locationId,
              input.clientRateType,
              input.amount,
              input.currency,
              input.effectiveFrom ?? null,
              actorId,
            ],
          );
          if (!row) throw AppError.internal('bulk insert returned no row');
          await q(
            `INSERT INTO rate_history (rate_id, action, new_amount, new_effective_from, changed_by)
             VALUES ($1, 'CREATE', $2, $3, $4)`,
            [row.id, row.amount, row.effectiveFrom, actorId],
          );
          await q(`RELEASE SAVEPOINT ${sp}`);
          out.push({ locationId, status: 'CREATED', rateId: row.id, error: null });
        } catch (e) {
          await q(`ROLLBACK TO SAVEPOINT ${sp}`);
          const code = pgCode(e);
          if (code === EXCLUSION_VIOLATION) {
            out.push({ locationId, status: 'EXISTS', rateId: null, error: null });
          } else if (code === FK_VIOLATION) {
            out.push({ locationId, status: 'ERROR', rateId: null, error: 'INVALID_REFERENCE' });
          } else {
            throw e; // unexpected → abort the whole batch
          }
        }
      }
      return out;
    });
  },

  /** Effective-dated revision: end-date the current row, insert a new dated version, audit. */
  async revise(
    id: number,
    amount: number,
    effectiveFrom: string | null,
    userId: string,
    expectedVersion: number,
  ): Promise<Rate> {
    try {
      return await withTransaction(async (q) => {
        const [cur] = await q<Rate>(`SELECT ${COLS} FROM rates WHERE id = $1 FOR UPDATE`, [id]);
        if (!cur) throw AppError.notFound('RATE_NOT_FOUND');
        if (cur.version !== expectedVersion) throw AppError.stale(cur);
        if (!cur.isActive) throw AppError.conflict('RATE_NOT_ACTIVE', 'cannot revise an inactive rate');
        // end-date the current row FIRST (so the new open-ended row doesn't overlap it)
        await q(
          `UPDATE rates SET effective_to = COALESCE($2::timestamptz, now()), version = version + 1,
             updated_by = $3, updated_at = now()
           WHERE id = $1`,
          [id, effectiveFrom, userId],
        );
        const [next] = await q<Rate>(
          // ADR-0068: carry the rate type forward as a code → rate_types.id resolution (NULL code → NULL id).
          `INSERT INTO rates
             (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount, currency, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, $4, (SELECT id FROM rate_types WHERE code = UPPER($5)), $6, $7, COALESCE($8::timestamptz, now()), $9, $9)
           RETURNING ${COLS}`,
          [
            cur.clientId,
            cur.productId,
            cur.verificationUnitId,
            cur.locationId,
            cur.clientRateType,
            amount,
            cur.currency,
            effectiveFrom,
            userId,
          ],
        );
        if (!next) throw AppError.internal('revise insert returned no row');
        await q(
          `INSERT INTO rate_history (rate_id, action, old_amount, new_amount, old_effective_to, new_effective_from, changed_by)
           VALUES ($1, 'REVISE', $2, $3, $4, $5, $6)`,
          [next.id, cur.amount, next.amount, next.effectiveFrom, next.effectiveFrom, userId],
        );
        return next;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** OCC-guarded legacy flat amount edit (ADR-0019); 0 rows → 404 or 409 STALE_UPDATE. */
  async updateAmount(id: number, amount: number, userId: string, expectedVersion: number): Promise<Rate> {
    const [row] = await query<Rate>(
      `UPDATE rates SET amount = $2, version = version + 1, updated_by = $3, updated_at = now()
       WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
      [id, amount, userId, expectedVersion],
    );
    if (!row) {
      const current = await this.findById(id);
      if (!current) throw AppError.notFound('RATE_NOT_FOUND');
      throw AppError.stale(current);
    }
    return row;
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(id: number, isActive: boolean, userId: string, expectedVersion: number): Promise<Rate> {
    try {
      return await withTransaction(async (q) => {
        const [before] = await q<Rate>(`SELECT ${COLS} FROM rates WHERE id = $1`, [id]);
        if (!before) throw AppError.notFound('RATE_NOT_FOUND');
        const [row] = await q<Rate>(
          `UPDATE rates SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
          [id, isActive, userId, expectedVersion],
        );
        if (!row) throw AppError.stale(before);
        if (!isActive)
          await q(
            `INSERT INTO rate_history (rate_id, action, old_amount, changed_by) VALUES ($1, 'DEACTIVATE', $2, $3)`,
            [id, row.amount, userId],
          );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Full revision trail for the rate's (client, product, VU, location, client_rate_type) line. */
  async history(id: number): Promise<RateHistory[]> {
    return query<RateHistory>(
      `SELECT h.id, h.rate_id, h.action,
              h.old_amount::float8 AS old_amount, h.new_amount::float8 AS new_amount,
              h.old_effective_to, h.new_effective_from, h.changed_by, h.changed_at
       FROM rate_history h
       JOIN rates r ON r.id = h.rate_id
       WHERE (r.client_id, COALESCE(r.product_id, -1), COALESCE(r.verification_unit_id, -1),
              COALESCE(r.location_id, -1), COALESCE(r.rate_type_id, -1)) = (
         SELECT k.client_id, COALESCE(k.product_id, -1), COALESCE(k.verification_unit_id, -1),
                COALESCE(k.location_id, -1), COALESCE(k.rate_type_id, -1)
         FROM rates k WHERE k.id = $1
       )
       ORDER BY h.changed_at DESC, h.id DESC`,
      [id],
    );
  },
};
