/**
 * @crm2/sdk — the Billing & Commission read-model (ADR-0036, slice 5b). A per-case view of money:
 * every COMPLETED task in a case is a billable line carrying a CLIENT bill amount (resolved from the
 * `rates` engine) and an AGENT commission amount (resolved from `commission_rates`). Read-only —
 * amounts are DERIVED at read time; no billed-state is persisted (the invoice/payout engine is a
 * later slice). Gated `billing.view` (billing operators). Eligibility = ANY completed task.
 */

/** One case row in the billing list — aggregate over its COMPLETED tasks. */
export interface BillingCaseRow {
  caseId: string;
  caseNumber: string;
  clientName: string;
  productName: string;
  status: string;
  completedTaskCount: number;
  /** Σ ct.bill_count over the case's completed tasks (unit-weighted count; G-2). */
  billableUnits: number;
  /** Σ client bill amount over the case's completed tasks (rates engine). */
  billTotal: number;
  /** Σ agent commission over the case's completed tasks (commission_rates; unconfigured ⇒ 0). */
  commissionTotal: number;
  lastCompletedAt: string | null;
}

/** One completed-task billing line within a case (the accordion detail). */
export interface BillingTaskLine {
  taskId: string;
  taskNumber: string;
  unitName: string;
  assigneeName: string | null;
  /** task_origin — ORIGINAL | REVISIT (both bill; label only). */
  billingClass: string;
  visitType: string | null;
  /** CLIENT rate type (LOCAL/OGL) of the resolved billing rate (Rate Management). */
  clientRateType: string | null;
  /** client bill amount; null when the CPV has no active rate. */
  billAmount: number | null;
  /** agent commission; null when the assignee has no matching commission_rate. */
  commissionAmount: number | null;
  /** bill-count multiplier for this task line (G-2); line total = amount × billCount. */
  billCount: number;
  /** completed-in TAT band (tat_hours), -1 = out of every band, null = no elapsed (ADR-0046 §4.2). */
  tatBand: number | null;
  completedAt: string | null;
}

/**
 * Billing breakdown (ADR-0046) — completed-task bill/commission totals over the same filter as the
 * case list, grouped two ways: by the task's resolved location (pincode/area) and by the completed-in
 * TAT band. Read-only, derived; gated `billing.view`.
 */

/** One pincode/area group — the task's resolved location (task area > pincode > case area > pincode). */
export interface BillingLocationGroup {
  /** Resolved location id; null when the task carries no location (unmapped). */
  locationId: number | null;
  pincode: string | null;
  area: string | null;
  completedTaskCount: number;
  /** Σ ct.bill_count over the group (unit-weighted count). */
  billableUnits: number;
  /** Σ client bill amount × bill_count over the group. */
  billTotal: number;
  /** Σ agent commission × bill_count over the group. */
  commissionTotal: number;
}

/** One completed-in TAT band group. band = tat_hours | -1 (out of band) | null (no elapsed minutes). */
export interface BillingBandGroup {
  band: number | null;
  completedTaskCount: number;
  billableUnits: number;
  billTotal: number;
  commissionTotal: number;
}

/** Both groupings, returned by `GET /billing/breakdown` in one round-trip. */
export interface BillingBreakdown {
  byLocation: BillingLocationGroup[];
  byBand: BillingBandGroup[];
}

/** Filter contract for `GET /billing/breakdown` — same fields the case list accepts (all optional). */
export interface BillingBreakdownQuery {
  clientId?: number;
  completedFrom?: string;
  completedTo?: string;
  search?: string;
}

/**
 * Commission Summary (ADR-0081) — periodic, per-field-user agent-commission rollup for export/payout.
 * Answers "how much did each field agent earn this week/fortnight/month/quarter" — the gap the
 * per-case Billing list could not (it has no field-user grain or period bucketing). Read-only, derived;
 * gated `billing.view`. Every amount is the SAME `COALESCE(snapshot, live)` commission the Billing page
 * shows, summed × bill_count. The period bucket + the date range both anchor on the **earned-at** instant
 * `COALESCE(submitted_at, completed_at)` (ADR-0047: field commission freezes at SUBMIT), NOT `completed_at`.
 */
export type CommissionPeriod = 'week' | 'fortnight' | 'month' | 'quarter';

/** `agent` = one row per field-user per period; `agentClientProduct` = also split by client + product. */
export type CommissionGroupBy = 'agent' | 'agentClientProduct';

/** One rollup row: a field-user's earned commission within one period bucket (optionally per client+product). */
export interface CommissionSummaryRow {
  agentId: string;
  agentName: string;
  /** null unless groupBy = agentClientProduct. */
  clientId: number | null;
  clientName: string | null;
  productId: number | null;
  productName: string | null;
  /** Period label: `2026-W27` (week) · `2026-06-H1`/`-H2` (fortnight) · `2026-06` (month) · `2026-Q2` (quarter). */
  periodKey: string;
  /** ISO date of the bucket's first day (sortable). */
  periodStart: string | null;
  /** Count of SUBMITTED/COMPLETED commissioned tasks in the bucket. */
  taskCount: number;
  /** Σ bill_count over the bucket (unit-weighted). */
  billableUnits: number;
  /** Σ agent commission × bill_count over the bucket. */
  commissionTotal: number;
}

/** Query contract for `GET /billing/commission-summary` (+ `/export`). All optional; defaults month/agent. */
export interface CommissionSummaryQuery {
  /** Bucket granularity. Default `month`. */
  period?: CommissionPeriod;
  /** Grouping grain. Default `agent`. */
  groupBy?: CommissionGroupBy;
  clientId?: number;
  productId?: number;
  /** ISO timestamp; only commission earned (COALESCE(submittedAt, completedAt)) at/after this. */
  from?: string;
  /** ISO timestamp; only commission earned at/before this. */
  to?: string;
  /** Full-text across agent name, client name, product name. */
  search?: string;
  page?: number;
  pageSize?: number;
}
