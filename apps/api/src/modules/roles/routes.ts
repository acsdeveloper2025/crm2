import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { roleController as c } from './controller.js';

/**
 * /api/v2/roles — role configuration (ADR-0022). Reads: page.access (the Roles/Access screen);
 * `/options` additionally serves the user form (page.users). Writes: role.manage (SUPER_ADMIN
 * via grants_all; grantable only through this same surface).
 */
export const roleRoutes: Router = Router();

// static single-segment paths precede `/:code`
roleRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
roleRoutes.get('/options', authorize(PERMISSIONS.USER_VIEW), c.options);
roleRoutes.get('/dimensions', authorize(PERMISSIONS.ACCESS_VIEW), c.dimensions);
roleRoutes.get('/', authorize(PERMISSIONS.ACCESS_VIEW), c.list);
roleRoutes.post('/', authorize(PERMISSIONS.ROLE_MANAGE), c.create);
roleRoutes.put('/:code', authorize(PERMISSIONS.ROLE_MANAGE), c.update);
roleRoutes.post('/:code/activate', authorize(PERMISSIONS.ROLE_MANAGE), c.activate);
roleRoutes.post('/:code/deactivate', authorize(PERMISSIONS.ROLE_MANAGE), c.deactivate);
roleRoutes.put('/:code/permissions', authorize(PERMISSIONS.ROLE_MANAGE), c.setPermissions);
