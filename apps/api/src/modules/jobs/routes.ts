import { Router } from 'express';
import { jobController as c } from './controller.js';

/**
 * /api/v2/jobs — the background-job tray (ADR-0030). No permission gate: every authenticated user
 * reads their OWN jobs (scope is identity, like /auth/me and /notifications). The controller 401s when
 * unauthenticated; `:id` 404s for a non-owner.
 */
export const jobRoutes: Router = Router();

jobRoutes.get('/', c.list);
jobRoutes.get('/:id/result-url', c.resultUrl); // declared before /:id (Express matches in order)
jobRoutes.get('/:id', c.get);
