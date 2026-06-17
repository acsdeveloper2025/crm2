import { Router } from 'express';
import { savedViewController as c } from './controller.js';

/**
 * /api/v2/saved-views — per-user named DataGrid views (B-5, DATAGRID_STANDARD §10). No permission
 * gate: every authenticated user manages their OWN views (scope is identity, like /notifications and
 * /jobs). The controller 401s when unauthenticated; a `:id` that isn't the caller's 404s (IDOR-safe).
 */
export const savedViewRoutes: Router = Router();

savedViewRoutes.get('/', c.list); // ?resourceKey=<grid>
savedViewRoutes.post('/', c.create);
savedViewRoutes.post('/:id/set-default', c.setDefault);
savedViewRoutes.put('/:id', c.update);
savedViewRoutes.delete('/:id', c.remove);
