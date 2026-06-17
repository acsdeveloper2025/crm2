import { query } from '../db.js';

/**
 * Role-attribute resolution (ADR-0022) — the DB half of the access seam. Loads what a role IS
 * (grants_all, hierarchy mode, granted permission codes) from the roles/role_permissions tables.
 * Raw DB access lives here (a repository) per the data-access boundary; the cache + middleware
 * glue live in `./index.ts`.
 */
export type HierarchyMode = 'ALL' | 'SUBTREE' | 'DIRECT_TEAM' | 'SELF';

export interface RoleAttributes {
  grantsAll: boolean;
  permissions: string[];
  hierarchyMode: HierarchyMode;
  /** force a password change every N days for users of this role; null = never (exempt). */
  passwordExpiryDays: number | null;
}

/** `null` when the role code is unknown or inactive — callers treat that as zero permissions. */
export async function loadRoleAttributes(roleCode: string): Promise<RoleAttributes | null> {
  const roles = await query<{
    grantsAll: boolean;
    hierarchyMode: HierarchyMode;
    passwordExpiryDays: number | null;
  }>(
    `SELECT grants_all AS "grantsAll", hierarchy_mode AS "hierarchyMode",
            password_expiry_days AS "passwordExpiryDays"
     FROM roles WHERE code = $1 AND is_active`,
    [roleCode],
  );
  const role = roles[0];
  if (!role) return null;
  const base = { hierarchyMode: role.hierarchyMode, passwordExpiryDays: role.passwordExpiryDays };
  if (role.grantsAll) return { grantsAll: true, permissions: [], ...base };
  const rows = await query<{ code: string }>(
    `SELECT permission_code AS code FROM role_permissions WHERE role_code = $1`,
    [roleCode],
  );
  return { grantsAll: false, permissions: rows.map((r) => r.code), ...base };
}
