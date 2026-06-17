import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { accessController as c } from './controller.js';

/**
 * /api/v2/access — read-only view of the frozen RBAC matrix.
 * Reads: page.access (SUPER_ADMIN only). No writes by design.
 */
export const accessRoutes: Router = Router();

accessRoutes.get('/matrix', authorize(PERMISSIONS.ACCESS_VIEW), c.matrix);
