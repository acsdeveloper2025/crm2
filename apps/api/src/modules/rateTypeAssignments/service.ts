import {
  CreateRateTypeAssignmentSchema,
  type Paginated,
  type RateTypeAssignment,
  type RateTypeAssignmentView,
  type BulkResult,
} from '@crm2/sdk';
import { rateTypeAssignmentRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { parseBulkIds } from '../../platform/bulk.js';
import { buildTemplate, runImportConfirm, runImportPreview } from '../../platform/import/index.js';
import { buildRateTypeAssignmentSpec, RATE_TYPE_ASSIGNMENT_TEMPLATE_SPEC } from './import.js';

/** Sortable + filterable columns (apiField → SQL column); only these reach ORDER BY / the WHERE clause.
 *  Count + items share RTA_FROM (all joins present), so joined columns are sortable + filterable. */
const RTA_PAGE_SPEC: PageSpec = {
  sortMap: {
    client: 'c.name',
    product: 'p.name',
    verificationUnit: 'vu.name',
    rateType: 'rt.code',
    status: 'a.is_active',
    createdAt: 'a.created_at',
    updatedAt: 'a.updated_at',
  },
  filterMap: {
    client: { column: 'c.name', kind: 'text' },
    product: { column: 'p.name', kind: 'text' },
    verificationUnit: { column: 'vu.name', kind: 'text' },
    rateType: { column: 'rt.code', kind: 'text' },
    createdAt: { column: 'a.created_at', kind: 'date' },
  },
  defaultSort: 'client',
  defaultOrder: 'asc',
};

const toPosInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** DataGrid export manifest — `id`s match the FE column ids (RateTypeAssignmentsPage). A null product /
 *  unit renders the literal `Universal` (consistent with the FE column) so a reader never confuses
 *  "applies to any" with "missing". */
const UNIVERSAL = 'Universal';
const RTA_EXPORT_COLUMNS: ExportColumn<RateTypeAssignmentView>[] = [
  { id: 'client', header: 'Client', value: (r) => r.clientName ?? r.clientCode ?? '' },
  {
    id: 'product',
    header: 'Product',
    value: (r) => (r.productName ? `${r.productCode ?? ''} ${r.productName}`.trim() : UNIVERSAL),
  },
  { id: 'verificationUnit', header: 'Unit', value: (r) => r.verificationUnitName ?? UNIVERSAL },
  { id: 'rateType', header: 'Rate Type', value: (r) => r.rateTypeCode },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
];

/**
 * Rate-type assignment service (ADR-0067 / ADR-0069) — which rate type a (client × product × unit) combo
 * may use. Standard CRUD master data (mirrors commissionRates, minus amount/effective-dating/OCC):
 *  - list/get: the joined view (product/unit NULL = Universal)
 *  - create: idempotent — re-creating the same combo re-activates it (NULLS-NOT-DISTINCT unique key)
 *  - deactivate: soft toggle by id
 */
export const rateTypeAssignmentService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<RateTypeAssignmentView>> {
    const r = resolvePage(rawQuery, RTA_PAGE_SPEC);
    const clientId = toPosInt(rawQuery['clientId']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, RTA_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
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

  /** A single assignment by id (the record-page loader); 404s an unknown id. */
  async get(id: number): Promise<RateTypeAssignmentView> {
    const row = await repo.findView(id);
    if (!row) throw AppError.notFound('RATE_TYPE_ASSIGNMENT_NOT_FOUND');
    return row;
  },

  /** Export rows for the DataGrid (IMPORT_EXPORT_STANDARD) — re-runs the SAME list query. */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, RTA_PAGE_SPEC);
    const clientId = toPosInt(rawQuery['clientId']);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, RTA_PAGE_SPEC);
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: RTA_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(clientId !== undefined ? { clientId } : {}),
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
    return { rows: items, columns: RTA_EXPORT_COLUMNS };
  },

  /** Import (FK-resolving): the file carries client/product/unit/rate-type CODEs; `buildRateTypeAssignmentSpec`
   *  preloads the code→id maps and the engine maps each row to a numeric-id create-input. Confirm reuses
   *  the audited per-row `create`. */
  importTemplate(): Promise<Buffer> {
    return buildTemplate(RATE_TYPE_ASSIGNMENT_TEMPLATE_SPEC);
  },
  async importPreview(file: Buffer) {
    return runImportPreview(file, await buildRateTypeAssignmentSpec());
  },
  async importConfirm(file: Buffer, userId: string, fileName: string | undefined) {
    return runImportConfirm(
      file,
      await buildRateTypeAssignmentSpec(),
      async (input) => {
        await rateTypeAssignmentService.create(input, userId);
      },
      { userId, fileName },
    );
  },

  create(input: unknown, userId: string): Promise<RateTypeAssignment> {
    const validated = CreateRateTypeAssignmentSchema.parse(input); // throws ZodError → 400
    return repo.create(validated, userId);
  },

  deactivate: (id: number, userId: string): Promise<RateTypeAssignment> => repo.deactivate(id, userId),

  /** Bulk deactivate (UX-11) — mirrors the SHAPE of rates' bulk endpoint (per-row result map), not
   *  its OCC mechanics (RTA has no version column). A row already inactive (or unknown) reports
   *  NOT_FOUND — the repo's single UPDATE only matches active rows, so both cases land in the same
   *  diff (there's nothing to distinguish "gone" from "already off" without a second read, and the
   *  bulk action is deactivate-only, so both mean "nothing left to do here"). */
  async bulkDeactivate(body: unknown, userId: string): Promise<BulkResult> {
    const ids = parseBulkIds(body);
    const { okIds, notFoundIds } = await repo.bulkDeactivate(ids, userId);
    const results: BulkResult['results'] = [
      ...okIds.map((id) => ({ id: String(id), status: 'OK' as const })),
      ...notFoundIds.map((id) => ({ id: String(id), status: 'NOT_FOUND' as const })),
    ];
    return { results, okCount: okIds.length, conflictCount: 0, notFoundCount: notFoundIds.length };
  },
};
