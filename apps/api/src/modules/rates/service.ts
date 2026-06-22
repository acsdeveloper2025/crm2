import {
  CreateRateSchema,
  UpdateRateSchema,
  ReviseRateSchema,
  KINDS,
  type Rate,
  type RateHistory,
  type RateView,
  type Paginated,
} from '@crm2/sdk';
import { rateRepository as repo } from './repository.js';
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
import { buildTemplate, runImportConfirm, runImportPreview } from '../../platform/import/index.js';
import { buildRateSpec, RATE_TEMPLATE_SPEC } from './import.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6/§7)
 *  below — count and items share RATE_FROM (all joins present), so joined columns are filterable. */
const RATE_PAGE_SPEC: PageSpec = {
  sortMap: {
    client: 'c.name',
    product: 'p.name',
    kind: 'vu.kind',
    unit: 'vu.name',
    pincode: 'l.pincode',
    area: 'l.area',
    clientRateType: 'r.client_rate_type',
    amount: 'r.amount',
    effectiveFrom: 'r.effective_from',
    status: 'r.is_active',
    createdAt: 'r.created_at',
    updatedAt: 'r.updated_at',
  },
  filterMap: {
    kind: { column: 'vu.kind', kind: 'enum', values: KINDS },
    unit: { column: 'vu.name', kind: 'text' },
    pincode: { column: 'l.pincode', kind: 'text' },
    area: { column: 'l.area', kind: 'text' },
    clientRateType: { column: 'r.client_rate_type', kind: 'text' },
    createdAt: { column: 'r.created_at', kind: 'date' },
    effectiveFrom: { column: 'r.effective_from', kind: 'date' },
  },
  defaultSort: 'client',
  defaultOrder: 'asc',
};

const toPosInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * The DataGrid export manifest for the rates list (IMPORT_EXPORT_STANDARD). Column `id`s match the
 * FE DataGrid column ids (RateManagementPage) so the visible-columns (`cols`) selection filters +
 * orders them; the `actions` column has no data value and is absent here. KYC rates have null
 * product/unit geography/rate-type — those values fall back to empty cells.
 */
const RATE_EXPORT_COLUMNS: ExportColumn<RateView>[] = [
  { id: 'client', header: 'Client', value: (r) => r.clientCode },
  { id: 'product', header: 'Product', value: (r) => r.productCode },
  { id: 'kind', header: 'Kind', value: (r) => r.unitKind.replace(/_/g, ' ') },
  { id: 'unit', header: 'Verification Unit', value: (r) => r.unitName },
  { id: 'pincode', header: 'Pincode', value: (r) => r.pincode },
  { id: 'area', header: 'Area', value: (r) => r.area },
  { id: 'clientRateType', header: 'Rate Type', value: (r) => r.clientRateType },
  { id: 'amount', header: 'Rate', value: (r) => r.amount },
  // currency is importable (rates/import.ts) but was dropped from export → non-lossless round-trip.
  { id: 'currency', header: 'Currency', value: (r) => r.currency },
  { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
  // effectiveTo (history-row validity window; null = current) — without it a history export loses the
  // end of each version's window. Not a FE grid column, so it rides only the full (no-`cols`) export.
  { id: 'effectiveTo', header: 'Effective To', value: (r) => r.effectiveTo },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];

/**
 * Rate service (ADR-0016) — the billing authority for a verification unit under a client+product.
 *  - create: optional client_rate_type (KYC VUs leave it null); eligibility + no-overlap enforced by the DB
 *  - revise: effective-dated — a new version row; the prior is end-dated, never overwritten
 *  - update: legacy flat amount edit (overwrite) for the pre-workspace screen
 */
export const rateService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<RateView>> {
    const r = resolvePage(rawQuery, RATE_PAGE_SPEC);
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const verificationUnitId = toPosInt(rawQuery['verificationUnitId']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const history = rawQuery['history'] === 'true' ? true : undefined;
    const columnFilters = resolveFilters(rawQuery, RATE_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(clientId !== undefined ? { clientId } : {}),
      ...(productId !== undefined ? { productId } : {}),
      ...(verificationUnitId !== undefined ? { verificationUnitId } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(history !== undefined ? { history } : {}),
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
    if (verificationUnitId !== undefined) filters['verificationUnitId'] = verificationUnitId;
    if (active !== undefined) filters['active'] = active;
    if (history !== undefined) filters['history'] = history;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (search/filters/sort + clientId/productId/unit/kind) — `current` = the exact page; `all` = every
   * matching row (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it).
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, RATE_PAGE_SPEC);
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const verificationUnitId = toPosInt(rawQuery['verificationUnitId']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const history = rawQuery['history'] === 'true' ? true : undefined;
    const columnFilters = resolveFilters(rawQuery, RATE_PAGE_SPEC);
    // `selected` restricts to the ticked numeric ids; an empty/invalid set exports nothing (never
    // falls through to "all").
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: RATE_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(clientId !== undefined ? { clientId } : {}),
      ...(productId !== undefined ? { productId } : {}),
      ...(verificationUnitId !== undefined ? { verificationUnitId } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: RATE_EXPORT_COLUMNS };
  },

  create(input: unknown, userId: string): Promise<Rate> {
    const validated = CreateRateSchema.parse(input); // throws ZodError → 400
    return repo.create(validated, userId);
  },

  /** Import (B-14, the only FK-resolving domain): the file carries client/product/unit CODES + a
   *  pincode+area geography; `buildRateSpec` preloads the code→id maps per request and the engine's
   *  `resolve` maps each row to the numeric-id `CreateRateInput` (per-row code errors surface in
   *  preview). Confirm reuses the audited `create` per row, so each imported rate also appends audit. */
  importTemplate(): Promise<Buffer> {
    return buildTemplate(RATE_TEMPLATE_SPEC);
  },
  async importPreview(file: Buffer) {
    return runImportPreview(file, await buildRateSpec());
  },
  async importConfirm(file: Buffer, userId: string, fileName: string | undefined) {
    return runImportConfirm(
      file,
      await buildRateSpec(),
      async (input) => {
        await rateService.create(input, userId);
      },
      { userId, fileName },
    );
  },

  async revise(id: number, input: unknown, userId: string): Promise<Rate> {
    const validated = ReviseRateSchema.parse(input);
    const expectedVersion = requireVersion(input);
    return repo.revise(id, validated.amount, validated.effectiveFrom ?? null, userId, expectedVersion);
  },

  async update(id: number, input: unknown, userId: string): Promise<Rate> {
    const validated = UpdateRateSchema.parse(input);
    const expectedVersion = requireVersion(input);
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('RATE_NOT_FOUND');
    return repo.updateAmount(id, validated.amount, userId, expectedVersion);
  },

  async history(id: number): Promise<RateHistory[]> {
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('RATE_NOT_FOUND');
    return repo.history(id);
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
