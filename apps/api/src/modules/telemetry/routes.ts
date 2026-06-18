import { Router } from 'express';
import { telemetryController as c } from './controller.js';

/**
 * /api/v2/telemetry — optional mobile telemetry ingest (mobile parity). Authenticated; best-effort
 * accept-and-ack (202). The device swallows failures, so this never gates the app.
 */
export const telemetryRoutes: Router = Router();

telemetryRoutes.post('/mobile/ingest', c.ingest);
