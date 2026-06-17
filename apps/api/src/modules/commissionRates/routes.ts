import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { commissionRateController as c } from './controller.js';

/**
 * /api/v2/commission-rates (ADR-0036) — per-user agent-commission rate config (master data, like
 * `rates`). Effective-dated + OCC; `:id` integer. EVERY route (incl. export + import) gates
 * `masterdata.manage` (SUPER_ADMIN): commission AMOUNTS are compensation data, more sensitive than
 * rate cards — the list is NOT exposed to the broader `page.masterdata` viewers, and the EXPORT is
 * SA-only too (NOT `data.export`, else a data.export-only role could exfiltrate comp data — the rule
 * the 5b billing export learned). Import is gated like create (it CREATES rates).
 */
export const commissionRateRoutes: Router = Router();

commissionRateRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.list);
// `/export` + `/import-template` are literal single-segment paths — declared before the param routes.
commissionRateRoutes.get('/export', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.export);
commissionRateRoutes.get('/import-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.importTemplate);
commissionRateRoutes.post(
  '/import',
  authorize(PERMISSIONS.MASTERDATA_MANAGE),
  raw({ type: () => true, limit: '10mb' }),
  c.import,
);
commissionRateRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
commissionRateRoutes.post('/:id/revise', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.revise);
commissionRateRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
commissionRateRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
