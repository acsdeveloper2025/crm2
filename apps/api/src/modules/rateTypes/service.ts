import {
  CreateRateTypeSchema,
  UpdateRateTypeSchema,
  type Paginated,
  type RateType,
  type RateTypeOption,
} from '@crm2/sdk';
import { rateTypeRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { buildTemplate, runImportConfirm, runImportPreview } from '../../platform/import/index.js';
import { RATE_TYPE_IMPORT_SPEC } from './import.js';

/** Required positive-int query param → its value, else 400 BAD_REQUEST naming the param.
 *  Shared with the rateTypeAssignments service (the combo lookups validate the same 3 params). */
export const posIntParam = (q: Record<string, unknown>, name: string): number => {
  const n = Number(q[name]);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('BAD_REQUEST', { param: name });
  return n;
};

/** Same as posIntParam but the param may be OMITTED (absent/blank) — used for `available`'s
 *  product/unit dims, which drop out entirely for a Universal dim (owner fix 2026-07-08) instead of
 *  requiring a concrete id. A present-but-invalid value still 400s. */
const optionalPosIntParam = (q: Record<string, unknown>, name: string): number | undefined => {
  const raw = q[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('BAD_REQUEST', { param: name });
  return n;
};

/** Sortable + filterable columns (apiField → SQL column); only whitelisted columns reach ORDER BY /
 *  the WHERE clause (SQL-injection-safe). `code` is the immutable identity (Phase C FK key). */
const RATE_TYPE_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    sortOrder: 'sort_order',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    effectiveFrom: 'effective_from',
  },
  filterMap: {
    category: { column: 'category', kind: 'text' },
    isActive: { column: 'is_active', kind: 'text' },
  },
  defaultSort: 'sortOrder',
  defaultOrder: 'asc',
};

/** The DataGrid export manifest (UX-5): column `id`s match the FE DataGrid column ids. */
function rateTypeExportColumns(): ExportColumn<RateType>[] {
  return [
    { id: 'code', header: 'Code', value: (r) => r.code },
    { id: 'name', header: 'Name', value: (r) => r.name },
    { id: 'description', header: 'Description', value: (r) => r.description ?? '' },
    { id: 'category', header: 'Category', value: (r) => r.category },
    { id: 'sortOrder', header: 'Sort Order', value: (r) => String(r.sortOrder) },
    { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
    { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
    { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
    { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
  ];
}

/** Rate-type service — managed master-data catalog (ADR-0064). `code` is immutable (import/export: UX-5). */
export const rateTypeService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<RateType>> {
    const r = resolvePage(rawQuery, RATE_TYPE_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, RATE_TYPE_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /** Export rows for the DataGrid (IMPORT_EXPORT_STANDARD) — re-runs the SAME list query. */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, RATE_TYPE_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, RATE_TYPE_PAGE_SPEC);
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: rateTypeExportColumns() };
    const { items, totalCount } = await repo.list({
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
    return { rows: items, columns: rateTypeExportColumns() };
  },

  options: (activeOnly: boolean): Promise<RateTypeOption[]> => repo.options(activeOnly),

  /** Resolve the rate types available for a client, optionally narrowed by product / unit (ADR-0067,
   *  Phase B; owner fix 2026-07-08). A Universal dim omits its param entirely — the repo then matches
   *  ALL assignments on that dim (not just the wildcard NULL row) instead of falling back to the full
   *  catalog. clientId is always required. */
  available(rawQuery: Record<string, unknown>): Promise<RateTypeOption[]> {
    const clientId = posIntParam(rawQuery, 'clientId');
    const productId = optionalPosIntParam(rawQuery, 'productId');
    const unitId = optionalPosIntParam(rawQuery, 'verificationUnitId');
    return repo.available(clientId, productId, unitId);
  },

  findById: (id: number): Promise<RateType | null> => repo.findById(id),

  create(input: unknown, userId: string): Promise<RateType> {
    const v = CreateRateTypeSchema.parse(input); // throws ZodError → 400
    return repo.create(
      {
        code: v.code,
        name: v.name,
        description: v.description,
        category: v.category,
        sortOrder: v.sortOrder,
        effectiveFrom: v.effectiveFrom,
      },
      userId,
    );
  },

  /** Import (UX-5): download template / preview (validate, no writes) / confirm (process valid rows).
   *  Confirm reuses the audited `repo.create` per row; a duplicate code is reported per-row and never
   *  blocks the others. */
  importTemplate: () => buildTemplate(RATE_TYPE_IMPORT_SPEC),
  importPreview: (file: Buffer) => runImportPreview(file, RATE_TYPE_IMPORT_SPEC),
  importConfirm: (file: Buffer, userId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      RATE_TYPE_IMPORT_SPEC,
      async (input) => {
        await repo.create(
          {
            code: input.code,
            name: input.name,
            description: input.description,
            category: input.category ?? 'FIELD', // schema defaults blank → FIELD; satisfies the type post-parse
            sortOrder: input.sortOrder,
            effectiveFrom: input.effectiveFrom,
          },
          userId,
        );
      },
      { userId, fileName },
    ),

  async update(id: number, input: unknown, userId: string): Promise<RateType> {
    const v = UpdateRateTypeSchema.parse(input); // field validation (400 VALIDATION) — no `code`
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
    return repo.update(
      id,
      {
        name: v.name,
        description: v.description,
        category: v.category,
        sortOrder: v.sortOrder,
        effectiveFrom: v.effectiveFrom,
      },
      userId,
      expectedVersion,
      existing,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),
};
