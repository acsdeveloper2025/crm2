import { z } from 'zod';

/**
 * @crm2/sdk — Roles contract (ADR-0022, Access Control 2.0). Roles are DATA: the catalog lives in
 * the `roles` table (6 locked system roles + admin-created custom roles), the role→permission
 * mapping, hierarchy visibility mode, and scope-dimension wiring are all admin-editable. The
 * permission CATALOG stays code-owned (you can only grant codes a route actually checks).
 */
export type RoleHierarchyMode = 'ALL' | 'SUBTREE' | 'DIRECT_TEAM' | 'SELF';
export const ROLE_HIERARCHY_MODES = ['ALL', 'SUBTREE', 'DIRECT_TEAM', 'SELF'] as const;

export type ScopeDimensionMode = 'EXPAND' | 'RESTRICT';

/** One dimension a role may hold + how its assignments shape visibility. */
export interface RoleDimensionWiring {
  dimension: string;
  /** EXPAND adds rows on top of hierarchy; RESTRICT caps rows (empty assignments ⇒ none). */
  mode: ScopeDimensionMode;
}

/** A scope-dimension catalog row (code-mirrored; feeds the role dialog's wiring picker). */
export interface ScopeDimensionInfo {
  code: string;
  label: string;
  entityKind: 'ID' | 'VALUE';
  level: 'CASE' | 'TASK';
}

export interface RoleView {
  code: string;
  name: string;
  description: string | null;
  /** true only for SUPER_ADMIN — holds every permission implicitly; its config is locked. */
  grantsAll: boolean;
  hierarchyMode: RoleHierarchyMode;
  reportsToRole: string | null;
  isSystem: boolean;
  isActive: boolean;
  /** Force users of this role to change their password every N days; null = never (the field-agent +
   *  super-admin default). Enforced at login + token refresh. */
  passwordExpiryDays: number | null;
  /** Web idle auto-logout window in minutes (ADR-0045); null = exempt (field agents). */
  idleLogoutMinutes: number | null;
  /** Absolute session lifetime in minutes (ADR-0045); null = no cap. */
  maxSessionMinutes: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Granted permission codes (empty for grants_all roles — implicit ALL). */
  permissions: string[];
  /** The role's scope-dimension wiring (what its users may be assigned). */
  dimensions: RoleDimensionWiring[];
}

/** Active roles for selects (the user form's role picker + role-aware reports-to filtering). */
export interface RoleOption {
  code: string;
  name: string;
  reportsToRole: string | null;
}

const MAX_PERMISSIONS = 200;
const MAX_DIMENSIONS = 20;
/** UPPER_SNAKE, ≤20 chars — matches roles.code varchar(20) (a longer code would be a pg 22001). */
const ROLE_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/);

const DimensionWiringSchema = z.object({
  dimension: z.string().min(1).max(32),
  mode: z.enum(['EXPAND', 'RESTRICT']),
});

/** Per-role password rotation: 1–3650 days, or null = never expire (exempt). */
const passwordExpiryDays = z.number().int().min(1).max(3650).nullable();
/** Web idle auto-logout window: 1–1440 min, or null = exempt (ADR-0045). */
const idleLogoutMinutes = z.number().int().min(1).max(1440).nullable();
/** Absolute session lifetime: 5–10080 min (7 days), or null = no cap (ADR-0045). */
const maxSessionMinutes = z.number().int().min(5).max(10080).nullable();

export const CreateRoleSchema = z.object({
  code: ROLE_CODE,
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  hierarchyMode: z.enum(ROLE_HIERARCHY_MODES),
  reportsToRole: ROLE_CODE.nullable().optional(),
  /** default-deny: a new role starts with exactly what the admin grants here (may be empty). */
  permissions: z.array(z.string().min(1)).max(MAX_PERMISSIONS).default([]),
  dimensions: z.array(DimensionWiringSchema).max(MAX_DIMENSIONS).default([]),
  /** password rotation policy; omitted ⇒ null (never expire). */
  passwordExpiryDays: passwordExpiryDays.optional(),
  /** web idle auto-logout window; omitted ⇒ null (exempt). */
  idleLogoutMinutes: idleLogoutMinutes.optional(),
  /** absolute session lifetime; omitted ⇒ null (no cap). */
  maxSessionMinutes: maxSessionMinutes.optional(),
});
export type CreateRoleInput = z.input<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  hierarchyMode: z.enum(ROLE_HIERARCHY_MODES),
  reportsToRole: ROLE_CODE.nullable().optional(),
  /** full replacement of the wiring (omit to leave unchanged). */
  dimensions: z.array(DimensionWiringSchema).max(MAX_DIMENSIONS).optional(),
  /** password rotation policy; omit to leave unchanged, null to clear (never expire). */
  passwordExpiryDays: passwordExpiryDays.optional(),
  /** idle auto-logout window; omit to leave unchanged, null to clear (exempt). */
  idleLogoutMinutes: idleLogoutMinutes.optional(),
  /** absolute session lifetime; omit to leave unchanged, null to clear (no cap). */
  maxSessionMinutes: maxSessionMinutes.optional(),
  version: z.number().int().nonnegative(),
});
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;

export const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)).max(MAX_PERMISSIONS),
  version: z.number().int().nonnegative(),
});
export type UpdateRolePermissionsInput = z.infer<typeof UpdateRolePermissionsSchema>;
