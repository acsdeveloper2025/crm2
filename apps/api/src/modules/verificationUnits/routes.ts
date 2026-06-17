import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { verificationUnitController as c } from './controller.js';

/**
 * /api/v2/verification-units
 * Reads: page.masterdata. Writes: verification_unit.manage (SUPER_ADMIN only, per the seed).
 */
export const verificationUnitRoutes: Router = Router();

verificationUnitRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
// `/options` + `/export` must precede `/:id` or they'd be captured as id="options"/"export".
verificationUnitRoutes.get('/options', authorize(PERMISSIONS.MASTERDATA_VIEW), c.options);
verificationUnitRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
// Import (B-14): template download + preview/confirm upload. Gated by VERIFICATION_UNIT_MANAGE —
// import CREATES units, so it needs the same authority as `POST /`. The file is sent as raw bytes;
// `raw()` runs only on this route. Static single-segment paths, declared before `/:id`.
verificationUnitRoutes.get(
  '/import-template',
  authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE),
  c.importTemplate,
);
verificationUnitRoutes.post(
  '/import',
  authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
verificationUnitRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.get);
verificationUnitRoutes.post('/', authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE), c.create);
verificationUnitRoutes.put('/:id', authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE), c.update);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
verificationUnitRoutes.post(
  '/bulk-activate',
  authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE),
  c.bulkActivate,
);
verificationUnitRoutes.post(
  '/bulk-deactivate',
  authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE),
  c.bulkDeactivate,
);
verificationUnitRoutes.post('/:id/activate', authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE), c.activate);
verificationUnitRoutes.post('/:id/deactivate', authorize(PERMISSIONS.VERIFICATION_UNIT_MANAGE), c.deactivate);
