import { Router, raw } from 'express';
import multer from 'multer';
import { authorize, PERMISSIONS } from '@crm2/access';
import { userController as c } from './controller.js';
import { MAX_IMAGE_BYTES } from '../../platform/image.js';
// Session data lives in the auth domain (auth_refresh_tokens); the admin view/revoke endpoints are
// mounted here under /users/:id but delegate to the auth controller (slice 6).
import { authController } from '../auth/controller.js';
// Generic scope assignment (ADR-0022) — mounted under /users/:id, delegates to its module.
import { scopeAssignmentController } from '../scopeAssignments/controller.js';

/**
 * /api/v2/users — admin user identity management.
 * Reads: page.users. Writes: user.manage (SUPER_ADMIN only).
 */
export const userRoutes: Router = Router();

// Profile-photo upload accepts BOTH transports (ADR-0011 additive): the mobile app POSTs
// multipart/form-data with a `photo` field, the web/admin caller POSTs the raw image bytes
// (application/octet-stream). multer (memory-storage, same pattern as verification-tasks) parses a
// multipart body into `req.file`; on a NON-multipart request it passes through without consuming the
// stream, so `raw()` (next in the chain) still captures the raw bytes. The controller reads
// `req.file?.buffer` first, else falls back to the raw `req.body` Buffer.
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

userRoutes.get('/', authorize(PERMISSIONS.USER_VIEW), c.list);
// `/options` precedes the param routes — the reports-to picker reads it (B-22).
userRoutes.get('/options', authorize(PERMISSIONS.USER_VIEW), c.options);
// `/export` must precede the `/:id` param routes or it'd be captured as id="export".
userRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
// Import (B-14): template download + preview/confirm upload. Gated by USER_MANAGE — import CREATES
// users, so it needs the same authority as `POST /` (never a weaker generic perm). The file is sent
// as raw bytes (no multipart dep); `raw()` runs only on this route (global json() skips non-JSON
// bodies). Static single-segment paths, declared before `/:id`.
userRoutes.get('/import-template', authorize(PERMISSIONS.USER_MANAGE), c.importTemplate);
userRoutes.post(
  '/import',
  authorize(PERMISSIONS.USER_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
userRoutes.post('/', authorize(PERMISSIONS.USER_MANAGE), c.create);
// Self-service "my account" — any authenticated user edits only their OWN profile (no USER_MANAGE).
// The acting id is read from the session, so there is no IDOR surface. These static `/me/...` paths
// MUST precede the `/:id/...` param routes below, or `id` would capture "me" (→ a 400 on a non-uuid).
// Photo bytes ride as multipart `photo` (mobile) OR the raw body (web/admin) — see `photoUpload` above.
userRoutes.get('/me/profile', c.meProfile);
userRoutes.patch('/me/profile', c.meUpdateProfile);
userRoutes.get('/me/photo-url', c.mePhotoUrl);
userRoutes.post(
  '/me/photo',
  photoUpload.single('photo'),
  raw({ type: () => true, limit: '6mb' }),
  c.meUploadPhoto,
);
userRoutes.put('/:id', authorize(PERMISSIONS.USER_MANAGE), c.update);
userRoutes.post('/:id/password', authorize(PERMISSIONS.USER_MANAGE), c.setPassword);
// Admin "generate one-time password" (plaintext returned once) + "unlock" (clear a lockout).
userRoutes.post('/:id/generate-temp-password', authorize(PERMISSIONS.USER_MANAGE), c.generateTempPassword);
userRoutes.post('/:id/unlock', authorize(PERMISSIONS.USER_MANAGE), c.unlock);
// Profile photo (slice 7): upload an image as multipart `photo` (mobile) OR raw bytes (web/admin) —
// see `photoUpload` above — + read a signed URL. USER_MANAGE — editing a user's profile is the same
// authority as POST /.
userRoutes.post(
  '/:id/photo',
  authorize(PERMISSIONS.USER_MANAGE),
  photoUpload.single('photo'),
  raw({ type: () => true, limit: '6mb' }),
  c.uploadPhoto,
);
userRoutes.get('/:id/photo-url', authorize(PERMISSIONS.USER_MANAGE), c.photoUrl);
// Admin session management (slice 6): view/revoke another user's active sessions. USER_MANAGE.
userRoutes.get('/:id/sessions', authorize(PERMISSIONS.USER_MANAGE), authController.adminListSessions);
userRoutes.post(
  '/:id/sessions/:jti/revoke',
  authorize(PERMISSIONS.USER_MANAGE),
  authController.adminRevokeSession,
);
// Generic scope assignment (ADR-0022 slice 3): one surface for every dimension (territory,
// portfolio, …). What a user may hold is the target ROLE's admin-edited dimension wiring.
// ACCESS_SCOPE_ASSIGN = SUPER_ADMIN ONLY — only an admin sets a user's data-access scope.
const T = PERMISSIONS.ACCESS_SCOPE_ASSIGN;
userRoutes.get('/:id/scope-assignments', authorize(T), scopeAssignmentController.get);
userRoutes.post('/:id/scope-assignments', authorize(T), scopeAssignmentController.add);
userRoutes.delete('/:id/scope-assignments/:assignmentId', authorize(T), scopeAssignmentController.remove);
// Bulk assignment (IMPORT_EXPORT_STANDARD): spreadsheet import + all-assignments export. Static
// two-segment paths — no collision with the `/:id/...` patterns above.
userRoutes.get('/scope/import-template', authorize(T), scopeAssignmentController.importTemplate);
userRoutes.post(
  '/scope/import',
  authorize(T),
  raw({ type: () => true, limit: '10mb' }),
  scopeAssignmentController.import,
);
// the export dumps the FULL access-control topology — same authority as reading/assigning it
// (data.export alone would WIDEN access: MANAGER/TL/BE hold it but cannot read assignments).
userRoutes.get('/scope/export', authorize(T), scopeAssignmentController.export);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
userRoutes.post('/bulk-activate', authorize(PERMISSIONS.USER_MANAGE), c.bulkActivate);
userRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.USER_MANAGE), c.bulkDeactivate);
userRoutes.post('/:id/activate', authorize(PERMISSIONS.USER_MANAGE), c.activate);
userRoutes.post('/:id/deactivate', authorize(PERMISSIONS.USER_MANAGE), c.deactivate);
