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
  completedAt: string | null;
}
