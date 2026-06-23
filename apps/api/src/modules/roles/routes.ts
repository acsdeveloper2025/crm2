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
// Gated ACCESS_VIEW (NOT bare data.export): the export dumps the full RBAC topology (every role's
// permission set + scope wiring) — the SAME sensitive data as `GET /` (page.access). data.export alone
// would WIDEN disclosure: MANAGER/TEAM_LEADER/BACKEND_USER hold it but cannot read roles. Mirrors the
// users /export + /scope/export precedent (export never wider than read).
roleRoutes.get('/export', authorize(PERMISSIONS.ACCESS_VIEW), c.export);
roleRoutes.get('/options', authorize(PERMISSIONS.USER_VIEW), c.options);
roleRoutes.get('/dimensions', authorize(PERMISSIONS.ACCESS_VIEW), c.dimensions);
roleRoutes.get('/', authorize(PERMISSIONS.ACCESS_VIEW), c.list);
// Single role by code (the Roles record-page loader). Read = ACCESS_VIEW (same audience as `GET /`),
// NOT role.manage — viewing a role is the read surface, not a write. Declared AFTER the static
// single-segment paths above so `/export`, `/options`, `/dimensions` are never captured as a `:code`.
roleRoutes.get('/:code', authorize(PERMISSIONS.ACCESS_VIEW), c.get);
roleRoutes.post('/', authorize(PERMISSIONS.ROLE_MANAGE), c.create);
roleRoutes.put('/:code', authorize(PERMISSIONS.ROLE_MANAGE), c.update);
roleRoutes.post('/:code/activate', authorize(PERMISSIONS.ROLE_MANAGE), c.activate);
roleRoutes.post('/:code/deactivate', authorize(PERMISSIONS.ROLE_MANAGE), c.deactivate);
roleRoutes.put('/:code/permissions', authorize(PERMISSIONS.ROLE_MANAGE), c.setPermissions);
