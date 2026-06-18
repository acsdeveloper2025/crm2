import { Router } from 'express';
import { consentController as c } from './controller.js';

/**
 * /api/v2/consents — DPDP consent acceptance (mobile parity). Authenticated, own-user (identity scope,
 * like /auth/me); the controller 401s when unauthenticated.
 */
export const consentRoutes: Router = Router();

consentRoutes.post('/accept', c.accept);
