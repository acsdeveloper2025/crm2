import type { ReportTemplate, ReportTemplateType, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';

const COLS = `id, code, name, template_type, content, is_active, effective_from, version,
  created_by, updated_by, created_at, updated_at`;

interface CreateRow {
  code: string;
  name: string;
  templateType: ReportTemplateType;
  content: string;
  effectiveFrom?: string | undefined;
}
interface UpdateRow {
  code?: string | undefined;
  name: string;
  templateType: ReportTemplateType;
  content: string;
  effectiveFrom?: string | undefined;
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface ReportTemplateListOptions {
  templateType?: ReportTemplateType;
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

export const reportTemplateRepository = {
  async list(o: ReportTemplateListOptions): Promise<{ items: ReportTemplate[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.templateType !== undefined) {
      params.push(o.templateType);
      where.push(`template_type = $${params.length}`);
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
      `SELECT count(*)::int AS count FROM report_templates ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<ReportTemplate>(
      `SELECT ${COLS} FROM report_templates ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<ReportTemplate | null> {
    const rows = await query<ReportTemplate>(`SELECT ${COLS} FROM report_templates WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: CreateRow, userId: string): Promise<ReportTemplate> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<ReportTemplate>(
          `INSERT INTO report_templates (code, name, template_type, content, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $6) RETURNING ${COLS}`,
          [input.code, input.name, input.templateType, input.content, input.effectiveFrom ?? null, userId],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'report_templates',
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
        throw AppError.conflict('REPORT_TEMPLATE_EXISTS', 'a template with this code already exists');
      throw e;
    }
  },

  /**
   * No v2 table references report_templates yet (ADR-0020) — so a code is always correctable today.
   * When reporting/CPV references land, add them here so an in-use template code locks.
   */
  hasDependents(_id: number): Promise<boolean> {
    return Promise.resolve(false);
  },

  /** OCC-guarded update (ADR-0019); `code` corrected only when provided (ADR-0020 — service gates it). */
  async update(
    id: number,
    input: UpdateRow,
    userId: string,
    expectedVersion: number,
    before: ReportTemplate,
  ): Promise<ReportTemplate> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<ReportTemplate>(
          `UPDATE report_templates SET code = COALESCE($2, code), name = $3, template_type = $4, content = $5,
                  effective_from = COALESCE($6::timestamptz, effective_from),
                  version = version + 1, updated_by = $7, updated_at = now()
           WHERE id = $1 AND version = $8 RETURNING ${COLS}`,
          [
            id,
            input.code ?? null,
            input.name,
            input.templateType,
            input.content,
            input.effectiveFrom ?? null,
            userId,
            expectedVersion,
          ],
        );
        if (!row) {
          const [current] = await q<ReportTemplate>(`SELECT ${COLS} FROM report_templates WHERE id = $1`, [
            id,
          ]);
          if (!current) throw AppError.notFound('REPORT_TEMPLATE_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'report_templates',
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
        throw AppError.conflict('REPORT_TEMPLATE_EXISTS', 'a template with this code already exists');
      throw e;
    }
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<ReportTemplate> {
    return withTransaction(async (q) => {
      const [before] = await q<ReportTemplate>(`SELECT ${COLS} FROM report_templates WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('REPORT_TEMPLATE_NOT_FOUND');
      const [row] = await q<ReportTemplate>(
        `UPDATE report_templates SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'report_templates',
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
