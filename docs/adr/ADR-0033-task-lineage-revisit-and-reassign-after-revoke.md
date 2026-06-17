# ADR-0033: Task lineage — REVISIT and REASSIGN-AFTER-REVOKE

- **Status:** Accepted
- **Date:** 2026-06-15

## Correction (2026-06-16) — the backend DOES revoke a live task

The original cut of this ADR over-corrected and removed backend revoke entirely.
The owner's actual rule (confirmed against v1 `verificationTasksController.revokeTask`,
perm `task.revoke`) is narrower: **the backend/office CAN revoke a LIVE task —
ASSIGNED or IN_PROGRESS — it just cannot revoke a COMPLETED one** (a completed task
is reworked via REVISIT). So `task.revoke` is **re-established** (BACKEND_USER +
MANAGER; mig 0056), and `POST /api/v2/cases/:id/tasks/:taskId/revoke` performs the
same DB transition as the device revoke ({ASSIGNED,IN_PROGRESS}→REVOKED, reason
mandatory, COMPLETED/PENDING→409, already-REVOKED idempotent) — scope-bound instead
of ownership-bound, via the shared repo method `revokeTaskInPlace`. The statements
below that say "the backend never revokes / removed entirely" are superseded by this
section; everything else (revisit, reassign-after-revoke, verdict history) stands.

## Context

ADR-0032 (the two-track lifecycle) listed "revisit/recheck + revoke" as slice 3
but left the exact semantics to v1 parity. The owner clarified the operational
model (2026-06-15), and v1's `verificationTasksController` confirms it:

- **REVOKE is a device action, not an office one.** A field/verifier user revokes
  their own assigned task on the device (already built — ADR-0032 slice 2c-1,
  `task.execute`). The backend NEVER revokes a task, and **must not** revoke a
  COMPLETED one. The frozen RBAC §8 line that named a `task.revoke` web perm
  (BACKEND_USER/MANAGER, revoking ASSIGNED/IN_PROGRESS/COMPLETED) was wrong.
- After a device revoke, the **office dispatches the work again** by creating a
  **replacement** task (v1 `createReplacementTask`: a new row, `parent_task_id`
  = the revoked task, same task type, born ASSIGNED). The revoked row stays
  REVOKED. **No additional commission** — it is the redo of unpaid/revoked work.
- **REVISIT** (v1 `visit.revisit`) is for a **COMPLETED** task: the client asks
  for more after delivery → a NEW task cloning the completed parent, which
  re-opens the case (COMPLETED → IN_PROGRESS) and is **billed separately**.
  v1 blocks revisit on a non-COMPLETED parent (`REVISIT_REQUIRES_COMPLETED_PARENT`)
  and on a second active sibling (`REVISIT_BLOCKED_BY_ACTIVE_SIBLING`).
- **RECHECK** in v1 is the KYC-document analog of REVISIT (separate KYC engine).
  v2 treats KYC as a unit subtype with no separate engine, so the mechanic is
  identical — the owner chose to **collapse RECHECK into REVISIT** for now.

## Decision

We add **task lineage** (`case_tasks.parent_task_id` self-FK + `task_origin`
`ORIGINAL`/`REVISIT`, partial index — migration 0054) and two office
interventions, **both gated by one new perm `task.rework`** (BACKEND_USER +
MANAGER; SUPER_ADMIN via grants_all). There is **no** backend revoke perm.

- **`POST /cases/:id/tasks/:taskId/revisit`** — the parent must be **COMPLETED**
  (else 409 `INVALID_TRANSITION`); a second open revisit of the same parent is
  blocked (409 `ACTIVE_REVISIT_EXISTS`). Creates a NEW task cloning the parent's
  CPV + applicant + address + trigger + priority + visit type + location, born
  **PENDING** (the office dispatches it via the normal assign flow), with
  `task_origin='REVISIT'` and `parent_task_id` set. The single rollup writer
  (`recomputeCaseStatus`) re-opens the case and invalidates the verdict.
- **`POST /cases/:id/tasks/:taskId/reassign`** — the parent must be **REVOKED**
  (else 409). The chosen assignee is re-checked against the SAME pool as a normal
  reassign (visit-type pool ∩ hierarchy ∩ FIELD territory, against the revoked
  task's own location) → 400 `INVALID_ASSIGNEE`. Creates a NEW **replacement**
  task (cloning the revoked task's CPV + applicant + address + location, born
  **ASSIGNED** with the operator's re-picked pool/bill), **keeping the parent's
  `task_origin`** (no extra bill), lineage-linked, with an `ASSIGNED` history
  event whose `previous_assigned_to` is the revoked assignee. The revoked row is
  never re-activated (mobile landmine #2 — the device purges a re-activated task).

Gating both on `task.rework` (rather than reopening the frozen `case.assign`,
which is MANAGER/TL only) lets the office (BACKEND_USER) drive both flows without
a blanket assign capability, matching the owner's "backend does this" model.

## Consequences

### Positive

- Faithful v1 parity for the operational reality (device revoke → office redo;
  client-asks-more → billed revisit), grounded in `verificationTasksController`.
- `task_origin` is the billing class the commission gate (slice 5) reads:
  `REVISIT` bills additionally; a reassign replacement keeps `ORIGINAL` (one bill).
- Lineage (`parent_task_id`) gives MIS/audit a re-verification trail.
- Re-open + verdict invalidation reuse the existing single rollup writer — no new
  case-status path, no deadlock surface.

### Negative

- `task.rework` gates an assignment-creating action (reassign) outside the normal
  `case.assign` perm — a deliberate, documented divergence. If BACKEND_USER should
  also assign normal tasks, that is a separate perm grant.
- The active-sibling guard is per-parent (simpler than v1's per-verification-type
  on the case). Sufficient to stop double-billing the same completed task; a
  broader rule can be added if a real case needs it.

## Alternatives Considered

- **Backend revoke in place (the original slice-3 build).** Rejected by the owner:
  the backend never revokes, and never a COMPLETED task. Removed entirely.
- **Reassign in place (flip REVOKED → ASSIGNED on the same row).** Rejected: loses
  the revoked-row audit trail v1 keeps; the replacement-row model is v1 parity.
- **Keep RECHECK as a distinct origin now.** Deferred: v2 has no separate KYC
  engine, so the mechanic is identical; re-adding RECHECK is a one-line migration
  + enum entry if a real distinction emerges.
- **Let the operator change location at reassign.** Rejected: v2's assign model
  sets location at task creation, not at assign-time; the replacement clones the
  parent's location (the operator re-picks pool/assignee/bill, as in a reassign).

## Related ADRs

- ADR-0032 — the two-track lifecycle this slice (slice 3) completes; supersedes
  its §8 "task.revoke (web)" line and its §7 REVISIT/RECHECK split.
- ADR-0024 — the visit-type assignment pool + territory eligibility reused here.
- ADR-0012 — the locked mobile contract (device revoke stays on `task.execute`).
