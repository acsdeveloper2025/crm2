import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import {
  PRIORITIES,
  type CaseTaskView,
  type DeviceAttachment,
  type DeviceAttachmentUploadResult,
} from '@crm2/sdk';
import { logger } from '@crm2/logger';
import { caseRepository as repo } from '../cases/repository.js';
import { AppError } from '../../platform/errors.js';
import { detectAttachment } from '../../platform/file.js';
import { processFieldPhoto, MAX_FIELD_PHOTO_BYTES, MAX_FIELD_PHOTOS } from '../../platform/photo.js';
import { getStorage } from '../../platform/storage/index.js';
import { enqueueReverseGeocode } from '../../platform/geocode/queue.js';
import type { Actor } from '../../platform/scope/index.js';

/**
 * Field-execution service (ADR-0032 slice 2c) — the device-driven task lifecycle on `/api/v2`,
 * byte-compatible with the locked mobile contract (ADR-0012). The route grants `task.execute`
 * (FIELD_AGENT); ownership is enforced HERE: every action is bound to a task ASSIGNED to the actor
 * (out-of-ownership ≡ missing → 404, IDOR-safe). The repo writers are idempotent by state (the
 * device retries with an Idempotency-Key, no OCC version) and carry 409=success semantics on
 * start/complete/revoke (NOT priority). No result is recorded — the field submits evidence only.
 */
const MAX_REASON = 2000;
const RevokeSchema = z.object({ reason: z.string().trim().min(1).max(MAX_REASON) });
const PrioritySchema = z.object({ priority: z.enum(PRIORITIES) });

/** The LOCKED verification form-type slugs (URL path segment) the device posts — verbatim from the
 *  mobile contract (crm-mobile-native FormUploader). Pinned here so an unknown slug → 400, never a
 *  silent mis-store. Renaming/removing one breaks the device (ADR-0012). */
const FORM_TYPE_SLUGS = [
  'residence',
  'office',
  'business',
  'residence-cum-office',
  'dsa-connector',
  'builder',
  'property-individual',
  'property-apf',
  'noc',
] as const;
/** The submitted form body — evidence stored as a jsonb blob. Permissive (the device owns the inner
 *  shape: formData/attachmentIds/geoLocation/photos/metadata/verificationOutcome). The blob's
 *  `verificationOutcome`, if present, is EVIDENCE only — it never becomes the official result (D1). */
const FormSubmissionSchema = z.record(z.string(), z.unknown());
const MAX_FORM_BYTES = 262_144; // 256 KiB — a verification form is small JSON; guard against abuse

/** The task IFF assigned to this actor → its caseId; else 404 (ownership, not just the perm). */
async function ownedCaseId(taskId: string, actor: Actor): Promise<string> {
  const t = await repo.taskForAssignee(taskId, actor.userId);
  if (!t) throw AppError.notFound('TASK_NOT_FOUND');
  return t.caseId;
}

// ── Device FIELD-PHOTO upload (ADR-0034) ──
/** One parsed multipart file, decoupled from multer's type so the service stays transport-agnostic. */
export interface UploadedPhoto {
  buffer: Buffer;
  originalName: string;
  size: number;
}
interface PhotoFields {
  photoType?: string | undefined;
  operationId?: string | undefined;
  clientSha256?: string | undefined;
  geoLocation?: string | undefined;
  verificationType?: string | undefined;
  submissionId?: string | undefined;
}
const MAX_PHOTO_NAME = 255;
const UNIQUE_VIOLATION = '23505';
const SHA256_RE = /^[0-9a-f]{64}$/;
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function parseGeo(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null; // a malformed geoLocation never fails the upload — the photo is the evidence
  }
}
function uploadResult(
  attachments: DeviceAttachment[],
  failed: { filename: string; reason: string }[],
  caseId: string,
  taskId: string,
  verificationType: string | null,
  submissionId: string | null,
): DeviceAttachmentUploadResult {
  const msg = `${attachments.length} verification photo${attachments.length === 1 ? '' : 's'} uploaded`;
  return {
    success: attachments.length > 0,
    message: failed.length > 0 ? `${msg} (${failed.length} failed)` : msg,
    data: { attachments, failed, caseId, taskId, verificationType, submissionId },
  };
}

