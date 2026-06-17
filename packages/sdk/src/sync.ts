import { z } from 'zod';

/**
 * @crm2/sdk — Mobile down-sync contract (ADR-0012; the LOCKED field-dispatch contract,
 * docs/specs/2026-06-11-v1-zion-case-task-creation-audit.md §3). v2's `GET /api/v2/sync/download`
 * serves this byte-compatibly to the UNMODIFIED field app: one row per task assigned to the
 * device user, in the v1 `MobileCaseResponse` shape, wrapped in `{ success, message, data }`.
 *
 * Only `id` and `caseId` are hard-required on the device (sync.schema); every other field is
 * optional with a safe default. Fields v2 does not store yet (execution timestamps, formData,
 * attachments) are emitted as undefined/empty — exactly as v1 does on the wire today.
 */

interface CatalogRef {
  id: number;
  name: string;
  code?: string;
}

/** One task as the field app consumes it (mirrors crm-mobile-native `src/types/api.ts`). */
export interface MobileSyncTask {
  id: string;
  caseId: string | number;
  title: string;
  description: string;
  customerName: string;
  customerCallingCode?: string;
  customerPhone?: string;
  /** Targeted applicant's employer/company (case_applicants.company_name); omitted when absent. */
  companyName?: string;
  addressStreet: string;
  /** Phantom fields — v1 sends these empty (no source columns); kept for byte-compat. */
  addressCity: string;
  addressState: string;
  addressPincode: string;
  status: string;
  priority: string;
  assignedAt: string;
  /** The delta watermark driver. */
  updatedAt: string;
  completedAt?: string;
  /** The bank trigger instruction (device renders it as `notes`). */
  notes?: string;
  verificationType?: string;
  verificationOutcome?: string;
  applicantType?: string;
  backendContactNumber?: string;
  createdByBackendUser?: string;
  assignedToFieldUser?: string;
  verificationTaskId?: string;
  verificationTaskNumber?: string;
  isRevoked?: boolean;
  inProgressAt?: string;
  savedAt?: string;
  isSaved?: boolean;
  attachmentCount?: number;
  client: CatalogRef;
  product?: CatalogRef;
  verificationTypeDetails?: CatalogRef;
  attachments?: unknown[];
  formData?: Record<string, unknown>;
  syncStatus?: 'SYNCED' | 'PENDING' | 'CONFLICT';
}

/** The `data` envelope: `cases` and `changes` are the SAME array (v1 semantics). */
export interface MobileSyncDownload {
  cases: MobileSyncTask[];
  changes: MobileSyncTask[];
  /** Assignments the device must purge (revoked / no longer the user's). */
  revokedAssignmentIds: string[];
  deletedTaskIds: string[];
  deletedCaseIds: string[];
  conflicts: unknown[];
  attachmentChanges: unknown[];
  /** The watermark the device persists as `last_download_sync_at`. */
  syncTimestamp: string;
  hasMore: boolean;
  nextCursor: string | null;
}

/** The wire response — v1-compatible `{ success, message, data }` (NOT the v2 list envelope). */
export interface MobileSyncResponse {
  success: boolean;
  message: string;
  data: MobileSyncDownload;
}

const positiveInt = z.number().int().positive();
export const SyncDownloadQuerySchema = z.object({
  lastSyncTimestamp: z.string().optional(),
  limit: positiveInt.optional(),
  offset: z.number().int().min(0).optional(),
});
export type SyncDownloadQuery = z.infer<typeof SyncDownloadQuerySchema>;

/**
 * Device FIELD-PHOTO upload (ADR-0034). The device POSTs multipart `files[]` + form fields
 * (photoType/operationId/clientSha256/geoLocation/verificationType/submissionId) + an `Idempotency-Key`
 * header to `/api/v2/verification-tasks/:id/attachments`; the response is the LOCKED `{success,message,
 * data}` envelope (the device's shape), NOT the v2 list envelope. A replay (same operation id) returns
 * the cached rows with success=true. One stored photo:
 */
export interface DeviceAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  photoType: string;
  /** Captured geo at the photo — { latitude, longitude, accuracy, timestamp } or null. */
  geoLocation: Record<string, unknown> | null;
  /** Object-storage key of the stored (EXIF-stripped) photo. */
  url: string;
  /** Object-storage key of the 200×200 thumbnail, or null if thumbnailing failed. */
  thumbnailUrl: string | null;
  uploadedAt: string;
}

export interface DeviceAttachmentUploadResult {
  success: boolean;
  message: string;
  data: {
    attachments: DeviceAttachment[];
    failed: { filename: string; reason: string }[];
    caseId: string;
    taskId: string;
    verificationType: string | null;
    submissionId: string | null;
  };
}
