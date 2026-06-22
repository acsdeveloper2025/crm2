import {
  CreateVerificationUnitSchema,
  EffectiveFromSchema,
  KINDS,
  type CreateVerificationUnitInput,
  type VerificationUnit,
  type VerificationUnitOption,
  type Paginated,
} from '@crm2/sdk';
import { verificationUnitRepository as repo } from './repository.js';
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
import { parseIsoDate, parseBoolean, parseInteger, parseCsvList } from '../../platform/import/parsers.js';
import { applyBulkOcc, parseBulkItems } from '../../platform/bulk.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6/§7) below. */
const VU_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    kind: 'kind',
    category: 'category',
    sortOrder: 'sort_order',
    status: 'is_active',
    effectiveFrom: 'effective_from',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    code: { column: 'code', kind: 'text' },
    name: { column: 'name', kind: 'text' },
    category: { column: 'category', kind: 'text' },
    // Excel-style multi-select (§7): the fixed unit-kind enum.
    kind: { column: 'kind', kind: 'enum', values: KINDS },
    createdAt: { column: 'created_at', kind: 'date' },
    effectiveFrom: { column: 'effective_from', kind: 'date' },
  },
  defaultSort: 'sortOrder',
  defaultOrder: 'asc',
};

/**
 * requiredAttachments round-trips through a single spreadsheet cell as a comma-separated list of
 * `TYPE:MIN` tokens (MIN omitted ⇒ 1), e.g. "DOCUMENT,PAN:2" ⇄ [{type:'DOCUMENT',min:1},{type:'PAN',min:2}].
 * Blank ⇒ undefined so the Create schema applies its [] default (valid for non-KYC units; the KYC_DOCUMENT
 * invariant requires ≥1, so a KYC import row must carry this cell — previously impossible, GAP-VU-1).
 */
const parseAttachmentList = (raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((tok) => {
      const [type, minRaw] = tok.split(':').map((x) => x.trim());
      const min = minRaw ? Number(minRaw) : 1;
      return { type: (type ?? '').toUpperCase(), min: Number.isInteger(min) && min > 0 ? min : 1 };
    })
    .filter((a) => a.type !== ''); // drop a blank-type token (e.g. ":2") — never a usable attachment spec
};

/** Inverse of {@link parseAttachmentList} for export: [{type,min}] → "TYPE[:MIN],…" (MIN omitted when 1). */
const formatAttachmentList = (list: unknown[]): string =>
  (Array.isArray(list) ? list : [])
    .map((a) => {
      if (a && typeof a === 'object' && 'type' in a) {
        const t = String((a as { type?: unknown }).type ?? '');
        const m = Number((a as { min?: unknown }).min);
        return Number.isInteger(m) && m > 1 ? `${t}:${m}` : t;
      }
      return String(a);
    })
    .filter(Boolean)
    .join(',');

/**
 * The DataGrid export manifest. The first 20 columns mirror VU_IMPORT_COLUMNS (same headers) so an
 * export re-imports losslessly (every Create-form field is present and re-mappable); the trailing
 * read-only audit columns (Created/Updated/Status) are ignored on re-import. The `id`s of the columns
 * the FE grid shows (code/name/category/kind/billing/effectiveFrom/createdAt/updatedAt/status) match
 * the grid column ids so the visible-columns (`cols`) selection still filters + orders them.
 */
