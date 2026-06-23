import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { reportLayoutController as c } from './controller.js';

/**
 * /api/v2/report-layouts (ADR-0037, MIS engine slice 1) — per-(client,product) data-entry / MIS /
 * Billing-MIS column layouts. Admin config: EVERY route gates `report_template.manage` (SUPER_ADMIN),
 * the same admin perm as the narrative report templates. `:id` integer; update/(de)activate OCC-guarded.
 */
export const reportLayoutRoutes: Router = Router();

reportLayoutRoutes.get('/', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.list);
// `/by-config` is a literal single-segment path — declared before `/:id`.
reportLayoutRoutes.get('/by-config', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.byConfig);
// `/export` must precede `/:id` or it'd be captured as id="export". Gated TEMPLATE_MANAGE (the same
// admin perm every reportLayouts route uses — it IS the list's read perm here): the export streams the
// SAME layout rows as `GET /`, so it shares the list's audience. A bare data.export gate would WIDEN
// access. Mirrors the report-templates /export precedent.
reportLayoutRoutes.get('/export', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.export);
reportLayoutRoutes.get('/:id', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.get);
reportLayoutRoutes.post('/', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.create);
reportLayoutRoutes.put('/:id', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.update);
reportLayoutRoutes.post('/:id/activate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.activate);
reportLayoutRoutes.post('/:id/deactivate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.deactivate);
