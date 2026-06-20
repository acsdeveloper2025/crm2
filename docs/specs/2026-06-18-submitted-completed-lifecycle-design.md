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

### 1. Status value (migration `0077`, deconflict number with concurrent ADR-0044/0046 work)
- **Precondition (safety):** `SELECT count(*) FROM case_tasks WHERE status='SUBMITTED_FOR_REVIEW'` must be `0` (dev = 0 confirmed; verify on prod). The migration asserts this, then narrows the CHECK.
- Rewrite `chk_case_task_status` (current def `db/v2/migrations/0037_case_task_dispatch_fields.sql:62-66`): drop `SUBMITTED_FOR_REVIEW`, add `SUBMITTED` →
  `('PENDING','ASSIGNED','IN_PROGRESS','SUBMITTED','COMPLETED','REVOKED','CANCELLED')`.
- Add `case_tasks.submitted_at timestamptz` (additive; the field-commission date window + mobile display).
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

### 6. Billing gates (coordinate with ADR-0046 — same files)
- **Field commission → SUBMITTED**: change the read-model gate from `status='COMPLETED'` to
  `status IN ('SUBMITTED','COMPLETED')` for the *commission* (field payout, `COMMISSION_LATERAL` keyed
  `assigned_to`) — `tasks/repository.ts:131,197` (commissionable), and wherever commission is summed for
  payout. Date by `submitted_at`.
- **Client billing → COMPLETED (unchanged)**: the *billable* / bill-amount (`RATE_LATERAL`) stays
  `status='COMPLETED'` — `billing/repository.ts:48,117`, `tasks/repository.ts:78` (`billable`).
- ⚠️ `laterals.ts` + these read-models are also edited by ADR-0046 — sequence/merge, don't develop blind.

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
- API: device submit → `SUBMITTED` (+`submitted_at`, `verification_outcome` NULL); office complete →
  `COMPLETED`; case rollup stays IN_PROGRESS while a task is SUBMITTED; commission appears at SUBMITTED;
  bill amount appears only at COMPLETED; revoke policy (below).
- Integration: full PENDING→…→SUBMITTED→COMPLETED with DB assertions at each hop; the `case:updated`
  realtime fires on submit + complete.
- Mobile: submit → Submitted tab (not Completed); office complete → moves to Completed on next sync.
- Gate: `pnpm verify` green (scoped); `pnpm openapi` no unexpected diff.

## Resolved decisions (owner, 2026-06-18)
1. **Revoke-after-submit:** `SUBMITTED`/`COMPLETED` are **NOT revocable**; revoke stays
   `{ASSIGNED,IN_PROGRESS}→REVOKED`; redo is **REVISIT** (separate bill). Field commission is naturally
   non-reversible. (See §5b.)
2. **FE-throughput metric:** **deferred** (owner unsure; `completed_by` already captured → easy to add later).
3. **Rollout:** **no coordination** — app not live / no current users → ship directly. (See Rollout §1.)
4. **ADR-0046 order:** the concurrent **commission-dimensions rework lands FIRST**; this lifecycle change
   **rebases on top of its laterals**. ⇒ Do NOT start the billing-gate edits (§6) until ADR-0046 is in;
   the status/lifecycle/mobile parts (§1–§5b, mobile) can proceed in parallel.
