import {
  CreateCommissionRateSchema,
  ReviseCommissionRateSchema,
  type CommissionRate,
  type CommissionRateView,
  type Paginated,
} from '@crm2/sdk';
import { commissionRateRepository as repo } from './repository.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { buildTemplate, runImportConfirm, runImportPreview } from '../../platform/import/index.js';
import { buildCommissionRateSpec, COMMISSION_RATE_TEMPLATE_SPEC } from './import.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Count and items share
 *  CR_FROM (all joins present), so joined columns are filterable too. */
const CR_PAGE_SPEC: PageSpec = {
  sortMap: {
    user: 'u.name',
    client: 'c.name',
    fieldRateType: 'cr.field_rate_type',
    amount: 'cr.amount',
    effectiveFrom: 'cr.effective_from',
    status: 'cr.is_active',
    createdAt: 'cr.created_at',
    updatedAt: 'cr.updated_at',
  },
  filterMap: {
    fieldRateType: { column: 'cr.field_rate_type', kind: 'text' },
    user: { column: 'u.name', kind: 'text' },
    client: { column: 'c.name', kind: 'text' },
    createdAt: { column: 'cr.created_at', kind: 'date' },
    effectiveFrom: { column: 'cr.effective_from', kind: 'date' },
  },
  defaultSort: 'user',
  defaultOrder: 'asc',
};

const toPosInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** DataGrid export manifest — `id`s match the FE column ids (CommissionRatesPage). The ADR-0046
 *  resolution dimensions (product / verification-unit / location / tat-band) and the currency are
 *  exported so two differently-dimensioned rows are NEVER ambiguous and the `location` (a REQUIRED
 *  key for LOCAL/OGL rows) is never dropped. Every Universal-able dimension renders the literal
 *  `Universal` when unset (consistent with the Client column) so a reader never confuses "applies to
 *  any" with "missing". NOTE: this export is display-oriented — the commission IMPORT template is
 *  code/pincode-keyed, so an export is read-for-analysis, not a re-import source (registry IE-DEFER-7). */
const UNIVERSAL = 'Universal';
const COMMISSION_RATE_EXPORT_COLUMNS: ExportColumn<CommissionRateView>[] = [
  { id: 'user', header: 'User', value: (r) => r.userName },
  { id: 'client', header: 'Client', value: (r) => r.clientName ?? UNIVERSAL },
  { id: 'fieldRateType', header: 'Rate Type', value: (r) => r.fieldRateType },
  {
    id: 'product',
    header: 'Product',
    value: (r) => (r.productName ? `${r.productCode ?? ''} ${r.productName}`.trim() : UNIVERSAL),
  },
  { id: 'verificationUnit', header: 'Unit', value: (r) => r.verificationUnitName ?? UNIVERSAL },
  {
    id: 'location',
    header: 'Location',
    value: (r) => (r.pincode || r.area ? `${r.pincode ?? ''} ${r.area ?? ''}`.trim() : UNIVERSAL),
  },
  {
    id: 'tatBand',
    header: 'TAT Band',
    value: (r) => (r.tatBand == null ? UNIVERSAL : r.tatBand === -1 ? 'Out of band' : `${r.tatBand}h`),
  },
  { id: 'amount', header: 'Amount', value: (r) => r.amount },
  { id: 'currency', header: 'Currency', value: (r) => r.currency },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
  { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
];

/**
 * Commission rate service (ADR-0036) — the per-user agent-commission amount source.
 *  - create: client-scoped or universal (clientId null); no-overlap enforced by the DB
 *  - revise: effective-dated — a new version row; the prior is end-dated, never overwritten
 *  - (de)activate: OCC-guarded soft state
 */
export const commissionRateService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<CommissionRateView>> {
    const r = resolvePage(rawQuery, CR_PAGE_SPEC);
    const userId = typeof rawQuery['userId'] === 'string' ? rawQuery['userId'] : undefined;
    const clientId = toPosInt(rawQuery['clientId']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const history = rawQuery['history'] === 'true' ? true : undefined;
    const columnFilters = resolveFilters(rawQuery, CR_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(userId !== undefined ? { userId } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
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
    if (userId !== undefined) filters['userId'] = userId;
    if (clientId !== undefined) filters['clientId'] = clientId;
    if (active !== undefined) filters['active'] = active;
    if (history !== undefined) filters['history'] = history;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /** Export rows for the DataGrid (IMPORT_EXPORT_STANDARD) — re-runs the SAME list query. */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, CR_PAGE_SPEC);
    const userId = typeof rawQuery['userId'] === 'string' ? rawQuery['userId'] : undefined;
    const clientId = toPosInt(rawQuery['clientId']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const history = rawQuery['history'] === 'true' ? true : undefined;
    const columnFilters = resolveFilters(rawQuery, CR_PAGE_SPEC);
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: COMMISSION_RATE_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(userId !== undefined ? { userId } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
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
    return { rows: items, columns: COMMISSION_RATE_EXPORT_COLUMNS };
  },

  /** Import (FK-resolving): the file carries username + client CODE; `buildCommissionRateSpec`
   *  preloads the code→id maps and the engine maps each row to a numeric-id create-input. Confirm
   *  reuses the audited per-row `create` (no-overlap + audit per row). */
  importTemplate(): Promise<Buffer> {
    return buildTemplate(COMMISSION_RATE_TEMPLATE_SPEC);
  },
  async importPreview(file: Buffer) {
    return runImportPreview(file, await buildCommissionRateSpec());
  },
  async importConfirm(file: Buffer, userId: string, fileName: string | undefined) {
    return runImportConfirm(
      file,
      await buildCommissionRateSpec(),
      async (input) => {
        await commissionRateService.create(input, userId);
      },
      { userId, fileName },
    );
  },

  create(input: unknown, userId: string): Promise<CommissionRate> {
    const validated = CreateCommissionRateSchema.parse(input); // throws ZodError → 400
    return repo.create(validated, userId);
  },

  async revise(id: number, input: unknown, userId: string): Promise<CommissionRate> {
    const validated = ReviseCommissionRateSchema.parse(input);
    const expectedVersion = requireVersion(input);
    return repo.revise(id, validated.amount, validated.effectiveFrom ?? null, userId, expectedVersion);
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),
};
