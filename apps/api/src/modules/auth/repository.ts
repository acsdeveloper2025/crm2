import type { AuthUser, PendingPolicy, SessionInfo } from '@crm2/sdk';
import { query } from '../../platform/db.js';

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
}
/** A TOTP enrolment row (secret already DECRYPTED by the service for verification). */
export interface MfaRow {
  secretEncrypted: string;
  recoveryCodeHashes: string[];
  recoveryCodeUsed: boolean[];
  enrolledAt: string | null;
}
interface RefreshRow {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  /** carried forward on rotation so a session keeps its device label across refreshes. */
  deviceId: string | null;
  deviceInfo: string | null;
}

export const authRepository = {
  async credentialsByUsername(username: string): Promise<Credentials | null> {
    const rows = await query<Credentials>(
      `SELECT u.id, u.role, (u.is_active AND u.effective_from <= now()) AS usable, u.password_hash,
              u.password_must_change, u.password_set_at, u.failed_login_count, u.locked_until, u.mfa_required,
              (m.user_id IS NOT NULL AND m.enrolled_at IS NOT NULL) AS mfa_enrolled
       FROM users u LEFT JOIN user_mfa_secrets m ON m.user_id = u.id
       WHERE u.username = $1`,
      [username],
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

  async insertRefresh(input: {
    jti: string;
    userId: string;
    expiresAt: Date;
    deviceId: string | null;
    deviceInfo: string | null;
    ip: string | null;
  }): Promise<void> {
    // last_used_at defaults to now() (DDL) — each freshly issued/rotated token stamps "last active now".
    await query(
      `INSERT INTO auth_refresh_tokens (jti, user_id, expires_at, device_id, device_info, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.jti, input.userId, input.expiresAt, input.deviceId, input.deviceInfo, input.ip],
    );
  },

  async findRefresh(jti: string): Promise<RefreshRow | null> {
    const rows = await query<RefreshRow>(
      `SELECT user_id, expires_at, revoked_at, device_id, device_info
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

  // ── Policy acceptance gate (ADR-0043) ──
  /** Active+effective policies this user has NOT accepted at the current content_version (ADR-0043). */
  async pendingPoliciesForUser(userId: string): Promise<PendingPolicy[]> {
    return query<PendingPolicy>(
      `SELECT p.id, p.code, p.name, p.content, p.content_version
         FROM policies p
        WHERE p.is_active = true AND p.effective_from <= now()
          AND NOT EXISTS (
            SELECT 1 FROM policy_acceptances pa
             WHERE pa.user_id = $1 AND pa.policy_id = p.id AND pa.content_version = p.content_version)
        ORDER BY p.created_at`,
      [userId],
    );
  },

  /** Record acceptance for the given active policy ids, snapshotting the SERVER-side content_version
   *  (the client's claim is ignored). Idempotent. Returns the number of policies accepted. */
  async acceptPolicies(
    userId: string,
    policyIds: number[],
    ip: string | null,
    userAgent: string | null,
    source: 'WEB' | 'MOBILE',
  ): Promise<number> {
    const rows = await query<{ policyId: number }>(
      `INSERT INTO policy_acceptances (user_id, policy_id, content_version, ip, user_agent, source)
       SELECT $1, p.id, p.content_version, $3::inet, $4, $5
         FROM policies p
        WHERE p.id = ANY($2::int[]) AND p.is_active = true AND p.effective_from <= now()
       ON CONFLICT (user_id, policy_id, content_version) DO NOTHING
       RETURNING policy_id`,
      [userId, policyIds, ip, userAgent, source],
    );
    return rows.length;
  },
};
