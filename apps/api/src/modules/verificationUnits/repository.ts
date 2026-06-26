import type { VerificationUnit, VerificationUnitOption, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const SELECT_COLS = `
  id, code, name, description, version, category, worker_role, assignment_method,
  required_form_code, required_photos, required_gps, required_attachments, result_set,
  review_required, billing_profile, commission_profile, report_template_type,
  reverification_rule, pii_sensitive, is_active, is_system, effective_from, sort_order, created_by,
  updated_by, created_at, updated_at`;

type WriteInput = Omit<
  VerificationUnit,
  // `isSystem` is set only by the seed/migration (the 9 mobile-hardcoded units) — never via create/update.
  | 'id'
  | 'version'
  | 'isActive'
  | 'isSystem'
  | 'effectiveFrom'
  | 'createdBy'
  | 'updatedBy'
  | 'createdAt'
  | 'updatedAt'
> & { effectiveFrom?: string | undefined };

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface VerificationUnitListOptions {
  workerRole?: string;
  category?: string;
  active?: boolean;
  search?: string;
  /** whitelisted per-column filters (§6/§7); columns trusted, values bound. */
  columnFilters?: AppliedFilter[];
  /** restrict to these ids (export `mode:'selected'`); applied on top of scope/filters, bound as a param. */
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const verificationUnitRepository = {
  async list(o: VerificationUnitListOptions): Promise<{ items: VerificationUnit[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.workerRole) {
      params.push(o.workerRole);
      where.push(`worker_role = $${params.length}`);
    }
    if (o.category) {
      params.push(o.category);
      where.push(`category = $${params.length}`);
    }
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
      `SELECT count(*)::int AS count FROM verification_units ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<VerificationUnit>(
      `SELECT ${SELECT_COLS} FROM verification_units ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<VerificationUnit | null> {
    const rows = await query<VerificationUnit>(
      `SELECT ${SELECT_COLS} FROM verification_units WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Unpaginated USABLE (active AND in effect — ADR-0017) options for dropdowns (B-22); carries `workerRole`. */
  async options(): Promise<VerificationUnitOption[]> {
    return query<VerificationUnitOption>(
      `SELECT id, code, name, worker_role FROM verification_units
       WHERE is_active AND effective_from <= now()
       ORDER BY sort_order ASC, name ASC`,
    );
  },

  async create(input: WriteInput, userId: string): Promise<VerificationUnit> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<VerificationUnit>(
          `INSERT INTO verification_units
            (code, name, description, category, worker_role, assignment_method,
             required_form_code, required_photos, required_gps, required_attachments, result_set,
             review_required, billing_profile, commission_profile, report_template_type,
             reverification_rule, pii_sensitive, sort_order, effective_from, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::text[],$12,$13,$14,$15,$16,$17,$18,COALESCE($19::timestamptz, now()),$20,$20)
           RETURNING ${SELECT_COLS}`,
          [
            input.code,
            input.name,
            input.description ?? null,
            input.category,
            input.workerRole,
            input.assignmentMethod,
            input.requiredFormCode ?? null,
            input.requiredPhotos,
            input.requiredGps,
            JSON.stringify(input.requiredAttachments ?? []),
            input.resultSet,
            input.reviewRequired,
            input.billingProfile,
            input.commissionProfile,
            input.reportTemplateType,
            input.reverificationRule,
            input.piiSensitive,
            input.sortOrder,
            input.effectiveFrom ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'verification_units',
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
        throw AppError.conflict('UNIT_CODE_EXISTS', `code already exists: ${input.code}`);
      throw e;
    }
  },

  /** True if any row references this unit (ADR-0020 lock check: CPV enablements, rates, case tasks). */
  async hasDependents(id: number): Promise<boolean> {
    const [row] = await query<{ used: boolean }>(
      `SELECT (EXISTS(SELECT 1 FROM client_product_verification_units WHERE verification_unit_id = $1)
            OR EXISTS(SELECT 1 FROM rates WHERE verification_unit_id = $1)
            OR EXISTS(SELECT 1 FROM case_tasks WHERE verification_unit_id = $1)) AS used`,
      [id],
    );
    return row?.used ?? false;
  },

  /** OCC-guarded full-row update + version bump (ADR-0019); 0 rows → 404 or 409 STALE_UPDATE. */
  async update(
    id: number,
    input: WriteInput,
    userId: string,
    expectedVersion: number,
    before: VerificationUnit,
  ): Promise<VerificationUnit> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<VerificationUnit>(
          // `code = COALESCE($22, code)` is appended as a fresh param (ADR-0020) to avoid renumbering $2..$21.
          `UPDATE verification_units SET
             code = COALESCE($22, code),
             name=$2, description=$3, category=$4, worker_role=$5, assignment_method=$6,
             required_form_code=$7, required_photos=$8, required_gps=$9, required_attachments=$10::jsonb,
             result_set=$11::text[], review_required=$12, billing_profile=$13, commission_profile=$14,
             report_template_type=$15, reverification_rule=$16, pii_sensitive=$17, sort_order=$18,
             effective_from = COALESCE($20::timestamptz, effective_from),
             version = version + 1, updated_by=$19, updated_at = now()
           WHERE id=$1 AND version=$21
           RETURNING ${SELECT_COLS}`,
          [
            id,
            input.name,
            input.description ?? null,
            input.category,
            input.workerRole,
            input.assignmentMethod,
            input.requiredFormCode ?? null,
            input.requiredPhotos,
            input.requiredGps,
            JSON.stringify(input.requiredAttachments ?? []),
            input.resultSet,
            input.reviewRequired,
            input.billingProfile,
            input.commissionProfile,
            input.reportTemplateType,
            input.reverificationRule,
            input.piiSensitive,
            input.sortOrder,
            userId,
            input.effectiveFrom ?? null,
            expectedVersion,
            input.code ?? null,
          ],
        );
        if (!row) {
          const [current] = await q<VerificationUnit>(
            `SELECT ${SELECT_COLS} FROM verification_units WHERE id = $1`,
            [id],
          );
          if (!current) throw AppError.notFound('UNIT_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'verification_units',
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
        throw AppError.conflict('UNIT_CODE_EXISTS', `code already exists: ${input.code}`);
      throw e;
    }
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<VerificationUnit> {
    return withTransaction(async (q) => {
      const [before] = await q<VerificationUnit>(
        `SELECT ${SELECT_COLS} FROM verification_units WHERE id = $1`,
        [id],
      );
      if (!before) throw AppError.notFound('UNIT_NOT_FOUND');
      // A system unit (the mobile-hardcoded field-visit types) must stay active — block deactivation
      // (ADR: the field app's per-type form endpoints are keyed to these codes). Activation is allowed.
      if (!isActive && before.isSystem)
        throw AppError.conflict(
          'SYSTEM_UNIT_LOCKED',
          'this verification unit is linked to the mobile app and cannot be deactivated',
        );
      const [row] = await q<VerificationUnit>(
        `UPDATE verification_units SET is_active=$2, version=version+1, updated_by=$3, updated_at=now()
         WHERE id=$1 AND version=$4 RETURNING ${SELECT_COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'verification_units',
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
