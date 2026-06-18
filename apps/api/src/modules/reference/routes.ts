import { Router } from 'express';
import { referenceController as c } from './controller.js';

/**
 * /api/v2/reference — server-driven masters the field app refreshes each sync cycle (ADR-0012 mobile
 * parity). Authenticated, no permission gate (static catalog, no PII, no user scope — like /auth/me).
 */
export const referenceRoutes: Router = Router();

referenceRoutes.get('/verification-type-outcomes', c.verificationTypeOutcomes);
referenceRoutes.get('/revoke-reasons', c.revokeReasons);
