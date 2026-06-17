import { query } from '../db.js';

/** Append the permanent, immutable import audit record (import_log; IMPORT_EXPORT_STANDARD §7). */
export const importLogRepository = {
  async record(entry: {
    resource: string;
    fileName: string | undefined;
    totalRows: number;
    successRows: number;
    failedRows: number;
    durationMs: number;
    actorId: string;
  }): Promise<void> {
    await query(
      `INSERT INTO import_log
         (resource, file_name, total_rows, success_rows, failed_rows, duration_ms, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.resource,
        entry.fileName ?? null,
        entry.totalRows,
        entry.successRows,
        entry.failedRows,
        entry.durationMs,
        entry.actorId,
      ],
    );
  },
};
