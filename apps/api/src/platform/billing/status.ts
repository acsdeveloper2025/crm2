/**
 * The ONE definition of which task statuses carry money. Extracted after the MIS per-row money columns
 * (mis/reportTypes.ts) drifted — they resolved a bill + commission for ANY status while the report's own
 * footer filtered — so a REVOKED task projected a phantom bill on prod CASE-000004 (§REVOKE-BILLING).
 * Same hand-typed-copy disease as TASK_OVERDUE_SQL (platform/tat/overdue.ts): every money surface imports
 * these instead of re-typing the predicate, so billing lines, commission, and MIS rows/footers agree by
 * construction.
 *
 * The two rules DIFFER by design and MUST NOT be merged: a billing line = a COMPLETED (billed) task, while
 * commission also pays the device-terminal SUBMITTED because ADR-0047 freezes commission at submit. Both
 * require the `case_tasks ct` alias (or a subquery that aliases the table as `ct`).
 */
export const BILLABLE_STATUS_SQL = `ct.status = 'COMPLETED'`;
export const COMMISSIONABLE_STATUS_SQL = `ct.status IN ('SUBMITTED', 'COMPLETED')`;
