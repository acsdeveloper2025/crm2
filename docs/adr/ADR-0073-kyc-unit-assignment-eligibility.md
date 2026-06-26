# ADR-0073: KYC-unit assignment eligibility

- **Status:** Accepted
- **Date:** 2026-06-26
- **Relates to:** ADR-0024 (the assignee-eligibility pool), ADR-0070 (visit-type decoupled from the unit), ADR-0022 (data scope — explicitly NOT extended here).

## Context

KYC verifiers work OFFICE (desk) tasks. Today the OFFICE assignee pool is **every** `KYC_VERIFIER` in the
actor's hierarchy — there is no per-unit control. The owner wants a KYC verifier to be assignable only the
**specific KYC units** they've been granted: when assigning an OFFICE task for a unit, the picker shows only
KYC users who hold that unit's access. A KYC verifier still **sees only tasks assigned to them (SELF)**.

The key design point (the owner corrected this twice): this is **assignment ELIGIBILITY**, not
scope-visibility. A scope dimension would let a KYC user *see* all tasks of their units — wrong. So it must be
a separate eligibility store the assignee picker consults but the visibility resolver never reads.

## Decision

A new **eligibility-only** table `user_kyc_unit_access (user_id, verification_unit_id, is_active, …)`,
unique on `(user_id, verification_unit_id)` (migration 0100). **Required-grant model**: a KYC user is
assignable an OFFICE task ONLY for units they're granted; no grant ⇒ not assignable for that unit.

- **Eligibility** — the three OFFICE-pool functions (`cases/repository.ts eligibleAssigneesForNew`;
  `tasks/repository.ts eligibleAssignees` + `eligibleTaskIdsForAssignee`) gain an OFFICE leg: the assignee
  must hold an active grant for the task's `verification_unit_id`. The OFFICE branch is a `CASE` (not an
  added disjunct) so the existing "unlocated task ⇒ no territory gate" clause cannot leak an OFFICE task
  through. Every assign WRITE re-validates through these functions → **fail-closed** (no IDOR). FIELD
  territory eligibility is unchanged.
- **Grant API/UI** — `GET/PUT /users/:id/kyc-units` (the set-the-set; `page.users` read, `user.manage`
  write); a grant editor on the user record page's Access tab, shown for KYC-verifier (OFFICE-pool-role)
  users, granting **any active verification unit** (field or office — a KYC verifier can be OFFICE-assigned
  a task at any unit, since ADR-0070 decoupled visit type from the unit). The grantee role is resolved from
  `assignment_pool_roles` (data-driven, no role-name literal).
- **Visibility — UNCHANGED.** The grant table is read ONLY by the eligibility functions, never by the scope
  resolver. KYC verifiers stay SELF.
- **Deploy backfill** — mig 0100 grants every existing KYC-verifier user every active verification unit, so
  live OFFICE assignment (today an open pool) does not break on deploy; admins prune afterward.

## Consequences

### Positive
- Per-unit control over who can be assigned a desk task, with no change to visibility.
- Fail-closed at the write; the picker is just a UI projection of the same predicate.

### Negative
- The OFFICE eligible-assignees endpoint now needs the task's `verificationUnitId` (the FE passes the chosen
  unit) — an additive query param.
- OFFICE assignment now requires a grant for the task's unit, so an admin must grant a KYC verifier the
  relevant units before assigning them desk work (the deploy backfill preserves the open pool for existing
  users; new users/units need explicit grants). Any unit is grantable — a FIELD-unit task assigned OFFICE
  (legal since ADR-0070 decoupled visit type from the unit) just needs the assignee granted that unit.

## Alternatives Considered
- **A scope-visibility dimension for KYC units** — rejected (would widen what KYC users SEE beyond SELF).
- **Optional grants (filter, not gate)** — rejected by the owner (a user with no grants would stay eligible
  for all units; the requirement is "shows only KYC users who have that unit's access").
- **Empty-table deploy (no backfill)** — rejected (would block all live OFFICE assignment until admins grant).

## Related ADRs
- ADR-0024 (assignee eligibility — extended here) · ADR-0070 (visit/unit decoupling) · ADR-0022 (data scope — deliberately NOT used).
