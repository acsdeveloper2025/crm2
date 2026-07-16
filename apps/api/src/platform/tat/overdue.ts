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

/**
 * The TAT a RE-WORK task is born with — a revisit (of a COMPLETED task) or a replacement for a REVOKED
 * one. Owner decision 2026-07-15: a fresh full window, matching the default the web sends for a new task
 * (AddTasksForm's 24h).
 *
 * Both lineage INSERTs used to omit `tat_hours` entirely, and the column has no DEFAULT (mig 0078), so
 * every re-work task was born NULL — and `TASK_OVERDUE_SQL` requires a non-NULL target. Re-work was
 * therefore invisible to Out-of-TAT forever, however long an agent held it. A named constant so the two
 * INSERTs cannot drift apart the way the overdue rule did.
 */
export const REWORK_TAT_HOURS = 24;

/**
 * ABANDONMENT — "nobody is coming for this task; take it back" (ADR-0095).
 *
 * NOT overdue, and deliberately not spelled with that word. Two different rules:
 *  - OVERDUE (above) is live and reversible: the agent is late, chase them; submitting clears it. It is
 *    measured against the task's OWN `tat_hours`.
 *  - ABANDONMENT is terminal: 45 days after assignment the work is presumed dead, and the server revokes
 *    it so a backend user SEES it and can reassign. One flat window for every task.
 * They are allowed to disagree — a 4h-TAT task is "overdue" within the day and "abandoned" only at 45.
 * Sharing a word is exactly what produced the drift this file's header describes; do not merge them.
 *
 * Why the sweep exists (owner, 2026-07-16): the device's 45-day retention sweep used to delete ANY old
 * task, so a job ASSIGNED 46 days ago that the agent never did vanished off the phone — and because
 * down-sync is incremental, an unchanged task is never re-sent, so it never came back. The agent
 * silently lost work they still owed and the office was never told. Mobile now reaps terminal states
 * only; the server owning the revoke is the other half of that fix.
 *
 * Each leg:
 *  - `status IN ('ASSIGNED','IN_PROGRESS')` — only work an agent is actually holding. PENDING is
 *    unassigned (and `revokeTaskInPlace` would 409 on it); SUBMITTED/COMPLETED/REVOKED are done.
 *  - `assigned_at IS NOT NULL` — the clock starts at assignment. NOT `started_at`: it arrived 42
 *    migrations after IN_PROGRESS (0010 vs 0052) with no backfill, so anchoring there would skip
 *    precisely the oldest rows this is meant to catch.
 *  - `now() > assigned_at + 45 days` — the window itself.
 *
 * Note there is deliberately NO `tat_hours IS NOT NULL` leg (unlike TASK_OVERDUE_SQL): legacy re-work
 * rows were born with a NULL TAT, and an abandoned one of those is exactly what must be swept.
 *
 * ponytail: a flat window, not a multiple of tat_hours — an URGENT 4h task would otherwise die at 7.5d
 * while a 48h one survived 90, which is unpredictable for the office. Revisit only if TAT bands ever
 * exceed 1080h (today they are 4–48h, seeded in mig 0077), where the sweep could fire inside TAT.
 *
 * Assumes the task table is aliased `ct`.
 */
export const TASK_ABANDONED_DAYS = 45;
export const TASK_ABANDONED_SQL = `(ct.status IN ('ASSIGNED','IN_PROGRESS')
  AND ct.assigned_at IS NOT NULL
  AND now() > ct.assigned_at + (${TASK_ABANDONED_DAYS} * interval '1 day'))`;

/**
 * The actor recorded for a server-performed write with no human behind it.
 *
 * `case_tasks.updated_by` is `uuid` with NO foreign key (mig 0010:62 — contrast `assigned_to uuid
 * REFERENCES users(id)` two lines above), deliberately so the dev/test synthetic actor ids work. So the
 * sweep needs a valid UUID *literal* but no `users` row: a nil UUID records "the system did this"
 * without inventing a fake person.
 *
 * NOT `...0001` — that is the seeded SUPER_ADMIN "System Administrator" LOGIN account (mig 0007), and
 * attributing an unattended sweep to it would put a real human's name on the audit row.
 *
 * It must be a UUID: `revokeTaskInPlace` feeds this same id to `updated_by` (uuid), the audit row
 * (text), and the case rollup's `cases.updated_by` (uuid) — the string 'SYSTEM' raises 22P02.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The reason stored on an auto-revoke. Free text: `case_tasks.remark` has no FK/CHECK and both existing
 * revoke paths already write a plain string there.
 *
 * Deliberately NOT a new `revoke_reasons` master row — that table's only reader filters `is_active =
 * true` and feeds the FIELD AGENT's revoke picker, so an active row would let an agent claim their own
 * task was "auto-revoked", and an inactive one would be invisible to the only reader that exists.
 *
 * Uppercase to match the office path, which uppercases via zod (`packages/sdk` cases schema); the sweep
 * calls the repository directly and bypasses that transform, so it must arrive uppercase already.
 */
export const AUTO_REVOKE_REASON = `AUTO-REVOKED — NO ACTION FOR ${TASK_ABANDONED_DAYS} DAYS`;
