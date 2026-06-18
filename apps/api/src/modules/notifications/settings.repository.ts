import { query } from '../../platform/db.js';
import type { NotificationMute, NotificationPreferences } from '@crm2/sdk';

/**
 * Notification settings persistence (ADR-0027, mobile parity): per-task mutes + per-user delivery
 * preferences. Own-user scoped at the query layer (WHERE user_id = actor) — identity, not a permission.
 * Mobile mutes task-level only; `case_id` stays null (reserved for the web case-level mute).
 */
export const settingsRepository = {
  /** UPSERT a task mute (re-mute refreshes the TTL). Returns the active mute row. */
  async muteTask(userId: string, taskId: string, expiresAt: string | null): Promise<NotificationMute> {
    const rows = await query<NotificationMute>(
      `INSERT INTO notification_mutes (user_id, task_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, task_id) WHERE task_id IS NOT NULL
         DO UPDATE SET expires_at = EXCLUDED.expires_at, created_at = now()
       RETURNING id, case_id, task_id, created_at, expires_at`,
      [userId, taskId, expiresAt],
    );
    const row = rows[0];
    if (!row) throw new Error('notification mute upsert produced no row');
    return row;
  },

  /** Remove a task mute. Returns true if a row was deleted (idempotent — absent ⇒ false). */
  async unmuteTask(userId: string, taskId: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `DELETE FROM notification_mutes WHERE user_id = $1 AND task_id = $2 RETURNING id`,
      [userId, taskId],
    );
    return rows.length > 0;
  },

  /** Active mutes for a user (expired TTLs excluded), newest-first. */
  async listMutes(userId: string): Promise<NotificationMute[]> {
    return query<NotificationMute>(
      `SELECT id, case_id, task_id, created_at, expires_at
       FROM notification_mutes
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC`,
      [userId],
    );
  },

  /** Get the user's preferences (defaults to an empty map when no row exists). */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const rows = await query<NotificationPreferences>(
      `SELECT preferences, updated_at FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? { preferences: {}, updatedAt: null };
  },

  /** UPSERT the user's preferences (single row per user). Returns the stored value. */
  async setPreferences(
    userId: string,
    preferences: Record<string, unknown>,
  ): Promise<NotificationPreferences> {
    const rows = await query<NotificationPreferences>(
      `INSERT INTO notification_preferences (user_id, preferences)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id)
         DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()
       RETURNING preferences, updated_at`,
      [userId, JSON.stringify(preferences)],
    );
    const row = rows[0];
    if (!row) throw new Error('notification preferences upsert produced no row');
    return row;
  },
};
