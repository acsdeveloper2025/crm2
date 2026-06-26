import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { clientProductController as cp, cpvUnitController as cpv } from './controller.js';

/**
 * /api/v2/client-products — a product enabled for a client.
 * /api/v2/cpv-units       — a verification unit enabled for a client-product.
 * Reads: page.masterdata. Writes: masterdata.manage (SUPER_ADMIN only).
 */
export const clientProductRoutes: Router = Router();
clientProductRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), cp.list);
// `/export` + `/import` declared before the `/:id` param routes (IMPORT_EXPORT_STANDARD route order).
clientProductRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), cp.export);
// Import (B-14): template download + preview/confirm upload. Gated by MASTERDATA_MANAGE — import
// CREATES links, so it needs the same authority as `POST /`. The file is raw bytes; `raw()` is
// route-scoped so the global json() parser is untouched.
clientProductRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), cp.importTemplate);
clientProductRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  cp.import,
);
clientProductRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), cp.create);
clientProductRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), cp.update);
clientProductRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), cp.activate);
clientProductRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), cp.deactivate);

export const cpvUnitRoutes: Router = Router();
cpvUnitRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), cpv.list);
// ADR-0074: CPV-scoped available units for a client+product (Universal CPV ⇒ all units) — feeds the config
// unit pickers (rate-type-assignment / commission / rate-management). Static path, before `/:id`.
cpvUnitRoutes.get('/available', authorize(PERMISSIONS.MASTERDATA_VIEW), cpv.available);
// `/export` + `/import` declared before the `/:id` param routes (IMPORT_EXPORT_STANDARD route order).
// Gates IDENTICAL to the clientProduct leg: export=DATA_EXPORT, import=MASTERDATA_MANAGE (import
// CREATES enablements, so it needs the same authority as `POST /`). The file is raw bytes; `raw()`
// is route-scoped so the global json() parser is untouched.
cpvUnitRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), cpv.export);
cpvUnitRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), cpv.importTemplate);
cpvUnitRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  cpv.import,
);
cpvUnitRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), cpv.create);
cpvUnitRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), cpv.update);
cpvUnitRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), cpv.activate);
cpvUnitRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), cpv.deactivate);
