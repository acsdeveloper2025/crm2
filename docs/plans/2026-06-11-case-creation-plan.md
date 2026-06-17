# Case Creation (dispatch parity) — Build Plan

- **Status:** Plan — 2026-06-11 (pending owner go-ahead to start slice 1)
- **Design:** `docs/specs/2026-06-11-case-creation-and-pipeline-model-design.md` · **ADR:** `ADR-0023` · **Audit:** `docs/specs/2026-06-11-v1-zion-case-task-creation-audit.md`
- **Baseline:** origin/main `8d1c2b4` (+ this docs commit). Migrations 0001–0036, next = **0037**. api 489 · sdk 81 · logger 4 · Playwright 81.
- **Scope of THIS plan:** the creation-parity slices (§2 + §3 of the design) — add the dispatch fields + per-task applicant targeting. The dispatch read-model (§4), ingest (§5), and review/complete (§6) are **separate later milestones**, designed but NOT in this plan.

> Per-slice workflow (standing): scope → build → `pnpm verify` ALONE green (fresh :5433) → Audit Panel subagent (CEO+Security+API+DB, append `docs/agents/ceo-quality-sentinel.md`) → browser-verify the real action live → commit (author Mayur, conventional, no AI trailer) → push per standing approval → update `project_crm2_operations_phase.md`.

---

## Slice 1 — Migration 0037 + schema (DB foundation)

**Files:** `db/v2/migrations/0037_case_task_dispatch_fields.sql` (new).

1. `cases.backend_contact_number varchar(20)` — add nullable, backfill existing dev rows with a placeholder (`'0000000000'`), then `SET NOT NULL`.
2. `case_applicants.calling_code varchar(40)` — add nullable; backfill existing rows `'CC-LEGACY-'||id`; (stays nullable — app generates on new inserts; existing dev rows are disposable).
3. `case_tasks.applicant_id uuid REFERENCES case_applicants(id)` — add nullable; backfill each existing task to its case's primary applicant (`UPDATE … SET applicant_id = (SELECT id FROM case_applicants WHERE case_id = ct.case_id AND is_primary)`); then `SET NOT NULL`. Index `idx_case_tasks_applicant`.
4. `case_tasks.address text` — add nullable, backfill `''`, `SET NOT NULL`.
5. `case_tasks.trigger text NOT NULL DEFAULT ''`.
6. `case_tasks.priority varchar(10) NOT NULL DEFAULT 'MEDIUM'` + CHECK `chk_case_task_priority IN (LOW,MEDIUM,HIGH,URGENT)`.
7. `case_tasks.task_number varchar(30)` — add nullable; backfill `case_number || '-' || row_number() over (partition by case_id order by created_at)`; `SET NOT NULL`; UNIQUE `uq_case_task_number (case_id, task_number)`.
8. Extend `chk_case_task_status` to add `SUBMITTED_FOR_REVIEW`, `REVOKED` (drop+recreate CHECK with the guard pattern).

All steps idempotent (`IF NOT EXISTS` / `DO $$ … pg_constraint`). Apply to dev `:54329` (`psql -f`) and the test harness applies to `:5433`.

**Verify:** `\d case_tasks`, `\d cases`, `\d case_applicants` show the columns/constraints; existing dev rows backfilled (no NULLs); re-run the migration → clean (idempotent).

---

## Slice 2 — SDK contract (`@crm2/sdk`)

**Files:** `packages/sdk/src/cases.ts` (+ `cases.test.ts`).

1. `CASE_TASK_STATUSES` += `SUBMITTED_FOR_REVIEW`, `REVOKED`.
2. `PRIORITIES = ['LOW','MEDIUM','HIGH','URGENT'] as const` + type.
3. `Case` / `CaseView` += `backendContactNumber: string`.
4. `CaseApplicant` += `callingCode: string`.
5. `CaseTaskView` += `applicantId: string`, `applicantName: string`, `address: string`, `trigger: string`, `priority: Priority`, `taskNumber: string`.
6. `CreateCaseSchema` += `backendContactNumber: z.string().trim().min(4).max(20)` (required).
7. Replace `AddTasksSchema` with the per-task spec shape (design §3.1): `{tasks: [{verificationUnitId, applicantId(uuid), address(1-500), trigger(≤2000), priority(default MEDIUM)}]}`. Keep `MAX_*` consts (magic-number lint).
8. Contract tests for the new schemas (valid/invalid: missing applicantId, bad priority, missing backendContactNumber).

