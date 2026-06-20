import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { syncController as c } from './controller.js';

/**
 * /api/v2/sync — the mobile down-sync surface (ADR-0054). `GET /download` serves the v2-native
 * field app the dispatch contract: tasks assigned to the device user, in the clean v2-native bare
 * body (no v1 envelope/aliases). Gated by case.view (the field agent's read permission).
 */
export const syncRoutes: Router = Router();

syncRoutes.get('/download', authorize(PERMISSIONS.CASE_VIEW), c.download);
