import {
  CreateReportLayoutSchema,
  UpdateReportLayoutSchema,
  LAYOUT_KINDS,
  type LayoutKind,
  type Paginated,
  type ReportLayoutDetail,
  type ReportLayoutView,
} from '@crm2/sdk';
import { reportLayoutRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';

/** Sortable/filterable columns (apiField → SQL column); only these reach ORDER BY. */
const LAYOUT_PAGE_SPEC: PageSpec = {
  sortMap: {
    client: 'c.name',
    product: 'p.name',
    kind: 'rl.kind',
    name: 'rl.name',
    status: 'rl.is_active',
    createdAt: 'rl.created_at',
    updatedAt: 'rl.updated_at',
  },
  filterMap: {
    client: { column: 'c.name', kind: 'text' },
    product: { column: 'p.name', kind: 'text' },
    kind: { column: 'rl.kind', kind: 'enum', values: LAYOUT_KINDS },
    name: { column: 'rl.name', kind: 'text' },
    createdAt: { column: 'rl.created_at', kind: 'date' },
    updatedAt: { column: 'rl.updated_at', kind: 'date' },
  },
  defaultSort: 'updatedAt',
  defaultOrder: 'desc',
};

const toPosInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const toKind = (v: unknown): LayoutKind | undefined =>
  typeof v === 'string' && (LAYOUT_KINDS as readonly string[]).includes(v) ? (v as LayoutKind) : undefined;

/**
 * The DataGrid export manifest (IMPORT_EXPORT_STANDARD). Column `id`s match the FE DataGrid column ids
 * (ReportLayoutsPage) so the visible-columns (`cols`) selection filters + orders them; the `actions`
 * column has no data value and is simply absent here. The large designer payload (template body /
 * column catalog JSON) is deliberately NOT exported — only the header summary + a column count.
 */
const REPORT_LAYOUT_EXPORT_COLUMNS: ExportColumn<ReportLayoutView>[] = [
  { id: 'client', header: 'Client', value: (l) => l.clientName },
  { id: 'product', header: 'Product', value: (l) => l.productName },
  { id: 'kind', header: 'Kind', value: (l) => l.kind },
  { id: 'name', header: 'Name', value: (l) => l.name },
  { id: 'columns', header: 'Columns', value: (l) => l.columnCount },
  { id: 'status', header: 'Status', value: (l) => (l.isActive ? 'Active' : 'Inactive') },
  { id: 'createdAt', header: 'Created', value: (l) => l.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (l) => l.updatedAt },
];

/**
 * MIS layout service (ADR-0037) — per-(client,product) data-entry / MIS / Billing-MIS column config.
 * Admin-only (report_template.manage, gated at the route). Create/update validate every column's
 * source binding against the shared SOURCE_CATALOG (in the zod schema), so a layout can only bind to
 * real, resolvable sources. Update replaces the column set in place; OCC-guarded.
 */
export const reportLayoutService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<ReportLayoutView>> {
    const r = resolvePage(rawQuery, LAYOUT_PAGE_SPEC);
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const kind = toKind(rawQuery['kind']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, LAYOUT_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(clientId !== undefined ? { clientId } : {}),
      ...(productId !== undefined ? { productId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (clientId !== undefined) filters['clientId'] = clientId;
    if (productId !== undefined) filters['productId'] = productId;
    if (kind !== undefined) filters['kind'] = kind;
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (clientId/productId/kind/active/search/filters/sort) — `current` = the exact page; `all` = every
   * matching row (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). The
   * repo has no per-id list filter, so `selected` is treated as `all` (header-only manifest applies).
   * Returns rows + the layout column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, LAYOUT_PAGE_SPEC);
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const kind = toKind(rawQuery['kind']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, LAYOUT_PAGE_SPEC);
    const isCurrent = ex.mode === 'current';
    const { items, totalCount } = await repo.list({
      ...(clientId !== undefined ? { clientId } : {}),
      ...(productId !== undefined ? { productId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: isCurrent ? r.limit : exportThreshold(),
      offset: isCurrent ? r.offset : 0,
    });
    if (!isCurrent) assertExportable(totalCount);
    return { rows: items, columns: REPORT_LAYOUT_EXPORT_COLUMNS };
  },

  async get(id: number): Promise<ReportLayoutDetail> {
    const detail = await repo.findDetail(id);
    if (!detail) throw AppError.notFound('REPORT_LAYOUT_NOT_FOUND');
    return detail;
  },

  /** The active layout for a CPV + kind, or `null` (no layout configured yet — a normal answer, 200). */
  byConfig(rawQuery: Record<string, unknown>): Promise<ReportLayoutDetail | null> {
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const kind = toKind(rawQuery['kind']);
    if (clientId === undefined || productId === undefined || kind === undefined)
      throw AppError.badRequest('BAD_REQUEST', { param: 'clientId, productId, kind' });
    // FIELD_REPORT is keyed by verification type too; without it the lookup matches the type-less kinds.
    const vt = rawQuery['verificationType'];
    const verificationType = typeof vt === 'string' && vt.trim() ? vt.trim() : undefined;
    return repo.findActiveByConfig(clientId, productId, kind, verificationType);
  },

  create(input: unknown, userId: string): Promise<ReportLayoutDetail> {
    const validated = CreateReportLayoutSchema.parse(input); // ZodError → 400
    return repo.create(validated, userId);
  },

  update(id: number, input: unknown, userId: string): Promise<ReportLayoutDetail> {
    const validated = UpdateReportLayoutSchema.parse(input);
    const expectedVersion = requireVersion(input);
    return repo.update(
      id,
      {
        ...(validated.name !== undefined ? { name: validated.name } : {}),
        ...(validated.templateBody !== undefined ? { templateBody: validated.templateBody } : {}),
        ...(validated.pageSize !== undefined ? { pageSize: validated.pageSize } : {}),
        ...(validated.pageOrientation !== undefined ? { pageOrientation: validated.pageOrientation } : {}),
        ...(validated.columns !== undefined ? { columns: validated.columns } : {}),
      },
      userId,
      expectedVersion,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),
};
