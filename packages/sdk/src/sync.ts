import { z } from 'zod';

/**
 * @crm2/sdk — Mobile down-sync contract (ADR-0054; the v2-native field-dispatch contract).
 * v2's `GET /api/v2/sync/download` serves a clean v2-native body to the rebuilt field app: one row
 * per task assigned to the device user, with a single canonical id (`id`) and number (`taskNumber`),
 * one free-text `address` + `addressPincode`, structured catalog refs (`client`/`product`/
 * `verificationUnit`), execution timestamps, and the delta/watermark envelope — bare, with NO v1
 * `{ success, message, data }` wrapper and NO v1 aliases/phantoms
 * (`verificationTaskId`/`verificationTaskNumber`/`title`/`description`/`addressStreet`/`addressCity`/
 * `addressState`/`isSaved`/`savedAt`/`syncStatus`/`attachments[]`/`verificationTypeDetails`).
 */

interface CatalogRef {
  id: number;
  name: string;
  code?: string;
}

/** One task as the v2-native field app consumes it (ADR-0054 — v1 aliases/phantoms removed). */
export interface MobileSyncTask {
  /** Task id — the device's task primary key. */
  id: string;
  /** Display task number, e.g. CASE-000123-1. */
  taskNumber: string;
  /** Owning case id (uuid). */
  caseId: string;
  /** Owning case display number. */
  caseNumber: string;
  customerName: string;
  customerPhone?: string;
  customerCallingCode: string;
  companyName?: string;
  applicantType: string;
  /** The single free-text visit address. */
  address: string;
  addressPincode: string;
  latitude?: number;
  longitude?: number;
  status: string;
  priority: string;
  /** The verification unit (catalog ref). */
  verificationUnit: CatalogRef;
  /** The bank trigger instruction. */
  notes?: string;
  assignedAt: string;
  updatedAt: string;
  inProgressAt?: string;
  submittedAt?: string;
  completedAt?: string;
  verificationOutcome?: string;
  formData?: Record<string, unknown>;
  backendContactNumber: string;
  createdByBackendUser?: string;
  assignedToFieldUser?: string;
  isRevoked?: boolean;
  revokedAt?: string;
  revokeReason?: string;
  revokedByName?: string;
  attachmentCount: number;
  client: CatalogRef;
  product?: CatalogRef;
}

/** The v2-native down-sync body (ADR-0054 — bare; no v1 {success,message,data} wrapper). */
export interface MobileSyncDownload {
  tasks: MobileSyncTask[];
  /** Assignments the device must purge (reassigned/unassigned away). */
  revokedAssignmentIds: string[];
  /** The watermark the device persists as last_download_sync_at. */
  syncTimestamp: string;
  hasMore: boolean;
  nextCursor: string | null;
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

/** v2-native (ADR-0054) — the bare upload result; no v1 {success,message,data} wrapper. Always 200
 *  (new + replay); the device reads `failed` to detect partial/total failure. */
export interface DeviceAttachmentUploadResult {
  attachments: DeviceAttachment[];
  failed: { filename: string; reason: string }[];
  caseId: string;
  taskId: string;
  verificationType: string | null;
  submissionId: string | null;
}

/**
 * GET /api/v2/verification-tasks/:id/attachments — the office REFERENCE docs the device shows the
 * agent for an owned task (the device labels these REMOTE / "Source: Backend/Web"). v2-native: a bare
 * array (no v1 {success,data} wrapper).
 */
export interface DeviceTaskAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  /** Absolute, time-limited presigned URL to fetch the document bytes — the device fetches it directly
   *  (its URL normalizer passes http(s) through unchanged; a relative path would be mis-prefixed). */
  url: string;
  uploadedAt: string;
}

/** v2-native (ADR-0054) — a bare array of the office reference docs. */
export type DeviceTaskAttachmentList = DeviceTaskAttachment[];
