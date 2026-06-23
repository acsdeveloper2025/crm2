import {
  CreateClientProductSchema,
  CreateCpvUnitSchema,
  UpdateClientProductSchema,
  UpdateCpvUnitSchema,
  type ClientProduct,
  type ClientProductVerificationUnit,
  type ClientProductView,
  type CpvUnitListQuery,
  type Paginated,
} from '@crm2/sdk';
import {
  clientProductRepository as cpRepo,
  cpvUnitRepository as cpvRepo,
  type CpvUnitExportRow,
} from './repository.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { buildTemplate, runImportConfirm, runImportPreview } from '../../platform/import/index.js';
import { buildClientProductSpec, buildCpvUnitSpec, CP_TEMPLATE_SPEC, CPV_TEMPLATE_SPEC } from './import.js';

/**
 * DataGrid export manifest (IMPORT_EXPORT_STANDARD). The `client`/`product` ids match the FE DataGrid
 * column ids so the visible-columns (`cols`) selection filters + orders them; their header+value carry
 * the CODE — the key the import consumes ('Client Code'/'Product Code') — so an export re-imports
 * losslessly (the old combined "CODE — Name" cell could not). The Client/Product Name columns ride
 * alongside for readability; the import ignores them. The `actions` column has no data value and is absent.
 */
