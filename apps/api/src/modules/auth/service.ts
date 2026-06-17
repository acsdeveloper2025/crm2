import { randomUUID, randomBytes } from 'node:crypto';
import { loadEnv } from '@crm2/config';
import {
  AcceptPoliciesSchema,
  ChangePasswordSchema,
  LoginSchema,
  RefreshSchema,
  MfaCodeSchema,
  type AuthTokens,
  type LoginResponse,
  type MfaStatus,
  type MfaEnrollStart,
  type MfaRecoveryCodes,
  type SessionInfo,
} from '@crm2/sdk';
import { authRepository as repo } from './repository.js';
import { getRoleAttributes } from '../../platform/access/index.js';
import { hashPassword, verifyPassword } from '../../platform/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../platform/jwt.js';
import { generateTotpSecret, verifyTotp, otpauthUri, base32Encode } from '../../platform/totp.js';
import { encryptSecret, decryptSecret } from '../../platform/encryption.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';

const MS_PER_S = 1000;
/** Lock an account after this many consecutive failed logins; auto-unlock after the cooldown. */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_COOLDOWN_S = 900; // 15 minutes
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8;
const RECOVERY_CODE_LEN = 10; // base32 chars kept, formatted as XXXXX-XXXXX
const RECOVERY_CODE_GROUP = 5;
const TOTP_CODE_RE = /^\d{6}$/;
const invalidCreds = () => new AppError(HTTP_STATUS.UNAUTHENTICATED, 'INVALID_CREDENTIALS');
const invalidRefresh = () => new AppError(HTTP_STATUS.UNAUTHENTICATED, 'INVALID_REFRESH');
const accountLocked = () =>
  new AppError(HTTP_STATUS.LOCKED, 'ACCOUNT_LOCKED', 'too many failed attempts; try again later');
/** MFA is enrolled but no (valid) code was supplied — the client must re-login with `mfaCode`. */
const mfaRequired = () => new AppError(HTTP_STATUS.UNAUTHENTICATED, 'MFA_REQUIRED');
const isLocked = (until: string | null): boolean => until !== null && new Date(until).getTime() > Date.now();

const MS_PER_DAY = 86_400_000;
/** Per-role rotation (ADR-0022): true when the password is older than the role's expiry window.
 *  `expiryDays === null` (field agents + super admin, and any role left unset) ⇒ never expires. */
function passwordExpired(passwordSetAt: string | null, expiryDays: number | null): boolean {
  if (expiryDays === null || passwordSetAt === null) return false;
  return Date.now() - new Date(passwordSetAt).getTime() > expiryDays * MS_PER_DAY;
}

/** Normalise a recovery code to its comparable form (strip dashes/space, uppercase). */
const normRecovery = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A confirmed-enrolment TOTP/recovery check. Returns true (and burns a recovery code) on success. */
async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const mfa = await repo.mfaByUserId(userId);
  if (!mfa || mfa.enrolledAt === null) return false;
  const cleaned = code.trim();
  if (TOTP_CODE_RE.test(cleaned)) return verifyTotp(decryptSecret(mfa.secretEncrypted), cleaned, Date.now());
  // otherwise treat it as a one-time recovery code: match an UNUSED hash, then burn it.
  const candidate = normRecovery(cleaned);
  for (let i = 0; i < mfa.recoveryCodeHashes.length; i++) {
    if (mfa.recoveryCodeUsed[i]) continue;
    if (await verifyPassword(candidate, mfa.recoveryCodeHashes[i]!)) {
      await repo.markRecoveryUsed(userId, i);
      return true;
    }
  }
  return false;
}

/** 10 one-time recovery codes (base32, dash-grouped) — returned ONCE, stored only as hashes. */
function mintRecoveryCodes(): { plain: string[]; hashesP: Promise<string>[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(RECOVERY_CODE_BYTES)).slice(0, RECOVERY_CODE_LEN);
    return `${raw.slice(0, RECOVERY_CODE_GROUP)}-${raw.slice(RECOVERY_CODE_GROUP, RECOVERY_CODE_LEN)}`;
  });
  return { plain, hashesP: plain.map((c) => hashPassword(normRecovery(c))) };
}

interface Device {
  deviceId: string | null;
  deviceInfo: string | null;
}

