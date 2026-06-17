import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { fieldMonitoringController as c } from './controller.js';

/**
 * /api/v2/field-monitoring — the supervisor's field-operations console (ADR-0026). Reads the
 * field executives in the actor's hierarchy scope (roster + throughput + last-seen). Gated by
 * `page.field_monitoring` (SA/MANAGER/TEAM_LEADER); export by `data.export`.
 */
export const fieldMonitoringRoutes: Router = Router();

fieldMonitoringRoutes.get('/stats', authorize(PERMISSIONS.FIELD_MONITORING_VIEW), c.stats);
fieldMonitoringRoutes.get('/export', authorize(PERMISSIONS.DATA_EXPORT), c.export);
fieldMonitoringRoutes.get('/agents', authorize(PERMISSIONS.FIELD_MONITORING_VIEW), c.list);
// Admin "request location" ping (ADR-0027) — FCM + socket wake; scope-guarded in the service.
fieldMonitoringRoutes.post(
  '/agents/:id/request-location',
  authorize(PERMISSIONS.FIELD_MONITORING_VIEW),
  c.requestLocation,
);
