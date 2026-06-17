import { z } from 'zod';
import { StrongPasswordSchema, type UserRole } from './users.js';
import type { PendingPolicy } from './policies.js';

/**
 * @crm2/sdk — the Authentication contract (ADR-0014). JWT-pair: a stateless access token
 * + a rotating refresh token. Shapes match the mobile contract
 * (MOBILE_API_COMPATIBILITY_MATRIX.md): login → { user, tokens{accessToken,refreshToken,expiresIn} }.
 */
export const LoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  /** TOTP or recovery code — required (in this same request) when the account has MFA enrolled. */
  mfaCode: z.string().trim().min(1).max(20).optional(),
  deviceId: z.string().max(128).optional(),
  deviceInfo: z.string().max(2000).optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshInput = z.infer<typeof RefreshSchema>;

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  /** Office phone — prefills the case backend-contact number on create (ADR-0023). */
  phone: string | null;
  role: UserRole;
  /** resolved role attributes (ADR-0022) — the FE gates UI on PERMISSIONS, never role names. */
  grantsAll?: boolean;
  permissions?: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** access-token lifetime in seconds */
  expiresIn: number;
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
  /** true when the user signed in with a one-time password and must change it before continuing. */
  mustChangePassword: boolean;
  /** true when an admin requires MFA but the user has not enrolled yet — the FE prompts enrolment. */
  mustEnrollMfa: boolean;
  /** true when the user has unaccepted active policies — the FE blocks into the accept screen. */
  mustAcceptPolicies: boolean;
  /** the active policies this user still owes acceptance for (empty when mustAcceptPolicies is false). */
  pendingPolicies: PendingPolicy[];
}

/** MFA contract (slice 5): TOTP enrol/verify + status. A 401 `MFA_REQUIRED` on login means the
 *  account is enrolled and the client must re-login including `mfaCode`. */
export const MfaCodeSchema = z.object({ code: z.string().trim().min(1).max(20) });
export type MfaCodeInput = z.infer<typeof MfaCodeSchema>;

export interface MfaStatus {
  enrolled: boolean;
  required: boolean;
}
export interface MfaEnrollStart {
  /** base32 secret for manual entry into the authenticator app. */
  secret: string;
  /** otpauth:// URI the FE renders as a QR code. */
  otpauthUri: string;
}
export interface MfaRecoveryCodes {
  /** 10 one-time recovery codes — shown ONCE; stored only as hashes. */
  recoveryCodes: string[];
}

/** Admin sets/resets a user's password (strong policy). `mustChange` issues it as a one-time
 *  password — the user is forced to change it on first login (the admin "Set a password" reset mode). */
export const SetPasswordSchema = z.object({
  password: StrongPasswordSchema,
  mustChange: z.boolean().optional(),
});
export type SetPasswordInput = z.infer<typeof SetPasswordSchema>;

/** Admin "reset password" delivery for the random one-time password: show it to the admin (`view`)
 *  or email it to the user (`email`). Both issue a must-change one-time password. */
export const TempPasswordSchema = z.object({ deliver: z.enum(['view', 'email']).default('view') });
export type TempPasswordInput = z.input<typeof TempPasswordSchema>;

/** Self-service change: prove the current password, set a new strong one (no email needed). */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: StrongPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/** Admin "generate one-time password" response. `view` mode (and email mode that could not send)
 *  returns the plaintext to show ONCE; a successful email omits it (the email is the channel).
 *  `emailed` is true when it was sent to the user's address (ADR-0021; false when no SMTP / no email). */
export interface TempPasswordResponse {
  temporaryPassword?: string;
  emailed: boolean;
}

/** An active session (slice 6) = one non-revoked, unexpired refresh token. `id` is its jti.
 *  Self lists via GET /auth/sessions (`current` flags the caller's own device); an admin lists
 *  another user's via GET /users/:id/sessions. Either can revoke one (revoke-one, not logout-all). */
export interface SessionInfo {
  /** the refresh-token jti — the handle used to revoke this one session. */
  id: string;
  deviceId: string | null;
  deviceInfo: string | null;
  /** the IP the session was issued from (text form of inet); null for pre-slice-6 rows. */
  ip: string | null;
  /** last refresh/rotation time (≈ when this session was last active). */
  lastUsedAt: string;
  createdAt: string;
  /** true only for the caller's own current session (self listing). */
  current: boolean;
}
