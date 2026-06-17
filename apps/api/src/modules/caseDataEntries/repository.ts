import { query } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { composeScopePredicate, type Scope } from '../../platform/scope/index.js';

export interface CaseCpv {
  caseId: string;
  clientId: number;
  productId: number;
}
export interface DataEntryRow {
  id: number;
  data: Record<string, unknown>;
  version: number;
}

/** The keyed pickup fields (camelCase, aliased from the table). */
export interface PickupRow {
  id: number;
  pickupDate: string | null;
  reportedDate: string | null;
  pickupTrigger: string | null;
  samplerName: string | null;
  visitDateTime: string | null;
  version: number;
}
/** Derived-only pickup context (read-only on the form). */
export interface PickupContext {
  bankName: string;
  pickupForDocuments: string;
}
/** The keyed fields a save writes (post-validation). */
export interface PickupInput {
  pickupDate: string | null;
  reportedDate: string | null;
  pickupTrigger: string | null;
  samplerName: string | null;
  visitDateTime: string | null;
}

const PICKUP_COLS = `id, pickup_date AS "pickupDate", reported_date AS "reportedDate",
  pickup_trigger AS "pickupTrigger", sampler_name AS "samplerName",
  visit_date_time AS "visitDateTime", version`;

/** Case-grain scope predicate (mirrors cases/repository.ts) — a case is visible if the actor created
 *  it or is assigned one of its tasks. `cs` is the cases alias. `''` = no filter. */
function caseScopePredicate(params: unknown[], scope: Scope | undefined): string {
  if (!scope) return '';
  return composeScopePredicate(
    params,
    scope,
    (ph) =>
      `cs.created_by = ANY(${ph}) OR EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND ct.assigned_to = ANY(${ph}))`,
  );
}

export const caseDataEntryRepository = {
  /** The case's CPV (client/product), scope-guarded (out-of-scope/absent → null → the service maps to
   *  404, IDOR-safe). */
  async caseScope(caseId: string, scope: Scope | undefined): Promise<CaseCpv | null> {
    const params: unknown[] = [caseId];
    const pred = caseScopePredicate(params, scope);
    const rows = await query<CaseCpv>(
      `SELECT cs.id AS case_id, cs.client_id, cs.product_id
       FROM cases cs
       WHERE cs.id = $1 ${pred ? `AND (${pred})` : ''}`,
      params,
    );
    return rows[0] ?? null;
  },

  async findByCase(caseId: string): Promise<DataEntryRow | null> {
    const rows = await query<DataEntryRow>(
      `SELECT id, data, version FROM case_data_entries WHERE case_id = $1`,
      [caseId],
    );
    return rows[0] ?? null;
  },

  async insert(
    caseId: string,
    layoutId: number,
    data: Record<string, unknown>,
    userId: string,
  ): Promise<DataEntryRow> {
    try {
      const [row] = await query<DataEntryRow>(
        `INSERT INTO case_data_entries (case_id, layout_id, data, created_by, updated_by)
         VALUES ($1, $2, $3::jsonb, $4, $4)
         RETURNING id, data, version`,
        [caseId, layoutId, JSON.stringify(data), userId],
      );
      if (!row) throw AppError.internal('insert returned no row');
      return row;
    } catch (e) {
      // a concurrent first-save on the same case hits uq_case_data_entries_case
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505')
        throw AppError.conflict('DATA_ENTRY_EXISTS', 'data entry was created concurrently — reload');
      throw e;
    }
  },

  /** OCC-guarded update (ADR-0019). 0 rows updated → 404 or 409 STALE_UPDATE (surfaces the fresh row). */
  async update(
    caseId: string,
    data: Record<string, unknown>,
    userId: string,
    expectedVersion: number,
  ): Promise<DataEntryRow> {
    const [before] = await query<DataEntryRow>(
      `SELECT id, data, version FROM case_data_entries WHERE case_id = $1`,
      [caseId],
    );
    if (!before) throw AppError.notFound('DATA_ENTRY_NOT_FOUND');
    const [row] = await query<DataEntryRow>(
      `UPDATE case_data_entries SET data = $2::jsonb, version = version + 1, updated_by = $3, updated_at = now()
       WHERE case_id = $1 AND version = $4 RETURNING id, data, version`,
      [caseId, JSON.stringify(data), userId, expectedVersion],
    );
    if (!row) throw AppError.stale(before);
    return row;
  },

  // ── Pickup Information (fixed per-case office box) ──

  /** Derived read-only context: bank/NBFC = the client name; pickup-for = the case's distinct
   *  verification-unit names. Called after caseScope has authorised the case. */
  async pickupContext(caseId: string): Promise<PickupContext> {
    const [row] = await query<PickupContext>(
      `SELECT cl.name AS "bankName",
              COALESCE(
                (SELECT string_agg(DISTINCT vu.name, ', ' ORDER BY vu.name)
                 FROM case_tasks ct JOIN verification_units vu ON vu.id = ct.verification_unit_id
                 WHERE ct.case_id = cs.id),
                '') AS "pickupForDocuments"
       FROM cases cs JOIN clients cl ON cl.id = cs.client_id
       WHERE cs.id = $1`,
      [caseId],
    );
    return row ?? { bankName: '', pickupForDocuments: '' };
  },

  async findPickupByCase(caseId: string): Promise<PickupRow | null> {
    const rows = await query<PickupRow>(`SELECT ${PICKUP_COLS} FROM case_pickups WHERE case_id = $1`, [
      caseId,
    ]);
    return rows[0] ?? null;
  },

  async insertPickup(caseId: string, p: PickupInput, userId: string): Promise<PickupRow> {
    try {
      const [row] = await query<PickupRow>(
        `INSERT INTO case_pickups
           (case_id, pickup_date, reported_date, pickup_trigger, sampler_name, visit_date_time,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING ${PICKUP_COLS}`,
        [caseId, p.pickupDate, p.reportedDate, p.pickupTrigger, p.samplerName, p.visitDateTime, userId],
      );
      if (!row) throw AppError.internal('insert returned no row');
      return row;
    } catch (e) {
      // a concurrent first-save on the same case hits uq_case_pickups_case
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505')
        throw AppError.conflict('PICKUP_EXISTS', 'pickup was created concurrently — reload');
      throw e;
    }
  },

  async updatePickup(
    caseId: string,
    p: PickupInput,
    userId: string,
    expectedVersion: number,
  ): Promise<PickupRow> {
    const before = await this.findPickupByCase(caseId);
    if (!before) throw AppError.notFound('PICKUP_NOT_FOUND');
    const [row] = await query<PickupRow>(
      `UPDATE case_pickups SET pickup_date = $2, reported_date = $3, pickup_trigger = $4,
              sampler_name = $5, visit_date_time = $6, version = version + 1,
              updated_by = $7, updated_at = now()
       WHERE case_id = $1 AND version = $8 RETURNING ${PICKUP_COLS}`,
      [
        caseId,
        p.pickupDate,
        p.reportedDate,
        p.pickupTrigger,
        p.samplerName,
        p.visitDateTime,
        userId,
        expectedVersion,
      ],
    );
    if (!row) throw AppError.stale(before);
    return row;
  },
};
