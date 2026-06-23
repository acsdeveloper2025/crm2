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
// Gated TEMPLATE_VIEW (NOT bare data.export): the export streams the SAME template rows as `GET /`
// (page.templates), so it must share the list's audience. data.export alone would WIDEN access —
// MANAGER/TEAM_LEADER/BACKEND_USER hold it but cannot read templates. Mirrors users /export precedent.
reportTemplateRoutes.get('/export', authorize(PERMISSIONS.TEMPLATE_VIEW), c.export);
// `/:id` (additive read, ADR-0051 D4) — MUST follow the static GET routes (`/`, `/export`) so it
// can't shadow them. Co-exists with the POST `/:id/...` routes below (different methods).
reportTemplateRoutes.get('/:id', authorize(PERMISSIONS.TEMPLATE_VIEW), c.get);
reportTemplateRoutes.post('/', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.create);
reportTemplateRoutes.put('/:id', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.update);
// Bulk routes are static paths (single segment) — no collision with `/:id/...` (two segments).
reportTemplateRoutes.post('/bulk-activate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.bulkActivate);
reportTemplateRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.bulkDeactivate);
reportTemplateRoutes.post('/:id/activate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.activate);
reportTemplateRoutes.post('/:id/deactivate', authorize(PERMISSIONS.TEMPLATE_MANAGE), c.deactivate);
