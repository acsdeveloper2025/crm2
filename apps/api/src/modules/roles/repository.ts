import type { RoleView, RoleOption, RoleDimensionWiring, ScopeDimensionInfo, SortOrder } from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import { invalidateRoleCache } from '../../platform/access/index.js';
import type { AppliedFilter } from '../../platform/pagination.js';
import { filterClauses, likeContains } from '../../platform/pagination.js';

const COLS = `code, name, description, grants_all, hierarchy_mode, reports_to_role,
  is_system, is_active, password_expiry_days, idle_logout_minutes, max_session_minutes,
  otp_login_required, version, created_at, updated_at`;

type RoleRow = Omit<RoleView, 'permissions' | 'dimensions'>;

export interface RoleListOptions {
  active?: boolean;
  search?: string;
  /** restrict to these codes (the export's selected-rows mode). */
  codes?: string[];
  columnFilters?: AppliedFilter[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export interface CreateRoleRow {
  code: string;
  name: string;
  description: string;
  hierarchyMode: string;
  reportsToRole: string | null;
  passwordExpiryDays: number | null;
  idleLogoutMinutes: number | null;
  maxSessionMinutes: number | null;
  otpLoginRequired: boolean;
  permissions: string[];
  dimensions: RoleDimensionWiring[];
}

export interface UpdateRoleRow {
  name: string;
  description: string | undefined;
  hierarchyMode: string;
  reportsToRole: string | null | undefined;
  /** undefined ⇒ leave unchanged; null ⇒ never expire; number ⇒ rotate every N days. */
  passwordExpiryDays: number | null | undefined;
  /** undefined ⇒ leave unchanged; null ⇒ exempt; number ⇒ idle-logout minutes (ADR-0045). */
  idleLogoutMinutes: number | null | undefined;
  /** undefined ⇒ leave unchanged; null ⇒ no cap; number ⇒ absolute session minutes (ADR-0045). */
  maxSessionMinutes: number | null | undefined;
  /** undefined ⇒ leave unchanged; boolean ⇒ new-device login OTP on/off (ADR-0088). */
  otpLoginRequired: boolean | undefined;
  dimensions: RoleDimensionWiring[] | undefined;
}

async function permissionsByRole(codes?: string[]): Promise<Map<string, string[]>> {
  const rows = await query<{ roleCode: string; permissionCode: string }>(
    codes
      ? `SELECT role_code, permission_code FROM role_permissions WHERE role_code = ANY($1::text[]) ORDER BY permission_code`
      : `SELECT role_code, permission_code FROM role_permissions ORDER BY permission_code`,
    codes ? [codes] : [],
  );
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.roleCode, [...(map.get(r.roleCode) ?? []), r.permissionCode]);
  return map;
}

async function dimensionsByRole(codes?: string[]): Promise<Map<string, RoleDimensionWiring[]>> {
  const rows = await query<{ roleCode: string; dimension: string; mode: 'EXPAND' | 'RESTRICT' }>(
    codes
      ? `SELECT role_code, dimension_code AS dimension, mode FROM role_scope_dimensions
         WHERE is_active AND role_code = ANY($1::text[]) ORDER BY dimension_code`
      : `SELECT role_code, dimension_code AS dimension, mode FROM role_scope_dimensions
         WHERE is_active ORDER BY dimension_code`,
    codes ? [codes] : [],
  );
  const map = new Map<string, RoleDimensionWiring[]>();
  for (const r of rows)
    map.set(r.roleCode, [...(map.get(r.roleCode) ?? []), { dimension: r.dimension, mode: r.mode }]);
  return map;
}

async function attach(roles: RoleRow[]): Promise<RoleView[]> {
  const codes = roles.map((r) => r.code);
  const [perms, dims] = await Promise.all([permissionsByRole(codes), dimensionsByRole(codes)]);
  return roles.map((r) => ({
    ...r,
    permissions: perms.get(r.code) ?? [],
    dimensions: dims.get(r.code) ?? [],
  }));
}

export const roleRepository = {
  /** Unpaginated full catalog (the access-matrix view + small internal reads). */
  async list(): Promise<RoleView[]> {
    const roles = await query<RoleRow>(`SELECT ${COLS} FROM roles ORDER BY grants_all DESC, code`);
    return attach(roles);
  },

  /** Paginated list for the Roles DataGrid (server search/sort/filter per the list standard). */
  async pageList(o: RoleListOptions): Promise<{ items: RoleView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    if (o.codes && o.codes.length) {
      params.push(o.codes);
      where.push(`code = ANY($${params.length}::text[])`);
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM roles ${clause}`,
      params,
    );
    const items = await query<RoleRow>(
      `SELECT ${COLS} FROM roles ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, code ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items: await attach(items), totalCount: countRow?.count ?? 0 };
  },

  /** USABLE roles for selects (role picker + role-aware reports-to filtering). */
  options(): Promise<RoleOption[]> {
    return query<RoleOption>(
      `SELECT code, name, reports_to_role FROM roles WHERE is_active ORDER BY grants_all DESC, name`,
    );
  },

  /** The scope-dimension catalog (feeds the role dialog's wiring picker). */
  dimensionCatalog(): Promise<ScopeDimensionInfo[]> {
    return query<ScopeDimensionInfo>(
      `SELECT code, label, entity_kind, level FROM scope_dimensions WHERE is_active ORDER BY code`,
    );
  },

  async findByCode(code: string): Promise<RoleRow | null> {
    const rows = await query<RoleRow>(`SELECT ${COLS} FROM roles WHERE code = $1`, [code]);
    return rows[0] ?? null;
  },

  async findView(code: string): Promise<RoleView | null> {
    const row = await this.findByCode(code);
    if (!row) return null;
    const [view] = await attach([row]);
    return view ?? null;
  },

  /** Every role's reporting target — the cycle-guard walks this map. */
  async reportingMap(): Promise<Map<string, string | null>> {
    const rows = await query<{ code: string; reportsToRole: string | null }>(
      `SELECT code, reports_to_role FROM roles`,
    );
    return new Map(rows.map((r) => [r.code, r.reportsToRole]));
  },

  /** Dimension codes that exist (and are active) in the catalog. */
  async existingDimensions(codes: string[]): Promise<string[]> {
    const rows = await query<{ code: string }>(
      `SELECT code FROM scope_dimensions WHERE is_active AND code = ANY($1::text[])`,
      [codes],
    );
    return rows.map((r) => r.code);
  },

  /** Active users currently holding the role (gates deactivation — fail-closed for operations). */
  async usersCount(code: string): Promise<number> {
    const rows = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE role = $1 AND is_active`,
      [code],
    );
    return rows[0]?.count ?? 0;
  },

  async create(input: CreateRoleRow, actorId: string): Promise<void> {
    await withTransaction(async (q) => {
      const rows = await q<{ code: string }>(
        `INSERT INTO roles (code, name, description, hierarchy_mode, reports_to_role,
                password_expiry_days, idle_logout_minutes, max_session_minutes, otp_login_required,
                created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (code) DO NOTHING RETURNING code`,
        [
          input.code,
          input.name,
          input.description,
          input.hierarchyMode,
          input.reportsToRole,
          input.passwordExpiryDays,
          input.idleLogoutMinutes,
          input.maxSessionMinutes,
          input.otpLoginRequired,
          actorId,
        ],
      );
      if (rows.length === 0) throw AppError.conflict('ROLE_EXISTS');
      if (input.permissions.length > 0) {
        await q(
          `INSERT INTO role_permissions (role_code, permission_code)
           SELECT $1, x FROM unnest($2::text[]) AS x`,
          [input.code, input.permissions],
        );
      }
      for (const w of input.dimensions) {
        await q(`INSERT INTO role_scope_dimensions (role_code, dimension_code, mode) VALUES ($1, $2, $3)`, [
          input.code,
          w.dimension,
          w.mode,
        ]);
      }
      await appendAudit(
        {
          entityType: 'roles',
          entityId: input.code,
          action: 'CREATE',
          actorId,
          after: input,
          versionAfter: 1,
        },
        q,
      );
    });
    invalidateRoleCache();
  },

  /** OCC config edit: identity/hierarchy/reporting (+ full wiring replacement when provided). */
  async updateConfig(
    code: string,
    input: UpdateRoleRow,
    expectedVersion: number,
    actorId: string,
    before: RoleView,
  ): Promise<void> {
    await withTransaction(async (q) => {
      const rows = await q<{ version: number }>(
        `UPDATE roles SET name = $2, description = COALESCE($3, description),
                hierarchy_mode = $4, reports_to_role = $5, password_expiry_days = $8,
                idle_logout_minutes = $9, max_session_minutes = $10, otp_login_required = $11,
                version = version + 1, updated_by = $6, updated_at = now()
         WHERE code = $1 AND version = $7 RETURNING version`,
        [
          code,
          input.name,
          input.description ?? null,
          input.hierarchyMode,
          input.reportsToRole === undefined ? before.reportsToRole : input.reportsToRole,
          actorId,
          expectedVersion,
          input.passwordExpiryDays === undefined ? before.passwordExpiryDays : input.passwordExpiryDays,
          input.idleLogoutMinutes === undefined ? before.idleLogoutMinutes : input.idleLogoutMinutes,
          input.maxSessionMinutes === undefined ? before.maxSessionMinutes : input.maxSessionMinutes,
          input.otpLoginRequired === undefined ? before.otpLoginRequired : input.otpLoginRequired,
        ],
      );
      const row = rows[0];
      if (!row) {
        const [current] = await q<RoleRow>(`SELECT ${COLS} FROM roles WHERE code = $1`, [code]);
        if (!current) throw AppError.notFound('ROLE_NOT_FOUND');
        throw AppError.stale(current);
      }
      if (input.dimensions !== undefined) {
        await q(`DELETE FROM role_scope_dimensions WHERE role_code = $1`, [code]);
        for (const w of input.dimensions) {
          await q(`INSERT INTO role_scope_dimensions (role_code, dimension_code, mode) VALUES ($1, $2, $3)`, [
            code,
            w.dimension,
            w.mode,
          ]);
        }
      }
      await appendAudit(
        {
          entityType: 'roles',
          entityId: code,
          action: 'UPDATE',
          actorId,
          before,
          after: input,
          versionAfter: row.version,
        },
        q,
      );
    });
    invalidateRoleCache();
  },

  async setActive(code: string, isActive: boolean, expectedVersion: number, actorId: string): Promise<void> {
    await withTransaction(async (q) => {
      const rows = await q<{ version: number }>(
        `UPDATE roles SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE code = $1 AND version = $4 RETURNING version`,
        [code, isActive, actorId, expectedVersion],
      );
      const row = rows[0];
      if (!row) {
        const [current] = await q<RoleRow>(`SELECT ${COLS} FROM roles WHERE code = $1`, [code]);
        if (!current) throw AppError.notFound('ROLE_NOT_FOUND');
        throw AppError.stale(current);
      }
      await appendAudit(
        {
          entityType: 'roles',
          entityId: code,
          action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
          actorId,
          versionAfter: row.version,
        },
        q,
      );
    });
    invalidateRoleCache();
  },

  /**
   * Replace a role's permission set atomically (OCC on the roles row; the version bump IS the
   * concurrency token for the whole config edit). Audit carries the before/after code sets.
   */
  async setPermissions(
    code: string,
    permissions: string[],
    expectedVersion: number,
    actorId: string,
    before: string[],
  ): Promise<void> {
    await withTransaction(async (q) => {
      const [row] = await q<{ version: number }>(
        `UPDATE roles SET version = version + 1, updated_by = $2, updated_at = now()
         WHERE code = $1 AND version = $3 RETURNING version`,
        [code, actorId, expectedVersion],
      );
      if (!row) {
        const [current] = await q<RoleRow>(`SELECT ${COLS} FROM roles WHERE code = $1`, [code]);
        if (!current) throw AppError.notFound('ROLE_NOT_FOUND');
        throw AppError.stale(current);
      }
      await q(`DELETE FROM role_permissions WHERE role_code = $1`, [code]);
      if (permissions.length > 0) {
        await q(
          `INSERT INTO role_permissions (role_code, permission_code)
           SELECT $1, x FROM unnest($2::text[]) AS x`,
          [code, permissions],
        );
      }
      await appendAudit(
        {
          entityType: 'roles',
          entityId: code,
          action: 'UPDATE',
          actorId,
          before: { permissions: before },
          after: { permissions },
          versionAfter: row.version,
        },
        q,
      );
    });
    invalidateRoleCache(); // after commit — readers must never cache the pre-edit set past TTL
  },

  async permissionsOf(code: string): Promise<string[]> {
    const rows = await query<{ code: string }>(
      `SELECT permission_code AS code FROM role_permissions WHERE role_code = $1 ORDER BY permission_code`,
      [code],
    );
    return rows.map((r) => r.code);
  },
};
