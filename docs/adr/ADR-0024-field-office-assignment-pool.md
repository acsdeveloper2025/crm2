# ADR-0024: Field/Office assignment pool + assign-at-create

- **Status:** Accepted — shipped ~2026-06-11; retrospectively documented 2026-06-17
- **Date:** 2026-06-17

> **Retrospective record.** This decision shipped during the Case/Task dispatch
> work and has been referenced by number ("ADR-0024") throughout the codebase and
> by [ADR-0023](./ADR-0023-case-task-dispatch-fields-and-applicant-targeting.md),
> [ADR-0032](./ADR-0032-case-task-lifecycle-and-two-track-completion.md), and
> [ADR-0033](./ADR-0033-task-lineage-revisit-and-reassign-after-revoke.md), but the
> ADR document itself was never written. This is its first written record,
> reconstructed from the shipped implementation (`apps/api/src/modules/cases`,
> `apps/api/src/modules/tasks`, and the case/task UI). It records existing
> behaviour; it does not change it.

## Context

A case fans out into tasks (ADR-0002), and each task must be worked by the right
person. "The right person" depends on the **visit type**:

- **FIELD** work is done on location by a field agent and is **territory-bound** —
  only an agent assigned to the task's area/pincode should be eligible.
- **OFFICE** (desk) work has no territory: any desk-pool user may do it.

Two further forces apply:

- Assignment can happen **at task creation** (the operator picks the assignee while
  adding tasks) **or later** (reassign on the Pipeline / case detail). Both paths
  must offer and accept the **same** eligible set, or create and reassign disagree.
- The frontend offers a pool, but a client-supplied `assigneeId` **cannot be
  trusted** — the server must re-verify eligibility (IDOR / privilege-escalation).

The role that staffs each pool is an operational policy, not a code constant —
it must be changeable without a deploy.

## Decision

We define an **eligible assignment pool** for a task and reuse it for both
assign-at-create and reassign.

A user is in the pool for a `(visitType, area, pincode)` target when **all** hold
(`cases/repository.ts` `eligibleAssigneesForNew`):

1. The user is **USABLE** — `is_active` and `effective_from <= now()`.
2. The user's **role = the pool role for the visit type**, resolved from the
   data-driven **`assignment_pool_roles`** table (`visit_type → role_code`) — no
   role literal in code, so the staffing policy is changed by data.
3. The user is inside the **actor's hierarchy scope** (Epic F / ADR-0022 scoped
   user ids; `SUPER_ADMIN` = no cap).
4. **FIELD only:** the user holds an **ACTIVE territory assignment**
   (`user_scope_assignments`) matching the target **`AREA`** or **`PINCODE`** by
   id-equality (the same geo legs as the visibility engine). **OFFICE skips the
   territory leg** (desk pool).

Consequences of that model:

- **Territory is per-task, not per-case.** FIELD eligibility is matched against the
  **task's own** location, so two FIELD tasks in different places have different
  pools; the task carries its area/pincode.
- **Assign-at-create.** `POST /cases/:id/tasks` may carry `assigneeId` (only when
  the actor has `CASE_ASSIGN`). The schema guarantees `assigneeId ⇒ visitType`
  (and `FIELD ⇒ area + pincode`), and the service **re-checks each chosen assignee
  against the same pool** the FE offered, rejecting an out-of-pool pick with
  `400 INVALID_ASSIGNEE`. A task assigned at create lands in `ASSIGNED`.
- **Reassign uses the identical model** (`assignTask` → `eligibleTaskIdsForAssignee`)
  so create and reassign always agree; reassign is allowed only while the task is
  `PENDING`/`ASSIGNED` (`409 TASK_NOT_ASSIGNABLE` otherwise).
- **Bulk assign** (tasks module) offers the **intersection** of eligibility across
  all selected tasks, and per row commits only the subset that passes.
- **Rate type** for a task is resolved **live from rate management** for the case's
  client + product (ADR-0016/0018) at assignment time — it is not frozen onto the
  task at create.

Surface: `GET /cases/:id/assignable-users` and `GET /tasks/assignable-users`, both
`CASE_ASSIGN`-gated, parameterised by `visitType` (+ `pincodeId`/`areaId`, or a
`taskId` to derive them). Out-of-scope reads/writes return `404` (IDOR-safe).

## Consequences

### Positive

- One pool definition drives create, reassign, and bulk-assign — they cannot drift
  apart.
- The staffing policy (which role fills FIELD vs OFFICE) is **data** in
  `assignment_pool_roles`, changeable without a deploy.
- Territory correctness is enforced at the **task** grain and re-verified
  server-side, so a tampered or stale client pick is rejected.

### Negative

- Eligibility is a non-trivial SQL predicate (role mapping + hierarchy + territory
  EXISTS); it must stay in lockstep with the visibility engine's geo legs (ADR-0022)
  or pool and visibility diverge.
- FIELD assignment requires the task to already know its area + pincode, coupling
  dispatch to the location-capture flow.

## Alternatives Considered

- **Hardcode the pool role per visit type** (e.g. `FIELD ⇒ FIELD_AGENT`). Rejected
  — staffing is an operational policy; moved to the `assignment_pool_roles` table.
- **Trust the frontend's offered `assigneeId`.** Rejected — the server re-checks
  eligibility on every assign (assign-at-create and reassign).
- **Territory at the case level.** Rejected — a case can hold FIELD tasks in
  different locations, so eligibility must be matched per task.

## Related ADRs

- ADR-0002 — Case → Task → Verification Unit model (what is being assigned).
- ADR-0022 — Access Control 2.0: roles, permissions & scope dimensions (the
  hierarchy scope and `user_scope_assignments` territory legs this pool intersects).
- ADR-0023 — Case/Task dispatch fields + applicant targeting (carries the
  per-task visit type / location this pool consumes; first referenced this ADR).
- ADR-0016 / ADR-0018 — Rate Management (the live rate-type resolution at assign).
- ADR-0032 / ADR-0033 — Case/Task lifecycle and reassign-after-revoke (reuse this
  pool model).
