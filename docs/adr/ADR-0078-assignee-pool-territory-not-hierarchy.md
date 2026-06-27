# ADR-0078: The assignee pool is gated by territory/unit-grant, not the actor's org-hierarchy

- **Status:** Accepted
- **Date:** 2026-06-27
- **Relates to:** ADR-0024 (field/office assignment pool), ADR-0022 (RBAC + data-scope), ADR-0073 (KYC unit-grant eligibility), ADR-0065 (case-creation grant + write scope). No migration.
- **Supersedes:** the org-hierarchy leg of the assignee pool only (ADR-0024 point 3). Case/task **visibility** scoping (ADR-0022) is unchanged.

## Context

A `BACKEND_USER` granted `case.assign` could not assign **any** field executive at case creation —
the "Executive (Field)" picker always showed *"No field executive covers this pincode/area"*, no
matter how the territory was assigned in Admin → User Management.

Root cause: the eligible-assignee pool (ADR-0024) was the intersection of three legs —

1. role = the pool role for the visit type (`assignment_pool_roles`: FIELD → `FIELD_AGENT`, OFFICE → `KYC_VERIFIER`),
2. eligibility for the work — **FIELD**: an active territory assignment matching the task's pincode/area; **OFFICE** (ADR-0073): a grant for the task's verification unit,
3. **the actor's org-hierarchy scope** (`getScopedUserIds` — the same set used for case visibility).

Leg 3 collapses the pool to the actor's own visibility set, which for a `SELF`-hierarchy role
(`BACKEND_USER`, the seeded default) is **just the actor**. Field agents are never the backend user
themselves, so the pool was always empty — the territory (leg 2) was never even evaluated. The same
applied to OFFICE: a `SELF`-hierarchy operator could not assign a KYC verifier either.

Field/desk assignment is fundamentally **territory-/unit-based**, not org-tree-based: who can physically
work a pincode is governed by territory coverage, not by who reports to whom. Leg 3 was the wrong gate
for this pool — it conflated "whose rows can I see" with "who can do this task".

## Decision

**Remove the org-hierarchy leg from the assignee pool.** The pool is now:

- role for the visit type **∩** (FIELD) the task's territory **/** (OFFICE) the task's unit grant.

The action is still gated by:

- **`case.assign`** (route authorization) — only an assigner reaches the pool at all, and
- **case/task visibility** — `addTasks` / `assign` / `bulkAssign` / `reassign-after-revoke` each
  scope-guard the case or task (`resolveScope` → `caseVisible` / `tasksForAssignment`) **before** the
  pool is built. An actor still can only assign within cases/tasks they can see.

Concretely, the hierarchy cap (`scopeUserIds` / `AND u.id = ANY(...)`) is dropped from the three pool
functions and their callers:

- `cases/repository.ts` `eligibleAssigneesForNew` (Add-Task picker + the assign-at-create server re-check),
- `tasks/repository.ts` `eligibleAssignees` (reassign / bulk-assign picker) and `eligibleTaskIdsForAssignee`
  (per-row assign / bulk / reassign-after-revoke server re-check).

The generic, non-territory `assignableUsers` list (the cases-list assignee **filter**, no task context)
stays hierarchy-scoped — it is a visibility filter, not the work-eligibility pool.

## Consequences

- A `BACKEND_USER` (or any `case.assign` holder) now sees **every** executive covering the chosen
  territory / granted the chosen unit, regardless of org tree — matching the owner's model that the
  territory is the access control (owner decision, 2026-06-27).
- **No data widening.** The pool only returns executive name/role (already exposed to assigners).
  Which **cases/tasks** an actor can see or act on is unchanged — that scoping (ADR-0022) is enforced
  separately and untouched. The endpoint was already case-independent and `case.assign`-gated.
- Creation, reassign, and bulk-assign stay in lock-step (the ADR-0024 invariant) because all three
  pool functions changed together; an assignee offered by the picker can never be rejected by the
  server re-check on hierarchy grounds.
- Supervisor scoping (a TEAM_LEADER previously saw only their team's agents in the pool) is relaxed:
  any covering agent is now assignable by any `case.assign` holder. This is the intended trade — the
  territory, not the reporting line, decides who can work a pincode.
- **Regression-proofed** — `cases.api.test.ts` seeds a `SELF`-hierarchy role with `case.assign` and a
  field agent covering a territory who reports to no one, and asserts the agent appears in
  `eligible-assignees`. Re-introducing the hierarchy cap flips that assertion and fails the test.
- No migration; no schema change. `BACKEND_USER` keeps `hierarchy_mode = SELF` (case visibility
  intentionally stays narrow) — only the assignee pool stops reading it.
