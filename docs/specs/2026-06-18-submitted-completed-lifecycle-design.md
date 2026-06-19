# Two-stage task completion (SUBMITTED → COMPLETED) — design spec

Implements [ADR-0047](../adr/ADR-0047-two-stage-task-completion.md). Coordinates with
[ADR-0046](../adr/ADR-0046-commission-location-and-tat-dimensions.md) on the commission laterals.

## Goal

Split the single `COMPLETED` terminal into two real stages with two actors and two credits:

| Stage | Actor | Trigger | Credit |
|---|---|---|---|
| **SUBMITTED** | field executive (mobile) | submits the verification form | **field commission** + "submitted" count |
| **COMPLETED** | office (web) | adds report + official result | **client billing** (bill amount) + "completed" count |

Lifecycle: `PENDING → ASSIGNED → IN_PROGRESS → SUBMITTED → COMPLETED` (+ `REVOKED`, `CANCELLED`).

## Backend (apps/api) — touch-points

### 1. Status value + submit timestamps (migration `0081` — 0080 = commission snapshot; confirm tail at build)
- **Precondition (safety):** `SELECT count(*) FROM case_tasks WHERE status='SUBMITTED_FOR_REVIEW'` must be `0` (dev = 0 confirmed; verify on prod). The migration asserts this, then narrows the CHECK.
- Rewrite `chk_case_task_status` (current def `db/v2/migrations/0037_case_task_dispatch_fields.sql:62-66`): drop `SUBMITTED_FOR_REVIEW`, add `SUBMITTED` →
  `('PENDING','ASSIGNED','IN_PROGRESS','SUBMITTED','COMPLETED','REVOKED','CANCELLED')`.
- Add `case_tasks.submitted_at timestamptz` + `case_tasks.submitted_elapsed_minutes integer` (mirror of
  `completed_at`/`completed_elapsed_minutes`, stamped at SUBMIT; drive the field-commission anchor + submit-in band + mobile display).
- No change to `cases.status` CHECK (`0052_case_lifecycle.sql:31-33`) — no new case status.

### 2. SDK contract (`packages/sdk/src/cases.ts`)
- `CASE_TASK_STATUSES` (`:41-49`): remove `SUBMITTED_FOR_REVIEW`, add `SUBMITTED`. Fix the stale "device
  collapses SFR→COMPLETED" comment (`:37-39`).
- Add `submittedAt?: string | null` to `CaseTaskView` (`:162+`). Add a `SUBMITTED` label ("Submitted").
- `pnpm openapi` after.

### 3. Device write path (`apps/api/src/modules/verification-tasks/service.ts` + `cases/repository.ts`)
- New repo writer `submitTaskByDevice` (mirror `completeTaskByDevice` `repository.ts:1089-1120` but
  `→ SUBMITTED`, stamp `submitted_at`, **not** `completed_at`/`completed_by`).
- `submitForm` (`service.ts:179-190`, the submit==complete chokepoint): persist the form blob, then call
  `submitTaskByDevice` (was `completeTaskByDevice`).
- Device `start`→`complete` (`service.ts:116,122`): the bare device `/complete` also lands `SUBMITTED`
  (the device has no "office complete" concept). Keep `revoke` as-is.
- Emit `case:updated` (ADR-0027, already wired) with the new status.

### 4. Office complete (already exists — reuse)
- `cases/service.ts:319-326` complete-guard from-set `{ASSIGNED, SUBMITTED_FOR_REVIEW}` → **`{ASSIGNED, SUBMITTED}`**.
- `cases/repository.ts:703-741` already writes `COMPLETED` + `verification_outcome` + remark +
  `completed_by` + `completed_at`. No change beyond the from-set rename.
- `recordTaskResult` (`service.ts:345-366`, status-unchanged result edit) — review; likely still valid for
  post-completion result edits.