const CP_EXPORT_COLUMNS: ExportColumn<ClientProductView>[] = [
  { id: 'client', header: 'Client Code', value: (r) => r.clientCode },
  { id: 'clientName', header: 'Client Name', value: (r) => r.clientName },
  { id: 'product', header: 'Product Code', value: (r) => r.productCode },
  { id: 'productName', header: 'Product Name', value: (r) => r.productName },
  { id: 'units', header: 'Units', value: (r) => r.unitCount },
  { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];

/** Sortable + filterable columns (apiField → SQL column); only these reach ORDER BY / WHERE. */
const CP_PAGE_SPEC: PageSpec = {
  // Sort/filter target the CODE (the bold value shown in each cell) so the column stays coherent.
  sortMap: {
    client: 'c.code',
    product: 'p.code',
    units: 'unit_count',
    status: 'cp.is_active',
    effectiveFrom: 'cp.effective_from',
    createdAt: 'cp.created_at',
    updatedAt: 'cp.updated_at',
  },
  filterMap: {
    client: { column: 'c.code', kind: 'text' },
    product: { column: 'p.code', kind: 'text' },
    createdAt: { column: 'cp.created_at', kind: 'date' },
    effectiveFrom: { column: 'cp.effective_from', kind: 'date' },
  },
  defaultSort: 'client',
  defaultOrder: 'asc',
};

/**
 * CPV enablement services:
 *  - clientProduct: links a product to a client (unique pair, FK-checked)
 *  - cpvUnit: enables a verification unit for a client-product (unique pair, FK-checked)
 * Both write paths validate input via the shared zod schema; referential + uniqueness
 * invariants are enforced by the DB and mapped to AppError in the repository.
 */
export const clientProductService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<ClientProductView>> {
    const r = resolvePage(rawQuery, CP_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const clientId =
      typeof rawQuery['clientId'] === 'string' && Number.isInteger(Number(rawQuery['clientId']))
        ? Number(rawQuery['clientId'])
        : undefined;
    const columnFilters = resolveFilters(rawQuery, CP_PAGE_SPEC);
    const { items, totalCount } = await cpRepo.list({
      ...(clientId !== undefined ? { clientId } : {}),
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
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (clientId/active/search/filters/sort) — `current` = the exact page; `all` = every matching row
   * (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). CPV has no row
   * selection, so the `selected` mode never arrives from the UI; if requested it exports nothing
   * (never falls through to "all"). Returns rows + the manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    if (ex.mode === 'selected') return { rows: [], columns: CP_EXPORT_COLUMNS };
    const r = resolvePage(rawQuery, CP_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const clientId =
      typeof rawQuery['clientId'] === 'string' && Number.isInteger(Number(rawQuery['clientId']))
        ? Number(rawQuery['clientId'])
        : undefined;
    const columnFilters = resolveFilters(rawQuery, CP_PAGE_SPEC);
    const { items, totalCount } = await cpRepo.list({
      ...(clientId !== undefined ? { clientId } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: CP_EXPORT_COLUMNS };
  },

  create(input: unknown, userId: string): Promise<ClientProduct> {
    const validated = CreateClientProductSchema.parse(input); // throws ZodError → 400
    return cpRepo.create(validated, userId);
  },

  /** Import (B-14, FK-resolving): the file carries client/product CODES; `buildClientProductSpec`
   *  preloads the code→id maps per request and the engine's `resolve` maps each row to the numeric-id
   *  CreateClientProductInput (unknown codes surface in preview). Confirm reuses the audited `create`
   *  per row, so each imported link also appends audit; a duplicate link is reported per-row (409)
   *  and never blocks the others. */
  importTemplate(): Promise<Buffer> {
    return buildTemplate(CP_TEMPLATE_SPEC);
  },
  async importPreview(file: Buffer) {
    return runImportPreview(file, await buildClientProductSpec());
  },
  async importConfirm(file: Buffer, userId: string, fileName: string | undefined) {
    return runImportConfirm(
      file,
      await buildClientProductSpec(),
      async (input) => {
        await clientProductService.create(input, userId);
      },
      { userId, fileName },
    );
  },

  update(id: number, input: unknown, userId: string): Promise<ClientProduct> {
    const { effectiveFrom } = UpdateClientProductSchema.parse(input); // 400 VALIDATION
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    return cpRepo.updateEffectiveFrom(id, effectiveFrom, userId, expectedVersion);
  },

  activate: (id: number, version: number, userId: string) => cpRepo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => cpRepo.setActive(id, false, userId, version),
};

/**
 * DataGrid export manifest for the enabled-units leg (IE-DEFER-2). The `unit`/`effectiveFrom`/
 * `createdAt`/`updatedAt`/`status` ids match CpvPage's enabled-units sub-table column ids so a
 * visible-columns (`cols`) selection filters + orders them. The export carries the resolvable CODES
 * (client + product + unit) — the keys the cpv-unit import consumes ('Client Code'/'Product Code'/
 * 'Unit Code') — so an export re-imports losslessly; the Name columns ride alongside for readability
 * (the import ignores them). The `actions` column has no data value and is absent.
 */
const CPV_UNIT_EXPORT_COLUMNS: ExportColumn<CpvUnitExportRow>[] = [
  { id: 'client', header: 'Client Code', value: (r) => r.clientCode },
  { id: 'clientName', header: 'Client Name', value: (r) => r.clientName },
  { id: 'product', header: 'Product Code', value: (r) => r.productCode },
  { id: 'productName', header: 'Product Name', value: (r) => r.productName },
  // id 'unit' matches the FE sub-table 'Unit' column; header is the import key 'Unit Code'.
  { id: 'unit', header: 'Unit Code', value: (r) => r.unitCode },
  { id: 'unitName', header: 'Unit Name', value: (r) => r.unitName },
  { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];

/** Sortable + filterable columns for the export list (apiField → SQL column); only these reach ORDER BY / WHERE. */
const CPV_UNIT_EXPORT_PAGE_SPEC: PageSpec = {
  // Sort/filter target the CODE (the value shown in each cell) so the column stays coherent.
  sortMap: {
    client: 'c.code',
    product: 'p.code',
    unit: 'vu.code',
    status: 'cpvu.is_active',
    effectiveFrom: 'cpvu.effective_from',
    createdAt: 'cpvu.created_at',
    updatedAt: 'cpvu.updated_at',
  },
  filterMap: {
    client: { column: 'c.code', kind: 'text' },
    product: { column: 'p.code', kind: 'text' },
    unit: { column: 'vu.code', kind: 'text' },
    createdAt: { column: 'cpvu.created_at', kind: 'date' },
    effectiveFrom: { column: 'cpvu.effective_from', kind: 'date' },
  },
  defaultSort: 'client',
  defaultOrder: 'asc',
};

export const cpvUnitService = {
  list: (q: CpvUnitListQuery) => cpvRepo.list(q),

  /**
   * Export the enabled-units across ALL client-products (IE-DEFER-2, IMPORT_EXPORT_STANDARD). Mirrors
   * `clientProductService.exportData`: `current` = the exact page; `all` = every matching row (no page
   * LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). There is no row selection in
   * the sub-table, so `selected` exports nothing (never falls through to "all"). Returns rows + the
   * manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    if (ex.mode === 'selected') return { rows: [], columns: CPV_UNIT_EXPORT_COLUMNS };
    const r = resolvePage(rawQuery, CPV_UNIT_EXPORT_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, CPV_UNIT_EXPORT_PAGE_SPEC);
    const { items, totalCount } = await cpvRepo.listForExport({
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: CPV_UNIT_EXPORT_COLUMNS };
  },

  /** Import (IE-DEFER-2, FK-resolving): the file carries client/product/unit CODES; `buildCpvUnitSpec`
   *  preloads the code→id maps + the client_product link map per request and the engine's `resolve`
   *  maps each row to the numeric-id CreateCpvUnitInput (unknown codes / no usable link surface in
   *  preview). Confirm reuses the audited `create` per row, so each imported enablement also appends
   *  audit; a duplicate enablement is reported per-row (409) and never blocks the others. */
  importTemplate(): Promise<Buffer> {
    return buildTemplate(CPV_TEMPLATE_SPEC);
  },
  async importPreview(file: Buffer) {
    return runImportPreview(file, await buildCpvUnitSpec());
  },
  async importConfirm(file: Buffer, userId: string, fileName: string | undefined) {
    return runImportConfirm(
      file,
      await buildCpvUnitSpec(),
      async (input) => {
        await cpvUnitService.create(input, userId);
      },
      { userId, fileName },
    );
  },

  create(input: unknown, userId: string): Promise<ClientProductVerificationUnit> {
    const validated = CreateCpvUnitSchema.parse(input); // throws ZodError → 400
    return cpvRepo.create(validated, userId);
  },

  update(id: number, input: unknown, userId: string): Promise<ClientProductVerificationUnit> {
    const { effectiveFrom } = UpdateCpvUnitSchema.parse(input); // 400 VALIDATION
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    return cpvRepo.updateEffectiveFrom(id, effectiveFrom, userId, expectedVersion);
  },

  activate: (id: number, version: number, userId: string) => cpvRepo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => cpvRepo.setActive(id, false, userId, version),
};
