import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { rateTypeController as c } from './controller.js';

/** /api/v2/rate-types — read-only managed rate-type list for the rate dropdown. */
export const rateTypeRoutes: Router = Router();

rateTypeRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