### 5. Case rollup (`cases/repository.ts:101-127` `recomputeCaseStatus`)
- Add `SUBMITTED` to the **active** bucket (currently `PENDING/ASSIGNED/IN_PROGRESS`) so a fully-submitted
  case stays `IN_PROGRESS` until the office completes. `AWAITING_COMPLETION` (all `COMPLETED`) + finalize
  unchanged.

### 5b. Revoke & revisit (owner-confirmed — NO transition change)
- **Revoke is allowed ONLY while `ASSIGNED` or `IN_PROGRESS`** (office BE + FE users; the field
  device-revoke for an unworkable task stays within these states too). Transition unchanged:
  `{ASSIGNED, IN_PROGRESS} → REVOKED` (`cases/repository.ts revokeTaskInPlace`, shared device+office).
- A **`SUBMITTED`** task (field form submitted) and a **`COMPLETED`** task are **NOT revocable.** The
  only redo path is the office creating a **REVISIT** — a new lineage-linked task (same or different
  data, same or different field user) that is **billed separately** (existing `revisitTask`, ADR-0033).
- **Mobile Save vs Submit:** "Save" is a LOCAL draft (existing `is_saved` / "Saved" tab) — the task is
  still `ASSIGNED`/`IN_PROGRESS` and revocable. "Submit" moves it to `SUBMITTED` — the field terminal,
  not revocable.
- **Commission stickiness is automatic:** field commission fires on `SUBMITTED` and cannot be reversed
  by a revoke (none is possible post-submit); a revisit is a NEW task that earns its own commission.

### 6. Billing — as-built PERSISTED snapshot (ADR-0046 §4)
- **Freeze field commission at SUBMIT:** move `stampCommissionSnapshot(q, taskId)` (`cases/repository.ts:43`)
  out of the COMPLETE writers (`completeTask:776`, `completeTaskByDevice:1158`) into the new device-submit
  writer (`submitTaskByDevice`). Do **not** re-stamp at office COMPLETE.
- **Submit-anchored lateral + band:** extend `COMMISSION_LATERAL` (`platform/billing/laterals.ts`) anchor
  `COALESCE(ct.completed_at, now())` → `COALESCE(ct.submitted_at, ct.completed_at, now())` and the band
  elapsed `ct.completed_elapsed_minutes` → `COALESCE(ct.submitted_elapsed_minutes, ct.completed_elapsed_minutes)`,
  so the snapshot resolves the executive's rate + submit-in band as-of submit (office-only tasks fall back
  to completed). Keep `COMPLETED_BAND` (`billing/repository.ts:45`, the **display/client-TAT** band) on
  `completed_elapsed_minutes`/`completed_at`.
- **Read-gate:** widen the commission row gate `status='COMPLETED'` → `status IN ('SUBMITTED','COMPLETED')`
  in the **one** shared `buildBillingWhere` (`billing/repository.ts:79-80`, used by listCases+breakdown)
  AND the `caseTasks` inline gate (`:156`). The read-model already `COALESCE(ct.commission_amount,
  com.commission_amount)` (`:120,148,177,193`) → field commission shows for SUBMITTED with no further change.
- **Null the client bill for non-COMPLETED rows:** `CASE WHEN ct.status='COMPLETED' THEN rt.bill_amount END`
  so a SUBMITTED task contributes commission but **zero** client bill. RATE_LATERAL untouched (fixed by ADR-0048).

### 7. Read-models that bucket SFR today (update to SUBMITTED)
- `dashboard/repository.ts:23` (`OPEN_HELD`) and `field-monitoring/repository.ts:16,19` reference
  `SUBMITTED_FOR_REVIEW` — repoint to `SUBMITTED` (and decide its bucket: "submitted, awaiting office").

## Web (apps/web)
- Add a **"Submitted"** status tone/label (Pipeline `STATUS_TONE`, the SDK label map, CaseDetailPage).
  Tone: `st-under-review` (or `st-in-progress`). *(This is the real-status version of the tone work
  reverted earlier — now justified because SUBMITTED is a surfaced status.)*
