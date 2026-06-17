import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { locationController as c } from './controller.js';

/**
 * /api/v2/location — device location ingest (ADR-0026). `POST /capture` honors the LOCKED
 * mobile capture contract. Gated by `location.capture` (the field app's perm, mirrors how
 * /sync/download gates on a field-held perm). Forward-prep: no live producer until the
 * crm-mobile-native rebase onto /api/v2.
 */
export const locationCaptureRoutes: Router = Router();

locationCaptureRoutes.post('/capture', authorize(PERMISSIONS.LOCATION_CAPTURE), c.capture);
