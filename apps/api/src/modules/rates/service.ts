import {
  BulkCreateRatesSchema,
  CreateRateSchema,
  UpdateRateSchema,
  ReviseRateSchema,
  type BulkRateResult,
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
import { buildRateSpec, buildRateTemplateNotes, RATE_TEMPLATE_SPEC } from './import.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6/§7)
 *  below — count and items share RATE_FROM (all joins present), so joined columns are filterable. */
const RATE_PAGE_SPEC: PageSpec = {
  sortMap: {
    client: 'c.name',
    product: 'p.name',
    unit: 'vu.name',
    pincode: 'l.pincode',
    area: 'l.area',
    clientRateType: 'rt.code',
    amount: 'r.amount',
    effectiveFrom: 'r.effective_from',
    status: 'r.is_active',
    createdAt: 'r.created_at',
    updatedAt: 'r.updated_at',
  },
  filterMap: {
    unit: { column: 'vu.name', kind: 'text' },
    pincode: { column: 'l.pincode', kind: 'text' },
    area: { column: 'l.area', kind: 'text' },
    clientRateType: { column: 'rt.code', kind: 'text' },
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

/** Resolve a rate-type CODE to its catalog id for a NEW save. A non-empty unknown code is a hard
 *  400 (never a silent typeless rate — matches bulk `INVALID_RATE_TYPE` and the import row error);
 *  blank/absent ⇒ null, a legitimately typeless located rate (e.g. a legacy/office-less line). */
async function resolveRateTypeId(code: string | null | undefined): Promise<number | null> {
  if (!code) return null;
  const rateType = await repo.rateTypeByCode(code);
  if (!rateType) throw AppError.badRequest('INVALID_RATE_TYPE', { code });
  return rateType.id;
}

/**
 * The DataGrid export manifest for the rates list (IMPORT_EXPORT_STANDARD). Column `id`s match the
 * FE DataGrid column ids (RateManagementPage) so the visible-columns (`cols`) selection filters +
 * orders them; the `actions` column has no data value and is absent here. KYC rates have null
 * product/unit geography/rate-type — those values fall back to empty cells.
 */
const RATE_EXPORT_COLUMNS: ExportColumn<RateView>[] = [
  { id: 'client', header: 'Client', value: (r) => r.clientCode },
  { id: 'product', header: 'Product', value: (r) => r.productCode },
  { id: 'unit', header: 'Verification Unit', value: (r) => r.unitName },
  { id: 'pincode', header: 'Pincode', value: (r) => r.pincode },
  { id: 'area', header: 'Area', value: (r) => r.area },
  { id: 'clientRateType', header: 'Rate Type', value: (r) => r.clientRateType },
  { id: 'amount', header: 'Rate', value: (r) => r.amount },
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

  /** Single rate as the joined RateView (D4 record-page loader, ADR-0051) — same shape a list row
   *  returns (client/product/unit/location names), so the revise form seeds its read-only dimensions.
   *  Returns null on a miss; the controller maps that to 404. */
  get(id: number): Promise<RateView | null> {
    return repo.findViewById(id);
  },

  async create(input: unknown, userId: string): Promise<Rate> {
    const validated = CreateRateSchema.parse(input); // throws ZodError → 400
    // Owner rule (2026-07-11): one active rate per (client, product, unit, location) slot. A located
    // rate whose slot already carries a DIFFERENT type — a differently-typed rate, OR a typeless rate
    // vs a typed one either way — is rejected, not added as a second line that double-bills. Runs on
    // EVERY located save (typed or not) so an import row can't plant a typeless rate at a typed slot;
    // an unknown code hard-fails (never a silent typeless rate). Guard on NEW saves; resolution unchanged.
    if (validated.locationId != null) {
      const newTypeId = await resolveRateTypeId(validated.clientRateType);
      const [conflict] = await repo.otherTypeAtSlot(
        validated.clientId,
        validated.productId ?? null,
        validated.verificationUnitId ?? null,
        [validated.locationId],
        newTypeId,
      );
      if (conflict)
        throw AppError.conflict(
          'HAS_OTHER_RATE_TYPE',
          `this client/product/unit already has a ${conflict.code ?? 'different'} rate at this location — one location holds one rate type; revise or deactivate the existing rate first`,
        );
    }
    return repo.create(validated, userId);
  },

  /** Multi-location bulk create: one client bill-rate fanned across many locations, per-row
   *  (CREATED / EXISTS / ERROR). Catalog-driven guard: an unknown rate-type code would fan dead
   *  NULL-rate_type_id rows (400 INVALID_RATE_TYPE); an OFFICE-category code is location-less and
   *  belongs on the single form (400 OFFICE_NOT_BULKABLE). */
  async bulkCreate(input: unknown, actorId: string): Promise<BulkRateResult> {
    const v = BulkCreateRatesSchema.parse(input); // ZodError → 400
    const rateType = await repo.rateTypeByCode(v.clientRateType);
    if (!rateType) throw AppError.badRequest('INVALID_RATE_TYPE', { code: v.clientRateType });
    if (rateType.category === 'OFFICE') throw AppError.badRequest('OFFICE_NOT_BULKABLE');
    // Dedupe (picker may repeat) + sort so two concurrent batches insert in the same order — a
    // deterministic order can't deadlock against itself on the EXCLUDE index.
    const locationIds = [...new Set(v.locationIds)].sort((a, b) => a - b);
    // Owner rule (2026-07-11): one slot = one rate type — locations already holding a DIFFERENT
    // type at this (client, product, unit) become per-row HAS_OTHER_RATE_TYPE errors.
    const otherType = new Set(
      (
        await repo.otherTypeAtSlot(
          v.clientId,
          v.productId ?? null,
          v.verificationUnitId ?? null,
          locationIds,
          rateType.id,
        )
      ).map((r) => r.locationId),
    );
    const results = await repo.bulkCreate(v, locationIds, otherType, actorId);
    return {
      results,
      createdCount: results.filter((r) => r.status === 'CREATED').length,
      existsCount: results.filter((r) => r.status === 'EXISTS').length,
      errorCount: results.filter((r) => r.status === 'ERROR').length,
    };
  },

  /** Import (B-14, the only FK-resolving domain): the file carries client/product/unit CODES + a
   *  pincode+area geography; `buildRateSpec` preloads the code→id maps per request and the engine's
   *  `resolve` maps each row to the numeric-id `CreateRateInput` (per-row code errors surface in
   *  preview). Confirm reuses the audited `create` per row, so each imported rate also appends audit. */
  async importTemplate(): Promise<Buffer> {
    // Notes sheet generated from the LIVE rate-type catalog (drift-safe; the parser reads only the
    // first sheet, so notes are round-trip safe) — same seam as the scope-assignments template.
    return buildTemplate({ ...RATE_TEMPLATE_SPEC, templateNotes: await buildRateTemplateNotes() });
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

  /** Reactivation runs the same one-slot-one-type guard as create (owner rule 2026-07-11) —
   *  otherwise Deactivate LOCAL → add OGL → Activate LOCAL resurrects a second type at the slot.
   *  Runs for typeless located rates too (a typeless rate can't return to a slot a typed rate now
   *  holds). The rate's OWN type may be retired, so resolve it directly (never re-validate here). */
  async activate(id: number, version: number, userId: string): Promise<Rate> {
    const rate = await repo.findById(id);
    if (!rate) throw AppError.notFound('RATE_NOT_FOUND');
    if (rate.locationId != null) {
      const ownTypeId = rate.clientRateType
        ? ((await repo.rateTypeByCode(rate.clientRateType))?.id ?? null)
        : null;
      const [conflict] = await repo.otherTypeAtSlot(
        rate.clientId,
        rate.productId,
        rate.verificationUnitId,
        [rate.locationId],
        ownTypeId,
      );
      if (conflict)
        throw AppError.conflict(
          'HAS_OTHER_RATE_TYPE',
          `this location now has a ${conflict.code ?? 'different'} rate for this client/product/unit — deactivate it first to reactivate this ${rate.clientRateType ? `${rate.clientRateType} ` : ''}rate`,
        );
    }
    return repo.setActive(id, true, userId, version);
  },
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),

  /** Bulk (de)activate — per-row OCC, per-row result (CONCURRENCY_AND_EDITING_STANDARD §1). Reuses
   *  the same version-guarded `repo.setActive`; a row changed since selection comes back CONFLICT.
   *  Activation routes through the guarded `activate` so bulk can't resurrect a second rate type at
   *  a slot (per-row HAS_OTHER_RATE_TYPE → CONFLICT, same as SYSTEM_UNIT_LOCKED). */
  bulkSetActive(body: unknown, isActive: boolean, userId: string) {
    const items = parseBulkItems(body, 'int');
    return applyBulkOcc(items, (id, version) =>
      isActive
        ? rateService.activate(Number(id), version, userId)
        : repo.setActive(Number(id), false, userId, version),
    );
  },
};
