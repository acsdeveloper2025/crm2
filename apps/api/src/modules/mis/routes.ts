import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { misController as c } from './controller.js';

/**
 * MIS routes (ADR-0084). All gated by `mis.view` (incl. the catalog, so field-name schema isn't
 * exposed unauthed). Export + summary land in later slices. The literal `/report-types` is declared
 * before `/:type/rows` (distinct path shapes, but order-safe).
 */
export const misRoutes: Router = Router();

misRoutes.get('/report-types', authorize(PERMISSIONS.MIS_VIEW), c.reportTypes);
misRoutes.get('/:type/rows', authorize(PERMISSIONS.MIS_VIEW), c.rows);
