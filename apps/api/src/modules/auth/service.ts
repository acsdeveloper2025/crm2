import { randomUUID, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@crm2/config';
import {
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
  type UserPolicyAcceptance,
} from '@crm2/sdk';
import { authRepository as repo } from './repository.js';
import { getRoleAttributes } from '../../platform/access/index.js';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../../platform/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../platform/jwt.js';
import { generateTotpSecret, verifyTotp, otpauthUri, base32Encode } from '../../platform/totp.js';
import { encryptSecret, decryptSecret } from '../../platform/encryption.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { getMailer, mailConfigured } from '../../platform/mail/index.js';
import { getSmsSender, smsConfigured, normalizeIndianMobile } from '../../platform/sms.js';
import { getRealtime } from '../../platform/realtime/index.js';
import { revokeUserAccessTokens } from '../../platform/tokenRevocation/index.js';
import { logger } from '@crm2/logger';

const MS_PER_S = 1000;
const MS_PER_MIN = 60_000;

/**
 * Push a real-time forced-logout to the affected device(s) (ADR-0014/0027). The field app listens for
 * `auth:session_revoked` and wipes its keychain when `payload.deviceId` matches its own device — so a
 * remotely-revoked session (admin/self session revoke, logout-everywhere, password change) signs the
 * device out immediately instead of only on its next token refresh/401. Best-effort over the socket.
 */
function emitSessionRevoked(userId: string, deviceIds: ReadonlyArray<string | null>): void {
  const rt = getRealtime();
  for (const deviceId of deviceIds) {
    if (deviceId) rt.emitToUser(userId, 'auth:session_revoked', { deviceId });
  }
}

/**
 * Fully cut a user off (ADR-0076 Phase 2): revoke all refresh sessions (+ push the per-device
 * forced-logout), kill live access tokens (the durable cutoff), and hard-disconnect live sockets so a
 * revoked/compromised user loses REST and realtime at once — not only at the access token's TTL.
 */
async function fullyRevokeUser(userId: string): Promise<void> {
  emitSessionRevoked(userId, await repo.revokeAllForUser(userId));
  await revokeUserAccessTokens(userId);
  getRealtime().disconnectUser(userId);
}

/** Grace for refresh-token reuse detection: a rotated token replayed within this window is treated as a
 *  benign client retry (lost-response retry / multi-tab race) → plain 401, no family revoke. Beyond it,
 *  a replay is a theft signal → revoke the whole family. Avoids network jitter causing mass logout. */
const REFRESH_REUSE_GRACE_MS = 60_000;
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

// ── OTP login verification (ADR-0088): new-device second factor, both channels, same code ──
const OTP_TTL_MIN = 5;
const OTP_TTL_MS = OTP_TTL_MIN * MS_PER_MIN;
const OTP_MAX_ATTEMPTS = 5; // wrong codes per challenge; each also feeds the account lockout
const OTP_MAX_SENDS = 3; // deliveries per challenge (first send + 2 resends)
const OTP_RESEND_COOLDOWN_MS = 60_000;
const TRUSTED_DEVICE_WINDOW_DAYS = 180; // sliding — touched on every trusted login
const OTP_CODE_DIGITS = 6;
const OTP_CODE_SPACE = 1_000_000; // 10^OTP_CODE_DIGITS — randomInt's exclusive upper bound
const PHONE_MASK_TAIL = 4;

const maskEmail = (email: string): string => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};
const maskPhone = (phone: string): string => `******${phone.replace(/\D/g, '').slice(-PHONE_MASK_TAIL)}`;

interface OtpSentTo {
  email: string | null;
  sms: string | null;
}
/** Masked view of the channels a code actually went out on (the FE shows these on the OTP step). */
const sentToView = (
  creds: { email: string | null; phone: string | null },
  sentEmail: boolean,
  sentSms: boolean,
): OtpSentTo => ({
  email: sentEmail && creds.email ? maskEmail(creds.email) : null,
  sms: sentSms && creds.phone ? maskPhone(creds.phone) : null,
});
/** Only reachable AFTER a correct password (like MFA_REQUIRED) — leaks nothing login doesn't. */
const otpRequired = (sentTo: OtpSentTo) =>
  new AppError(HTTP_STATUS.UNAUTHENTICATED, 'OTP_REQUIRED', 'a sign-in code is required', { sentTo });

