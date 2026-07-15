/**
 * THE definition of "a task has breached its TAT" (ADR-0044). One SQL fragment, shared by every
 * surface that reports it — Pipeline/cases, the tasks list, and the Field Monitoring console.
 *
 * Owner-reported 2026-07-15 (live prod): Field Monitoring showed an agent "Overdue 1" for a task he had
 * already SUBMITTED, while Pipeline showed him 0 out-of-TAT for the same task. Three copies of this rule
 * existed and two of them had drifted: Field Monitoring counted SUBMITTED work against the agent and
 * measured it against a hard-coded 24h window instead of the task's own `tat_hours`. Two screens, two
 * answers, one question. Hence one exported constant — a fourth caller must reuse it, not re-type it.
 *
 * The rule, and why each leg is there:
 *  - `status IN ('PENDING','ASSIGNED','IN_PROGRESS')` — only work still owed. Once a task is SUBMITTED the
 *    agent has delivered; any further delay is the back office's, not theirs. COMPLETED/REVOKED/CANCELLED
 *    are done.
 *  - `tat_hours IS NOT NULL` — no TAT means nothing to breach. Never assume a default.
 *  - `assigned_at IS NOT NULL` — the clock starts at assignment, so unassigned work cannot be late.
 *  - `now() > assigned_at + tat_hours` — the breach itself, against the task's OWN TAT.
 *
 * Assumes the task table is aliased `ct` (every caller already does).
 */
export const TASK_OVERDUE_SQL = `(ct.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
  AND ct.tat_hours IS NOT NULL AND ct.assigned_at IS NOT NULL
  AND now() > ct.assigned_at + (ct.tat_hours * interval '1 hour'))`;

/** The task's due instant (`assigned_at + tat_hours`); NULL when either input is NULL. Aliased `ct`. */
export const TASK_DUE_AT_SQL = `(ct.assigned_at + (ct.tat_hours * interval '1 hour'))`;
