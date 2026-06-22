import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { departmentController as c } from './controller.js';

/**
 * /api/v2/departments — organisational departments (User-Management sub-entity).
 * Reads: page.users. Writes: user.manage (SUPER_ADMIN only).
 */
export const departmentRoutes: Router = Router();

// `/options` and `/export` are static single-segment paths — declared before `/:id`.
departmentRoutes.get('/options', authorize(PERMISSIONS.USER_VIEW), c.options);
// Gated USER_VIEW (NOT bare data.export): the department list is `page.users` (SUPER_ADMIN-only), so
// the export must share that audience — data.export alone (held by MANAGER/TEAM_LEADER/BACKEND_USER)
// would let them export the org structure they cannot read. Mirrors the users /export precedent.
departmentRoutes.get('/export', authorize(PERMISSIONS.USER_VIEW), c.export);
// Import (B-14): create-authority gate (user.manage). Raw body runs only on this route.
departmentRoutes.get('/import-template', authorize(PERMISSIONS.USER_MANAGE), c.importTemplate);
departmentRoutes.post(
  '/import',
  authorize(PERMISSIONS.USER_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
departmentRoutes.get('/', authorize(PERMISSIONS.USER_VIEW), c.list);
departmentRoutes.post('/', authorize(PERMISSIONS.USER_MANAGE), c.create);
departmentRoutes.put('/:id', authorize(PERMISSIONS.USER_MANAGE), c.update);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
departmentRoutes.post('/bulk-activate', authorize(PERMISSIONS.USER_MANAGE), c.bulkActivate);
departmentRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.USER_MANAGE), c.bulkDeactivate);
departmentRoutes.post('/:id/activate', authorize(PERMISSIONS.USER_MANAGE), c.activate);
departmentRoutes.post('/:id/deactivate', authorize(PERMISSIONS.USER_MANAGE), c.deactivate);