- Office complete flow (Case-Detail `CompleteForm`) unchanged — it already drives SUBMITTED→COMPLETED.
- Pipeline/Case grids: a `SUBMITTED` filter bucket (field-done worklist for the office).

## Mobile (`crm-mobile-native`, separate repo — new release v1.0.71+)
- `src/types/enums.ts:4-13`: add `Submitted = 'SUBMITTED'`.
- `src/sync/SyncDownloadService.ts:434-447`: **remove** the `SUBMITTED_FOR_REVIEW → COMPLETED`
  normalization; map the server's `SUBMITTED` to local `SUBMITTED` (stamp `submitted_at`).
- `src/usecases/SubmitVerificationUseCase.ts:281` (+ `CompleteTaskUseCase.ts:39-41`): write
  `TaskStatus.Submitted` on submit (was `Completed`).
- Navigation `src/navigation/RootNavigator.tsx:169-175,260-286`: add a **Submitted** tab; new
  `src/screens/tasks/SubmittedTasksScreen.tsx` (`defaultFilter="SUBMITTED"`, mirror CompletedTasksScreen).
- `src/screens/tasks/TaskListScreen.tsx:56-62` `FILTER_TABS`: add `SUBMITTED`.
- `src/projections/TaskListProjection.ts:68-91,159-167` + `src/repositories/TaskRepository.ts`: add the
  `SUBMITTED` bucket to filtering + counts. No mobile DB migration (status is free-text `TEXT`).

## Rollout & migration safety
1. **No rollout coordination needed (owner-confirmed):** the mobile app is **not live and has no current
   users** (being reconnected to v2), so emitting the new `SUBMITTED` value is **safe to do directly** —
   no version-gate, feature flag, or forced-update sequencing. The new app behavior + API ship together.
2. **CHECK narrowing** runs only after the zero-SFR-rows assertion passes (dev=0; verify prod).
3. **Triple-write the migration** (file → test:5433 auto → dev psql) per the standing invariant.

## Testing
- API: device submit → `SUBMITTED` (+`submitted_at`/`submitted_elapsed_minutes`, `verification_outcome`
  NULL, **commission_amount stamped here**); office complete → `COMPLETED` (commission NOT re-stamped);
  case rollup stays IN_PROGRESS while a task is SUBMITTED.
- Billing (extend `billing.commission.test.ts`): a **SUBMITTED (not yet completed)** task **contributes
  field commission but NOT client bill**; a COMPLETED task shows both; **keep the existing completed-case
  §E assertions green**; band-specific rate resolves the **submit-in** band.
- Integration: full PENDING→…→SUBMITTED→COMPLETED with DB assertions at each hop; `case:updated` realtime
  fires on submit + complete.
- Mobile: submit → Submitted tab (not Completed); office complete → moves to Completed on next sync.
- Gate: `pnpm verify` green (scoped, `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C`)
  + `pnpm openapi` no unexpected diff. **⚠ then watch the CI `ci` workflow** — e2e/Playwright (axe a11y +
  viewports) is NOT in `pnpm verify`; a green local verify can still red CI (e.g. axe `scrollable-region-focusable`).

## Resolved decisions (owner, 2026-06-18)
1. **Revoke-after-submit:** `SUBMITTED`/`COMPLETED` are **NOT revocable**; revoke stays
   `{ASSIGNED,IN_PROGRESS}→REVOKED`; redo is **REVISIT** (separate bill). Field commission is naturally
   non-reversible. (See §5b.)
2. **FE-throughput metric:** **deferred** (owner unsure; `completed_by` already captured → easy to add later).
3. **Rollout:** **no coordination** — app not live / no current users → ship directly. (See Rollout §1.)
4. **ADR-0046 order:** the concurrent **commission-dimensions rework lands FIRST**; this lifecycle change
   **rebases on top of its laterals**. ⇒ Do NOT start the billing-gate edits (§6) until ADR-0046 is in;
   the status/lifecycle/mobile parts (§1–§5b, mobile) can proceed in parallel.
