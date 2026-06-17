# ADR-0032: Case/Task Lifecycle — Two-Track Completion, Single-Layer Result, Case-Level Verdict

- **Status:** Proposed
- **Date:** 2026-06-15

## Context

The v2 case/task lifecycle was half-built (audit `docs/specs/2026-06-15-lifecycle-audit/`):
the case status never rolled up to COMPLETED (no rollup service), 4 of 7 task statuses had no
producer, there was **no field-submission ingest** at all (IN_PROGRESS / SUBMITTED_FOR_REVIEW
unreachable), and the office `complete` accepted a state nothing created. v1's production model is a
two-layer result (field assessment vs backend decision) that suffers a proven fragmentation bug
(VT-000199: the client report prints a stale rollup column, never the backend decision). Zion uses
one result set once. The mobile app is unchanged, on `/api/mobile` (v1), and has a fatal landmine:
re-opening a delivered task silently loses work (photos purged). A robust v2 lifecycle must be
designed end-to-end across v2-BE/FE, mobile, and informed by v1 + Zion.

## Decision

We will adopt a **two-track completion model** with a **single-layer, office-authored result**:

1. **Single-layer (D1).** The field agent / device submits **evidence only** — never a result.
2. **Two tracks (D2).** A field submission **auto-completes the TASK** (no mandatory review queue
   blocking the agent). The office **completes the CASE** as a separate downstream action.
3. **Result model (D3).** The backend records a **per-task result** for every task
   (`case_tasks.verification_outcome`, kept from ADR-0025 as the office per-task report); from those
   the office decides **ONE final case verdict** (`cases.verification_outcome`). The client report
   prints the per-task results **and** the one final verdict. A revisit/recheck re-opens the case and
   **invalidates the verdict** (must re-finalize) to prevent staleness.
4. **Mobile delivery (D4).** Build the ingest spine as native `/api/v2` endpoints honoring the locked
   contract **shapes/headers/Idempotency-Key/409-semantics** (ADR-0012); the device is rebased
   `/api/mobile/* → /api/v2/*` (path-only) in a coordinated release — an accepted prerequisite.
5. **Rework = always a NEW task** (revisit/recheck with `parent_task_id` lineage); never re-open a
   delivered task (device-safety). Revoke is in-place, no commission.
6. **Status machines:** TASK `PENDING→ASSIGNED→IN_PROGRESS→COMPLETED` (+REVOKED/CANCELLED);
   CASE `NEW→IN_PROGRESS→AWAITING_COMPLETION→COMPLETED` (+REVOKED/CANCELLED), driven by a single
   in-tx rollup service; CASE COMPLETED is set only by `case.finalize` (never auto) and is
   re-openable.
7. **Commission stays task-based** — accrues on TASK COMPLETED & !REVOKED, independent of the verdict.
8. **RBAC:** new perms `task.execute` (FIELD_AGENT, own-assigned), `task.revoke`, `case.finalize`,
   `case.revoke`; KYC_VERIFIER read-only. `cases` gains an OCC `version` column.

Full spec: `docs/specs/2026-06-15-lifecycle-design/2026-06-15-v2-lifecycle-redesign.md`.

## Consequences

### Positive

- Fixes v1's result fragmentation: the printed verdict is an explicit office decision, coherent by construction.
- Field agents never wait in a review queue; the unchanged device's "submit == complete" mental model holds.
- Device-safe by design — rework is new tasks, dodging the silent-work-loss landmine.
- Completes the missing ingest spine and the missing case rollup; no dead enum states.

### Negative

- Reopens prior framing: supersedes the kickoff "task is the unit of record / FE≠backend result"
  invariant (now: case is the unit of the official verdict; task is the unit of work/billing).
- Requires a coordinated mobile release before real-device lifecycle works (D4).
- Two result columns (per-task + case) must keep distinct meanings; enforced by verdict-invalidation
  on re-open and by build discipline.
- The cases list's missing row-level scope must be closed before slice 1 (Security, blocking).

## Alternatives Considered

- **v1 two-layer result (field-assessment ≠ backend-decision).** Rejected by owner — added complexity
  and is the source of v1's fragmentation; single-layer office-authored is simpler and coherent.
- **Mandatory office review gate (SUBMITTED_FOR_REVIEW per task).** Rejected by owner — blocks the
  field agent; the two-track model gives separation (office owns the verdict) without a per-task gate.
- **Byte-compat mobile surface on v2 (device unchanged).** Rejected by owner in favour of native
  `/api/v2` + a device rebase (cleaner long-term).
- **Auto-complete the case from task rollup.** Rejected — the office must own the authoritative
  verdict; COMPLETED is never automatic.

## Related ADRs

- ADR-0012 — locked mobile contract (honored; path-only rebase).
- ADR-0023 — case/task dispatch fields & applicant targeting (feeds the contract).
- ADR-0024 — field/office assignment pool (assignment leg).
- ADR-0025 — KYC desk verification & task finalize (per-task result column **kept**, re-scoped as the
  office per-task report; the office `complete` no longer the case-level authority).
- ADR-0021 — object storage (attachment ingest).
