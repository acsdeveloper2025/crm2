import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { reportTemplateController as c } from './controller.js';

/**
 * /api/v2/report-templates — authored report template management.
 * Reads: page.templates. Writes: report_template.manage (SUPER_ADMIN only).
 */
export const reportTemplateRoutes: Router = Router();

reportTemplateRoutes.get('/', authorize(PERMISSIONS.TEMPLATE_VIEW), c.list);
// `/export` must precede `/:id` routes or it'd be captured as id="export".
reportTemplateRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
reportTemplateRoutes.post('/', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.create);
reportTemplateRoutes.put('/:id', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.update);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
reportTemplateRoutes.post('/bulk-activate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.bulkActivate);
reportTemplateRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.bulkDeactivate);
reportTemplateRoutes.post('/:id/activate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.activate);
reportTemplateRoutes.post('/:id/deactivate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.deactivate);
