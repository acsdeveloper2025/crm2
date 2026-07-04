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
  /** web idle auto-logout window in minutes (ADR-0045); null = exempt (FIELD_AGENT). */
  idleLogoutMinutes: number | null;
  /** absolute session lifetime in minutes (ADR-0045); null = no cap. */
  maxSessionMinutes: number | null;
  /** new-device login OTP enforcement (ADR-0088). FIELD_AGENT stays false until the OTP-capable
   *  mobile app releases (ADR-0054) — flipping it is a role-admin edit, not a deploy. */
  otpLoginRequired: boolean;
}

/** `null` when the role code is unknown or inactive — callers treat that as zero permissions. */
export async function loadRoleAttributes(roleCode: string): Promise<RoleAttributes | null> {
  const roles = await query<{
    grantsAll: boolean;
    hierarchyMode: HierarchyMode;
    passwordExpiryDays: number | null;
    idleLogoutMinutes: number | null;
    maxSessionMinutes: number | null;
    otpLoginRequired: boolean;
  }>(
    `SELECT grants_all AS "grantsAll", hierarchy_mode AS "hierarchyMode",
            password_expiry_days AS "passwordExpiryDays",
            idle_logout_minutes AS "idleLogoutMinutes",
            max_session_minutes AS "maxSessionMinutes",
            otp_login_required AS "otpLoginRequired"
     FROM roles WHERE code = $1 AND is_active`,
    [roleCode],
  );
  const role = roles[0];
  if (!role) return null;
  const base = {
    hierarchyMode: role.hierarchyMode,
    passwordExpiryDays: role.passwordExpiryDays,
    idleLogoutMinutes: role.idleLogoutMinutes,
    maxSessionMinutes: role.maxSessionMinutes,
    otpLoginRequired: role.otpLoginRequired,
  };
  if (role.grantsAll) return { grantsAll: true, permissions: [], ...base };
  const rows = await query<{ code: string }>(
    `SELECT permission_code AS code FROM role_permissions WHERE role_code = $1`,
    [roleCode],
  );
  return { grantsAll: false, permissions: rows.map((r) => r.code), ...base };
}
