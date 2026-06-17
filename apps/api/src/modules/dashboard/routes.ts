import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { dashboardController as c } from './controller.js';

/**
 * /api/v2/dashboard — read-only operations overview (ADR-0029). One scoped scan per load gives the
 * pipeline counter bar + today's throughput/trend + aging of open work, filtered to the actor's
 * hierarchy. Gated by `page.dashboard` (every web role except FIELD_AGENT); scope-enforced in the
 * repository via the shared task-scope seam (IDOR-safe — an out-of-scope task is never counted).
 */
export const dashboardRoutes: Router = Router();

dashboardRoutes.get('/stats', authorize(PERMISSIONS.DASHBOARD_VIEW), c.stats);
// Portfolio rollup (client × product) — a dashboard view, not a billing one. Gated by the same
// `page.dashboard` as the rest of the dashboard and SCOPE-enforced in the repository (resolveScope →
// caseScopePredicate), so each role sees its own slice: a backend user their assigned client/product,
// a TL their team's, a manager their subtree's, an admin all. (Was billing.generate — too narrow.)
dashboardRoutes.get('/portfolio', authorize(PERMISSIONS.DASHBOARD_VIEW), c.portfolio);
