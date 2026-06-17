import {
  CreateClientSchema,
  UpdateClientSchema,
  type Client,
  type CreateClientInput,
  type Option,
  type Paginated,
} from '@crm2/sdk';
import { clientRepository as repo } from './repository.js';
import { scopedEntityIds, type Actor } from '../../platform/scope/index.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import { masterDataExportColumns } from '../shared/masterDataExport.js';
import { masterDataImportSpec } from '../shared/masterDataImport.js';
import { assertExportable, exportThreshold, type ResolvedExport } from '../../platform/export/index.js';
import { buildTemplate, runImportConfirm, runImportPreview } from '../../platform/import/index.js';
import { applyBulkOcc, parseBulkItems } from '../../platform/bulk.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6) below. */
const CLIENT_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    status: 'is_active',
    effectiveFrom: 'effective_from',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    code: { column: 'code', kind: 'text' },
    name: { column: 'name', kind: 'text' },
    createdAt: { column: 'created_at', kind: 'date' },
    effectiveFrom: { column: 'effective_from', kind: 'date' },
  },
  defaultSort: 'name',
  defaultOrder: 'asc',
};

/** Import contract (B-14): the shared code/name/effectiveFrom manifest + the Client Create schema. */
const CLIENT_IMPORT_SPEC = masterDataImportSpec<CreateClientInput>('clients', CreateClientSchema);

/**
 * Client master-data service:
 *  - create/update validated against the shared zod schema
 *  - `code` is correctable only while the client is unreferenced (ADR-0020); locked once in use
 *  - audit (created_by/updated_by) set from the caller
 */
export const clientService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<Client>> {
    const r = resolvePage(rawQuery, CLIENT_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, CLIENT_PAGE_SPEC);
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

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (search/filters/sort) — `current` = the exact page; `all` = every matching row (no page LIMIT,
   * capped at the job threshold → 413 EXPORT_TOO_LARGE above it). Returns rows + the shared
   * master-data column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, CLIENT_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, CLIENT_PAGE_SPEC);
    // `selected` restricts to the ticked numeric ids; an empty/invalid set exports nothing (never
    // falls through to "all").
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: masterDataExportColumns<Client>() };
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
    return { rows: items, columns: masterDataExportColumns<Client>() };
  },

  async get(id: number): Promise<Client> {
    const client = await repo.findById(id);
    if (!client) throw AppError.notFound('CLIENT_NOT_FOUND');
    return client;
  },

  // actor present (operational dropdowns) → scoped to the portfolio; absent (import code-resolution)
  // → unscoped (all). SUPER_ADMIN / roles with no CLIENT wiring see all either way.
  async options(actor?: Actor): Promise<Option[]> {
    return repo.options(actor ? await scopedEntityIds(actor, 'CLIENT') : undefined);
  },

  create(input: unknown, userId: string): Promise<Client> {
    const validated = CreateClientSchema.parse(input); // throws ZodError → 400
    return repo.create(validated, userId);
  },

  /** Import (B-14): download template / preview (validate, no writes) / confirm (process valid rows).
   *  Confirm reuses the audited `repo.create` per row, so each imported row also appends an audit_log
   *  CREATE; a duplicate code is reported per-row and never blocks the others. */
  importTemplate: () => buildTemplate(CLIENT_IMPORT_SPEC),
  importPreview: (file: Buffer) => runImportPreview(file, CLIENT_IMPORT_SPEC),
  importConfirm: (file: Buffer, userId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      CLIENT_IMPORT_SPEC,
      async (input) => {
        await repo.create(input, userId);
      },
      { userId, fileName },
    ),

  async update(id: number, input: unknown, userId: string): Promise<Client> {
    const validated = UpdateClientSchema.parse(input); // field validation (400 VALIDATION)
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('CLIENT_NOT_FOUND');
    // ADR-0020: the code is correctable only while unreferenced; locked once in use.
    const codeChanged = validated.code !== undefined && validated.code !== existing.code;
    if (codeChanged && (await repo.hasDependents(id)))
      throw AppError.conflict('CODE_LOCKED', 'code is in use by other records and cannot be changed');
    const code = codeChanged ? validated.code : undefined;
    return repo.updateRow(
      id,
      code,
      validated.name,
      validated.effectiveFrom,
      userId,
      expectedVersion,
      existing,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),

  /** Bulk (de)activate — per-row OCC, per-row result (CONCURRENCY_AND_EDITING_STANDARD §1). Reuses
   *  the same version-guarded `repo.setActive`; a row changed since selection comes back CONFLICT. */
  bulkSetActive(body: unknown, isActive: boolean, userId: string) {
    const items = parseBulkItems(body, 'int');
    return applyBulkOcc(items, (id, version) => repo.setActive(Number(id), isActive, userId, version));
  },
};
