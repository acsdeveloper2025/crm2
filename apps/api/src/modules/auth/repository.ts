import type { AuthUser, PendingPolicy, SessionInfo } from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';

interface RefreshInsert {
  jti: string;
  userId: string;
  expiresAt: Date;
  deviceId: string | null;
  deviceInfo: string | null;
  ip: string | null;
  absoluteExpiresAt: Date | null;
}

interface Credentials {
  id: string;
  /** open role catalog (ADR-0022) — a roles.code, resolved to attributes downstream. */
  role: string;
  /** USABLE = is_active AND effective_from <= now() (ADR-0017). */
  usable: boolean;
  passwordHash: string | null;
  passwordMustChange: boolean;
  /** when the current password was last set (drives the per-role rotation policy); null = unknown. */
  passwordSetAt: string | null;
  failedLoginCount: number;
  /** when the lockout lifts (auto-unlock); null = not locked. */
  lockedUntil: string | null;
  /** admin flag: this user must have MFA. */
  mfaRequired: boolean;
  /** has a CONFIRMED TOTP enrolment (a row with enrolled_at set). */
  mfaEnrolled: boolean;
  /** review-only (mig 0122): skips the ADR-0088 new-device OTP gate. Set on ONE reviewer account
   *  by a manual DB update — no API/UI writes it. false for every real account. */
  otpExempt: boolean;
  /** OTP delivery targets (ADR-0088) — both channels get the same code. */
  email: string | null;
  phone: string | null;
}
/** A TOTP enrolment row (secret already DECRYPTED by the service for verification). */
export interface MfaRow {
  secretEncrypted: string;
  recoveryCodeHashes: string[];
  recoveryCodeUsed: boolean[];
  enrolledAt: string | null;
}
/** A live login-OTP challenge (ADR-0088); code is AES-GCM encrypted (decrypt to verify/resend). */
export interface OtpChallengeRow {
  id: string;
  codeEncrypted: string;
  expiresAt: string;
  attempts: number;
  sendCount: number;
  lastSentAt: string;
  sentEmail: boolean;
  sentSms: boolean;
  sentWhatsapp: boolean;
}

interface RefreshRow {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  /** carried forward on rotation so a session keeps its device label across refreshes. */
  deviceId: string | null;
  deviceInfo: string | null;
  /** hard session deadline (ADR-0045); carried forward unchanged on rotation. null = no cap. */
  absoluteExpiresAt: string | null;
}

