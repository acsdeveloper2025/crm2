import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { geocodeController as c } from './controller.js';

/**
 * /api/v2/geocode — reverse geocoding (ADR-0026). `GET /reverse?lat=&lng=` → a frozen human
 * address (or null when no key / no result). A pure coordinate→address function (no record id),
 * gated by `case.view` (the established read gate; held by every web role that views a location).
 */
export const geocodeRoutes: Router = Router();

geocodeRoutes.get('/reverse', authorize(PERMISSIONS.CASE_VIEW), c.reverse);
// Reverse-geocode DLQ ops (ADR-0040 S4 Slice B) — list open failures + bulk replay (SA/ops).
geocodeRoutes.get('/dlq', authorize(PERMISSIONS.SYSTEM_VIEW), c.dlq);
geocodeRoutes.post('/dlq/replay', authorize(PERMISSIONS.SYSTEM_VIEW), c.replayDlq);
