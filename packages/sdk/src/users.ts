import { z } from 'zod';
import { toUpper } from './text.js';

/**
 * @crm2/sdk — the User contract. Identity master-data: who exists, their role and
 * place in the reporting hierarchy. Mirrors crm2/db/v2/migrations/0007 `users`.
 *
 * Credentials/authentication are NOT part of this contract (separate Auth phase).
 * USER_ROLES mirrors @crm2/access ROLES by contract (the frozen leaf-package pattern —
 * the contract layer never imports the access package), and equals the DB role CHECK.
 */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'MANAGER',
  'TEAM_LEADER',
  'BACKEND_USER',
  'FIELD_AGENT',
  'KYC_VERIFIER',
] as const;
/** OPEN since ADR-0022 — the role catalog lives in the `roles` table (system + custom roles);
 *  USER_ROLES keeps only the 6 seeded system codes (legacy dropdown fallback until the
 *  roles-options feed replaces it on the FE). */
export type UserRole = string;

export interface User {
  id: string;
  username: string;
  name: string;
  email: string | null;
  /** server-minted, immutable, unique (CRM-00001…); never supplied by the client. */
  employeeId: string | null;
  phone: string | null;
  departmentId: number | null;
  designationId: number | null;
  role: UserRole;
  reportsTo: string | null;
  isActive: boolean;
  /** admin flag: this user must use MFA (must enrol before their next sign-in). */
  mfaRequired: boolean;
  /** when the user becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC concurrency token (ADR-0019); sent back on update, bumped on every successful write. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A user joined with its manager / department / designation display names (list view). */
export interface UserView extends User {
  reportsToName: string | null;
  departmentName: string | null;
  designationName: string | null;
}

/**
 * Lightweight user option for dropdowns (e.g. the "reports to" picker) — the unpaginated
 * `/users/options` feed. UUID id + role (not the int-keyed master-data {@link Option} shape),
 * so a manager selector can never silently truncate the way `?limit=200` did (B-22).
 */
export interface UserOption {
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

const username = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, dot, underscore or hyphen');
const name = z.string().trim().min(1).max(150).transform(toUpper);
const email = z.string().trim().email().max(255);
// open role catalog (ADR-0022): shape-validated here, existence-validated by the users.role FK
const role = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/);
const uuid = z.string().uuid();
const isoDate = z.string().datetime();
/** E.164: optional leading +, 8–15 digits, no leading zero (e.g. +919876543210). */
const phone = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'phone must be in E.164 format');
const fkId = z.number().int().positive();
/** Strong password policy (v1 parity): ≥8 chars with a lowercase, uppercase, digit and a symbol. */
export const StrongPasswordSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/[a-z]/, 'needs a lowercase letter')
  .regex(/[A-Z]/, 'needs an uppercase letter')
  .regex(/[0-9]/, 'needs a digit')
  .regex(/[^A-Za-z0-9]/, 'needs a special character');

export const CreateUserSchema = z.object({
  username,
  name,
  email: email.optional(),
  // Profile fields: required by the FE create form; nullable at the API so the FK-free import + seed
  // admin keep working. employee_id is NOT here — it is minted server-side.
  phone: phone.optional(),
  departmentId: fkId.optional(),
  designationId: fkId.optional(),
  role,
  reportsTo: uuid.optional(),
  effectiveFrom: isoDate.optional(),
  /** optional initial password (strong policy); when omitted the admin sets it later via /password. */
  password: StrongPasswordSchema.optional(),
});

/** Update: everything editable; `username` correctable as a login rename (ADR-0020 — no FK dependents). */
export const UpdateUserSchema = z.object({
  // ADR-0020: username is a login identifier (no FK dependents — refs are by uuid id); correctable as a
  // login rename, uniqueness-checked. No dependents gate needed.
  username: username.optional(),
  name,
  email: email.nullable().optional(),
  phone: phone.nullable().optional(),
  departmentId: fkId.nullable().optional(),
  designationId: fkId.nullable().optional(),
  role,
  reportsTo: uuid.nullable().optional(),
  effectiveFrom: isoDate.optional(),
  mfaRequired: z.boolean().optional(),
});

/** Self-service contact update (v1 parity: PATCH /users/me/profile). A user edits only their OWN
 *  email + phone — both nullable so a value can be cleared. No role/manager/status here: those stay
 *  admin-only on PUT /users/:id. */
export const UpdateSelfProfileSchema = z.object({
  email: email.nullable().optional(),
  phone: phone.nullable().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UpdateSelfProfileInput = z.infer<typeof UpdateSelfProfileSchema>;
