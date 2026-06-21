# ADR-0055: Revoke-before-reassign — remove in-place reassign and unassign

- **Status:** **Accepted** — owner-directed 2026-06-21 (owner + CTO). Realizes an explicit owner workflow
  rule: a task can only be taken off a field agent by **Revoke (with a mandatory reason)**, and a revoked
  task is then **reassigned** (reassign-after-revoke, ADR-0033). There is **no direct in-place reassign** of
  a live task and **no unassign**. **Supersedes** the in-place assign/reassign-of-an-`ASSIGNED`-task and the
  `unassign` action of [ADR-0024].
- **Date:** 2026-06-21
- **Scope:** `/api/v2` task assignment (`crm2` backend + `@crm2/sdk`) and the web case-detail actions. No DB
  migration. Mobile is unaffected (the field app never assigned/unassigned — assignment is office-side).

## Context

Under [ADR-0024], the office could move a task between agents two ways:
1. **Direct in-place reassign** — `POST /cases/:id/tasks/:taskId/assign` accepted a task already in
   `ASSIGNED` and re-pointed it to another agent in place (`assignTask` allowed `PENDING` **or** `ASSIGNED`).
2. **Unassign** — `POST /cases/:id/tasks/:taskId/unassign` sent an `ASSIGNED` task back to `PENDING`.

Both move work off an agent **without capturing a reason**. The owner requires that every time a task leaves
an agent, the **why** is recorded and visible — the revoke reason is the audit trail (each revoke writes the
task's `remark` + a `case_task` audit event, and reassign-after-revoke creates a new task row so the full
history of revoke reasons is preserved and shown on the case page, any number of times, by any actor). A
silent reassign/unassign breaks that trail.

## Decision

The **only** way to take a live task off an agent is **Revoke** (mandatory reason). Concretely:

### Backend (`crm2`)
- `assignTask` accepts **`PENDING` only**. Assigning a task already in `ASSIGNED` → `409 TASK_NOT_ASSIGNABLE`.
  (Initial assignment of an assign-later `PENDING` task is unchanged.)
- The **`unassign` endpoint is removed** — route, controller, service, and repository method. There is no
  server path back from `ASSIGNED` to `PENDING`; the office revokes instead.
- Unchanged: **Revoke** (`{ASSIGNED,IN_PROGRESS} → REVOKED`, mandatory reason, ADR-0033), **reassign-after-
  revoke** (`REVOKED → ` new replacement task, ADR-0033), and **revisit** of a `COMPLETED` task (ADR-0033).
- `@crm2/sdk`: the `unassignTask` client method is removed; `assignTask` stays (now PENDING-gated server-side).

### Web (`apps/web`)
- The case-detail task row no longer shows a **Reassign** button on an `ASSIGNED` task or an **Unassign**
  button. A `PENDING` task shows **Assign**; an `ASSIGNED`/`IN_PROGRESS` task shows **Revoke**; a `REVOKED`
  task shows **Reassign** (reassign-after-revoke); a `COMPLETED` task shows **Revisit**.

### Resulting agent-change flow
`ASSIGNED/IN_PROGRESS` → **Revoke (reason)** → `REVOKED` → **Reassign** → new `ASSIGNED` task on another (or
the same) agent. Each hop leaves a revoked task row carrying its reason — the visible, append-only history.

## Consequences

### Positive
- Every agent change is reason-stamped and auditable; the case page shows the complete revoke history.
- One coherent state machine: live work leaves an agent only through Revoke; no silent re-pointing.

### Negative / risks
- Reassigning is now two steps (revoke, then reassign) instead of one, and creates a new task row (new id)
  rather than mutating the existing assignment. This is the intended trade for the audit trail.
- Removing the `unassign` route is a **non-additive** `/api/v2` change — permitted here only as an explicit
  freeze exception under this ADR (owner + CTO). The web is the sole consumer; the mobile app never called it.

## Alternatives Considered
- **Keep in-place reassign/unassign (status quo, ADR-0024)** — rejected by the owner: silent moves with no
  captured reason break the audit trail.
- **Block at the web only, leave the API permissive** — rejected: the API/any client could still move work
  off an agent without a reason; the rule must be enforced server-side.

## Related ADRs
- [ADR-0024] — task assignment / in-place reassign + unassign. **Superseded** (for in-place reassign of an
  `ASSIGNED` task and the `unassign` action) by this ADR.
- [ADR-0033] — revoke / reassign-after-revoke / revisit (the retained office-intervention flows).
- [ADR-0011] — `/api/v2` versioning. This removes a route under an owner/CTO freeze exception, not a new version.

[ADR-0024]: ./ADR-0024-task-assignment.md
[ADR-0033]: ./ADR-0033-office-task-intervention.md
[ADR-0011]: ./ADR-0011-api-versioning-strategy.md
