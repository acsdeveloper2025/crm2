import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { rateTypeAssignmentController as c } from './controller.js';

/**
 * /api/v2/rate-type-assignments (ADR-0067 / ADR-0069) — per-(client × product × verification_unit)
 * rate-type availability, as standard CRUD master data (DataGrid list + record-page form), mirroring
 * commission-rates. View/list/get: page.masterdata. Manage (create/deactivate/import): masterdata.manage.
 * Export: data.export (it's reference master-data, not comp data — no amount). `/:id` integer.
 * Static single-segment paths (`/export`, `/import-template`) are declared before the param routes.
 */
export const rateTypeAssignmentRoutes: Router = Router();

rateTypeAssignmentRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
rateTypeAssignmentRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
rateTypeAssignmentRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.importTemplate);
rateTypeAssignmentRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.get);
rateTypeAssignmentRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
rateTypeAssignmentRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
// Static path (single segment) — no collision with `/:id/deactivate` (two segments).
rateTypeAssignmentRoutes.post('/bulk-deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkDeactivate);
rateTypeAssignmentRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
