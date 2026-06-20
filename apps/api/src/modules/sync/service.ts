import { SyncDownloadQuerySchema, type MobileSyncDownload, type MobileSyncTask } from '@crm2/sdk';
import { syncRepository as repo, type SyncTaskRow } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const WATERMARK_DAYS = 30;
const MS_PER_DAY = 86_400_000;

const iso = (d: string | Date): string => new Date(d).toISOString();

/** Map a flat assigned-task row to the v2-native `MobileSyncTask` shape (ADR-0054). */
function toMobileTask(r: SyncTaskRow): MobileSyncTask {
  return {
    id: r.id,
    taskNumber: r.taskNumber,
    caseId: r.caseId,
    caseNumber: r.caseNumber,
    customerName: r.customerName,
    customerCallingCode: r.customerCallingCode,
    ...(r.customerPhone ? { customerPhone: r.customerPhone } : {}),
    ...(r.companyName ? { companyName: r.companyName } : {}),
    applicantType: r.applicantType,
    address: r.address,
    addressPincode: r.addressPincode ?? '',
    ...(r.latitude != null ? { latitude: Number(r.latitude) } : {}),
    ...(r.longitude != null ? { longitude: Number(r.longitude) } : {}),
    status: r.status,
    priority: r.priority,
    verificationUnit: { id: r.unitId, name: r.unitName, code: r.unitCode },
    ...(r.trigger ? { notes: r.trigger } : {}),
    assignedAt: iso(r.assignedAt ?? r.updatedAt),
    updatedAt: iso(r.updatedAt),
    ...(r.startedAt ? { inProgressAt: iso(r.startedAt) } : {}),
    ...(r.submittedAt ? { submittedAt: iso(r.submittedAt) } : {}),
    ...(r.completedAt ? { completedAt: iso(r.completedAt) } : {}),
    ...(r.verificationOutcome ? { verificationOutcome: r.verificationOutcome } : {}),
    ...(r.formData ? { formData: r.formData } : {}),
    backendContactNumber: r.backendContactNumber,
    ...(r.createdByName ? { createdByBackendUser: r.createdByName } : {}),
    ...(r.assignedToName ? { assignedToFieldUser: r.assignedToName } : {}),
    ...(r.status === 'REVOKED'
      ? {
          isRevoked: true,
          revokedAt: iso(r.updatedAt),
          ...(r.remark ? { revokeReason: r.remark } : {}),
          ...(r.revisedByName ? { revokedByName: r.revisedByName } : {}),
        }
      : {}),
    attachmentCount: r.attachmentCount,
    client: { id: r.clientId, name: r.clientName, code: r.clientCode },
    product: { id: r.productId, name: r.productName, code: r.productCode },
  };
}

export const syncService = {
  /**
   * Down-sync for the field device (ADR-0054). Returns the v2-native BARE body — `{ tasks,
   * revokedAssignmentIds, syncTimestamp, hasMore, nextCursor }` — with no v1 `{ success, message, data }`
   * wrapper. `tasks` is the assigned-task page. `revokedAssignmentIds` carries tasks the device was
   * assigned but no longer is (reassigned/unassigned away) so the device purges the orphans (a revoked
   * task that is still the user's flows via `tasks` with `isRevoked = true`, not a purge). The delta is
   * computed only on the first page (offset 0): the device restarts every cycle at offset 0, and the
   * device-side purge is idempotent + `recentlyCleaned`-deduped, so repeating it per page is wasteful.
   */
  async download(rawQuery: Record<string, unknown>, actor: Actor): Promise<MobileSyncDownload> {
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
      tasks,
      revokedAssignmentIds,
      syncTimestamp: new Date().toISOString(),
      hasMore,
      nextCursor: hasMore ? String(offset + limit) : null,
    };
  },
};