**Verify:** `pnpm --filter @crm2/sdk test` green; typecheck across consumers.

---

## Slice 3 — API: create + add-tasks (`modules/cases`)

**Files:** `apps/api/src/modules/cases/{repository,service,controller}.ts` (+ `__tests__/cases.api.test.ts`).

1. **create:** INSERT `backend_contact_number` (from `input.backendContactNumber`); generate `calling_code` per applicant on insert; `appendAudit(CREATE)` inside the tx.
2. **add-tasks (rewrite `addTasks`):** accept the per-task specs; per task validate `applicantId` belongs to the case (else 400 `INVALID_APPLICANT`) + `verificationUnitId` CPV-enabled (existing check); compute `task_number` (`count(*) WHERE case_id + ordinal`); INSERT `(case_id, verification_unit_id, applicant_id, address, trigger, priority, task_number, created_by, updated_by)`; keep the NEW→IN_PROGRESS case bump.
3. **reads:** extend `TASK_VIEW_BY_CASE`/`TASK_VIEW_BY_ID` + `CASE_VIEW_SELECT` to return the new columns + `applicant_name` (JOIN case_applicants on applicant_id) + `backend_contact_number`.
4. Tests: create with backendContactNumber + calling codes; add-tasks with applicant targeting (cross-case applicant → 400; non-CPV unit → 400); task_number format + uniqueness; status enum accepts new values.

**Verify:** `LC_ALL=C DATABASE_URL=…:5433 pnpm verify` EXIT=0 (run ALONE); live dev `:4000` create + add-tasks 200 with the new fields.

---

## Slice 4 — Web create flow (`features/cases`)

**Files:** `apps/web/src/features/cases/CaseCreatePage.tsx` (+ the add-units stage → add-tasks stage).

1. **Stage 1:** add a `backendContactNumber` input, **prefilled from the logged-in user's `/me` phone** (editable, required).
2. **Stage 2 (was AddUnitsStage):** becomes per-task entry — for each task row: pick verification unit (CPV list), **pick applicant/co-applicant** (the case's applicants, just created in stage 1), address (text), trigger (textarea), priority (select). "Add task" appends a row; submit sends `{tasks:[…]}`.
3. Send the new payload shapes; surface 400 `INVALID_APPLICANT` / CPV errors.

**Verify (browser, per standing rule):** create a case with 1 applicant + 1 co-applicant → add two tasks, one targeting each → confirm persisted (fresh API read shows distinct `applicant_id`/`address`/`task_number`); duplicate/invalid paths surface errors. Screenshot as proof.

---

## Slice 5 — Audit Panel + close-out

1. Audit Panel subagent (CEO+Security+API+DB) reads+appends `docs/agents/ceo-quality-sentinel.md`; fix real findings in-slice.
2. Update `project_crm2_operations_phase.md` (new milestone row: Case-Creation dispatch parity; carries; DON'T-REGRESS).
3. Commit + push per standing approval (author Mayur, no AI trailer).

---

## DON'T-REGRESS (this milestone)
- The locked dispatch contract (audit §3) is sacred — these columns exist to feed it; never drop/rename a device-read field when the §4 read-model lands.
- `applicant_id` NOT NULL — every task targets exactly one applicant of its own case.
- Task status writers (future start/complete/finalize) MUST bump `version` (TOCTOU ratchet).
- `task_assignment_history` append-only; migrations forward-only + idempotent; triple-write (dev+test; no prod yet).
- Magic-number lint: new consts (`MAX_*`, priorities) live in the SDK, not inline.
- The §4 dispatch read-model + §5 ingest + §6 review/complete are SEPARATE later milestones — this plan stops at creation parity.

## Open items to confirm at build time
- Backfill placeholder for `backend_contact_number` on existing dev rows (`'0000000000'`) — acceptable since dev data is disposable; confirm no test asserts on it.
- Whether to reset the test DB before the NOT-NULL backfills (recommended: fresh `:5433` per the standing verify).