const VU_EXPORT_COLUMNS: ExportColumn<VerificationUnit>[] = [
  { id: 'code', header: 'Code', value: (r) => r.code },
  { id: 'name', header: 'Name', value: (r) => r.name },
  { id: 'description', header: 'Description', value: (r) => r.description ?? '' },
  { id: 'category', header: 'Category', value: (r) => r.category },
  { id: 'kind', header: 'Kind', value: (r) => r.kind },
  { id: 'workerRole', header: 'Worker Role', value: (r) => r.workerRole },
  { id: 'assignmentMethod', header: 'Assignment Method', value: (r) => r.assignmentMethod },
  { id: 'requiredFormCode', header: 'Required Form Code', value: (r) => r.requiredFormCode ?? '' },
  { id: 'requiredPhotos', header: 'Required Photos', value: (r) => r.requiredPhotos },
  { id: 'requiredGps', header: 'Required GPS', value: (r) => r.requiredGps },
  {
    id: 'requiredAttachments',
    header: 'Required Attachments',
    value: (r) => formatAttachmentList(r.requiredAttachments),
  },
  { id: 'resultSet', header: 'Result Set', value: (r) => r.resultSet.join(',') },
  { id: 'reviewRequired', header: 'Review Required', value: (r) => r.reviewRequired },
  // id 'billing' keeps the FE grid column id; the header matches the import 'Billing Profile' for round-trip.
  { id: 'billing', header: 'Billing Profile', value: (r) => r.billingProfile },
  { id: 'commissionProfile', header: 'Commission Profile', value: (r) => r.commissionProfile },
  { id: 'reportTemplateType', header: 'Report Template Type', value: (r) => r.reportTemplateType },
  { id: 'reverificationRule', header: 'Reverification Rule', value: (r) => r.reverificationRule },
  { id: 'piiSensitive', header: 'PII Sensitive', value: (r) => r.piiSensitive },
  { id: 'sortOrder', header: 'Sort Order', value: (r) => r.sortOrder },
  { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];

/**
 * Import manifest (B-14): one column per Create-schema field. Enums/strings arrive as plain strings
 * (zod validates the enum); booleans/ints/the date are coerced by the shared cell parsers; `resultSet`
 * is a comma-separated list. Order matches the template header order.
 */
const VU_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'code', header: 'Code', required: true },
  { id: 'name', header: 'Name', required: true },
  { id: 'description', header: 'Description' },
  { id: 'category', header: 'Category', required: true },
  { id: 'kind', header: 'Kind', required: true },
  { id: 'workerRole', header: 'Worker Role', required: true },
  { id: 'assignmentMethod', header: 'Assignment Method', required: true },
  { id: 'requiredFormCode', header: 'Required Form Code' },
  { id: 'requiredPhotos', header: 'Required Photos', parse: parseInteger },
  { id: 'requiredGps', header: 'Required GPS', parse: parseBoolean },
  // KYC_DOCUMENT units require ≥1 attachment; without this column those rows could never import (GAP-VU-1).
  { id: 'requiredAttachments', header: 'Required Attachments', parse: parseAttachmentList },
  { id: 'resultSet', header: 'Result Set', parse: parseCsvList },
  { id: 'reviewRequired', header: 'Review Required', parse: parseBoolean },
  { id: 'billingProfile', header: 'Billing Profile', required: true },
  { id: 'commissionProfile', header: 'Commission Profile' },
  { id: 'reportTemplateType', header: 'Report Template Type', required: true },
  { id: 'reverificationRule', header: 'Reverification Rule', required: true },
  { id: 'piiSensitive', header: 'PII Sensitive', parse: parseBoolean },
  { id: 'sortOrder', header: 'Sort Order', parse: parseInteger },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

/**
 * Import contract (B-14): the full VU column manifest + the Create schema (which runs `applyInvariants`).
 * FK-free → no `resolve`; `TInput = CreateVerificationUnitInput`. The sample row mirrors the seeded
 * RESIDENCE FIELD_VISIT unit so it passes the cross-field invariants.
 */
const VU_IMPORT_SPEC: ImportSpec<CreateVerificationUnitInput> = {
  resource: 'verification-units',
  columns: VU_IMPORT_COLUMNS,
  schema: CreateVerificationUnitSchema,
  uniqueKey: 'code',
  sample: {
    code: 'RESIDENCE',
    name: 'Residence Verification',
    description: 'Physical residence verification',
    category: 'FIELD',
    kind: 'FIELD_VISIT',
    workerRole: 'FIELD_AGENT',
    assignmentMethod: 'TERRITORY_AUTO',
    requiredFormCode: 'RESIDENCE_FORM',
    requiredPhotos: 5,
    requiredGps: 'true',
    // demonstrates the Required Attachments cell grammar in the downloadable template: comma-separated
    // `TYPE[:MIN]` tokens (MIN omitted ⇒ 1). KYC_DOCUMENT units MUST carry ≥1; FIELD_VISIT may leave it blank.
    requiredAttachments: 'DOCUMENT,PAN:2',
    resultSet: 'Positive,Negative,Refer,Fraud',
    reviewRequired: 'true',
    billingProfile: 'AGENT_COMMISSION',
    commissionProfile: 'FIELD_RATE',
    reportTemplateType: 'FIELD_NARRATIVE',
    reverificationRule: 'REVISIT_PARENT_RATE',
    piiSensitive: 'false',
    sortOrder: 1,
    effectiveFrom: '2026-01-01',
  },
};

