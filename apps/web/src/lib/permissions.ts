/**
 * Central client-side permission check (ADR-0022 access model). SUPER_ADMIN carries
 * `grantsAll`; every other role has an explicit `permissions` list. The single source for
 * UX gating — use the SAME permission the server write endpoint enforces. The server remains
 * authoritative; this only hides controls a user can't use (defense-in-depth, not the gate).
 */
export interface PermissionSubject {
  grantsAll?: boolean;
  permissions?: string[];
}

export function hasPermission(user: PermissionSubject | null | undefined, perm: string): boolean {
  return !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
}
