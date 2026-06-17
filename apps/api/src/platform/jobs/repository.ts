import { query } from '../db.js';
import type { JobType, JobView } from '@crm2/sdk';

/**
 * Background-job persistence (ADR-0030). Raw SQL lives in platform here (precedent:
 * platform/import/importLog.repository.ts) because the job seam owns the `jobs` table directly.
 * `payload` is internal (the job input) and never returned to the client; reads expose JobView.
 */
const READ_COLS = 'id, type, status, progress, stage, result, error, created_at, started_at, completed_at';

export interface JobListParams {
  userId: string;
  limit: number;
  offset: number;
  sortColumn: string;
  sortOrder: 'asc' | 'desc';
}

export const jobRepository = {
  /** INSERT a PENDING job owned by `createdBy`; returns the tray row (no payload). */
  async insert(type: JobType, payload: unknown, createdBy: string): Promise<JobView> {
    const rows = await query<JobView>(
      `INSERT INTO jobs (type, payload, created_by)
       VALUES ($1, $2::jsonb, $3)
       RETURNING ${READ_COLS}`,
      [type, JSON.stringify(payload ?? {}), createdBy],
    );
    const row = rows[0];
    if (!row) throw new Error('job insert produced no row');
    return row;
  },

  /** The full payload for the runner (server-internal; not exposed to clients). */
  async payload(id: string): Promise<unknown> {
    const rows = await query<{ payload: unknown }>(`SELECT payload FROM jobs WHERE id = $1`, [id]);
    return rows[0]?.payload ?? null;
  },

  async setRunning(id: string): Promise<void> {
    await query(
      `UPDATE jobs SET status = 'RUNNING', started_at = now(), progress = 0
       WHERE id = $1 AND status = 'PENDING'`,
      [id],
    );
  },

  async setProgress(id: string, progress: number, stage: string | null): Promise<void> {
    await query(`UPDATE jobs SET progress = $2, stage = $3 WHERE id = $1`, [id, progress, stage]);
  },

  async setSucceeded(id: string, result: unknown): Promise<void> {
    await query(
      `UPDATE jobs SET status = 'SUCCEEDED', progress = 100, result = $2::jsonb, completed_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(result ?? {})],
    );
  },

  async setFailed(id: string, error: string): Promise<void> {
    await query(`UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1`, [
      id,
      error,
    ]);
  },

  /** Own-row read (IDOR-safe): null for a non-owner so the controller 404s. */
  async getOwned(id: string, userId: string): Promise<JobView | null> {
    const rows = await query<JobView>(`SELECT ${READ_COLS} FROM jobs WHERE id = $1 AND created_by = $2`, [
      id,
      userId,
    ]);
    return rows[0] ?? null;
  },

  async listOwned(p: JobListParams): Promise<JobView[]> {
    return query<JobView>(
      `SELECT ${READ_COLS} FROM jobs
       WHERE created_by = $1
       ORDER BY ${p.sortColumn} ${p.sortOrder.toUpperCase()}
       LIMIT $2 OFFSET $3`,
      [p.userId, p.limit, p.offset],
    );
  },

  async countOwned(userId: string): Promise<number> {
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM jobs WHERE created_by = $1`,
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  },
};
