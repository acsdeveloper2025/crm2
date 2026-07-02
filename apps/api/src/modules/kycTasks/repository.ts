import type { KycAttachment, KycTaskRow, SortOrder } from '@crm2/sdk';
import { filterClauses, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { taskScopePredicate, type Scope } from '../../platform/scope/index.js';
import type { KycQueueColumn } from './columns.js';

/**
 * KYC-queue repository (ADR-0085). One row per OFFICE task in the actor's scope; the export state is
 * DERIVED from the first-export event (`fe`, at most one row by the partial unique — no fan-out):
 *  - TO_EXPORT: still ASSIGNED and never exported (the verifier's work list)
 *  - EXPORTED:  a first-export event exists (any current status — a later complete/revoke stays visible)
 * Scope reuses the shared task predicate: SELF-hierarchy verifiers ⇒ own rows only; out-of-scope ⇒ 0.
 */

const KYC_QUEUE_FROM = `
  FROM case_tasks ct
  JOIN cases cs ON cs.id = ct.case_id
  JOIN verification_units vu ON vu.id = ct.verification_unit_id
  JOIN clients cl ON cl.id = cs.client_id
  JOIN products p ON p.id = cs.product_id
  JOIN case_applicants ta ON ta.id = ct.applicant_id
  LEFT JOIN users ab ON ab.id = ct.assigned_by
  LEFT JOIN task_export_events fe ON fe.task_id = ct.id AND NOT fe.is_reexport
  LEFT JOIN users ue ON ue.id = fe.exported_by`;

const STATE_LEG: Record<'TO_EXPORT' | 'EXPORTED', string> = {
  TO_EXPORT: `ct.status = 'ASSIGNED' AND fe.id IS NULL`,
  EXPORTED: `fe.id IS NOT NULL`,
};

export interface KycQueueOptions {
  state: 'TO_EXPORT' | 'EXPORTED';
  columns: KycQueueColumn[];
  filters: AppliedFilter[];
  scope: Scope;
  sortColumn: string; // registry SQL expression (whitelisted, safe to interpolate)
  sortOrder: SortOrder;
  limit: number;
  offset: number;
  /** restrict to these task ids (service-validated uuids) — the export path's claimed set. */
  idFilter?: string[];
}

function whereClause(
  o: Pick<KycQueueOptions, 'state' | 'filters' | 'scope' | 'idFilter'>,
  params: unknown[],
): string {
  const where: string[] = [`ct.visit_type = 'OFFICE'`, STATE_LEG[o.state]];
  const sp = taskScopePredicate(params, o.scope);
  if (sp) where.push(sp);
  where.push(...filterClauses(o.filters, params));
  if (o.idFilter) {
    params.push(o.idFilter);
    where.push(`ct.id = ANY($${params.length}::uuid[])`);
  }
  return `WHERE ${where.join(' AND ')}`;
}

export const kycTasksRepository = {
  async rows(o: KycQueueOptions): Promise<{ items: KycTaskRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const clause = whereClause(o, params);

    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${KYC_QUEUE_FROM} ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const selectList = o.columns.map((c) => `${c.sql} AS "${c.key}"`).join(', ');
    const items = await query<KycTaskRow>(
      `SELECT ct.id AS "id", cs.id AS "caseId", ${selectList} ${KYC_QUEUE_FROM} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder} NULLS LAST, ct.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  /**
   * Reference attachments for ONE of the actor's OWN KYC tasks (ADR-0085, owner 2026-07-02). The
   * verifier no longer has case.view / the case page, so this is his ONLY attachment path — scoped
   * to a task assigned to him (taskScopePredicate) with visit_type='OFFICE'; an out-of-scope taskId
   * simply returns []. Excludes device FIELD_PHOTO rows + soft-deleted. SA (no scope) sees all OFFICE.
   */
  async taskAttachments(taskId: string, scope: Scope): Promise<KycAttachment[]> {
    const params: unknown[] = [taskId];
    const pred = taskScopePredicate(params, scope);
    const scopeLeg = pred ? `AND (${pred})` : '';
    return query<KycAttachment>(
      `SELECT ca.id, ca.original_name AS "originalName", ca.mime_type AS "mimeType",
              ca.file_size AS "fileSize", ca.created_at AS "createdAt"
       FROM case_attachments ca
       WHERE ca.task_id = $1 AND ca.deleted_at IS NULL AND ca.kind IS DISTINCT FROM 'FIELD_PHOTO'
         AND EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                     WHERE ct.id = $1 AND ct.visit_type = 'OFFICE' ${scopeLeg})
       ORDER BY ca.created_at DESC`,
      params,
    );
  },

  /** The storage key of ONE attachment on the actor's own OFFICE task (same guard as taskAttachments)
   *  — for the presigned-download endpoint. null when the task is out of scope or the id doesn't match. */
  async attachmentStorageKey(taskId: string, attachmentId: string, scope: Scope): Promise<string | null> {
    const params: unknown[] = [taskId, attachmentId];
    const pred = taskScopePredicate(params, scope);
    const scopeLeg = pred ? `AND (${pred})` : '';
    const [row] = await query<{ storageKey: string }>(
      `SELECT ca.storage_key AS "storageKey"
       FROM case_attachments ca
       WHERE ca.task_id = $1 AND ca.id = $2 AND ca.deleted_at IS NULL
         AND ca.kind IS DISTINCT FROM 'FIELD_PHOTO'
         AND EXISTS (SELECT 1 FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
                     WHERE ct.id = $1 AND ct.visit_type = 'OFFICE' ${scopeLeg})`,
      params,
    );
    return row?.storageKey ?? null;
  },

  /** Scoped + filtered match count (the export guard's pre-check). */
  async count(o: Pick<KycQueueOptions, 'state' | 'filters' | 'scope' | 'idFilter'>): Promise<number> {
    const params: unknown[] = [];
    const clause = whereClause(o, params);
    const [row] = await query<{ count: number }>(
      `SELECT count(*)::int AS count ${KYC_QUEUE_FROM} ${clause}`,
      params,
    );
    return row?.count ?? 0;
  },

  /**
   * Claim tasks for a FIRST export by inserting their first-export events — one atomic statement.
   * The candidate set is exactly the TO_EXPORT view (scope + filters + optional ids), so an
   * out-of-scope or already-exported id is silently not claimed. A CONCURRENT duplicate claim loses
   * at `uq_task_first_export` (`ON CONFLICT … DO NOTHING`) — the loser's file simply excludes the
   * row. Returns the claimed task ids (the exact set the streamed file must contain).
   */
  async claimFirstExports(o: {
    filters: AppliedFilter[];
    scope: Scope;
    idFilter?: string[];
    format: string;
    actorId: string;
  }): Promise<{ taskIds: string[]; exportNo: number | null }> {
    const params: unknown[] = [];
    const clause = whereClause({ state: 'TO_EXPORT', ...o }, params);
    params.push(o.actorId, o.format);
    const rows = await query<{ id: number; taskId: string }>(
      `INSERT INTO task_export_events (task_id, case_id, exported_by, format)
       SELECT ct.id, ct.case_id, $${params.length - 1}, $${params.length}
       ${KYC_QUEUE_FROM} ${clause}
       ON CONFLICT (task_id) WHERE NOT is_reexport DO NOTHING
       RETURNING id, task_id`,
      params,
    );
    // exportNo = the batch's first event id — the quotable "export #N" in the filename.
    return {
      taskIds: rows.map((r) => r.taskId),
      exportNo: rows.length ? Math.min(...rows.map((r) => Number(r.id))) : null,
    };
  },

  /**
   * Append re-export events (mandatory reason) for ALREADY-exported tasks in the actor's scope.
   * All-or-nothing: any requested id that isn't an exported task of the actor's rolls the whole
   * request back with 409 NOT_RE_EXPORTABLE (no partial re-export trail).
   */
  async appendReexports(o: {
    ids: string[];
    scope: Scope;
    format: string;
    actorId: string;
    reason: string;
  }): Promise<{ taskIds: string[]; exportNo: number | null }> {
    return withTransaction(async (q) => {
      const params: unknown[] = [];
      const clause = whereClause({ state: 'EXPORTED', filters: [], scope: o.scope, idFilter: o.ids }, params);
      params.push(o.actorId, o.format, o.reason);
      const rows = await q<{ id: number; taskId: string }>(
        `INSERT INTO task_export_events (task_id, case_id, exported_by, format, is_reexport, reexport_reason)
         SELECT ct.id, ct.case_id, $${params.length - 2}, $${params.length - 1}, true, $${params.length}
         ${KYC_QUEUE_FROM} ${clause}
         RETURNING id, task_id`,
        params,
      );
      if (rows.length !== o.ids.length)
        throw AppError.conflict(
          'NOT_RE_EXPORTABLE',
          `${rows.length} of ${o.ids.length} selected tasks are re-exportable (already-exported tasks in your scope only)`,
        );
      return {
        taskIds: rows.map((r) => r.taskId),
        exportNo: rows.length ? Math.min(...rows.map((r) => Number(r.id))) : null,
      };
    });
  },
};