async function issueTokens(
  userId: string,
  role: string,
  device: Device,
  ip: string | null,
): Promise<AuthTokens> {
  const env = loadEnv();
  const accessTtl = env.AUTH_ACCESS_TTL_S;
  const refreshTtl = env.AUTH_REFRESH_TTL_S;
  const jti = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId, role }, accessTtl),
    signRefreshToken({ userId, jti }, refreshTtl),
  ]);
  await repo.insertRefresh({
    jti,
    userId,
    expiresAt: new Date(Date.now() + refreshTtl * MS_PER_S),
    deviceId: device.deviceId,
    deviceInfo: device.deviceInfo,
    ip,
  });
  return { accessToken, refreshToken, expiresIn: accessTtl };
}

/** Attach the role's resolved attributes (ADR-0022) so the FE can gate UI on PERMISSIONS,
 *  never on role names. Cached resolution; unknown/inactive role → zero permissions. */
async function withResolvedPermissions<T extends { role: string }>(
  user: T,
): Promise<T & { grantsAll: boolean; permissions: string[] }> {
  const attrs = await getRoleAttributes(user.role);
  return { ...user, grantsAll: attrs?.grantsAll ?? false, permissions: attrs?.permissions ?? [] };
}

export const authService = {
  async login(input: unknown, ip: string | null): Promise<LoginResponse> {
    const v = LoginSchema.parse(input);
    const creds = await repo.credentialsByUsername(v.username);
    if (!creds || !creds.usable || !creds.passwordHash) throw invalidCreds();
    // Locked accounts are refused before the password is even checked (auto-unlock once the cooldown lifts).
    if (isLocked(creds.lockedUntil)) throw accountLocked();
    if (!(await verifyPassword(v.password, creds.passwordHash))) {
      const after = await repo.recordFailedLogin(creds.id, MAX_FAILED_LOGINS, LOCKOUT_COOLDOWN_S);
      throw isLocked(after.lockedUntil) ? accountLocked() : invalidCreds();
    }
    // MFA challenge: an enrolled user must supply a valid TOTP/recovery code in the same request.
    // A missing/invalid code returns 401 MFA_REQUIRED so the client can re-login with `mfaCode`.
    if (creds.mfaEnrolled && !(v.mfaCode && (await verifyMfaCode(creds.id, v.mfaCode)))) throw mfaRequired();
    await repo.resetLoginState(creds.id); // success clears the failed-attempt counter
    const tokens = await issueTokens(
      creds.id,
      creds.role,
      { deviceId: v.deviceId ?? null, deviceInfo: v.deviceInfo ?? null },
      ip,
    );
    const user = await repo.authUserById(creds.id);
    if (!user) throw AppError.internal('user vanished mid-login');
    // Per-role rotation policy: an over-age password forces a change before the user can proceed
    // (the FE blocks into the change-password screen). Exempt roles carry passwordExpiryDays = null.
    const attrs = await getRoleAttributes(creds.role);
    const expired = passwordExpired(creds.passwordSetAt, attrs?.passwordExpiryDays ?? null);
    // Policy-acceptance gate (ADR-0042): a user owing acceptance is blocked into the accept screen.
    const pendingPolicies = await repo.pendingPoliciesForUser(creds.id);
    return {
      user: await withResolvedPermissions(user),
      tokens,
      mustChangePassword: creds.passwordMustChange || expired,
      // admin-required but not yet enrolled → the FE prompts the user to set up MFA.
      mustEnrollMfa: creds.mfaRequired && !creds.mfaEnrolled,
      mustAcceptPolicies: pendingPolicies.length > 0,
      pendingPolicies,
    };
  },

  // ── MFA (slice 5) ──
  mfaStatus(userId: string): Promise<MfaStatus> {
    return repo.mfaStatus(userId);
  },

  /** Begin enrolment: generate a fresh secret, store it pending (encrypted), return it + the QR URI. */
  async mfaEnrollStart(userId: string): Promise<MfaEnrollStart> {
    const user = await repo.authUserById(userId);
    if (!user) throw AppError.unauthenticated();
    const secret = generateTotpSecret();
    await repo.upsertPendingSecret(userId, encryptSecret(secret));
    return { secret, otpauthUri: otpauthUri(secret, user.username) };
  },

  /** Confirm enrolment by proving a code from the pending secret; mints + returns recovery codes ONCE. */
  async mfaEnrollVerify(userId: string, input: unknown): Promise<MfaRecoveryCodes> {
    const { code } = MfaCodeSchema.parse(input);
    const mfa = await repo.mfaByUserId(userId);
    if (!mfa) throw AppError.badRequest('MFA_NOT_STARTED');
    if (!verifyTotp(decryptSecret(mfa.secretEncrypted), code, Date.now()))
      throw AppError.badRequest('INVALID_MFA_CODE');
    const { plain, hashesP } = mintRecoveryCodes();
    await repo.confirmEnrolment(userId, await Promise.all(hashesP));
    return { recoveryCodes: plain };
  },

  /** Self-disable MFA — requires proof of a current code (TOTP or recovery). */
  async mfaDisable(userId: string, input: unknown): Promise<void> {
    const { code } = MfaCodeSchema.parse(input);
    if (!(await verifyMfaCode(userId, code))) throw AppError.badRequest('INVALID_MFA_CODE');
    await repo.deleteMfa(userId);
  },

  /** Admin removes a user's MFA enrolment (no code needed — admin authority). */
  async mfaAdminDisable(userId: string): Promise<void> {
    await repo.deleteMfa(userId);
  },

  /** Self-service change-password: prove the current password, set a new strong one, clear the
   *  must-change flag, and revoke all refresh tokens so other sessions must re-authenticate. */
  async changePassword(userId: string, input: unknown): Promise<void> {
    const v = ChangePasswordSchema.parse(input);
    const hash = await repo.passwordHashById(userId);
    if (!hash || !(await verifyPassword(v.currentPassword, hash))) throw invalidCreds();
    await repo.changePassword(userId, await hashPassword(v.newPassword));
    await repo.revokeAllForUser(userId);
  },

  /** Self-service: record the user's acceptance of the given pending policy ids (ADR-0042). */
  async acceptPolicies(
    userId: string,
    input: unknown,
    ip: string | null,
    userAgent: string | null,
  ): Promise<void> {
    const v = AcceptPoliciesSchema.parse(input);
    await repo.acceptPolicies(userId, v.policyIds, ip, userAgent, v.source);
  },

  async refresh(input: unknown, ip: string | null): Promise<AuthTokens> {
    const v = RefreshSchema.parse(input);
    const claims = await verifyRefreshToken(v.refreshToken);
    if (!claims) throw invalidRefresh();
    const row = await repo.findRefresh(claims.jti);
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() < Date.now()) throw invalidRefresh();
    const status = await repo.statusById(claims.userId);
    if (!status || !status.usable) throw invalidRefresh();
    // Rotation policy can't be outrun by an always-on session: once the password is over-age, refresh
    // is refused so the client must re-login — where login returns mustChangePassword and forces it.
    const attrs = await getRoleAttributes(status.role);
    if (passwordExpired(status.passwordSetAt, attrs?.passwordExpiryDays ?? null)) throw invalidRefresh();
    // Policy-acceptance gate (ADR-0042): an unaccepted active policy refuses refresh, forcing a re-login
    // where login returns mustAcceptPolicies and blocks the user into the accept screen.
    if ((await repo.pendingPoliciesForUser(claims.userId)).length > 0) throw invalidRefresh();
    // Rotate: the presented refresh token is single-use. The new token carries the SAME device label
    // (so the session keeps its identity across refreshes) and the current request IP.
    await repo.revokeRefresh(claims.jti);
    return issueTokens(
      claims.userId,
      status.role,
      { deviceId: row.deviceId, deviceInfo: row.deviceInfo },
      ip,
    );
  },

  // ── Sessions (slice 6) ──
  /** Active sessions for a user. `currentJti` (self only) flags the caller's own session. */
  listSessions(userId: string, currentJti: string | null): Promise<SessionInfo[]> {
    return repo.sessionsForUser(userId, currentJti);
  },

  /** Revoke ONE session, scoped to its owner — 404 when it isn't an active session of `userId`
   *  (IDOR-safe: a user can't probe/revoke another user's jti). */
  async revokeSession(userId: string, jti: string): Promise<void> {
    if (!(await repo.revokeRefreshForUser(jti, userId)))
      throw new AppError(HTTP_STATUS.NOT_FOUND, 'SESSION_NOT_FOUND');
  },

  async logout(userId: string): Promise<void> {
    await repo.revokeAllForUser(userId);
  },

  async me(userId: string): Promise<LoginResponse['user']> {
    const user = await repo.authUserById(userId);
    if (!user) throw AppError.unauthenticated();
    return withResolvedPermissions(user);
  },
};
