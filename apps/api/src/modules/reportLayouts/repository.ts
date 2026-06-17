import type {
  ReportLayout,
  ReportLayoutColumn,
  ReportLayoutDetail,
  ReportLayoutView,
  CreateReportLayoutInput,
  ReportLayoutColumnInput,
  SortOrder,
} from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction, type TxQuery } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

const pgErr = (e: unknown): { code?: string; constraint?: string } =>
  typeof e === 'object' && e !== null ? (e as { code?: string; constraint?: string }) : {};
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

const mapWriteError = (e: unknown): never => {
  const { code, constraint } = pgErr(e);
  if (code === UNIQUE_VIOLATION && constraint === 'uq_report_layouts_active')
    throw AppError.conflict(
      'REPORT_LAYOUT_EXISTS',
      'an active layout already exists for this client + product + kind',
    );
  if (code === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
  // A shape-CHECK violation (e.g. a direct-API page-geometry patch onto a non-CASE_REPORT row) is a
  // bad request, not a 500 — the Zod refine catches the FE path; this backstops raw API callers.
  if (code === CHECK_VIOLATION) throw AppError.badRequest('REPORT_LAYOUT_INVALID_SHAPE');
  throw e;
};

const HEADER_COLS = `id, client_id, product_id, kind, name, verification_type, template_body,
  page_size, page_orientation, is_active, version, created_by, updated_by, created_at, updated_at`;

const COLUMN_COLS = `id, column_key, header_label, source_type, source_ref, data_type,
  display_order, section, is_required, options, validation`;

const LAYOUT_FROM = `FROM report_layouts rl
  JOIN clients c ON c.id = rl.client_id
  JOIN products p ON p.id = rl.product_id`;

async function insertColumns(
  q: TxQuery,
  layoutId: number,
  columns: ReportLayoutColumnInput[],
): Promise<void> {
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    await q(
      `INSERT INTO report_layout_columns
         (layout_id, column_key, header_label, source_type, source_ref, data_type,
          display_order, section, is_required, options, validation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
      [
        layoutId,
        col.columnKey,
        col.headerLabel,
        col.sourceType,
        col.sourceRef?.trim() || null,
        col.dataType,
        col.displayOrder ?? i,
        col.section?.trim() || null,
        col.isRequired ?? false,
        JSON.stringify(col.options ?? []),
        JSON.stringify(col.validation ?? {}),
      ],
    );
  }
}

async function columnsFor(id: number): Promise<ReportLayoutColumn[]> {
  return query<ReportLayoutColumn>(
    `SELECT ${COLUMN_COLS} FROM report_layout_columns WHERE layout_id = $1 ORDER BY display_order, id`,
    [id],
  );
}

export interface ReportLayoutListOptions {
  clientId?: number;
  productId?: number;
  kind?: string;
  active?: boolean;
  search?: string;
  columnFilters?: AppliedFilter[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const reportLayoutRepository = {
  async list(o: ReportLayoutListOptions): Promise<{ items: ReportLayoutView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, val: unknown) => {
      params.push(val);
      where.push(clause.replace('$?', `$${params.length}`));
    };
    if (o.clientId !== undefined) add('rl.client_id = $?', o.clientId);
    if (o.productId !== undefined) add('rl.product_id = $?', o.productId);
    if (o.kind !== undefined) add('rl.kind = $?', o.kind);
    if (o.active !== undefined) add('rl.is_active = $?', o.active);
    if (o.search) {
      params.push(likeContains(o.search));
      const n = params.length;
      where.push(`(rl.name ILIKE $${n} OR c.name ILIKE $${n} OR p.name ILIKE $${n})`);
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${LAYOUT_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<ReportLayoutView>(
      `SELECT rl.id, rl.client_id, rl.product_id, rl.kind, rl.name, rl.verification_type,
              rl.template_body, rl.page_size, rl.page_orientation, rl.is_active, rl.version,
              rl.created_by, rl.updated_by, rl.created_at, rl.updated_at,
              c.name AS client_name, p.name AS product_name,
              (SELECT count(*)::int FROM report_layout_columns rc WHERE rc.layout_id = rl.id) AS column_count
       ${LAYOUT_FROM} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, rl.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /** Layout header + names + column count (no columns array). */
  async findHeader(id: number): Promise<ReportLayoutView | null> {
    const rows = await query<ReportLayoutView>(
      `SELECT rl.id, rl.client_id, rl.product_id, rl.kind, rl.name, rl.verification_type,
              rl.template_body, rl.page_size, rl.page_orientation, rl.is_active, rl.version,
              rl.created_by, rl.updated_by, rl.created_at, rl.updated_at,
              c.name AS client_name, p.name AS product_name,
              (SELECT count(*)::int FROM report_layout_columns rc WHERE rc.layout_id = rl.id) AS column_count
       ${LAYOUT_FROM} WHERE rl.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Full detail (header + ordered columns). */
  async findDetail(id: number): Promise<ReportLayoutDetail | null> {
    const header = await this.findHeader(id);
    if (!header) return null;
    return { ...header, columns: await columnsFor(id) };
  },

  /** The ACTIVE layout for a CPV + kind (+ verificationType for FIELD_REPORT), with columns. `null` =
   *  none configured yet (a normal answer). `verificationType` undefined → matches the type-less kinds
   *  (DATA_ENTRY/MIS/BILLING_MIS); a value → matches the FIELD_REPORT for that verification type. */
  async findActiveByConfig(
    clientId: number,
    productId: number,
    kind: string,
    verificationType?: string,
  ): Promise<ReportLayoutDetail | null> {
    const params: unknown[] = [clientId, productId, kind];
    let typeClause = 'AND verification_type IS NULL';
    if (verificationType !== undefined) {
      params.push(verificationType);
      typeClause = `AND verification_type = $${params.length}`;
    }
    const rows = await query<{ id: number }>(
      `SELECT id FROM report_layouts
        WHERE client_id = $1 AND product_id = $2 AND kind = $3 ${typeClause} AND is_active
        LIMIT 1`,
      params,
    );
    const id = rows[0]?.id;
    return id === undefined ? null : this.findDetail(id);
  },

  async create(input: CreateReportLayoutInput, userId: string): Promise<ReportLayoutDetail> {
    try {
      const id = await withTransaction(async (q) => {
        const [row] = await q<{ id: number }>(
          `INSERT INTO report_layouts
             (client_id, product_id, kind, name, verification_type, template_body,
              page_size, page_orientation, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
          [
            input.clientId,
            input.productId,
            input.kind,
            input.name,
            input.verificationType?.trim() || null,
            input.templateBody ?? null,
            input.pageSize ?? null,
            input.pageOrientation ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await insertColumns(q, row.id, input.columns as ReportLayoutColumnInput[]);
        return row.id;
      });
      const detail = await this.findDetail(id);
      if (!detail) throw AppError.internal('layout vanished after insert');
      return detail;
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Replace name and/or the full column set in place; OCC-guarded (ADR-0019). */
  async update(
    id: number,
    patch: {
      name?: string;
      templateBody?: string;
      pageSize?: string;
      pageOrientation?: string;
      columns?: ReportLayoutColumnInput[];
    },
    userId: string,
    expectedVersion: number,
  ): Promise<ReportLayoutDetail> {
    try {
      await withTransaction(async (q) => {
        const [cur] = await q<ReportLayout>(
          `SELECT ${HEADER_COLS} FROM report_layouts WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!cur) throw AppError.notFound('REPORT_LAYOUT_NOT_FOUND');
        if (cur.version !== expectedVersion) throw AppError.stale(cur);
        // Immutable-once-used (ADR-0037): a layout that already has keyed data-entry values can be
        // renamed but NOT structurally re-columned — otherwise stored `data` keys would orphan.
        if (patch.columns) {
          const used = await q<{ one: number }>(
            `SELECT 1 AS one FROM case_data_entries WHERE layout_id = $1 LIMIT 1`,
            [id],
          );
          if (used.length)
            throw AppError.conflict(
              'REPORT_LAYOUT_IN_USE',
              'this layout has keyed data — its columns can no longer be changed (rename only)',
            );
        }
        await q(
          `UPDATE report_layouts
             SET name = COALESCE($2, name), template_body = COALESCE($4, template_body),
                 page_size = COALESCE($5, page_size), page_orientation = COALESCE($6, page_orientation),
                 version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1`,
          [
            id,
            patch.name ?? null,
            userId,
            patch.templateBody ?? null,
            patch.pageSize ?? null,
            patch.pageOrientation ?? null,
          ],
        );
        if (patch.columns) {
          await q(`DELETE FROM report_layout_columns WHERE layout_id = $1`, [id]);
          await insertColumns(q, id, patch.columns);
        }
      });
      const detail = await this.findDetail(id);
      if (!detail) throw AppError.internal('layout vanished after update');
      return detail;
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Activate/deactivate — version-guarded (ADR-0019). Activating a 2nd layout for the same
   *  (client,product,kind) hits the partial-unique index → 409 REPORT_LAYOUT_EXISTS. */
  async setActive(
    id: number,
    isActive: boolean,
    userId: string,
    expectedVersion: number,
  ): Promise<ReportLayoutView> {
    try {
      const before = await this.findHeader(id);
      if (!before) throw AppError.notFound('REPORT_LAYOUT_NOT_FOUND');
      const [row] = await query<{ id: number }>(
        `UPDATE report_layouts SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING id`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      const after = await this.findHeader(id);
      if (!after) throw AppError.internal('layout vanished after setActive');
      return after;
    } catch (e) {
      return mapWriteError(e);
    }
  },
};