/** Constant-time 6-digit comparison (length mismatch is an immediate, non-secret fail). */
const otpMatches = (expected: string, given: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Deliver `code` on every deliverable channel at once (owner decision: both). A leg is deliverable
 *  when its provider is configured AND the user has that contact; each send is best-effort. */
async function deliverOtp(
  creds: { email: string | null; phone: string | null },
  code: string,
): Promise<{ sentEmail: boolean; sentSms: boolean; deliverable: boolean }> {
  const emailLeg = mailConfigured() && !!creds.email;
  const phone10 = creds.phone ? normalizeIndianMobile(creds.phone) : null;
  const smsLeg = smsConfigured() && phone10 !== null;
  if (!emailLeg && !smsLeg) return { sentEmail: false, sentSms: false, deliverable: false };
  const [sentEmail, sentSms] = await Promise.all([
    emailLeg
      ? getMailer().send({
          to: creds.email as string,
          subject: `${code} is your CRM2 sign-in code`,
          text:
            `${code} is your CRM2 sign-in code for a new device. It expires in 5 minutes.\n\n` +
            `If you did not try to sign in, contact your administrator immediately.`,
        })
      : Promise.resolve(false),
    smsLeg ? getSmsSender().sendOtp(phone10 as string, code) : Promise.resolve(false),
  ]);
  return { sentEmail, sentSms, deliverable: true };
}

/**
 * The new-device OTP gate (ADR-0088). Runs only for role-flagged accounts without TOTP enrolment.
 * Returns normally when the login may proceed: device inside its trust window, gate inert (no
 * deliverable channel — deferred activation, warn-and-allow), or a valid `otpCode` consumed (which
 * also trusts the device). Otherwise throws 401 OTP_REQUIRED (challenge created/re-sent per the
 * cooldown + send-cap rules — the same code is re-delivered, never a fresh SMS while one is live)
 * or 423 ACCOUNT_LOCKED (wrong codes feed the account lockout, mirroring mfaCode).
 */
async function otpLoginGate(
  creds: { id: string; email: string | null; phone: string | null },
  v: { otpCode?: string | undefined; deviceId?: string | undefined },
  ip: string | null,
): Promise<void> {
  const deviceId = v.deviceId ?? null;
  if (deviceId && (await repo.touchTrustedDevice(creds.id, deviceId, TRUSTED_DEVICE_WINDOW_DAYS))) return;

  const challenge = await repo.activeOtpChallenge(creds.id, deviceId, OTP_MAX_ATTEMPTS);

  if (v.otpCode) {
    if (challenge) {
      if (otpMatches(decryptSecret(challenge.codeEncrypted), v.otpCode)) {
        await repo.consumeOtpChallenge(challenge.id);
        if (deviceId) await repo.trustDevice(creds.id, deviceId);
        return;
      }
      await repo.recordOtpAttempt(challenge.id);
    }
    // A wrong (or expired-challenge) code is a real failed attempt — same counter/cooldown as a
    // wrong password or mfaCode (AUTHENTICATION-01), so a code can't be ground within its 5 tries.
    const after = await repo.recordFailedLogin(creds.id, MAX_FAILED_LOGINS, LOCKOUT_COOLDOWN_S);
    if (isLocked(after.lockedUntil)) throw accountLocked();
    throw otpRequired(sentToView(creds, challenge?.sentEmail ?? false, challenge?.sentSms ?? false));
  }

  if (challenge) {
    // Re-login without a code while a challenge is live = the resend path: re-deliver the SAME code
    // once the cooldown passes, up to the send cap; inside the cooldown/cap nothing is sent.
    const cooldownOver = Date.now() - new Date(challenge.lastSentAt).getTime() >= OTP_RESEND_COOLDOWN_MS;
    if (cooldownOver && challenge.sendCount < OTP_MAX_SENDS) {
      const sent = await deliverOtp(creds, decryptSecret(challenge.codeEncrypted));
      await repo.recordOtpResend(challenge.id, sent.sentEmail, sent.sentSms);
      throw otpRequired(
        sentToView(creds, challenge.sentEmail || sent.sentEmail, challenge.sentSms || sent.sentSms),
      );
    }
    throw otpRequired(sentToView(creds, challenge.sentEmail, challenge.sentSms));
  }

  const code = String(randomInt(0, OTP_CODE_SPACE)).padStart(OTP_CODE_DIGITS, '0');
  const sent = await deliverOtp(creds, code);
  if (!sent.deliverable) {
    // Deferred activation (ADR-0088 §3): no configured channel reaches any contact this user has —
    // warn-and-allow rather than brick logins on an unprovisioned box or a contact-less account.
    logger.warn('otp gate inert — no deliverable channel', { userId: creds.id });
    return;
  }
  await repo.insertOtpChallenge({
    userId: creds.id,
    deviceId,
    codeEncrypted: encryptSecret(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    sentEmail: sent.sentEmail,
    sentSms: sent.sentSms,
    ip,
  });
  throw otpRequired(sentToView(creds, sent.sentEmail, sent.sentSms));
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

/** Defaults to a plain insert (login: one write, already atomic). `refresh()` passes a `persist` that
 *  rotates atomically instead (DATABASE-02) — keeps the transaction inside repository.ts, which is the
 *  only layer allowed to touch platform/db.ts (`db-access-only-in-repositories` boundary). */
async function issueTokens(
  userId: string,
  role: string,
  device: Device,
  ip: string | null,
  absoluteExpiresAt: Date | null,
  persist: (row: Parameters<typeof repo.insertRefresh>[0]) => Promise<void> = repo.insertRefresh,
): Promise<AuthTokens> {
  const env = loadEnv();
  const accessTtl = env.AUTH_ACCESS_TTL_S;
  const refreshTtl = env.AUTH_REFRESH_TTL_S;
  const jti = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId, role }, accessTtl),
    signRefreshToken({ userId, jti }, refreshTtl),
  ]);
  // The absolute cap (if any) never moves out on rotation → the token's expiry is the earlier of the
  // normal refresh TTL and the hard deadline, so the existing `expires_at > now()` check enforces it.
  const refreshExpiresAt = new Date(Date.now() + refreshTtl * MS_PER_S);
  const expiresAt =
    absoluteExpiresAt && absoluteExpiresAt.getTime() < refreshExpiresAt.getTime()
      ? absoluteExpiresAt
      : refreshExpiresAt;
  await persist({
    jti,
    userId,
    expiresAt,
    deviceId: device.deviceId,
    deviceInfo: device.deviceInfo,
    ip,
    absoluteExpiresAt,
  });
  return { accessToken, refreshToken, jti, expiresIn: accessTtl };
}