export const verificationTaskService = {
  async start(taskId: string, actor: Actor): Promise<CaseTaskView> {
    return repo.startTaskByDevice(await ownedCaseId(taskId, actor), taskId, actor.userId);
  },

  async complete(taskId: string, actor: Actor): Promise<CaseTaskView> {
    return repo.completeTaskByDevice(await ownedCaseId(taskId, actor), taskId, actor.userId);
  },

  async revoke(taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const v = RevokeSchema.parse(input);
    return repo.revokeTaskInPlace(await ownedCaseId(taskId, actor), taskId, actor.userId, v.reason);
  },

  async setPriority(taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const v = PrioritySchema.parse(input);
    return repo.setTaskPriorityByDevice(await ownedCaseId(taskId, actor), taskId, actor.userId, v.priority);
  },

  /** Submit a verification form (evidence) for the task. `formType` must be one of the LOCKED slugs
   *  (else 400). The body is stored under `form_data[formType]` — evidence only; any inner
   *  `verificationOutcome` is NOT the official result (D1). Idempotent (resubmit overwrites). */
  async submitForm(taskId: string, formType: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    if (!(FORM_TYPE_SLUGS as readonly string[]).includes(formType))
      throw AppError.badRequest('UNKNOWN_FORM_TYPE', { formType });
    const body = FormSubmissionSchema.parse(input);
    const json = JSON.stringify(body);
    if (json.length > MAX_FORM_BYTES) throw AppError.badRequest('FORM_TOO_LARGE');
    return repo.submitVerificationForm(
      await ownedCaseId(taskId, actor),
      taskId,
      actor.userId,
      formType,
      json,
    );
  },

  /** Upload field photos (ADR-0034): multipart `files[]` + the locked form fields. Ownership-bound
   *  (assigned_to = actor → 404). Idempotent by the device's operation id (a replay returns the cached
   *  rows, success=true; no re-store) — NOT 409-as-success. Each image is EXIF-stripped + thumbnailed
   *  (sharp), the stored bytes are server-hashed (evidence), the client hash is verified-or-logged
   *  (never rejected), and the row is written kind='FIELD_PHOTO'. A per-file error is collected in
   *  `failed[]` (v1 parity); only an unconfigured store (503) fails the whole request. */
  async uploadAttachments(
    taskId: string,
    files: UploadedPhoto[],
    fields: PhotoFields,
    idemKey: string | undefined,
    actor: Actor,
  ): Promise<DeviceAttachmentUploadResult> {
    const caseId = await ownedCaseId(taskId, actor);
    const operationBase = (idemKey ?? fields.operationId ?? '').trim();
    if (!operationBase) throw AppError.badRequest('IDEMPOTENCY_KEY_REQUIRED');
    const verificationType = fields.verificationType?.trim() || null;
    const submissionId = fields.submissionId?.trim() || null;

    // Idempotency replay: the device retries with the same operation id → return the cached rows.
    // NOTE: the device uploads ONE file per operation, so an upload is atomic (the pre-check sees 0
    // rows → full retry, or the 1 row → cached). RATCHET: if a multi-file batch is ever served, make
    // this resumable per index (the per-file `${base}:${i}` UNIQUE already makes per-index resume safe)
    // rather than treating ANY existing row as the whole upload being done.
    const cached = await repo.fieldAttachmentsByOperation(operationBase);
    if (cached.length > 0) return uploadResult(cached, [], caseId, taskId, verificationType, submissionId);

    if (files.length === 0) throw AppError.badRequest('NO_FILES');
    if (files.length > MAX_FIELD_PHOTOS) throw AppError.badRequest('TOO_MANY_FILES');

    const photoType = fields.photoType === 'selfie' ? 'selfie' : 'verification';
    const clientShaRaw = fields.clientSha256?.trim().toLowerCase();
    const clientSha = clientShaRaw && SHA256_RE.test(clientShaRaw) ? clientShaRaw : null;
    const geo = parseGeo(fields.geoLocation);

    const stored: DeviceAttachment[] = [];
    const failed: { filename: string; reason: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      try {
        if (f.size > MAX_FIELD_PHOTO_BYTES) throw AppError.badRequest('FILE_TOO_LARGE');
        const detected = detectAttachment(f.buffer);
        if (!detected || !detected.type.startsWith('image/'))
          throw AppError.badRequest('UNSUPPORTED_FILE_TYPE');
        // Transit check: the device's hash vs the bytes WE received (matches v1; logged, never rejected).
        const hashVerified = clientSha !== null && clientSha === sha256(f.buffer);
        if (clientSha && !hashVerified)
          logger.warn('field photo hash mismatch', { taskId, file: f.originalName });
        const { stripped, thumbnail } = await processFieldPhoto(f.buffer);
        const baseKey = `field-photos/${caseId}/${taskId}/${randomUUID()}`;
        const storageKey = `${baseKey}.${detected.ext}`;
        await getStorage().put(storageKey, stripped, detected.type); // 503 here fails the request (caught below)
        let thumbnailKey: string | null = null;
        if (thumbnail) {
          thumbnailKey = `${baseKey}.thumb.jpg`;
          await getStorage().put(thumbnailKey, thumbnail, 'image/jpeg');
        }
        const row = await repo.insertFieldAttachment(
          {
            caseId,
            taskId,
            originalName: f.originalName.slice(0, MAX_PHOTO_NAME),
            mimeType: detected.type,
            fileSize: stripped.length,
            storageKey,
            thumbnailKey,
            sha256: sha256(stripped), // evidence hash of the stored (stripped) artifact
            clientSha256: clientSha,
            hashVerified,
            geoLocation: geo,
            photoType,
            submissionId,
            verificationType,
            operationId: `${operationBase}:${i}`,
          },
          actor.userId,
        );
        stored.push(row);
      } catch (e) {
        if (e instanceof AppError && e.code === 'STORAGE_NOT_CONFIGURED') throw e; // infra — fail the request
        // A concurrent identical upload won the operation_id race → return the cached set (idempotent).
        if (typeof e === 'object' && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION) {
          const winner = await repo.fieldAttachmentsByOperation(operationBase);
          if (winner.length > 0)
            return uploadResult(winner, [], caseId, taskId, verificationType, submissionId);
        }
        // Log the real error before bucketing — a sharp/storage anomaly must leave an alertable line.
        if (!(e instanceof AppError))
          logger.warn('field photo processing failed', {
            taskId,
            file: f.originalName,
            error: e instanceof Error ? e.message : String(e),
          });
        failed.push({ filename: f.originalName, reason: e instanceof AppError ? e.code : 'PHOTO_FAILED' });
      }
    }
    // Async-on-upload reverse-geocode (ADR-0040 S4 Slice B) — FIELD_PHOTO only, fire-and-forget: a
    // missing/failed geocode never affects the upload (the photo is the evidence; on-view recovers).
    const lat = geo?.['latitude'];
    const lng = geo?.['longitude'];
    if (typeof lat === 'number' && typeof lng === 'number') {
      for (const row of stored) void enqueueReverseGeocode({ attachmentId: row.id, lat, lng });
    }

    return uploadResult(stored, failed, caseId, taskId, verificationType, submissionId);
  },
};
