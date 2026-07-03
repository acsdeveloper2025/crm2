import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { billingController as c } from './controller.js';

/**
 * /api/v2/billing (ADR-0036, slice 5b; Billing⟂Commission separated + redesigned by ADR-0086) — the flat
 * BILLING lines read-model (one row per COMPLETED billable task; client bill only). Gated `billing.view`
 * (MANAGER + BACKEND_USER + SA). The commission endpoints below serve the promoted top-level
 * /commission-summary page, gated by the renamed, out-of-namespace `commission_summary.view`. Read-only;
 * amounts derived.
 */
export const billingRoutes: Router = Router();

// `/lines/export` is a literal 2-segment path — declare before the bare `/lines` list. Gated `billing.view`
// (NOT just data.export): the export carries the SAME sensitive bill amounts as the list, so it must share
// the list's audience — otherwise a data.export-only role (TEAM_LEADER) blocked from /lines could exfiltrate
// the amounts via export. All billing.view holders also hold data.export, so this loses no legitimate access.
billingRoutes.get('/lines/export', authorize(PERMISSIONS.BILLING_VIEW), c.export);
// Filter-aware ₹ bill total + line count for the grid footer (ADR-0086). Literal 2-segment path — before the bare list.
billingRoutes.get('/lines/summary', authorize(PERMISSIONS.BILLING_VIEW), c.linesSummary);
// Flat billing lines — one row per COMPLETED billable task, all detail columns (ADR-0086 redesign).
billingRoutes.get('/lines', authorize(PERMISSIONS.BILLING_VIEW), c.listLines);
// Periodic per-field-user commission rollup + export (ADR-0081; page promoted to top-level /commission-summary
// by ADR-0086). `/export` is a literal 2-segment path — declare before the bare list. Gated by the DEDICATED
// `commission_summary.view` (renamed out of the `billing.` namespace, mig 0112; independent of `billing.view`);
// both list + export share it (the export carries the SAME comp amounts).
billingRoutes.get(
  '/commission-summary/export',
  authorize(PERMISSIONS.COMMISSION_SUMMARY_VIEW),
  c.commissionSummaryExport,
);
billingRoutes.get('/commission-summary', authorize(PERMISSIONS.COMMISSION_SUMMARY_VIEW), c.commissionSummary);
// Per-task commission/billing DETAIL + export (ADR-0081, v1 line-export parity). Same gate as the summary.
billingRoutes.get(
  '/commission-detail/export',
  authorize(PERMISSIONS.COMMISSION_SUMMARY_VIEW),
  c.commissionDetailExport,
);
billingRoutes.get('/commission-detail', authorize(PERMISSIONS.COMMISSION_SUMMARY_VIEW), c.commissionDetail);
