import { query } from '../../platform/db.js';
import type { PushTokenRegistration } from '@crm2/sdk';

export interface RegisterTokenInput {
  userId: string;
  token: string;
  platform: string;
  deviceId: string | null;
}

/**
 * FCM device-token registry (ADR-0027 phase 2). `token` is unique — a re-register upserts (a token can
 * migrate to a new user/device and is re-activated). Tokens FCM rejects are deactivated, never deleted.
 */
export const tokenRepository = {
  async register(p: RegisterTokenInput): Promise<PushTokenRegistration> {
    const rows = await query<PushTokenRegistration>(
      `INSERT INTO notification_tokens (user_id, token, platform, device_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE
         SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
             device_id = EXCLUDED.device_id, is_active = true, updated_at = now()
       RETURNING id, platform, is_active`,
      [p.userId, p.token, p.platform, p.deviceId],
    );
    const row = rows[0];
    if (!row) throw new Error('token register produced no row');
    return row;
  },

  async activeTokensFor(userId: string): Promise<string[]> {
    const rows = await query<{ token: string }>(
      `SELECT token FROM notification_tokens WHERE user_id = $1 AND is_active`,
      [userId],
    );
    return rows.map((r) => r.token);
  },

  /** Deactivate tokens FCM reported as unregistered/invalid (matches v1's auto-prune). */
  async deactivate(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await query(
      `UPDATE notification_tokens SET is_active = false, updated_at = now() WHERE token = ANY($1)`,
      [tokens],
    );
  },
};
