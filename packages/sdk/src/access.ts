/**
 * @crm2/sdk — the Access Control matrix contract. Since ADR-0022 the matrix is DB-backed
 * (roles + role_permissions tables): role codes are an OPEN set (system roles + future custom
 * roles), the permission catalog stays code-owned, and grants are edited via the roles API.
 */
export interface AccessPermission {
  code: string;
  label: string;
  group: string;
}

export interface AccessMatrix {
  roles: string[];
  permissions: AccessPermission[];
  /** role code → granted permission codes (grants_all roles expand to the full catalog). */
  grants: Record<string, string[]>;
}
