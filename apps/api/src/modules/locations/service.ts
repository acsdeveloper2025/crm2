import {
  CreateLocationSchema,
  CreateLocationBatchSchema,
  UpdateLocationSchema,
  type CreateLocationInput,
  type Location,
  type LocationBatchResult,
  type Paginated,
} from '@crm2/sdk';
import { locationRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { exportJobRowCap } from '../../platform/export/job.js';
import {
  buildTemplate,
  importMaxRows,
  runImportConfirm,
  runImportPreview,
  type ImportColumn,
  type ImportSpec,
} from '../../platform/import/index.js';
import { parseIsoDate } from '../../platform/import/parsers.js';
import { applyBulkOcc, parseBulkItems } from '../../platform/bulk.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6) below
 *  — all backed by the pg_trgm GIN indexes from migration 0020 (157k-row catalog stays fast). */
const LOCATION_PAGE_SPEC: PageSpec = {
  sortMap: {
    pincode: 'pincode',
    area: 'area',
    city: 'city',
    state: 'state',
    country: 'country',
    status: 'is_active',
    effectiveFrom: 'effective_from',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    pincode: { column: 'pincode', kind: 'text' },
    area: { column: 'area', kind: 'text' },
    city: { column: 'city', kind: 'text' },
    state: { column: 'state', kind: 'text' },
    createdAt: { column: 'created_at', kind: 'date' },
    effectiveFrom: { column: 'effective_from', kind: 'date' },
  },
  defaultSort: 'pincode',
  defaultOrder: 'asc',
};

/**
 * DataGrid export manifest (IMPORT_EXPORT_STANDARD). Column `id`s match the FE DataGrid column ids so
 * the visible-columns (`cols`) selection filters + orders them; the `actions` column has no data value
 * and is simply absent here.
 */
const LOCATION_EXPORT_COLUMNS: ExportColumn<Location>[] = [
  { id: 'pincode', header: 'Pincode', value: (r) => r.pincode },
  { id: 'area', header: 'Area', value: (r) => r.area },
  { id: 'city', header: 'City', value: (r) => r.city },
  { id: 'state', header: 'State', value: (r) => r.state },
  { id: 'country', header: 'Country', value: (r) => r.country },
  { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];

/**
 * Import contract (B-14): the pincode catalog is FK-free, so no `resolve` and no `uniqueKey`
 * (a pincode legitimately repeats across areas). Blank Country falls back to the schema default
 * ('India'); Effective From is coerced to ISO so the `z.string().datetime()` schema accepts a date.
 */
const LOCATION_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'pincode', header: 'Pincode', required: true },
  { id: 'area', header: 'Area', required: true },
  { id: 'city', header: 'City', required: true },
  { id: 'state', header: 'State', required: true },
  { id: 'country', header: 'Country' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const LOCATION_IMPORT_SPEC: ImportSpec<CreateLocationInput> = {
  resource: 'locations',
  columns: LOCATION_IMPORT_COLUMNS,
  schema: CreateLocationSchema,
  sample: { pincode: '400001', area: 'Fort', city: 'Mumbai', state: 'Maharashtra', country: 'India' },
};

/**
 * Location service — the pincode catalog.
 *  - create/update validated against the shared zod schema (pincode format mirrors DB CHECK)
 *  - pincode (the key) correctable only while unreferenced (ADR-0020); area/city/state always editable
 */
export const locationService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<Location>> {
    const r = resolvePage(rawQuery, LOCATION_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const pincode = typeof rawQuery['pincode'] === 'string' ? rawQuery['pincode'] : undefined;
    const columnFilters = resolveFilters(rawQuery, LOCATION_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(active !== undefined ? { active } : {}),
      ...(pincode !== undefined ? { pincode } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (active !== undefined) filters['active'] = active;
    if (pincode !== undefined) filters['pincode'] = pincode;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },
  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (active/pincode/search/filters/sort) — `current` = the exact page; `all` = every matching row
   * (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). On this 157k table
   * the `all` path reuses the list ORDER BY on the resolved sort column; the default sort (pincode) +
   * trgm search are indexed (migration 0020). Non-default export sorts rely on those existing indexes
   * (RATCHET already logged). Returns rows + the column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, LOCATION_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const pincode = typeof rawQuery['pincode'] === 'string' ? rawQuery['pincode'] : undefined;
    const columnFilters = resolveFilters(rawQuery, LOCATION_PAGE_SPEC);
    // `selected` restricts to the ticked numeric ids; an empty/invalid set exports nothing (never
    // falls through to "all").
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: LOCATION_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(active !== undefined ? { active } : {}),
      ...(pincode !== undefined ? { pincode } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: LOCATION_EXPORT_COLUMNS };
  },

  /**
   * Async export (B-13): the background EXPORT job re-runs the SAME filtered/sorted list query with no
   * page window, capped at the job row cap (no 413 — the job IS the >threshold path). Mode is always
   * `all` here; `selected`/`current` stream synchronously and never reach a job.
   */
  async exportAllForJob(rawQuery: Record<string, unknown>) {
    const r = resolvePage(rawQuery, LOCATION_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const pincode = typeof rawQuery['pincode'] === 'string' ? rawQuery['pincode'] : undefined;
    const columnFilters = resolveFilters(rawQuery, LOCATION_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(active !== undefined ? { active } : {}),
      ...(pincode !== undefined ? { pincode } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: exportJobRowCap(),
      offset: 0,
    });
    // totalCount = the FULL match count → the processor flags `capped` when it exceeds the cap.
    return { rows: items, columns: LOCATION_EXPORT_COLUMNS, totalCount };
  },

  pincodes: (q: string | undefined) => repo.pincodes(q),

  /** Import (B-14): template / preview (validate, no writes) / confirm (process valid rows). Confirm
   *  reuses this module's own audited `create`, so each imported row also appends an audit_log CREATE;
   *  a row whose write fails is reported per-row and never blocks the others. */
  importTemplate: () => buildTemplate(LOCATION_IMPORT_SPEC),
  // B-14: the 157k pincode catalog routinely imports >10k rows → allow up to the hard ceiling here
  // (maxRows); the sync-vs-job decision lives in importConfirmOrEnqueue, not the threshold throw.
  importPreview: (file: Buffer) => runImportPreview(file, LOCATION_IMPORT_SPEC, { maxRows: importMaxRows() }),
  importConfirm: (file: Buffer, userId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      LOCATION_IMPORT_SPEC,
      async (input) => {
        await locationService.create(input, userId);
      },
      { userId, fileName },
      { maxRows: importMaxRows() },
    ),

  create(input: unknown, userId: string): Promise<Location> {
    const validated = CreateLocationSchema.parse(input); // throws ZodError → 400
    return repo.create(validated, userId);
  },

  /**
   * Multi-area create (parity with v1's "add a pincode WITH its areas"). One shared
   * pincode/city/state/country + N areas → N rows, reusing the audited single `create` so each row
   * gets its own audit_log CREATE. Areas are de-duped case-insensitively first; an area whose
   * `(pincode,area)` already exists is reported in `skipped` and never aborts the rest.
   */
  async createBatch(input: unknown, userId: string): Promise<LocationBatchResult> {
    const { areas, ...shared } = CreateLocationBatchSchema.parse(input); // ZodError → 400
    const seen = new Set<string>();
    const created: Location[] = [];
    const skipped: { area: string; reason: string }[] = [];
    for (const area of areas) {
      const key = area.toLowerCase();
      if (seen.has(key)) {
        skipped.push({ area, reason: 'duplicate in request' });
        continue;
      }
      seen.add(key);
      try {
        created.push(await locationService.create({ ...shared, area }, userId));
      } catch (e) {
        if (e instanceof AppError && e.code === 'LOCATION_EXISTS') {
          skipped.push({ area, reason: 'pincode+area already exists' });
          continue;
        }
        throw e;
      }
    }
    return { created, skipped };
  },

  async update(id: number, input: unknown, userId: string): Promise<Location> {
    const validated = UpdateLocationSchema.parse(input); // field validation (400 VALIDATION)
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('LOCATION_NOT_FOUND');
    // ADR-0020: pincode (the key) is correctable only while unreferenced; locked once in use.
    const pincodeChanged = validated.pincode !== undefined && validated.pincode !== existing.pincode;
    if (pincodeChanged && (await repo.hasDependents(id)))
      throw AppError.conflict('PINCODE_LOCKED', 'pincode is in use by rates and cannot be changed');
    return repo.update(
      id,
      { ...validated, ...(pincodeChanged ? { pincode: validated.pincode } : { pincode: undefined }) },
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
