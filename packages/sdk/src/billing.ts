/**
 * @crm2/sdk — the Billing read-model (ADR-0036, slice 5b; Billing⟂Commission separated + redesigned as a
 * flat per-line list by ADR-0086). ONE flat list: a row per COMPLETED billable TASK, carrying every detail
 * column plus the resolved CLIENT bill (from the `rates` engine). Read-only — amounts are DERIVED at read
 * time; no billed-state is persisted (export-only). Gated `billing.view` (billing operators). The user
 * filters / sorts / searches the grid (Salesforce/Twenty list-view style) — there are no pre-aggregated
 * breakdown panels. Per-executive COMMISSION lives in the separate Commission read-model below
 * (CommissionSummaryRow / CommissionDetailRow — /commission-summary, `commission_summary.view`).
 */

/** One COMPLETED billable task = one billing line (the flat list row). Every detail is on the row. */
export interface BillingLineRow {
  taskId: string;
  taskNumber: string;
  /** Owning case — the row's click-through target. */
  caseId: string;
  caseNumber: string;
  clientName: string;
  productName: string;
  unitName: string;
  assigneeName: string | null;
  /** CLIENT rate type (LOCAL/OGL) of the resolved billing rate (Rate Management). */
  clientRateType: string | null;
  /** completed-in TAT band (tat_hours), -1 = out of every band, null = no elapsed (ADR-0046 §4.2). */
  tatBand: number | null;
  /** Resolved task location (task area > pincode > case area > pincode). */
  pincode: string | null;
  area: string | null;
  /** bill-count multiplier for this line (Units; G-2). */
  billCount: number;
  /** per-unit CLIENT bill amount; null when the CPV has no active rate. */
  billAmount: number | null;
  /** line total = billAmount × billCount; null when no active rate. */
  billTotal: number | null;
  completedAt: string | null;
}

/** Filter-aware aggregate for the flat Billing grid footer (ADR-0086) — the ₹ bill total + line count over
 *  ALL lines matching the current filter (client / date / search / column filters), not just the page. */
export interface BillingLinesSummary {
  billTotal: number;
  lineCount: number;
}

/**
 * Commission Summary (ADR-0081) — periodic, per-field-user agent-commission rollup for export/payout.
 * Answers "how much did each field agent earn this week/fortnight/month/quarter" — the gap the
 * per-case Billing list could not (it has no field-user grain or period bucketing). Read-only, derived;
 * gated `commission_summary.view`. Every amount is the SAME `COALESCE(snapshot, live)` commission the Billing page
 * shows, summed × bill_count. The period bucket + the date range both anchor on the **earned-at** instant
 * `COALESCE(submitted_at, completed_at)` (ADR-0047: field commission freezes at SUBMIT), NOT `completed_at`.
 */
export type CommissionPeriod = 'week' | 'fortnight' | 'month' | 'quarter';

/**
 * `agent` = one row per field-user per period · `agentClientProduct` = also split by client + product ·
 * `agentClientProductRateType` = additionally split by CLIENT rate type (billing) + FIELD rate type
 * (commission), so each row carries a single rate-type pair (v1-pivot parity).
 */
export type CommissionGroupBy = 'agent' | 'agentClientProduct' | 'agentClientProductRateType';

/** One rollup row: a field-user's earned commission within one period bucket (optionally per client+product). */
export interface CommissionSummaryRow {
  agentId: string;
  agentName: string;
  /** null unless groupBy includes client+product. */
  clientId: number | null;
  clientName: string | null;
  productId: number | null;
  productName: string | null;
  /** CLIENT rate type (LOCAL/OGL) of the resolved bill rate; null unless groupBy = agentClientProductRateType. */
  clientRateType: string | null;
  /** FIELD rate type (LOCAL/OGL/OFFICE) driving commission; null unless groupBy = agentClientProductRateType. */
  fieldRateType: string | null;
  /** Period label: `2026-W27` (week) · `2026-06-H1`/`-H2` (fortnight) · `2026-06` (month) · `2026-Q2` (quarter). */
  periodKey: string;
  /** ISO date of the bucket's first day (sortable). */
  periodStart: string | null;
  /** Count of SUBMITTED/COMPLETED commissioned tasks in the bucket. */
  taskCount: number;
  /** Σ bill_count over the bucket (unit-weighted). */
  billableUnits: number;
  /** Σ CLIENT bill amount × bill_count over the bucket's COMPLETED tasks (rates engine). */
  billTotal: number;
  /** Σ agent commission × bill_count over the bucket. */
  commissionTotal: number;
}

/** One per-task commission/billing DETAIL line (v1 line-export parity) — the real rate + both rate types. */
export interface CommissionDetailRow {
  taskId: string;
  taskNumber: string;
  caseNumber: string;
  agentId: string;
  agentName: string;
  clientName: string;
  productName: string;
  unitName: string;
  visitType: string | null;
  /** CLIENT rate type (LOCAL/OGL) of the resolved bill rate. */
  clientRateType: string | null;
  /** FIELD rate type (LOCAL/OGL/OFFICE) driving commission. */
  fieldRateType: string | null;
  /** the CLIENT bill rate for this task (rates engine); null until COMPLETED / when no active rate. */
  billAmount: number | null;
  /** agent commission for this task; null when the assignee has no matching commission_rate. */
  commissionAmount: number | null;
  billCount: number;
  status: string;
  /** earned-at date `COALESCE(submittedAt, completedAt)` (IST), YYYY-MM-DD. */
  earnedOn: string | null;
  submittedAt: string | null;
  completedAt: string | null;
}

/** Query contract for `GET /billing/commission-detail` (+ `/export`). Same earned-at filters as the summary. */
export interface CommissionDetailQuery {
  clientId?: number;
  productId?: number;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
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
