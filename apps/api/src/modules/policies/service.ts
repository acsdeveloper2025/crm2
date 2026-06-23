import {
  CreatePolicySchema,
  PolicyEffectiveFromSchema,
  type Policy,
  type Paginated,
  type UserPolicyAcceptance,
} from '@crm2/sdk';
import { policyRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';

// uuid path-param shape check (mirrors auth's UUID_RE) — a malformed value becomes a clean 400, not a
// pg 22P02 → 500 when the bind hits the uuid column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The DataGrid export manifest (IMPORT_EXPORT_STANDARD). Column `id`s match the FE DataGrid column
 * ids (PoliciesPage) so the visible-columns (`cols`) selection filters + orders them; the `actions`
 * column has no data value and is simply absent here. The large `content` legal blob is intentionally
 * NOT exported.
 */
const POLICY_EXPORT_COLUMNS: ExportColumn<Policy>[] = [
  { id: 'code', header: 'Code', value: (p) => p.code },
  { id: 'name', header: 'Name', value: (p) => p.name },
  { id: 'contentVersion', header: 'Version', value: (p) => p.contentVersion },
  { id: 'effectiveFrom', header: 'Effective From', value: (p) => p.effectiveFrom },
  { id: 'status', header: 'Status', value: (p) => (p.isActive ? 'Active' : 'Inactive') },
];

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns below. */
const POLICY_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    status: 'is_active',
    contentVersion: 'content_version',
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
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
};

/**
 * Policy service — admin CRUD for versioned, admin-managed acceptance policies (ADR-0043):
 *  - create/update validated against the shared zod schema (mirrors DB CHECKs)
 *  - `version` (OCC) bumps every edit; `content_version` bumps only when `content` changes
 *  - audit (created_by/updated_by) set from the caller
 */
export const policyService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<Policy>> {
    const r = resolvePage(rawQuery, POLICY_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, POLICY_PAGE_SPEC);
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
   * (active/search/filters/sort) — `current` = the exact page; `all` = every matching row (no page
   * LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it); `selected` = the ticked ids.
   * Returns rows + the policy column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, POLICY_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, POLICY_PAGE_SPEC);
    // `selected` restricts to the ticked numeric ids; an empty/invalid set exports nothing (never
    // falls through to "all").
    const selectedIds =
      ex.mode === 'selected' ? ex.ids.map(Number).filter((n) => Number.isInteger(n)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: POLICY_EXPORT_COLUMNS };
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
    return { rows: items, columns: POLICY_EXPORT_COLUMNS };
  },

  async get(id: number): Promise<Policy> {
    const policy = await repo.findById(id);
    if (!policy) throw AppError.notFound('POLICY_NOT_FOUND');
    return policy;
  },

  create(input: unknown, userId: string): Promise<Policy> {
    const v = CreatePolicySchema.parse(input); // throws ZodError → 400
    const { effectiveFrom } = PolicyEffectiveFromSchema.parse(input); // parsed apart (ADR-0017)
    return repo.create({ ...v, description: v.description ?? null, effectiveFrom }, userId);
  },

  async update(id: number, patch: Record<string, unknown>, userId: string): Promise<Policy> {
    const expectedVersion = requireVersion(patch); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('POLICY_NOT_FOUND');
    const merged = { ...existing, ...patch };
    const v = CreatePolicySchema.parse(merged); // re-asserts invariants on the merged row
    const { effectiveFrom } = PolicyEffectiveFromSchema.parse(patch); // parsed apart (never the DB row's value)
    // A content change forces a global re-accept via content_version + 1; metadata-only edits don't.
    const bumpContent = patch['content'] !== undefined && patch['content'] !== existing.content;
    return repo.update(
      id,
      { ...v, description: v.description ?? null, effectiveFrom },
      bumpContent,
      userId,
      expectedVersion,
      existing,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),

  /** Admin view: a single user's policy-acceptance log (ADR-0043). Validates uuid shape so a malformed
   *  path param is a clean 400 (never a pg 22P02 → 500 on the uuid bind). */
  acceptancesForUser(userId: string): Promise<UserPolicyAcceptance[]> {
    if (!UUID_RE.test(userId)) throw AppError.badRequest('BAD_REQUEST', { param: 'userId' });
    return repo.acceptancesForUser(userId);
  },
};
