import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { rateController as c } from './controller.js';

/**
 * /api/v2/rates
 * Reads: page.masterdata. Writes: masterdata.manage (SUPER_ADMIN only).
 */
export const rateRoutes: Router = Router();

rateRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
// `/export` is a literal segment — it must precede `/:id/history` so it isn't captured as id="export".
rateRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
// Import (B-14): template download + preview/confirm upload. Gated by MASTERDATA_MANAGE — import
// CREATES rates, so it needs the same authority as `POST /`. The file is sent as raw bytes; `raw()`
// runs only on this route. Static single-segment paths, declared before `/:id/history`.
rateRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.importTemplate);
rateRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
rateRoutes.get('/:id/history', authorize(PERMISSIONS.MASTERDATA_VIEW), c.history);
// Bare `GET /:id` (D4 record-page loader, ADR-0051) — declared AFTER the static GETs (`/`, `/export`,
// `/import-template`) so it never shadows them; the two-segment `/:id/history` is a distinct path.
rateRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.get);
rateRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
// Multi-location bulk create — one client bill-rate fanned across many locations. Static path
// (single segment, no collision with `/:id/...`); per-row CREATED/EXISTS/ERROR result.
rateRoutes.post('/bulk', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkCreate);
rateRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.update);
rateRoutes.post('/:id/revise', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.revise);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
rateRoutes.post('/bulk-activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkActivate);
rateRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkDeactivate);
rateRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
rateRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
