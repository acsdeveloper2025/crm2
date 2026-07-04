import { PERMISSIONS } from '@crm2/access';
import {
  CreateRoleSchema,
  UpdateRoleSchema,
  UpdateRolePermissionsSchema,
  type Paginated,
  type RoleView,
  type RoleOption,
  type RoleDimensionWiring,
  type ScopeDimensionInfo,
} from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import { roleRepository as repo } from './repository.js';

/** The code-owned permission catalog: only codes a route actually checks are grantable. */
const CATALOG = new Set<string>(Object.values(PERMISSIONS));

/** Reporting-chain walk cap (mirrors the scope subtree guard; role chains are far shorter). */
const REPORTING_CHAIN_CAP = 16;

const ROLE_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    hierarchyMode: 'hierarchy_mode',
    status: 'is_active',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    code: { column: 'code', kind: 'text' },
    name: { column: 'name', kind: 'text' },
    createdAt: { column: 'created_at', kind: 'date' },
  },
  defaultSort: 'code',
  defaultOrder: 'asc',
};

/** Export manifest (IMPORT_EXPORT_STANDARD — every DataGrid page exports; roles never import). */
const ROLE_EXPORT_COLUMNS: ExportColumn<RoleView>[] = [
  { id: 'code', header: 'Code', value: (r) => r.code },
  { id: 'name', header: 'Name', value: (r) => r.name },
  { id: 'hierarchyMode', header: 'Sees', value: (r) => r.hierarchyMode },
  { id: 'reportsToRole', header: 'Reports To', value: (r) => r.reportsToRole ?? '' },
  {
    id: 'permissions',
    header: 'Permissions',
    value: (r) => (r.grantsAll ? 'ALL' : r.permissions.join(', ')),
  },
  {
    id: 'dimensions',
    header: 'Scope Dimensions',
    value: (r) => r.dimensions.map((d) => `${d.dimension} (${d.mode})`).join(', '),
  },
  { id: 'kind', header: 'Kind', value: (r) => (r.isSystem ? 'SYSTEM' : 'CUSTOM') },
  {
    id: 'passwordExpiryDays',
    header: 'Password Expiry (days)',
    value: (r) => (r.passwordExpiryDays != null ? String(r.passwordExpiryDays) : 'Never'),
  },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
];

/** Catalog validation: every requested permission must be a code some route checks. */
function assertPermissionsValid(permissions: string[]): string[] {
  const unknown = permissions.filter((p) => !CATALOG.has(p));
  if (unknown.length > 0) throw AppError.badRequest('INVALID_PERMISSION', { unknown });
  return [...new Set(permissions)].sort();
}

/** Wiring validation: dimensions must exist in the catalog, once each. */
async function assertDimensionsValid(dimensions: RoleDimensionWiring[]): Promise<RoleDimensionWiring[]> {
  const codes = dimensions.map((d) => d.dimension);
  if (new Set(codes).size !== codes.length) throw AppError.badRequest('DUPLICATE_DIMENSION');
  if (codes.length > 0) {
    const found = await repo.existingDimensions(codes);
    const unknown = codes.filter((c) => !found.includes(c));
    if (unknown.length > 0) throw AppError.badRequest('UNKNOWN_DIMENSION', { unknown });
  }
  return dimensions;
}

/** The reporting target must exist, be active, and never form a cycle back to `code`. */
async function assertReportsToValid(code: string, reportsToRole: string | null): Promise<void> {
  if (reportsToRole === null) return;
  if (reportsToRole === code) throw AppError.badRequest('INVALID_REPORTS_TO_ROLE', { reason: 'self' });
  const target = await repo.findByCode(reportsToRole);
  if (!target || !target.isActive)
    throw AppError.badRequest('INVALID_REPORTS_TO_ROLE', { reason: 'unknown or inactive' });
  const map = await repo.reportingMap();
  let cursor: string | null = reportsToRole;
  for (let depth = 0; cursor !== null && depth < REPORTING_CHAIN_CAP; depth++) {
    if (cursor === code) throw AppError.badRequest('INVALID_REPORTS_TO_ROLE', { reason: 'cycle' });
    cursor = map.get(cursor) ?? null;
  }
  // a chain still unresolved at the cap is itself suspect — fail closed, never fail open
  if (cursor !== null) throw AppError.badRequest('INVALID_REPORTS_TO_ROLE', { reason: 'chain too deep' });
}

/** grants_all (SUPER_ADMIN) is immutable; system roles may be re-configured but never deactivated. */
async function loadEditable(code: string, opts: { forDeactivate?: boolean } = {}): Promise<RoleView> {
  const role = await repo.findView(code);
  if (!role) throw AppError.notFound('ROLE_NOT_FOUND');
  if (role.grantsAll) throw AppError.badRequest('ROLE_LOCKED', { code });
  if (opts.forDeactivate && role.isSystem) throw AppError.badRequest('ROLE_LOCKED', { code });
  return role;
}