/** Attach the role's resolved attributes (ADR-0022) so the FE can gate UI on PERMISSIONS,
 *  never on role names. Cached resolution; unknown/inactive role → zero permissions. */
async function withResolvedPermissions<T extends { role: string }>(
  user: T,
): Promise<
  T & {
    grantsAll: boolean;
    permissions: string[];
    idleLogoutMinutes: number | null;
    maxSessionMinutes: number | null;
  }
> {
  const attrs = await getRoleAttributes(user.role);
  return {
    ...user,
    grantsAll: attrs?.grantsAll ?? false,
    permissions: attrs?.permissions ?? [],
    idleLogoutMinutes: attrs?.idleLogoutMinutes ?? null,
    maxSessionMinutes: attrs?.maxSessionMinutes ?? null,
  };
}

export const authService = {
  async login(input: unknown, ip: string | null): Promise<LoginResponse> {
    const v = LoginSchema.parse(input);
    const creds = await repo.credentialsByUsername(v.username);
    if (!creds || !creds.usable || !creds.passwordHash) {
      // Spend the same scrypt cost as a real login so latency can't reveal whether the username
      // exists (ADR-0076 — closes the enumeration timing oracle). Always fails.
      await verifyDummyPassword(v.password);
      throw invalidCreds();
    }
    // Locked accounts are refused before the password is even checked (auto-unlock once the cooldown lifts).
    if (isLocked(creds.lockedUntil)) throw accountLocked();
    if (!(await verifyPassword(v.password, creds.passwordHash))) {
      const after = await repo.recordFailedLogin(creds.id, MAX_FAILED_LOGINS, LOCKOUT_COOLDOWN_S);
      throw isLocked(after.lockedUntil) ? accountLocked() : invalidCreds();
    }
    // MFA challenge: an enrolled user must supply a valid TOTP/recovery code in the same request.
    // A missing code is the normal first leg (password verified, prompting for the second factor) —
    // not an attempt, so it doesn't touch the lockout counter. A *wrong* code is a real failed
    // attempt (AUTHENTICATION-01, docs/audit/01-authentication.md): without this, an attacker holding
    // a valid password could grind the 6-digit TOTP indefinitely, bounded only by the per-IP flood
    // limiter. Mirrors the password branch above — same counter, same cooldown, fails closed.
    if (creds.mfaEnrolled) {
      if (!v.mfaCode) throw mfaRequired();
      if (!(await verifyMfaCode(creds.id, v.mfaCode))) {
        const after = await repo.recordFailedLogin(creds.id, MAX_FAILED_LOGINS, LOCKOUT_COOLDOWN_S);
        throw isLocked(after.lockedUntil) ? accountLocked() : mfaRequired();
      }
    }
    // Per-role policy (ADR-0022/0045/0088): OTP enforcement + rotation expiry + the absolute session
    // cap. Resolved once, before the OTP gate and token issue.
    const attrs = await getRoleAttributes(creds.role);
    // New-device OTP gate (ADR-0088): a role-flagged account on an untrusted device must prove a
    // delivered code in this same request (`otpCode`). TOTP enrolment supersedes — the mfaCode
    // branch above already challenged a stronger second factor at zero SMS cost.
    if (attrs?.otpLoginRequired && !creds.mfaEnrolled) await otpLoginGate(creds, v, ip);
    await repo.resetLoginState(creds.id); // success clears the failed-attempt counter
    const absoluteExpiresAt =
      attrs?.maxSessionMinutes != null ? new Date(Date.now() + attrs.maxSessionMinutes * MS_PER_MIN) : null;
    const tokens = await issueTokens(
      creds.id,
      creds.role,
      { deviceId: v.deviceId ?? null, deviceInfo: v.deviceInfo ?? null },
      ip,
      absoluteExpiresAt,
    );
    const user = await repo.authUserById(creds.id);
    if (!user) throw AppError.internal('user vanished mid-login');
    // An over-age password forces a change before the user can proceed (the FE blocks into the
    // change-password screen). Exempt roles carry passwordExpiryDays = null.
    const expired = passwordExpired(creds.passwordSetAt, attrs?.passwordExpiryDays ?? null);
    // Policy-acceptance gate (ADR-0043): a user owing acceptance is blocked into the accept screen.
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
    await fullyRevokeUser(userId);
  },

  async refresh(input: unknown, ip: string | null): Promise<AuthTokens> {
    const v = RefreshSchema.parse(input);
    const claims = await verifyRefreshToken(v.refreshToken);
    if (!claims) throw invalidRefresh();
    const row = await repo.findRefresh(claims.jti);
    if (!row || new Date(row.expiresAt).getTime() < Date.now()) throw invalidRefresh();
    // Reuse detection (ADR-0076 Phase 2): a signature-valid, present, but ALREADY-revoked token is a
    // rotated/used token being replayed. Within the grace window it's a benign client retry (lost
    // response / multi-tab race) → plain 401. Beyond grace it's a theft signal → burn the whole family.
    if (row.revokedAt) {
      if (Date.now() - new Date(row.revokedAt).getTime() > REFRESH_REUSE_GRACE_MS) {
        logger.warn('refresh-token reuse beyond grace → family revoke', { userId: claims.userId });
        await fullyRevokeUser(claims.userId);
      }
      throw invalidRefresh();
    }
    const status = await repo.statusById(claims.userId);
    if (!status || !status.usable) throw invalidRefresh();
    // Rotation policy can't be outrun by an always-on session: once the password is over-age, refresh
    // is refused so the client must re-login — where login returns mustChangePassword and forces it.
    const attrs = await getRoleAttributes(status.role);
    if (passwordExpired(status.passwordSetAt, attrs?.passwordExpiryDays ?? null)) throw invalidRefresh();
    // Policy-acceptance gate (ADR-0043): an unaccepted active policy refuses refresh, forcing a re-login
    // where login returns mustAcceptPolicies and blocks the user into the accept screen.
    if ((await repo.pendingPoliciesForUser(claims.userId)).length > 0) throw invalidRefresh();
    // Rotate: the presented refresh token is single-use. The new token carries the SAME device label
    // (so the session keeps its identity across refreshes) and the current request IP. The absolute
    // session deadline (ADR-0045) is carried forward UNCHANGED — rotation never extends it, so the
    // session still hard-expires at its original cap.
    //
    // DATABASE-02 (docs/audit/11-database.md): revoke-old + insert-new is one transaction, not two
    // independent statements — a crash between them used to leave the token revoked with no
    // replacement (fails closed: the user is just logged out, not a security/integrity bug, but a real
    // gap for a two-write operation that has no reason not to be atomic). `repo.rotateRefresh` owns the
    // transaction itself (repository-only, per the db-access-only-in-repositories boundary).
    return issueTokens(
      claims.userId,
      status.role,
      { deviceId: row.deviceId, deviceInfo: row.deviceInfo },
      ip,
      row.absoluteExpiresAt ? new Date(row.absoluteExpiresAt) : null,
      (newToken) => repo.rotateRefresh(claims.jti, newToken),
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
    const revoked = await repo.revokeRefreshForUser(jti, userId);
    if (!revoked) throw new AppError(HTTP_STATUS.NOT_FOUND, 'SESSION_NOT_FOUND');
    emitSessionRevoked(userId, [revoked.deviceId]);
  },

  async logout(userId: string): Promise<void> {
    await fullyRevokeUser(userId);
  },

  async me(userId: string): Promise<LoginResponse['user']> {
    const user = await repo.authUserById(userId);
    if (!user) throw AppError.unauthenticated();
    return withResolvedPermissions(user);
  },

  /** Self-service: this user's own policy-acceptance log (ADR-0043). userId comes from req.auth so
   *  no validation needed (already a verified uuid from JWT). */
  myConsents(userId: string): Promise<UserPolicyAcceptance[]> {
    return repo.myConsents(userId);
  },
};