export const authRepository = {
  /** Login identifier = username OR email (ADR-0088 follow-up): a value containing '@' is looked
   *  up by email (case-insensitive; unambiguous via the users_email_lower_uq partial unique index,
   *  mig 0115), anything else by username. One shape, so mobile's existing username login is
   *  untouched and either spelling costs the same scrypt timing on a miss. */
  async credentialsByIdentifier(identifier: string): Promise<Credentials | null> {
    const byEmail = identifier.includes('@');
    const rows = await query<Credentials>(
      `SELECT u.id, u.role, (u.is_active AND u.effective_from <= now()) AS usable, u.password_hash,
              u.password_must_change, u.password_set_at, u.failed_login_count, u.locked_until, u.mfa_required,
              (m.user_id IS NOT NULL AND m.enrolled_at IS NOT NULL) AS mfa_enrolled,
              u.otp_exempt,
              u.email, u.phone
       FROM users u LEFT JOIN user_mfa_secrets m ON m.user_id = u.id
       WHERE ${byEmail ? 'lower(u.email) = lower($1)' : 'u.username = $1'}`,
      [identifier],
    );
    return rows[0] ?? null;
  },

  // ── MFA (slice 5) ──
  /** The enrolment row (pending or confirmed); secret still encrypted. */
  async mfaByUserId(userId: string): Promise<MfaRow | null> {
    const rows = await query<MfaRow>(
      `SELECT secret_encrypted, recovery_code_hashes, recovery_code_used, enrolled_at
       FROM user_mfa_secrets WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  },

  /** {enrolled, required} for the status endpoint + the login flag. */
  async mfaStatus(userId: string): Promise<{ enrolled: boolean; required: boolean }> {
    const rows = await query<{ enrolled: boolean; required: boolean }>(
      `SELECT (m.enrolled_at IS NOT NULL) AS enrolled, u.mfa_required AS required
       FROM users u LEFT JOIN user_mfa_secrets m ON m.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    return rows[0] ?? { enrolled: false, required: false };
  },

  /** Begin (or restart) enrolment: store the encrypted secret, reset to pending (enrolled_at NULL). */
  async upsertPendingSecret(userId: string, secretEncrypted: string): Promise<void> {
    await query(
      `INSERT INTO user_mfa_secrets (user_id, secret_encrypted, recovery_code_hashes, recovery_code_used, enrolled_at)
       VALUES ($1, $2, '{}', '{}', NULL)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_encrypted = $2, recovery_code_hashes = '{}', recovery_code_used = '{}',
             enrolled_at = NULL, updated_at = now()`,
      [userId, secretEncrypted],
    );
  },

  /** Confirm enrolment: mark enrolled + store the hashed recovery codes (all unused). */
  async confirmEnrolment(userId: string, recoveryHashes: string[]): Promise<void> {
    await query(
      `UPDATE user_mfa_secrets
         SET enrolled_at = now(), recovery_code_hashes = $2,
             recovery_code_used = (SELECT array_agg(false) FROM unnest($2::text[])), updated_at = now()
       WHERE user_id = $1`,
      [userId, recoveryHashes],
    );
  },

  /** Mark the recovery code at `index` (0-based) as used (single-use). */
  async markRecoveryUsed(userId: string, index: number): Promise<void> {
    await query(
      `UPDATE user_mfa_secrets SET recovery_code_used[$2] = true, updated_at = now() WHERE user_id = $1`,
      [userId, index + 1], // pg arrays are 1-based
    );
  },

  /** Remove a user's MFA enrolment entirely (self-disable or admin disable). */
  async deleteMfa(userId: string): Promise<void> {
    await query(`DELETE FROM user_mfa_secrets WHERE user_id = $1`, [userId]);
  },

  /** Record a failed login; locks (sets locked_until) once the count reaches the threshold. Atomic.
   *  Returns the post-increment state so the caller can tell the client whether it just locked. */
  async recordFailedLogin(
    id: string,
    maxFails: number,
    cooldownSeconds: number,
  ): Promise<{ failedLoginCount: number; lockedUntil: string | null }> {
    const rows = await query<{ failedLoginCount: number; lockedUntil: string | null }>(
      `UPDATE users SET failed_login_count = failed_login_count + 1,
              locked_until = CASE WHEN failed_login_count + 1 >= $2
                THEN now() + ($3 || ' seconds')::interval ELSE locked_until END
       WHERE id = $1 RETURNING failed_login_count, locked_until`,
      [id, maxFails, String(cooldownSeconds)],
    );
    return rows[0] ?? { failedLoginCount: 0, lockedUntil: null };
  },

  /** Clear the lockout counters on a successful login. */
  async resetLoginState(id: string): Promise<void> {
    await query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [id]);
  },

  async passwordHashById(id: string): Promise<string | null> {
    const rows = await query<{ passwordHash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [id],
    );
    return rows[0]?.passwordHash ?? null;
  },

  /** Self-service change-password write: sets the new hash and clears the must-change flag. */
  async changePassword(id: string, passwordHash: string): Promise<void> {
    await query(
      `UPDATE users SET password_hash = $2, password_set_at = now(),
              password_must_change = false, updated_at = now()
       WHERE id = $1`,
      [id, passwordHash],
    );
  },

  async authUserById(id: string): Promise<AuthUser | null> {
    const rows = await query<AuthUser>(
      `SELECT id, username, name, email, phone, role FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async statusById(
    id: string,
  ): Promise<{ role: string; usable: boolean; passwordSetAt: string | null } | null> {
    const rows = await query<{ role: string; usable: boolean; passwordSetAt: string | null }>(
      `SELECT role, (is_active AND effective_from <= now()) AS usable, password_set_at
       FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async insertRefresh(input: RefreshInsert): Promise<void> {
    // last_used_at defaults to now() (DDL) — each freshly issued/rotated token stamps "last active now".
    await query(
      `INSERT INTO auth_refresh_tokens (jti, user_id, expires_at, device_id, device_info, ip, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.jti,
        input.userId,
        input.expiresAt,
        input.deviceId,
        input.deviceInfo,
        input.ip,
        input.absoluteExpiresAt,
      ],
    );
  },

  /** Atomically revoke `oldJti` and insert its replacement (DATABASE-02, docs/audit/11-database.md) —
   *  one transaction, so a crash between the two writes can't leave a revoked token with no
   *  replacement. Owns the transaction itself (raw SQL + `withTransaction` stay repository-only —
   *  `.dependency-cruiser.cjs`'s `db-access-only-in-repositories` boundary forbids service.ts from
   *  importing platform/db.ts directly). */
  async rotateRefresh(oldJti: string, newToken: RefreshInsert): Promise<void> {
    await withTransaction(async (q) => {
      await q(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE jti = $1 AND revoked_at IS NULL`, [
        oldJti,
      ]);
      await q(
        `INSERT INTO auth_refresh_tokens (jti, user_id, expires_at, device_id, device_info, ip, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newToken.jti,
          newToken.userId,
          newToken.expiresAt,
          newToken.deviceId,
          newToken.deviceInfo,
          newToken.ip,
          newToken.absoluteExpiresAt,
        ],
      );
    });
  },

  async findRefresh(jti: string): Promise<RefreshRow | null> {
    const rows = await query<RefreshRow>(
      `SELECT user_id, expires_at, revoked_at, device_id, device_info, absolute_expires_at
       FROM auth_refresh_tokens WHERE jti = $1`,
      [jti],
    );
    return rows[0] ?? null;
  },

  /** Active sessions for a user (slice 6): not revoked AND not expired, newest-used first.
   *  `currentJti` (the caller's own session, decoded from its refresh token) flags the "this device" row. */
  async sessionsForUser(userId: string, currentJti: string | null): Promise<SessionInfo[]> {
    return query<SessionInfo>(
      `SELECT jti AS id, device_id, device_info, ip::text AS ip,
              last_used_at, created_at, COALESCE(jti = $2, false) AS current
       FROM auth_refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_used_at DESC, jti`,
      [userId, currentJti],
    );
  },

  /** Revoke ONE session, scoped to its owner (IDOR-safe). Returns false when the jti isn't an active
   *  session of `userId` (unknown / already revoked / belongs to someone else → caller maps to 404). */
  /** Revoke ONE owned active session; returns the revoked session's deviceId (for the realtime
   *  forced-logout push), or null when nothing matched (not active / not owned). */
  async revokeRefreshForUser(jti: string, userId: string): Promise<{ deviceId: string | null } | null> {
    const rows = await query<{ deviceId: string | null }>(
      `UPDATE auth_refresh_tokens SET revoked_at = now()
       WHERE jti = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING device_id`,
      [jti, userId],
    );
    return rows[0] ?? null;
  },

  async revokeRefresh(jti: string): Promise<void> {
    await query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE jti = $1 AND revoked_at IS NULL`, [
      jti,
    ]);
  },

  /** Revoke ALL active sessions for a user; returns the distinct deviceIds affected (for the
   *  realtime forced-logout push to every signed-in device). */
  async revokeAllForUser(userId: string): Promise<string[]> {
    const rows = await query<{ deviceId: string | null }>(
      `UPDATE auth_refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL RETURNING device_id`,
      [userId],
    );
    return [...new Set(rows.map((r) => r.deviceId).filter((d): d is string => d !== null))];
  },

  // ── OTP login verification (ADR-0088) ──
  /** The latest live challenge for (user, device): unconsumed, unexpired, attempts left.
   *  `device_id IS NOT DISTINCT FROM` — a NULL deviceId (raw API caller) matches its own bucket. */
  async activeOtpChallenge(
    userId: string,
    deviceId: string | null,
    maxAttempts: number,
  ): Promise<OtpChallengeRow | null> {
    const rows = await query<OtpChallengeRow>(
      `SELECT id, code_encrypted, expires_at, attempts, send_count, last_sent_at,
              sent_email, sent_sms, sent_whatsapp
         FROM auth_otp_challenges
        WHERE user_id = $1 AND purpose = 'LOGIN' AND device_id IS NOT DISTINCT FROM $2
          AND consumed_at IS NULL AND expires_at > now() AND attempts < $3
        ORDER BY created_at DESC LIMIT 1`,
      [userId, deviceId, String(maxAttempts)],
    );
    return rows[0] ?? null;
  },

  /** Create a challenge; opportunistically prunes long-dead rows (same lightweight approach as
   *  auth_refresh_tokens — no scheduled job). */
  async insertOtpChallenge(input: {
    userId: string;
    deviceId: string | null;
    codeEncrypted: string;
    expiresAt: Date;
    sentEmail: boolean;
    sentSms: boolean;
    sentWhatsapp: boolean;
    ip: string | null;
  }): Promise<void> {
    await query(`DELETE FROM auth_otp_challenges WHERE expires_at < now() - interval '24 hours'`);
    await query(
      `INSERT INTO auth_otp_challenges
         (user_id, device_id, code_encrypted, expires_at, sent_email, sent_sms, sent_whatsapp, created_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.userId,
        input.deviceId,
        input.codeEncrypted,
        input.expiresAt,
        input.sentEmail,
        input.sentSms,
        input.sentWhatsapp,
        input.ip,
      ],
    );
  },

  /** A resend of the SAME code: bump the counter, stamp the clock, widen the delivered-channel flags. */
  async recordOtpResend(
    id: string,
    sentEmail: boolean,
    sentSms: boolean,
    sentWhatsapp: boolean,
  ): Promise<void> {
    await query(
      `UPDATE auth_otp_challenges
          SET send_count = send_count + 1, last_sent_at = now(),
              sent_email = sent_email OR $2, sent_sms = sent_sms OR $3,
              sent_whatsapp = sent_whatsapp OR $4
        WHERE id = $1`,
      [id, sentEmail, sentSms, sentWhatsapp],
    );
  },

  /** A wrong code burns one of the challenge's attempts (5 → the row stops matching activeOtpChallenge). */
  async recordOtpAttempt(id: string): Promise<void> {
    await query(`UPDATE auth_otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [id]);
  },

  /** Single-use: a verified challenge can never verify again. */
  async consumeOtpChallenge(id: string): Promise<void> {
    await query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE id = $1`, [id]);
  },

  /** Check-and-touch in one statement: true only while the device is inside its FIXED trust
   *  window — `trusted_at` (the last OTP success) + the role's window; activity never extends it
   *  (owner 2026-07-04: "input OTP every 24 hours"). `last_seen_at` is audit-only. A stale row
   *  stays put (re-trusted, clock reset, by the next OTP success). */
  async touchTrustedDevice(userId: string, deviceId: string, windowHours: number): Promise<boolean> {
    const rows = await query<{ userId: string }>(
      `UPDATE auth_trusted_devices SET last_seen_at = now()
        WHERE user_id = $1 AND device_id = $2
          AND trusted_at > now() - ($3 || ' hours')::interval
        RETURNING user_id`,
      [userId, deviceId, String(windowHours)],
    );
    return rows.length > 0;
  },

  /** Trust (or re-trust) a device after a successful OTP verification — resets the fixed window. */
  async trustDevice(userId: string, deviceId: string): Promise<void> {
    await query(
      `INSERT INTO auth_trusted_devices (user_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, device_id)
         DO UPDATE SET trusted_at = now(), last_seen_at = now()`,
      [userId, deviceId],
    );
  },

  // ── Policy acceptance gate (ADR-0043) ──
  /** Self-service: this user's own acceptance log (ADR-0043). Joins `consents` → `policies` by
   *  content_version for the policy code/name. LEFT JOIN: a consent row at a version whose policy
   *  was later deleted/renamed still surfaces, with null policy fields. Newest first. */
  async myConsents(userId: string): Promise<
    {
      id: string;
      policyCode: string | null;
      policyName: string | null;
      policyVersion: number;
      acceptedAt: string;
      ip: string | null;
      userAgent: string | null;
    }[]
  > {
    return query(
      `SELECT c.id, p.code AS policy_code, p.name AS policy_name,
              c.policy_version, c.accepted_at, c.ip::text AS ip, c.user_agent
         FROM consents c
         LEFT JOIN policies p ON p.content_version = c.policy_version
        WHERE c.user_id = $1
        ORDER BY c.accepted_at DESC`,
      [userId],
    );
  },

  /** Active+effective policies this user has NOT accepted at the current content_version. Acceptances
   *  live in the shared `consents` store (keyed by user_id + policy_version = p.content_version). */
  async pendingPoliciesForUser(userId: string): Promise<PendingPolicy[]> {
    return query<PendingPolicy>(
      `SELECT p.id, p.code, p.name, p.content, p.content_version
         FROM policies p
        WHERE p.is_active = true AND p.effective_from <= now()
          AND NOT EXISTS (
            SELECT 1 FROM consents c
             WHERE c.user_id = $1 AND c.policy_version = p.content_version)
        ORDER BY p.created_at`,
      [userId],
    );
  },
};
