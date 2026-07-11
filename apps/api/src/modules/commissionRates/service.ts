import {
  BulkCreateCommissionRatesSchema,
  CreateCommissionRateSchema,
  ReviseCommissionRateSchema,
  type BulkCommissionRateResult,
  type CommissionRate,
  type CommissionRateView,
  type CommissionTerritoryLocation,
  type Paginated,
} from '@crm2/sdk';
import { commissionRateRepository as repo } from './repository.js';
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
import { buildCommissionRateSpec, COMMISSION_RATE_TEMPLATE_SPEC } from './import.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Count and items share
 *  CR_FROM (all joins present), so joined columns are filterable too. */
const CR_PAGE_SPEC: PageSpec = {
  sortMap: {
    user: 'u.name',
    client: 'c.name',
    fieldRateType: 'rt.code',
    amount: 'cr.amount',
    effectiveFrom: 'cr.effective_from',
    status: 'cr.is_active',
    createdAt: 'cr.created_at',
    updatedAt: 'cr.updated_at',
  },
  filterMap: {
    fieldRateType: { column: 'rt.code', kind: 'text' },
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /** A single rate by id (the record-page loader). Read-only: returns the full joined view, 404s an
   *  unknown id with the same not-found error the revise/(de)activate paths use. */
  async get(id: number): Promise<CommissionRateView> {
    const rate = await repo.findView(id);
    if (!rate) throw AppError.notFound('COMMISSION_RATE_NOT_FOUND');
    return rate;
  },

  /** The field user's assigned (pincode, area) locations — the bulk/single location-picker source
   *  (multi-location bulk entry). Scoped read; gated masterdata.manage at the route. */
  async territory(userId: string): Promise<CommissionTerritoryLocation[]> {
    if (!UUID_RE.test(userId)) throw AppError.badRequest('BAD_REQUEST', { param: 'userId' });
    return repo.coveredLocationsForUser(userId);
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

  async create(input: unknown, userId: string): Promise<CommissionRate> {
    const validated = CreateCommissionRateSchema.parse(input); // throws ZodError → 400
    // Owner rule (2026-07-11): one (user, location) holds ONE rate type — a located rate whose
    // location already carries a different type is rejected, not added as a second tariff line.
    // Service-level guard on NEW saves (import routes here too); payout resolution unchanged.
    if (validated.locationId != null) {
      const rateType = await repo.rateTypeByCode(validated.fieldRateType);
      if (rateType) {
        const [conflict] = await repo.otherTypeAtLocations(
          validated.userId,
          [validated.locationId],
          rateType.id,
        );
        if (conflict)
          throw AppError.conflict(
            'HAS_OTHER_RATE_TYPE',
            `location already has a ${conflict.code} rate for this user — one location holds one rate type; revise or deactivate the existing rate first`,
          );
      }
    }
    return repo.create(validated, userId);
  },

  /** Multi-location bulk create (field agents only). Enforces the trust boundary — role + rate-type +
   *  each location within the agent's territory — then fans the rate across the locations, per-row
   *  (CREATED / EXISTS / ERROR). The picker is already scoped; the API re-checks (never trust the client). */
  async bulkCreate(input: unknown, actorId: string): Promise<BulkCommissionRateResult> {
    const v = BulkCreateCommissionRatesSchema.parse(input); // ZodError → 400
    // Bulk is field/location-based only, decided by the CATALOG (unknown codes would otherwise fan
    // dead NULL-rate_type_id rows; an admin-defined OFFICE-category code is as location-less as the
    // literal OFFICE — both belong on the single, location-less path).
    const rateType = await repo.rateTypeByCode(v.fieldRateType);
    if (!rateType) throw AppError.badRequest('INVALID_RATE_TYPE', { code: v.fieldRateType });
    if (rateType.category === 'OFFICE') throw AppError.badRequest('OFFICE_NOT_BULKABLE');
    // ADR-0022: gate on the role ATTRIBUTE (territory), never the role NAME. Only a user with an
    // assigned pincode/area territory (i.e. a field agent) can hold location-based commission; a user
    // with none is ineligible — a non-field role, or an un-provisioned agent (assign territory first).
    const covered = await repo.coveredLocationsForUser(v.userId);
    const allowed = new Set(covered.map((l) => l.id));
    if (allowed.size === 0) throw AppError.badRequest('USER_HAS_NO_TERRITORY');
    // Dedupe (picker may repeat) + sort so two concurrent batches insert in the same order — a
    // deterministic order can't deadlock against itself on the EXCLUDE index.
    const locationIds = [...new Set(v.locationIds)].sort((a, b) => a - b);
    // Owner rule (2026-07-11): one (user, location) = one rate type — locations already holding a
    // DIFFERENT type become per-row HAS_OTHER_RATE_TYPE errors, never a second tariff line.
    const otherType = new Set(
      (await repo.otherTypeAtLocations(v.userId, locationIds, rateType.id)).map((r) => r.locationId),
    );
    const results = await repo.bulkCreate(v, locationIds, allowed, otherType, actorId);
    return {
      results,
      createdCount: results.filter((r) => r.status === 'CREATED').length,
      existsCount: results.filter((r) => r.status === 'EXISTS').length,
      errorCount: results.filter((r) => r.status === 'ERROR').length,
    };
  },

  async revise(id: number, input: unknown, userId: string): Promise<CommissionRate> {
    const validated = ReviseCommissionRateSchema.parse(input);
    const expectedVersion = requireVersion(input);
    return repo.revise(id, validated.amount, validated.effectiveFrom ?? null, userId, expectedVersion);
  },

  /** Reactivation runs the same one-location-one-type guard as create (owner rule 2026-07-11) —
   *  otherwise Deactivate LOCAL → add OGL → Activate LOCAL resurrects a second type at the location. */
  async activate(id: number, version: number, userId: string): Promise<CommissionRate> {
    const rate = await repo.findById(id);
    if (!rate) throw AppError.notFound('COMMISSION_RATE_NOT_FOUND');
    if (rate.locationId != null && rate.fieldRateType) {
      const rateType = await repo.rateTypeByCode(rate.fieldRateType);
      if (rateType) {
        const [conflict] = await repo.otherTypeAtLocations(rate.userId, [rate.locationId], rateType.id);
        if (conflict)
          throw AppError.conflict(
            'HAS_OTHER_RATE_TYPE',
            `location now has a ${conflict.code} rate for this user — deactivate it first to reactivate this ${rate.fieldRateType} rate`,
          );
      }
    }
    return repo.setActive(id, true, userId, version);
  },
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),
};
