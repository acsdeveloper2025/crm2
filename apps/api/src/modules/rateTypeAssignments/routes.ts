import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { rateTypeAssignmentController as c } from './controller.js';

/**
 * /api/v2/rate-type-assignments — per-(client × product × verification_unit) rate-type availability
 * (ADR-0067 / ADR-0069). GET / lists a (client × product|Universal)'s assignments across all units.
 * View: page.masterdata. Manage (bulk-set): masterdata.manage.
 */
export const rateTypeAssignmentRoutes: Router = Router();

rateTypeAssignmentRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.listForClientProduct);
rateTypeAssignmentRoutes.post('/bulk', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkSet);
