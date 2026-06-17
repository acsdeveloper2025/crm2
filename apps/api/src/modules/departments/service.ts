import {
  CreateDepartmentSchema,
  UpdateDepartmentSchema,
  type CreateDepartmentInput,
  type Department,
  type DepartmentOption,
  type Paginated,
} from '@crm2/sdk';
import { departmentRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import {
  buildTemplate,
  runImportConfirm,
  runImportPreview,
  type ImportColumn,
  type ImportSpec,
} from '../../platform/import/index.js';
import { parseIsoDate } from '../../platform/import/parsers.js';
import { applyBulkOcc, parseBulkItems } from '../../platform/bulk.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6) below. */
const DEPARTMENT_PAGE_SPEC: PageSpec = {
  sortMap: {
    name: 'name',
    status: 'is_active',
    effectiveFrom: 'effective_from',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    name: { column: 'name', kind: 'text' },
    createdAt: { column: 'created_at', kind: 'date' },
    effectiveFrom: { column: 'effective_from', kind: 'date' },
  },
  defaultSort: 'name',
  defaultOrder: 'asc',
};

const DEPARTMENT_EXPORT_COLUMNS: ExportColumn<Department>[] = [
  { id: 'name', header: 'Name', value: (d) => d.name },
  { id: 'description', header: 'Description', value: (d) => d.description },
  { id: 'effectiveFrom', header: 'Effective From', value: (d) => d.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (d) => d.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (d) => d.updatedAt },
  { id: 'status', header: 'Status', value: (d) => (d.isActive ? 'Active' : 'Inactive') },
];

const DEPARTMENT_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'name', header: 'Name', required: true },
  { id: 'description', header: 'Description' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const DEPARTMENT_IMPORT_SPEC: ImportSpec<CreateDepartmentInput> = {
  resource: 'departments',
  columns: DEPARTMENT_IMPORT_COLUMNS,
  schema: CreateDepartmentSchema,
  sample: { name: 'Operations', description: 'Field operations team' },
};

/** Department service — organisational-unit CRUD (a required dropdown on the user form). */
export const departmentService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<Department>> {
    const r = resolvePage(rawQuery, DEPARTMENT_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, DEPARTMENT_PAGE_SPEC);
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

  options: (): Promise<DepartmentOption[]> => repo.options(),

  /** Export rows for the DataGrid (IMPORT_EXPORT_STANDARD) — same list query, file streamed by the controller. */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, DEPARTMENT_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, DEPARTMENT_PAGE_SPEC);
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: DEPARTMENT_EXPORT_COLUMNS };
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
    return { rows: items, columns: DEPARTMENT_EXPORT_COLUMNS };
  },

  importTemplate: () => buildTemplate(DEPARTMENT_IMPORT_SPEC),
  importPreview: (file: Buffer) => runImportPreview(file, DEPARTMENT_IMPORT_SPEC),
  importConfirm: (file: Buffer, userId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      DEPARTMENT_IMPORT_SPEC,
      async (input) => {
        await departmentService.create(input, userId);
      },
      { userId, fileName },
    ),

  create(input: unknown, userId: string): Promise<Department> {
    const v = CreateDepartmentSchema.parse(input); // throws ZodError → 400
    return repo.create(
      { name: v.name, description: v.description ?? '', effectiveFrom: v.effectiveFrom },
      userId,
    );
  },

  async update(id: number, input: unknown, userId: string): Promise<Department> {
    const v = UpdateDepartmentSchema.parse(input); // field validation (400 VALIDATION)
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('DEPARTMENT_NOT_FOUND');
    return repo.update(
      id,
      { name: v.name, description: v.description, effectiveFrom: v.effectiveFrom },
      userId,
      expectedVersion,
      existing,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),

  bulkSetActive(body: unknown, isActive: boolean, userId: string) {
    const items = parseBulkItems(body, 'int');
    return applyBulkOcc(items, (id, version) => repo.setActive(Number(id), isActive, userId, version));
  },
};
