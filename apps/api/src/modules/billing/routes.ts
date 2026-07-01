import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { billingController as c } from './controller.js';

/**
 * /api/v2/billing (ADR-0036, slice 5b) — the per-case Billing & Commission read-model. Gated
 * `billing.view` (MANAGER + BACKEND_USER + SA); export on `data.export`. Read-only; amounts derived.
 */
export const billingRoutes: Router = Router();

// `/cases/export` is a literal 2-segment path — declare before `/cases/:id/tasks` (3-segment) for clarity.
// Gated `billing.view` (NOT just data.export): the export carries the SAME sensitive bill+commission
// amounts as the list, so it must share the list's audience — otherwise a data.export-only role
// (TEAM_LEADER) blocked from /cases could exfiltrate the amounts via export (Security/CEO panel BLOCK).
// All billing.view holders also hold data.export, so this loses no legitimate access.
billingRoutes.get('/cases/export', authorize(PERMISSIONS.BILLING_VIEW), c.export);
billingRoutes.get('/cases', authorize(PERMISSIONS.BILLING_VIEW), c.listCases);
billingRoutes.get('/cases/:id/tasks', authorize(PERMISSIONS.BILLING_VIEW), c.caseTasks);
// Per-pincode/area + completed-in-band totals (ADR-0046 §4.3). Same query contract + gate as /cases.
billingRoutes.get('/breakdown', authorize(PERMISSIONS.BILLING_VIEW), c.breakdown);
// Periodic per-field-user commission rollup + export (ADR-0081). `/export` is a literal 2-segment path —
// declare before the bare list. Gated by a DEDICATED `billing.commission_summary.view` (independent of the
// per-case `billing.view`); both list + export share it (the export carries the SAME comp amounts).
billingRoutes.get(
  '/commission-summary/export',
  authorize(PERMISSIONS.BILLING_COMMISSION_SUMMARY_VIEW),
  c.commissionSummaryExport,
);
billingRoutes.get(
  '/commission-summary',
  authorize(PERMISSIONS.BILLING_COMMISSION_SUMMARY_VIEW),
  c.commissionSummary,
);
// Per-task commission/billing DETAIL + export (ADR-0081, v1 line-export parity). Same gate as the summary.
billingRoutes.get(
  '/commission-detail/export',
  authorize(PERMISSIONS.BILLING_COMMISSION_SUMMARY_VIEW),
  c.commissionDetailExport,
);
billingRoutes.get(
  '/commission-detail',
  authorize(PERMISSIONS.BILLING_COMMISSION_SUMMARY_VIEW),
  c.commissionDetail,
);
