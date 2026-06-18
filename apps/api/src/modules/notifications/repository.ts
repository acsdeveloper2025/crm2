import { query } from '../../platform/db.js';
import type { Notification, NotifyInput } from '@crm2/sdk';

/**
 * camelize() bridges snake→camel (action_type→actionType, read_at→readAt, …). The trailing columns are
 * MOBILE-COMPAT projections the field app reads under v1 names: message=body, is_read=readAt!=null, and
 * task_id/case_id/task_number/case_number/action_url surfaced from the `payload` jsonb. Additive — web ignores them.
 */
const SELECT_COLS = `id, type, title, body, payload, action_type, read_at, created_at,
  body AS message, (read_at IS NOT NULL) AS is_read,
  payload->>'taskId' AS task_id, payload->>'caseId' AS case_id,
  payload->>'taskNumber' AS task_number, payload->>'caseNumber' AS case_number,
  payload->>'actionUrl' AS action_url`;

export interface ListParams {
  userId: string;
  limit: number;
  offset: number;
  sortColumn: string;
  sortOrder: 'asc' | 'desc';
  unreadOnly: boolean;
}

/**
 * Notification feed persistence (ADR-0027). Append-only: rows are INSERTed by producers and only
 * `read_at` ever mutates. Every read is filtered by `user_id` — the own-user scope is enforced here,
 * there is no cross-user read path.
 */
export const notificationRepository = {
  async insert(n: NotifyInput): Promise<Notification> {
    const rows = await query<Notification>(
      `INSERT INTO notifications (user_id, type, title, body, payload, action_type)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING ${SELECT_COLS}`,
      [n.userId, n.type, n.title, n.body ?? null, JSON.stringify(n.payload ?? {}), n.actionType ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error('notification insert produced no row');
    return row;
  },

  async list(p: ListParams): Promise<Notification[]> {
    const unread = p.unreadOnly ? 'AND read_at IS NULL' : '';
    return query<Notification>(
      `SELECT ${SELECT_COLS} FROM notifications
       WHERE user_id = $1 AND deleted_at IS NULL ${unread}
       ORDER BY ${p.sortColumn} ${p.sortOrder.toUpperCase()}
       LIMIT $2 OFFSET $3`,
      [p.userId, p.limit, p.offset],
    );
  },

  async count(userId: string, unreadOnly: boolean): Promise<number> {
    const unread = unreadOnly ? 'AND read_at IS NULL' : '';
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications
       WHERE user_id = $1 AND deleted_at IS NULL ${unread}`,
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  },

  /** Trash feed: the user's soft-deleted rows, newest-first (restorable). */
  async listTrash(p: ListParams): Promise<Notification[]> {
    return query<Notification>(
      `SELECT ${SELECT_COLS} FROM notifications
       WHERE user_id = $1 AND deleted_at IS NOT NULL
       ORDER BY ${p.sortColumn} ${p.sortOrder.toUpperCase()}
       LIMIT $2 OFFSET $3`,
      [p.userId, p.limit, p.offset],
    );
  },

  async countTrash(userId: string): Promise<number> {
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications
       WHERE user_id = $1 AND deleted_at IS NOT NULL`,
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  },

  /** Soft-delete one own visible row. Returns the row, or null if absent/already trashed. */
  async softDeleteOne(userId: string, id: string): Promise<Notification | null> {
    const rows = await query<Notification>(
      `UPDATE notifications SET deleted_at = now()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING ${SELECT_COLS}`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  /** Soft-delete every visible own row (clear-all); returns how many were trashed. */
  async softDeleteAll(userId: string): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE notifications SET deleted_at = now()
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [userId],
    );
    return rows.length;
  },

  /** Restore one own trashed row. Returns the row, or null if absent/not trashed. */
  async restoreOne(userId: string, id: string): Promise<Notification | null> {
    const rows = await query<Notification>(
      `UPDATE notifications SET deleted_at = NULL
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
       RETURNING ${SELECT_COLS}`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  /** Restore every trashed own row; returns how many were restored. */
  async restoreAll(userId: string): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE notifications SET deleted_at = NULL
       WHERE user_id = $1 AND deleted_at IS NOT NULL
       RETURNING id`,
      [userId],
    );
    return rows.length;
  },

  /** Idempotent mark-read of one own row. Returns the row (read_at preserved on re-read), or null if absent. */
  async markRead(userId: string, id: string): Promise<Notification | null> {
    const rows = await query<Notification>(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_COLS}`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  /** Mark every unread own row read; returns how many flipped. */
  async markAllRead(userId: string): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id`,
      [userId],
    );
    return rows.length;
  },
};
