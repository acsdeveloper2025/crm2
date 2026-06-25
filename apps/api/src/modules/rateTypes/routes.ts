import { Router } from 'express';
import { authorize, authorizeAny, PERMISSIONS } from '@crm2/access';
import { rateTypeController as c } from './controller.js';

/**
 * /api/v2/rate-types — managed rate-type catalog (ADR-0064).
 * View: page.masterdata (MASTERDATA_VIEW). Manage: masterdata.manage (MASTERDATA_MANAGE).
 */
export const rateTypeRoutes: Router = Router();

// Static single-segment paths declared before `/:id` (else captured as an id).
rateTypeRoutes.get('/options', authorize(PERMISSIONS.MASTERDATA_VIEW), c.options);
// `available` is reachable by master-data viewers (Rate Mgmt) AND case creators (creation preview).
rateTypeRoutes.get(
  '/available',
  authorizeAny(PERMISSIONS.MASTERDATA_VIEW, PERMISSIONS.CASE_CREATE),
  c.available,
);
rateTypeRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
rateTypeRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.findById);
rateTypeRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
rateTypeRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.update);
rateTypeRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
rateTypeRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
