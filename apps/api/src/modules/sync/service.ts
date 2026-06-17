import { SyncDownloadQuerySchema, type MobileSyncResponse, type MobileSyncTask } from '@crm2/sdk';
import { syncRepository as repo, type SyncTaskRow } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const WATERMARK_DAYS = 30;
const MS_PER_DAY = 86_400_000;

const iso = (d: string | Date): string => new Date(d).toISOString();

/** Map a flat assigned-task row to the locked `MobileCaseResponse` shape (audit §3.1). */
function toMobileTask(r: SyncTaskRow): MobileSyncTask {
  return {
    id: r.id,
    caseId: r.caseId,
    title: r.taskNumber,
    description: `${r.unitName} - ${r.customerName}`,
    customerName: r.customerName,
    customerCallingCode: r.customerCallingCode,
    ...(r.customerPhone ? { customerPhone: r.customerPhone } : {}),
    ...(r.companyName ? { companyName: r.companyName } : {}),
    addressStreet: r.address,
    // Phantom fields — v1 sends these empty (no source columns); kept for byte-compat.
    addressCity: '',
    addressState: '',
    addressPincode: '',
    status: r.status,
    priority: r.priority,
    assignedAt: iso(r.assignedAt ?? r.updatedAt),
    updatedAt: iso(r.updatedAt),
    // Execution timestamps the office/device set on the task. The device's conflict resolver
    // preserves local pending state (sync_status / local_updated_at) so emitting these is safe;
    // they re-hydrate completion/start time after a local wipe. Omitted when null (v1 wire).
    ...(r.startedAt ? { inProgressAt: iso(r.startedAt) } : {}),
    ...(r.completedAt ? { completedAt: iso(r.completedAt) } : {}),
    notes: r.trigger,
    verificationType: r.unitName,
    applicantType: r.applicantType,
    backendContactNumber: r.backendContactNumber,
    createdByBackendUser: r.createdByName ?? '',
    ...(r.assignedToName ? { assignedToFieldUser: r.assignedToName } : {}),
    verificationTaskId: r.id,
    verificationTaskNumber: r.taskNumber,
    isRevoked: r.status === 'REVOKED',
    isSaved: false,
    attachmentCount: r.attachmentCount,
    client: { id: r.clientId, name: r.clientName, code: r.clientCode },
    product: { id: r.productId, name: r.productName, code: r.productCode },
    verificationTypeDetails: { id: r.unitId, name: r.unitName, code: r.unitCode },
    attachments: [],
    syncStatus: 'SYNCED',
  };
}

export const syncService = {
  /**
   * Down-sync for the field device (ADR-0012, ADR-0035). Returns the v1-compatible `{ success, message,
   * data }` envelope; `data.cases` and `data.changes` are the SAME array. `revokedAssignmentIds` carries
   * tasks the device was assigned but no longer is (reassigned/unassigned away) so the device purges the
   * orphans. `deletedTaskIds`/`deletedCaseIds` stay empty — v2 has no hard task/case delete (a revoked
   * task that is still the user's flows via `cases` with `isRevoked = true`, not a purge). The delta is
   * computed only on the first page (offset 0): the device restarts every cycle at offset 0, and the
   * device-side purge is idempotent + `recentlyCleaned`-deduped, so repeating it per page is wasteful.
   */
  async download(rawQuery: Record<string, unknown>, actor: Actor): Promise<MobileSyncResponse> {
    const q = SyncDownloadQuerySchema.parse({
      ...(typeof rawQuery['lastSyncTimestamp'] === 'string'
        ? { lastSyncTimestamp: rawQuery['lastSyncTimestamp'] }
        : {}),
      ...(rawQuery['limit'] !== undefined ? { limit: Number(rawQuery['limit']) } : {}),
      ...(rawQuery['offset'] !== undefined ? { offset: Number(rawQuery['offset']) } : {}),
    });
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = q.offset ?? 0;
    // Empty watermark → last 30 days (v1 semantics). A malformed timestamp is a 400 (not a 500
    // from a downstream toISOString throw); lenient — any Date-parseable string is accepted.
    const cutoff = q.lastSyncTimestamp
      ? new Date(q.lastSyncTimestamp)
      : new Date(Date.now() - WATERMARK_DAYS * MS_PER_DAY);
    if (Number.isNaN(cutoff.getTime())) throw AppError.badRequest('INVALID_TIMESTAMP');

    const scope = await resolveScope(actor);
    const { rows, total } = await repo.downloadForUser(actor.userId, scope, cutoff, limit, offset);
    const tasks = rows.map(toMobileTask);
    const hasMore = offset + tasks.length < total;
    // Purge-orphan signal — computed once per cycle (offset 0); see the method doc above.
    const revokedAssignmentIds =
      offset === 0 ? await repo.revokedAssignmentIdsForUser(actor.userId, cutoff) : [];

    return {
      success: true,
      message: 'Sync data retrieved',
      data: {
        cases: tasks,
        changes: tasks,
        revokedAssignmentIds,
        deletedTaskIds: [],
        deletedCaseIds: [],
        conflicts: [],
        attachmentChanges: [],
        syncTimestamp: new Date().toISOString(),
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : null,
      },
    };
  },
};
