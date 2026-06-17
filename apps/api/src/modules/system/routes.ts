import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { systemController as c } from './controller.js';

/**
 * /api/v2/system — admin system diagnostics.
 * Reads: page.system (SUPER_ADMIN only). No writes.
 */
export const systemRoutes: Router = Router();

systemRoutes.get('/health', authorize(PERMISSIONS.SYSTEM_VIEW), c.health);
