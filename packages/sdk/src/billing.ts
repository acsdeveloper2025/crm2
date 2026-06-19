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
  rateType: string | null;
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
