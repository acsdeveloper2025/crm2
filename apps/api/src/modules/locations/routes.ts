import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { locationController as c } from './controller.js';

/**
 * /api/v2/locations
 * Reads: page.masterdata. Writes: masterdata.manage (SUPER_ADMIN only).
 */
export const locationRoutes: Router = Router();

locationRoutes.get('/pincodes', authorize(PERMISSIONS.MASTERDATA_VIEW), c.pincodes);
// `/export` must precede `/:id` or it'd be captured as id="export".
locationRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
// Import (B-14): template download + preview/confirm upload. Gated by MASTERDATA_MANAGE — import
// CREATES master data, so it needs the same authority as `POST /` (never a weaker generic perm).
// The file is sent as raw bytes (no multipart dep); `raw()` runs only on this route (global json()
// skips non-JSON bodies). Static single-segment paths, declared before `/:id`.
locationRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.importTemplate);
locationRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
locationRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
locationRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
// Multi-area create: one pincode/city/state + N areas → N rows. Static path, before `/:id`.
locationRoutes.post('/batch', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.createBatch);
locationRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.update);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
locationRoutes.post('/bulk-activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkActivate);
locationRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkDeactivate);
locationRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
locationRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
