# SUBMITTED→COMPLETED — API backend implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make `SUBMITTED` a real `case_tasks` status (field submit) distinct from `COMPLETED` (office adds report+result), freeze the persisted field commission at SUBMIT, and split the billing read-model so commission shows at SUBMITTED while the client bill stays at COMPLETED.

**Architecture:** Implements [ADR-0047](../adr/ADR-0047-two-stage-task-completion.md) on the as-built persisted-commission model (ADR-0046 §4). Reuse: the office complete endpoint already accepts SUBMITTED→COMPLETED; `stampCommissionSnapshot` moves from COMPLETE to SUBMIT; `buildBillingWhere` widened once.

**Tech Stack:** Node 24, pnpm monorepo, Postgres 18, vitest + supertest. Gate: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm verify` then watch CI `ci` workflow.

**Scope:** API only (`apps/api`, `packages/sdk`, `db/v2/migrations`). Web UI + mobile are separate follow-on plans. No push without owner OK.

---

### Task 1: Migration 0081 — status value + submit timestamps

**Files:** Create `db/v2/migrations/0081_case_tasks_submitted.sql`

- [ ] **Step 1: Precondition + CHECK narrow + columns.** Assert zero SFR rows (raise if any), drop+re-add `chk_case_task_status` with `SUBMITTED` replacing `SUBMITTED_FOR_REVIEW`, add `submitted_at timestamptz` + `submitted_elapsed_minutes integer`. Wrap in BEGIN/COMMIT, idempotent (`ADD COLUMN IF NOT EXISTS`).

```sql
-- 0081_case_tasks_submitted.sql — real SUBMITTED status (field-done) + submit timestamps (ADR-0047).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM case_tasks WHERE status = 'SUBMITTED_FOR_REVIEW') THEN
    RAISE EXCEPTION 'ADR-0047: rows hold SUBMITTED_FOR_REVIEW; migrate them before narrowing the CHECK';
  END IF;
END $$;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS submitted_elapsed_minutes integer;
ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_task_status;
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_task_status CHECK (
  status IN ('PENDING','ASSIGNED','IN_PROGRESS','SUBMITTED','COMPLETED','REVOKED','CANCELLED'));
COMMIT;
```

- [ ] **Step 2: Apply to test DB + dev DB** (triple-write). Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api exec vitest run src/modules/system 2>&1 | tail` (template rebuild applies it) and `psql postgresql://postgres@127.0.0.1:54329/crm2_dev -f db/v2/migrations/0081_case_tasks_submitted.sql`. Expected: no error.
- [ ] **Step 3: Commit.** `git add db/v2/migrations/0081_case_tasks_submitted.sql && git commit -m "feat(db): 0081 — real SUBMITTED status + submit timestamps (ADR-0047)"`

---

### Task 2: SDK contract — SUBMITTED value + label + submittedAt

**Files:** Modify `packages/sdk/src/cases.ts`

- [ ] **Step 1: Failing test.** In `packages/sdk/src/*.test.ts` (or a new `cases.contract.test.ts`), assert `CASE_TASK_STATUSES` includes `'SUBMITTED'` and excludes `'SUBMITTED_FOR_REVIEW'`. Run → FAIL.
- [ ] **Step 2: Edit `cases.ts`.** In `CASE_TASK_STATUSES` (line ~41-49) replace `'SUBMITTED_FOR_REVIEW'` with `'SUBMITTED'`; fix the stale comment (~37-39 — remove "device collapses SFR→COMPLETED"). Add `CASE_TASK_STATUS_LABELS` entry `SUBMITTED: 'Submitted'` if a task-status label map exists (else note for web). Add `submittedAt?: string | null` to `CaseTaskView`.
- [ ] **Step 3: Run test → PASS.** Then `pnpm --filter @crm2/sdk build && pnpm openapi`.
- [ ] **Step 4: Commit.** `git commit -am "feat(sdk): SUBMITTED task status + submittedAt (ADR-0047)"`

---

### Task 3: Device submit writer + office-complete guard + commission-at-submit

**Files:** Modify `apps/api/src/modules/cases/repository.ts`, `apps/api/src/modules/verification-tasks/service.ts`; Test `apps/api/src/modules/verification-tasks/__tests__/verification-tasks.api.test.ts`

- [ ] **Step 1: Failing test** — device submit lands SUBMITTED, stamps `submitted_at` + `commission_amount`, NOT `completed_at`; case stays IN_PROGRESS; office `complete` then moves SUBMITTED→COMPLETED without re-stamping commission.

