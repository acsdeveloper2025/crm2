import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { productController as c } from './controller.js';

/**
 * /api/v2/products
 * Reads: page.masterdata. Writes: masterdata.manage (SUPER_ADMIN only).
 */
export const productRoutes: Router = Router();

productRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
// `/options` + `/export` must precede `/:id` or they'd be captured as id="options"/"export".
productRoutes.get('/options', authorize(PERMISSIONS.MASTERDATA_VIEW), c.options);
// Gated MASTERDATA_VIEW (NOT data.export) — an export carries the SAME rows as its list, so it must
// share the list's audience (same rule as `/billing/lines/export`). `data.export` is held by roles
// without `page.masterdata` (BACKEND_USER / TEAM_LEADER / FIELD_TEAM_LEADER), which would let them
// exfiltrate the whole catalogue they cannot open. Every MASTERDATA_VIEW holder also holds
// data.export, so no legitimate access is lost.
productRoutes.get('/export', authorize(PERMISSIONS.MASTERDATA_VIEW), c.export);
// Import (B-14): gated by MASTERDATA_MANAGE (import CREATES master data → same authority as POST /).
// Raw file bytes (no multipart dep); `raw()` runs only on this route. Static paths before `/:id`.
productRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.importTemplate);
productRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
productRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.get);
productRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
productRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.update);
// Bulk routes are static single-segment paths — no collision with `/:id/...`.
productRoutes.post('/bulk-activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkActivate);
productRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkDeactivate);
productRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
productRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
