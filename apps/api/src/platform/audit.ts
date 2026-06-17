/** Append-only audit actions (mirrors the audit_log CHECK in migration 0017). */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'ACTIVATE';

export interface AuditEntry {
  entityType: string;
  entityId: string | number;
  action: AuditAction;
  actorId: string;
  before?: unknown;
  after?: unknown;
  versionAfter?: number | null;
}

/** Minimal query shape (matches `query` / a transaction's `TxQuery`); kept structural so this helper
 *  never imports the db module — DB access stays in repositories (the boundary rule). */
type QueryFn = <T>(text: string, params?: unknown[]) => Promise<T[]>;

/**
 * Append ONE immutable row to audit_log (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §2). Every
 * create/update/(de)activate calls this from inside a repository, passing the write's transaction
 * `q` so the audit row commits atomically with the change it records. The audit_log table rejects
 * UPDATE/DELETE at the DB, so history can never be rewritten.
 */
export async function appendAudit(entry: AuditEntry, q: QueryFn): Promise<void> {
  await q(
    `INSERT INTO audit_log
       (entity_type, entity_id, action, actor_id, before_data, after_data, version_after)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      entry.entityType,
      String(entry.entityId),
      entry.action,
      entry.actorId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.versionAfter ?? null,
    ],
  );
}