```ts
it('device submit → SUBMITTED (commission frozen here); office complete → COMPLETED (no re-stamp)', async () => {
  const { caseId, taskId, agent } = await seedAssignedTask('SC');
  // (seed a commission_rates row for `agent` so the snapshot is non-null)
  await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', agent));
  const sub = await request(app).post(`/api/v2/verification-tasks/${taskId}/verification/residence`)
    .set(hdr('FIELD_AGENT', agent)).send({ formData: {} });
  expect(sub.body.status).toBe('SUBMITTED');
  const row = await db!.pool.query(`SELECT status, submitted_at, completed_at, commission_amount FROM case_tasks WHERE id=$1`, [taskId]);
  expect(row.rows[0]).toMatchObject({ status: 'SUBMITTED' });
  expect(row.rows[0].submitted_at).not.toBeNull();
  expect(row.rows[0].completed_at).toBeNull();
  expect(Number(row.rows[0].commission_amount)).toBeGreaterThan(0); // frozen at submit
  expect(await caseStatus(caseId)).toBe('IN_PROGRESS'); // SUBMITTED is active
  // office completes (records result) → COMPLETED, commission unchanged
  const v = sub.body.version;
  await request(app).post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`).set(SA)
    .send({ result: 'POSITIVE', version: v });
  const row2 = await db!.pool.query(`SELECT status, completed_at, commission_amount FROM case_tasks WHERE id=$1`, [taskId]);
  expect(row2.rows[0].status).toBe('COMPLETED');
  expect(row2.rows[0].completed_at).not.toBeNull();
  expect(Number(row2.rows[0].commission_amount)).toBe(Number(row.rows[0].commission_amount)); // not re-stamped
});
```

- [ ] **Step 2: Run → FAIL** (no submit writer; submitForm still completes).
- [ ] **Step 3: Add `submitTaskByDevice`** in `repository.ts` (mirror `completeTaskByDevice:1141`): `UPDATE … SET status='SUBMITTED', submitted_at=now(), submitted_elapsed_minutes=CEIL(EXTRACT(EPOCH FROM (now()-COALESCE(assigned_at,created_at)))/60)::int, version=version+1, updated_by=$3, updated_at=now() WHERE id=$1 AND case_id=$2 AND status IN ('ASSIGNED','IN_PROGRESS')`; idempotent-from-SUBMITTED; then `await stampCommissionSnapshot(q, taskId)`, audit (`after:{status:'SUBMITTED'}`), `recomputeCaseStatus`.
- [ ] **Step 4: Rewire `submitForm`** (`verification-tasks/service.ts:179-190`): call `repo.submitTaskByDevice` (was `completeTaskByDevice`); keep `emitTaskUpdate(view)`. Decide device bare `/complete` (`service.ts:122`) → also `submitTaskByDevice` (device never office-completes).
- [ ] **Step 5: Remove the commission re-stamp from `completeTask`** (`repository.ts:776`) — the office complete is the client-bill leg, commission already frozen at submit. (Keep `stampCommissionSnapshot` call in any path that completes WITHOUT a prior submit — i.e. OFFICE-only/desk tasks that go ASSIGNED→COMPLETED directly: guard the stamp `WHERE submitted_at IS NULL` or stamp only if `commission_amount IS NULL`.) Update office complete-guard from-set to `{ASSIGNED, SUBMITTED}` (already includes SUBMITTED_FOR_REVIEW → rename to SUBMITTED) at `cases/service.ts:319-326` + repo `:753-770`.
- [ ] **Step 6: Run → PASS** (`vitest run src/modules/verification-tasks`). 
- [ ] **Step 7: Commit.** `feat(api): device submit → SUBMITTED, freeze commission at submit, office complete → COMPLETED (ADR-0047)`

---

### Task 4: Submit-anchored COMMISSION_LATERAL (submit-in band)

**Files:** Modify `apps/api/src/platform/billing/laterals.ts`; Test `apps/api/src/modules/billing/__tests__/billing.commission.test.ts`

- [ ] **Step 1: Failing test** — a SUBMITTED task with a band-specific commission rate resolves the **submit-in** band (using `submitted_elapsed_minutes`), and a submitted task's commission is anchored as-of `submitted_at` (revising a rate after submit does not change it).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit `COMMISSION_LATERAL`** — anchor `COALESCE(ct.completed_at, now())` → `COALESCE(ct.submitted_at, ct.completed_at, now())` (both effective-date filters + the band subquery's tat_policies as-of); band elapsed `ct.completed_elapsed_minutes` → `COALESCE(ct.submitted_elapsed_minutes, ct.completed_elapsed_minutes)` (3 spots in the subquery). Update the doc-comment's FROM contract (now reads submitted_*). Do NOT touch RATE_LATERAL or COMPLETED_BAND.
- [ ] **Step 4: Run → PASS;** re-run the existing §E completed-case tests → still green.
- [ ] **Step 5: Commit.** `feat(api): commission lateral anchors as-of submit (submit-in band) (ADR-0047)`

---

### Task 5: Billing read-gate split (commission at SUBMITTED, bill at COMPLETED)

**Files:** Modify `apps/api/src/modules/billing/repository.ts`; Test `billing.commission.test.ts`

- [ ] **Step 1: Failing test** — a case with one SUBMITTED + one COMPLETED task: the billing row shows commission for BOTH but client bill only for the COMPLETED; a fully-SUBMITTED (no completed) case appears with commission and zero bill.
- [ ] **Step 2: Run → FAIL** (SUBMITTED rows excluded today).
- [ ] **Step 3: Widen the gate** in `buildBillingWhere` (`:79-80`): `ct.status = 'COMPLETED'` → `ct.status IN ('SUBMITTED','COMPLETED')`; same for the `caseTasks` inline gate (`:156`). **Null the bill for non-completed:** wrap the `rt.bill_amount` selections (`:120 listCases SUM`, `:148 caseTasks`, `:177/:193 breakdown`) as `CASE WHEN ct.status='COMPLETED' THEN rt.bill_amount END`. Commission selections already `COALESCE(ct.commission_amount, com.commission_amount)` — leave them. Confirm the `completedFrom/completedTo` date filters (`:86-87`) still gate on `completed_at` (bill-side); commission-by-submit-date is out of scope (note).
- [ ] **Step 4: Run → PASS;** keep all existing billing tests green.
- [ ] **Step 5: Commit.** `feat(api): billing shows field commission at SUBMITTED, client bill at COMPLETED (ADR-0047)`

---

### Task 6: Case rollup — SUBMITTED is active

**Files:** Modify `apps/api/src/modules/cases/repository.ts` (`recomputeCaseStatus`, the `active` aggregate ~`:131`); Test `apps/api/src/modules/cases/__tests__/*lifecycle*`

- [ ] **Step 1: Failing test** — a case whose only task is SUBMITTED rolls to `IN_PROGRESS` (not AWAITING_COMPLETION/degenerate); after office complete → AWAITING_COMPLETION.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add `SUBMITTED`** to the active `FILTER (WHERE status IN ('PENDING','ASSIGNED','IN_PROGRESS'))` → `(… ,'SUBMITTED')`. Verify TASK_VIEW overdue/active predicates (`:189`) — decide if SUBMITTED counts as "open" there (likely yes for worklist).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `feat(api): case rollup treats SUBMITTED as active (ADR-0047)`

---

### Task 7: Repoint SFR read-model references to SUBMITTED

**Files:** Modify `apps/api/src/modules/dashboard/repository.ts`, `apps/api/src/modules/field-monitoring/repository.ts` (+ grep any other `SUBMITTED_FOR_REVIEW`)

- [ ] **Step 1: Grep** `grep -rn "SUBMITTED_FOR_REVIEW" apps/api/src packages/sdk` → expect only these read-models (+ already-fixed SDK).
- [ ] **Step 2: Replace** `SUBMITTED_FOR_REVIEW` → `SUBMITTED` in `dashboard/repository.ts` (`OPEN_HELD`) + `field-monitoring/repository.ts` open/overdue sets.
- [ ] **Step 3: Run** the dashboard + field-monitoring tests → PASS.
- [ ] **Step 4: Commit.** `refactor(api): repoint SFR read-model buckets to SUBMITTED (ADR-0047)`

---

### Task 8: Full gate + openapi

- [ ] **Step 1:** `grep -rn "SUBMITTED_FOR_REVIEW" apps packages db` → only the migration's guard string remains.
- [ ] **Step 2:** `pnpm openapi` → review the `apps/api/openapi.json` diff (SUBMITTED in the task-status enum; no unexpected change).
- [ ] **Step 3:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm verify` → all green (scoped if worktree pollution; use `pnpm exec eslint apps packages`).
- [ ] **Step 4: Commit** any openapi/format changes. Hold push for owner OK + the web/mobile follow-on plans + CI `ci` workflow check.

---

## Self-review notes
- Spec coverage: Task 1 (status+cols), 2 (sdk), 3 (submit+complete+commission-at-submit), 4 (lateral anchor), 5 (read-gate split), 6 (rollup), 7 (read-models), 8 (gate) — covers spec §1–§7. Web tone/filter + mobile = separate plans. Revoke policy = no code change (existing `{ASSIGNED,IN_PROGRESS}→REVOKED` already excludes SUBMITTED — add a test asserting SUBMITTED→REVOKED is 409).
- Type consistency: `submitTaskByDevice` returns `CaseTaskView`; `submitted_at`/`submitted_elapsed_minutes` snake↔camel via camelize.
- Open: confirm whether a band-specific commission test fixture exists in §E to extend; office-only (desk) task commission must still stamp at its COMPLETED (guard `submitted_at IS NULL`).
