import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { tatPolicyController as c } from './controller.js';

/**
 * /api/v2/tat-policies (ADR-0044) — the configurable turnaround-time band master (4/6/8/12/24/48h).
 * Effective-dated + OCC; `:id` integer. The management routes gate `masterdata.manage` (SUPER_ADMIN),
 * like the commission-rates module; `/options` (read-only active bands for the target-TAT picker) gates
 * the broader `page.masterdata` so case-creators (e.g. MANAGER) can pick a TAT at task creation.
 */
export const tatPolicyRoutes: Router = Router();

// Static single-segment path — declared before the `/:id/...` routes.
tatPolicyRoutes.get('/options', authorize(PERMISSIONS.MASTERDATA_VIEW), c.options);
tatPolicyRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.list);
tatPolicyRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
tatPolicyRoutes.post('/:id/revise', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.revise);
tatPolicyRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
tatPolicyRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
