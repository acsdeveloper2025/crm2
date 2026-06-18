import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { policyController as c } from './controller.js';

/**
 * /api/v2/policies — admin CRUD for acceptance policies (ADR-0042).
 * Reads: page.policies. Writes + acceptances audit: policy.manage (SUPER_ADMIN per the seed).
 */
export const policyRoutes: Router = Router();

policyRoutes.get('/', authorize(PERMISSIONS.POLICY_VIEW), c.list);
// `/:id/acceptances` (two segments) is declared before `/:id` to keep the nested read distinct.
policyRoutes.get('/:id/acceptances', authorize(PERMISSIONS.POLICY_MANAGE), c.acceptances);
policyRoutes.get('/:id', authorize(PERMISSIONS.POLICY_VIEW), c.get);
policyRoutes.post('/', authorize(PERMISSIONS.POLICY_MANAGE), c.create);
policyRoutes.put('/:id', authorize(PERMISSIONS.POLICY_MANAGE), c.update);
policyRoutes.post('/:id/activate', authorize(PERMISSIONS.POLICY_MANAGE), c.activate);
policyRoutes.post('/:id/deactivate', authorize(PERMISSIONS.POLICY_MANAGE), c.deactivate);
