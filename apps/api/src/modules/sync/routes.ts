import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { syncController as c } from './controller.js';

/**
 * /api/v2/sync — the mobile down-sync surface (ADR-0012). `GET /download` serves the unmodified
 * field app the locked dispatch contract: tasks assigned to the device user, in the v1
 * MobileCaseResponse shape. Gated by case.view (the field agent's read permission).
 */
export const syncRoutes: Router = Router();

syncRoutes.get('/download', authorize(PERMISSIONS.CASE_VIEW), c.download);
