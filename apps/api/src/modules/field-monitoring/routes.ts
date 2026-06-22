import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { fieldMonitoringController as c } from './controller.js';

/**
 * /api/v2/field-monitoring — the supervisor's field-operations console (ADR-0026). Reads the
 * field executives in the actor's hierarchy scope (roster + throughput + last-seen). Gated by
 * `page.field_monitoring` (SA/MANAGER/TEAM_LEADER); the export shares that same view audience.
 */
export const fieldMonitoringRoutes: Router = Router();

fieldMonitoringRoutes.get('/stats', authorize(PERMISSIONS.FIELD_MONITORING_VIEW), c.stats);
// Gated FIELD_MONITORING_VIEW (NOT bare data.export): the export streams the SAME field-agent roster
// (name/phone/employeeId — PII + territory) as the list, so it must share the list's audience.
// data.export alone would WIDEN access — BACKEND_USER holds it but not page.field_monitoring. Mirrors
// the billing /cases/export precedent (export never wider than read).
fieldMonitoringRoutes.get('/export', authorize(PERMISSIONS.FIELD_MONITORING_VIEW), c.export);
fieldMonitoringRoutes.get('/agents', authorize(PERMISSIONS.FIELD_MONITORING_VIEW), c.list);
// Admin "request location" ping (ADR-0027) — FCM + socket wake; scope-guarded in the service.
fieldMonitoringRoutes.post(
  '/agents/:id/request-location',
  authorize(PERMISSIONS.FIELD_MONITORING_VIEW),
  c.requestLocation,
);
