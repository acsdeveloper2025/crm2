import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { authorize, PERMISSIONS } from '@crm2/access';
import { verificationTaskController as c } from './controller.js';
import { AppError } from '../../platform/errors.js';
import { MAX_FIELD_PHOTO_BYTES, MAX_FIELD_PHOTOS } from '../../platform/photo.js';

/**
 * /api/v2/verification-tasks — the field app's device-driven task lifecycle (ADR-0032 slice 2c),
 * mapping the locked mobile contract paths onto /api/v2. All gated `task.execute` (FIELD_AGENT);
 * the service binds ownership (assigned_to = actor). `:id` = the task UUID.
 */
export const verificationTaskRoutes: Router = Router();

// Device FIELD-PHOTO upload (ADR-0034): multer in memory-storage (bytes → the ADR-0021 storage seam,
// never disk), bounded count + per-file size. A multer rejection (oversize/too-many) → a clean 400.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FIELD_PHOTO_BYTES, files: MAX_FIELD_PHOTOS },
});
function parseFieldPhotos(req: Request, res: Response, next: NextFunction): void {
  photoUpload.array('files', MAX_FIELD_PHOTOS)(req, res, (err: unknown) => {
    if (err)
      return next(
        AppError.badRequest('UPLOAD_REJECTED', {
          reason: err instanceof Error ? err.message : 'multipart parse failed',
        }),
      );
    next();
  });
}

verificationTaskRoutes.post('/:id/start', authorize(PERMISSIONS.TASK_EXECUTE), c.start);
// Verification form submit (evidence) — :formType is one of the locked slugs (validated in service).
verificationTaskRoutes.post('/:id/verification/:formType', authorize(PERMISSIONS.TASK_EXECUTE), c.submitForm);
// Device FIELD-PHOTO upload (ADR-0034) — multipart files[] + locked form fields + Idempotency-Key.
verificationTaskRoutes.post(
  '/:id/attachments',
  authorize(PERMISSIONS.TASK_EXECUTE),
  parseFieldPhotos,
  c.uploadAttachments,
);
verificationTaskRoutes.post('/:id/complete', authorize(PERMISSIONS.TASK_EXECUTE), c.complete);
verificationTaskRoutes.post('/:id/revoke', authorize(PERMISSIONS.TASK_EXECUTE), c.revoke);
verificationTaskRoutes.put('/:id/priority', authorize(PERMISSIONS.TASK_EXECUTE), c.setPriority);
// List the office reference docs for an owned task (mobile parity) — read; same task.execute gate.
verificationTaskRoutes.get('/:id/attachments', authorize(PERMISSIONS.TASK_EXECUTE), c.listAttachments);
// One reference doc's bytes — the device's authenticated download (its presigned fetch sends a
// Bearer header, which S3/MinIO rejects as mixed auth; the app's fallback already targets this route).
verificationTaskRoutes.get(
  '/:id/attachments/:attachmentId',
  authorize(PERMISSIONS.TASK_EXECUTE),
  c.attachmentContent,
);
