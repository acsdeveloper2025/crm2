import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { misController as c } from './controller.js';

/**
 * /api/v2/mis — layout-driven MIS read-model (ADR-0037). Gated `page.mis`. Money columns
 * (RATE_AMOUNT / COMMISSION_AMOUNT) are silently dropped for actors without `billing.view`;
 * the route is NOT gated on billing.view — non-billing MIS viewers still get their columns.
 */
export const misRoutes: Router = Router();

misRoutes.get('/export', authorize(PERMISSIONS.MIS_VIEW), c.export);
misRoutes.get('/rows', authorize(PERMISSIONS.MIS_VIEW), c.rows);
