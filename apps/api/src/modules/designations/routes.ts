import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { designationController as c } from './controller.js';

/**
 * /api/v2/designations — job designations (User-Management sub-entity).
 * Reads: page.users. Writes: user.manage (SUPER_ADMIN only).
 */
export const designationRoutes: Router = Router();

// `/options` and `/export` are static single-segment paths — declared before `/:id`.
designationRoutes.get('/options', authorize(PERMISSIONS.USER_VIEW), c.options);
designationRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
designationRoutes.get('/import-template', authorize(PERMISSIONS.USER_MANAGE), c.importTemplate);
designationRoutes.post(
  '/import',
  authorize(PERMISSIONS.USER_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
designationRoutes.get('/', authorize(PERMISSIONS.USER_VIEW), c.list);
designationRoutes.post('/', authorize(PERMISSIONS.USER_MANAGE), c.create);
designationRoutes.put('/:id', authorize(PERMISSIONS.USER_MANAGE), c.update);
designationRoutes.post('/bulk-activate', authorize(PERMISSIONS.USER_MANAGE), c.bulkActivate);
designationRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.USER_MANAGE), c.bulkDeactivate);
designationRoutes.post('/:id/activate', authorize(PERMISSIONS.USER_MANAGE), c.activate);
designationRoutes.post('/:id/deactivate', authorize(PERMISSIONS.USER_MANAGE), c.deactivate);