/**
 * Verification Unit service — enforces the contract:
 *  - create/update validated against the shared zod schema (mirrors DB CHECKs)
 *  - `code` correctable only while the unit is unreferenced (ADR-0020); locked once in use
 *  - every edit bumps `version` (handled in the repo)
 *  - audit (created_by/updated_by) set from the caller
 */
export const verificationUnitService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<VerificationUnit>> {
    const r = resolvePage(rawQuery, VU_PAGE_SPEC);
    const rawKind = rawQuery['kind'];
    const kind = typeof rawKind === 'string' ? rawKind : undefined;
    const rawCategory = rawQuery['category'];
    const category = typeof rawCategory === 'string' ? rawCategory : undefined;
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, VU_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(kind !== undefined ? { kind } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (kind !== undefined) filters['kind'] = kind;
    if (category !== undefined) filters['category'] = category;
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (kind/category/active/search/filters/sort) — `current` = the exact page; `all` = every matching row
   * (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). Returns rows + the
   * module column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, VU_PAGE_SPEC);
    const rawKind = rawQuery['kind'];
    const kind = typeof rawKind === 'string' ? rawKind : undefined;
    const rawCategory = rawQuery['category'];
    const category = typeof rawCategory === 'string' ? rawCategory : undefined;
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, VU_PAGE_SPEC);
    // `selected` restricts to the ticked numeric ids; an empty/invalid set exports nothing (never
    // falls through to "all").
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: VU_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(kind !== undefined ? { kind } : {}),
      ...(category !== undefined ? { category } : {}),
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
    return { rows: items, columns: VU_EXPORT_COLUMNS };
  },

  async get(id: number): Promise<VerificationUnit> {
    const unit = await repo.findById(id);
    if (!unit) throw AppError.notFound('UNIT_NOT_FOUND');
    return unit;
  },

  options(): Promise<VerificationUnitOption[]> {
    return repo.options();
  },

  create(input: unknown, userId: string): Promise<VerificationUnit> {
    const validated = CreateVerificationUnitSchema.parse(input); // throws ZodError → 400
    const { effectiveFrom } = EffectiveFromSchema.parse(input); // parsed apart (ADR-0017)
    return repo.create(
      {
        ...validated,
        description: validated.description ?? null,
        requiredFormCode: validated.requiredFormCode ?? null,
        effectiveFrom,
      },
      userId,
    );
  },

  /** Import (B-14): download template / preview (validate, no writes) / confirm (process valid rows).
   *  Confirm reuses the audited `create` (NOT repo.create) so each row gets the EffectiveFromSchema
   *  split + description/requiredFormCode null-coalesce, plus a per-row audit_log CREATE; a duplicate
   *  code is reported per-row and never blocks the others. */
  importTemplate: () => buildTemplate(VU_IMPORT_SPEC),
  importPreview: (file: Buffer) => runImportPreview(file, VU_IMPORT_SPEC),
  importConfirm: (file: Buffer, userId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      VU_IMPORT_SPEC,
      async (input) => {
        await verificationUnitService.create(input, userId);
      },
      { userId, fileName },
    ),

  async update(id: number, patch: Record<string, unknown>, userId: string): Promise<VerificationUnit> {
    const expectedVersion = requireVersion(patch); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('UNIT_NOT_FOUND');
    // System units (the 9 mobile-hardcoded field-visit types) are read-only — the field app keys its
    // per-type form endpoints to these codes, so a rename/reconfigure would silently break submission.
    if (existing.isSystem)
      throw AppError.conflict(
        'SYSTEM_UNIT_LOCKED',
        'this verification unit is linked to the mobile app and cannot be edited',
      );
    // ADR-0020: code is correctable only while the unit is unreferenced; locked once in use.
    const codeChanged = patch['code'] !== undefined && patch['code'] !== existing.code;
    if (codeChanged && (await repo.hasDependents(id)))
      throw AppError.conflict('CODE_LOCKED', 'code is in use by other records and cannot be changed');
    // merged keeps the existing code unless a (permitted) new code was supplied in the patch.
    const merged = { ...existing, ...patch };
    const validated = CreateVerificationUnitSchema.parse(merged); // re-asserts invariants on the merged row
    const { effectiveFrom } = EffectiveFromSchema.parse(patch); // parsed apart (never the DB row's value)
    return repo.update(
      id,
      {
        ...validated,
        description: validated.description ?? null,
        requiredFormCode: validated.requiredFormCode ?? null,
        effectiveFrom,
      },
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