/**
 * Roles service (ADR-0022 slice 5): the role catalog itself is admin data — custom roles are
 * created with a chosen permission set, hierarchy visibility mode, reporting line, and scope-
 * dimension wiring; system roles stay delete/deactivate-locked and SUPER_ADMIN fully locked.
 */
export const roleService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<RoleView>> {
    const r = resolvePage(rawQuery, ROLE_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, ROLE_PAGE_SPEC);
    const { items, totalCount } = await repo.pageList({
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

  /** A single role by code (the record-page loader). Read-only: 404s an unknown code but — unlike
   *  loadEditable — never ROLE_LOCKEDs grants_all/system roles, so SUPER_ADMIN is viewable. */
  async get(code: string): Promise<RoleView> {
    const role = await repo.findView(code);
    if (!role) throw AppError.notFound('ROLE_NOT_FOUND');
    return role;
  },

  options: (): Promise<RoleOption[]> => repo.options(),
  dimensions: (): Promise<ScopeDimensionInfo[]> => repo.dimensionCatalog(),

  /** Export rows for the DataGrid — same list query; the controller streams the file. */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, ROLE_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, ROLE_PAGE_SPEC);
    // `selected` exports the ticked role codes (shape-validated); empty/invalid set → nothing.
    const selectedCodes =
      ex.mode === 'selected' ? ex.ids.filter((s) => /^[A-Z][A-Z0-9_]{1,19}$/.test(s)) : undefined;
    if (ex.mode === 'selected' && (!selectedCodes || selectedCodes.length === 0))
      return { rows: [], columns: ROLE_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.pageList({
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      ...(selectedCodes ? { codes: selectedCodes } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: ROLE_EXPORT_COLUMNS };
  },

  async create(input: unknown, actorId: string): Promise<RoleView> {
    const v = CreateRoleSchema.parse(input);
    const permissions = assertPermissionsValid(v.permissions);
    const dimensions = await assertDimensionsValid(v.dimensions);
    const reportsToRole = v.reportsToRole ?? null;
    await assertReportsToValid(v.code, reportsToRole);
    await repo.create(
      {
        code: v.code,
        name: v.name,
        description: v.description ?? '',
        hierarchyMode: v.hierarchyMode,
        reportsToRole,
        passwordExpiryDays: v.passwordExpiryDays ?? null,
        idleLogoutMinutes: v.idleLogoutMinutes ?? null,
        maxSessionMinutes: v.maxSessionMinutes ?? null,
        otpLoginRequired: v.otpLoginRequired ?? false,
        permissions,
        dimensions,
      },
      actorId,
    );
    return (await repo.findView(v.code))!;
  },

  async update(code: string, input: unknown, actorId: string): Promise<RoleView> {
    const v = UpdateRoleSchema.parse(input);
    const before = await loadEditable(code);
    const dimensions = v.dimensions === undefined ? undefined : await assertDimensionsValid(v.dimensions);
    const reportsToRole = v.reportsToRole === undefined ? before.reportsToRole : v.reportsToRole;
    await assertReportsToValid(code, reportsToRole);
    await repo.updateConfig(
      code,
      {
        name: v.name,
        description: v.description,
        hierarchyMode: v.hierarchyMode,
        reportsToRole: v.reportsToRole,
        passwordExpiryDays: v.passwordExpiryDays,
        idleLogoutMinutes: v.idleLogoutMinutes,
        maxSessionMinutes: v.maxSessionMinutes,
        otpLoginRequired: v.otpLoginRequired,
        dimensions,
      },
      v.version,
      actorId,
      before,
    );
    return (await repo.findView(code))!;
  },

  async activate(code: string, version: number, actorId: string): Promise<RoleView> {
    await loadEditable(code);
    await repo.setActive(code, true, version, actorId);
    return (await repo.findView(code))!;
  },

  /** Fail-closed for operations: a role with ACTIVE users cannot be deactivated (409) — its users
   *  would instantly lose all permissions; the admin reassigns them first. */
  async deactivate(code: string, version: number, actorId: string): Promise<RoleView> {
    await loadEditable(code, { forDeactivate: true });
    const inUse = await repo.usersCount(code);
    if (inUse > 0) throw AppError.conflict('ROLE_IN_USE', `${inUse} active user(s) hold this role`);
    await repo.setActive(code, false, version, actorId);
    return (await repo.findView(code))!;
  },

  async setPermissions(code: string, input: unknown, actorId: string): Promise<RoleView> {
    const { permissions, version } = UpdateRolePermissionsSchema.parse(input);
    await loadEditable(code);
    const unique = assertPermissionsValid(permissions);
    const before = await repo.permissionsOf(code);
    await repo.setPermissions(code, unique, version, actorId, before);
    return (await repo.findView(code))!;
  },
};
