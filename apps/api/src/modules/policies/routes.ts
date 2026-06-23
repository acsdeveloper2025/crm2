import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { policyController as c } from './controller.js';

/**
 * /api/v2/policies — admin CRUD for the policy content/version master (ADR-0043).
 * Reads: page.policies. Writes: policy.manage (SUPER_ADMIN per the seed). Acceptances live in the
 * shared `consents` store and are recorded via POST /api/v2/consents/accept.
 */
export const policyRoutes: Router = Router();

policyRoutes.get('/', authorize(PERMISSIONS.POLICY_VIEW), c.list);
// `/export` must precede `/:id` (and `/users/...`) or it'd be captured as id="export".
// Gated POLICY_VIEW (NOT bare data.export): the export streams the SAME policy rows as `GET /`
// (page.policies), so it must share the list's audience. data.export alone would WIDEN access —
// MANAGER/TEAM_LEADER/BACKEND_USER hold it but cannot read policies. Mirrors report-templates /export.
policyRoutes.get('/export', authorize(PERMISSIONS.POLICY_VIEW), c.export);
// Admin: a user's policy-acceptance log. Mounted BEFORE /:id so the literal `users` segment doesn't
// collide with the numeric :id path-param. Gated by page.users (user-management surface).
policyRoutes.get('/users/:userId/acceptances', authorize(PERMISSIONS.USER_VIEW), c.acceptancesForUser);
policyRoutes.get('/:id', authorize(PERMISSIONS.POLICY_VIEW), c.get);
policyRoutes.post('/', authorize(PERMISSIONS.POLICY_MANAGE), c.create);
policyRoutes.put('/:id', authorize(PERMISSIONS.POLICY_MANAGE), c.update);
policyRoutes.post('/:id/activate', authorize(PERMISSIONS.POLICY_MANAGE), c.activate);
policyRoutes.post('/:id/deactivate', authorize(PERMISSIONS.POLICY_MANAGE), c.deactivate);
