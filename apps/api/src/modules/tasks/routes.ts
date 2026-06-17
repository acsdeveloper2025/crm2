import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { taskController as c } from './controller.js';

/**
 * /api/v2/tasks — Pipeline, the operational task queue (every case_task across all cases, scoped
 * at TASK level per ADR-0022). Reads: case.view. Export: data.export. Static paths only (no /:id
 * detail — a task is opened through its case).
 */
export const taskRoutes: Router = Router();

taskRoutes.get('/stats', authorize(PERMISSIONS.CASE_VIEW), c.stats);
taskRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
taskRoutes.get('/assignable-users', authorize(PERMISSIONS.CASE_ASSIGN), c.assignableUsers);
taskRoutes.post('/bulk-assign', authorize(PERMISSIONS.CASE_ASSIGN), c.bulkAssign);
taskRoutes.get('/', authorize(PERMISSIONS.CASE_VIEW), c.list);
