import {
  CreateReportTemplateSchema,
  UpdateReportTemplateSchema,
  REPORT_TEMPLATE_TYPES,
  type Paginated,
  type ReportTemplate,
  type ReportTemplateType,
} from '@crm2/sdk';
import { reportTemplateRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { applyBulkOcc, parseBulkItems } from '../../platform/bulk.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6/§7) below. */
const TEMPLATE_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    templateType: 'template_type',
    status: 'is_active',
    effectiveFrom: 'effective_from',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    code: { column: 'code', kind: 'text' },
    name: { column: 'name', kind: 'text' },
    templateType: { column: 'template_type', kind: 'enum', values: REPORT_TEMPLATE_TYPES },
    createdAt: { column: 'created_at', kind: 'date' },
    effectiveFrom: { column: 'effective_from', kind: 'date' },
  },
  defaultSort: 'name',
  defaultOrder: 'asc',
};

const parseType = (raw: unknown): ReportTemplateType | undefined =>
  typeof raw === 'string' && (REPORT_TEMPLATE_TYPES as readonly string[]).includes(raw)
    ? (raw as ReportTemplateType)
    : undefined;

/**
 * The DataGrid export manifest (IMPORT_EXPORT_STANDARD). Column `id`s match the FE DataGrid column
 * ids so the visible-columns (`cols`) selection filters + orders them; the `actions` column has no
 * data value and is simply absent here.
 */
const TEMPLATE_EXPORT_COLUMNS: ExportColumn<ReportTemplate>[] = [
  { id: 'code', header: 'Code', value: (t) => t.code },
  { id: 'name', header: 'Name', value: (t) => t.name },
  { id: 'templateType', header: 'Type', value: (t) => t.templateType },
  { id: 'effectiveFrom', header: 'Effective From', value: (t) => t.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (t) => t.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (t) => t.updatedAt },
  { id: 'status', header: 'Status', value: (t) => (t.isActive ? 'Active' : 'Inactive') },
];

/**
 * Report template service — authoring CRUD.
 *  - create/update validated against the shared zod schema
 *  - `code` correctable only while unreferenced (ADR-0020; no v2 referrers today); name/type/content editable
 */
export const reportTemplateService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<ReportTemplate>> {
    const r = resolvePage(rawQuery, TEMPLATE_PAGE_SPEC);
    const templateType = parseType(rawQuery['templateType']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, TEMPLATE_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(templateType !== undefined ? { templateType } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (templateType !== undefined) filters['templateType'] = templateType;
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (templateType/active/search/filters/sort) — `current` = the exact page; `all` = every matching
   * row (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). Returns rows +
   * the template column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, TEMPLATE_PAGE_SPEC);
    const templateType = parseType(rawQuery['templateType']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, TEMPLATE_PAGE_SPEC);
    // `selected` restricts to the ticked numeric ids; an empty/invalid set exports nothing (never
    // falls through to "all").
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: TEMPLATE_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(templateType !== undefined ? { templateType } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: TEMPLATE_EXPORT_COLUMNS };
  },

  create(input: unknown, userId: string): Promise<ReportTemplate> {
    const v = CreateReportTemplateSchema.parse(input); // throws ZodError → 400
    return repo.create(
      {
        code: v.code,
        name: v.name,
        templateType: v.templateType,
        content: v.content ?? '',
        effectiveFrom: v.effectiveFrom,
      },
      userId,
    );
  },

  async update(id: number, input: unknown, userId: string): Promise<ReportTemplate> {
    const v = UpdateReportTemplateSchema.parse(input); // field validation (400 VALIDATION)
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('REPORT_TEMPLATE_NOT_FOUND');
    // ADR-0020: code correctable only while unreferenced; locked once in use (no v2 referrers today).
    const codeChanged = v.code !== undefined && v.code !== existing.code;
    if (codeChanged && (await repo.hasDependents(id)))
      throw AppError.conflict('CODE_LOCKED', 'code is in use by other records and cannot be changed');
    return repo.update(
      id,
      {
        ...(codeChanged ? { code: v.code } : {}),
        name: v.name,
        templateType: v.templateType,
        content: v.content,
        effectiveFrom: v.effectiveFrom,
      },
      userId,
      expectedVersion,
      existing,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),

  /** Bulk (de)activate — per-row OCC, per-row result (CONCURRENCY_AND_EDITING_STANDARD §1). Reuses
   *  the same version-guarded `repo.setActive` per row; a row changed since selection comes back CONFLICT. */
  bulkSetActive(body: unknown, isActive: boolean, userId: string) {
    const items = parseBulkItems(body, 'int');
    return applyBulkOcc(items, (id, version) => repo.setActive(Number(id), isActive, userId, version));
  },
};
