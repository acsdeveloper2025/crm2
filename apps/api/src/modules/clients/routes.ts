import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { clientController as c } from './controller.js';

/**
 * /api/v2/clients
 * Reads: page.masterdata. Writes: masterdata.manage (SUPER_ADMIN only).
 */
export const clientRoutes: Router = Router();

clientRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
// `/options` + `/export` must precede `/:id` or they'd be captured as id="options"/"export".
clientRoutes.get('/options', authorize(PERMISSIONS.MASTERDATA_VIEW), c.options);
clientRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
// Import (B-14): template download + preview/confirm upload. Gated by MASTERDATA_MANAGE — import
// CREATES master data, so it needs the same authority as `POST /` (never a weaker generic perm).
// The file is sent as raw bytes (no multipart dep); `raw()` runs only on this route (global json()
// skips non-JSON bodies). Static single-segment paths, declared before `/:id`.
clientRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.importTemplate);
clientRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
clientRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.get);
// Client Setup onboarding workbook (ADR-0092 S4) — multi-segment, no clash with `GET /:id`.
clientRoutes.get('/:id/onboarding-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.onboardingTemplate);
clientRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
clientRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.update);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
clientRoutes.post('/bulk-activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkActivate);
clientRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkDeactivate);
clientRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
clientRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
