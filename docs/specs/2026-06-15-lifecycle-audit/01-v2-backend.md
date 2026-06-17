# CRM2 — v2 Backend Case/Task Lifecycle Audit (READ-ONLY)

Date: 2026-06-15
Scope: `crm2/apps/api` + `db/v2/migrations`
Method: every claim cited `file:line`. Verified against live code, not ADR prose.

Model confirmed: **Case → case_tasks → verification_unit**. KYC is NOT a separate engine
— a KYC task is just a `case_task` whose unit's `worker_role` resolves to KYC; it finalizes
through the *same* generic `complete` endpoint. There is no second result table, no KYC cycle
table, no `task_backend_reviews` (that was v1; absent in v2).

---

## 1. CASE STATUS state machine

**Enum — DB CHECK:** `chk_cases_status CHECK (status IN ('NEW','IN_PROGRESS','COMPLETED','CANCELLED'))`
— `db/v2/migrations/0010_cases.sql:28`. Default `'NEW'` (`0010_cases.sql:18`). **Never extended**
(no later migration alters `chk_cases_status`).
**Enum — code:** `CASE_STATUSES = ['NEW','IN_PROGRESS','COMPLETED','CANCELLED']` — `packages/sdk/src/cases.ts:10`.

| From | To | Trigger (endpoint) | Perm / role | Writer |
|------|------|--------------------|-------------|--------|
| (none) | `NEW` | `POST /api/v2/cases` | `case.create` (SA/MGR) | `repository.ts:217` INSERT default |
| `NEW` | `IN_PROGRESS` | `POST /api/v2/cases/:id/tasks` (first task batch) | `case.create` | `repository.ts:380-384` (guarded `WHERE status='NEW'`) |
| — | `COMPLETED` | **NONE** | — | **No writer exists** |
| — | `CANCELLED` | **NONE** | — | **No writer exists** |

Routes: `modules/cases/routes.ts:17` (create, `CASE_CREATE`), `:18` (add tasks, `CASE_CREATE`).

### Task → Case ROLLUP
**ABSENT.** There is no rollup service. The ONLY case-status write after creation is the
`NEW→IN_PROGRESS` flip inside `addTasks` (`repository.ts:380`). `completeTask`
(`repository.ts:640-676`) updates `case_tasks` only and **never touches `cases.status`**.
Searched all of `src` for `UPDATE cases` / rollup / caseStatusSync — only hits are
`repository.ts:217` (insert) and `:381` (the NEW→IN_PROGRESS flip). Consequence: **a case can
never reach COMPLETED or CANCELLED**; once it has a task it is permanently `IN_PROGRESS`. The v1
`caseStatusSyncService` (bucket-priority rollup, including `SUBMITTED_FOR_REVIEW` as a real case
status) has **no v2 equivalent**.

---

## 2. TASK STATUS (`case_tasks.status`)

**Enum — DB CHECK:** `chk_case_task_status CHECK (status IN ('PENDING','ASSIGNED','IN_PROGRESS',
'SUBMITTED_FOR_REVIEW','COMPLETED','REVOKED','CANCELLED'))` — `0037_case_task_dispatch_fields.sql:78-80`
(originally only `PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED` in `0010_cases.sql:65-67`;
extended once in 0037). Default `'PENDING'` (`0010_cases.sql:60`).
**Enum — code:** `CASE_TASK_STATUSES` — `packages/sdk/src/cases.ts:18-26` (identical 7 values).

| From | To | Trigger (endpoint) | Perm | Web/Device | Writer |
|------|------|--------------------|------|-----------|--------|
| (none) | `PENDING` | `POST /cases/:id/tasks` (no assignee) | `case.create` | web | `repository.ts:352` |
| (none) | `ASSIGNED` | `POST /cases/:id/tasks` (assign-at-create, ADR-0024) | `case.create` | web | `repository.ts:352` |
| `PENDING`/`ASSIGNED` | `ASSIGNED` | `POST /cases/:id/tasks/:taskId/assign` **and** `POST /tasks/bulk-assign` | `case.assign` (SA/MGR/TL) | web | `repository.ts:551` |
| `ASSIGNED` | `PENDING` | `POST /cases/:id/tasks/:taskId/unassign` | `case.assign` | web | `repository.ts:610` |
| `ASSIGNED`/`SUBMITTED_FOR_REVIEW` | `COMPLETED` | `POST /cases/:id/tasks/:taskId/complete` | `field_review.complete` (SA/BACKEND_USER) | web | `repository.ts:649-650` |
| — | `IN_PROGRESS` | **NONE** | — | — | **No writer** (read/filtered only) |
| — | `SUBMITTED_FOR_REVIEW` | **NONE** | — | — | **No writer** (only consumed as a *source* state by complete) |
| — | `REVOKED` | **NONE** | — | — | **No writer** |
| — | `CANCELLED` | **NONE** | — | — | **No writer** |

Routes: `modules/cases/routes.ts:19` (assign, `CASE_ASSIGN`), `:20` (unassign, `CASE_ASSIGN`),
`:21` (complete, `FIELD_REVIEW_COMPLETE`); `modules/tasks/routes.ts:15` (bulk-assign, `CASE_ASSIGN`).

**No `IN_PROGRESS`, `SUBMITTED_FOR_REVIEW`, `REVOKED`, or `CANCELLED` is ever WRITTEN by any code
path.** They exist in the enum (forward-compat for the unbuilt ingest/review legs) and are only
*read*: dashboard (`modules/dashboard/repository.ts:23,95-98`), field-monitoring
(`modules/field-monitoring/repository.ts:16,19,25`), sync `isRevoked` (`modules/sync/service.ts:41`),
and `completeTask`'s transition guard (`service.ts:305`).

### Side-effects per transition

| Transition | assignment_history | audit_log | notification | OCC version | commission/billing |
|------------|--------------------|-----------|--------------|-------------|--------------------|
| create→PENDING | none | none (no per-task audit row) | none | starts at 1 (`0036:col`) | none |
| create→ASSIGNED | `ASSIGNED` row (`repository.ts:372-377`) | none | none | 1 | none |
| →ASSIGNED (assign) | `ASSIGNED` if prev null else `REASSIGNED` (`repository.ts:574-590`) | none | `CASE_TASK_ASSIGNED` to assignee (`service.ts:275-284`) | `version+1` (`repository.ts:554`) | none |
| →PENDING (unassign) | `UNASSIGNED` row (`repository.ts:624-629`) | none | none | `version+1` (`repository.ts:613`) | none |
| →COMPLETED (complete) | none | `case_task UPDATE` audit (`repository.ts:662-671`) | `TASK_COMPLETED` to `assignedBy` if ≠ self (`service.ts:309-318`) | `version+1` (`repository.ts:652`) | **none** |

Notifications are fire-and-forget (`service.ts:35-43`, ADR-0027) — never block the write.
`task_assignment_history` is append-only, enforced by trigger `trg_task_assignment_history_immutable`
(`0036_task_assignment.sql`). **Commission/billing: nothing fires on completion** (no commission
table, no billing write; see §4).

---

## 3. RESULT / OUTCOME model

- **Storage:** `case_tasks.verification_outcome varchar(20)` + `remark` + `completed_at` +
  `completed_by` — `0041_task_completion_result.sql:14-20`. CHECK `chk_case_task_outcome`:
  `verification_outcome IN ('POSITIVE','NEGATIVE','REFER','FRAUD')` (`0041:22-27`).
  Code enum `KYC_RESULTS = ['POSITIVE','NEGATIVE','REFER','FRAUD']` (`packages/sdk/src/cases.ts:53`).
  Validated by `CompleteTaskSchema { result: enum(KYC_RESULTS), remark: min1 max2000 }`
  (`cases.ts:334-337`). Written only by `completeTask` (`repository.ts:650`).
- **Single-layer.** There is **no field-assessment-vs-backend-final-decision split** (v1's
  `verification_reports.final_status` immutable layer + append-only `task_backend_reviews` is
  GONE). v2 records exactly one official outcome per task, on the task row itself, by the user who
  calls `complete` (the comment at `0041:8` states "the task is the system of record — no parallel
  KYC engine"). `cases` has **no** `verification_outcome` column (the v1 fragmentation source is absent).
- **REVOKE / REVISE / REVISIT / RECHECK:** **ABSENT in v2 backend.** No endpoint, no service, no
  status writer. `REVOKED` is an enum value with zero producers; `revise` exists only in the
  unrelated **rates** module (`modules/rates`); session `revoke` is auth-only. There is no
  recheck-clone, no revisit task-creation, no lineage column.

---

## 4. DESIGNED-but-NOT-BUILT (forward-compat scaffolding only)

| Piece | Evidence it's designed | Evidence it's NOT built |
|-------|------------------------|-------------------------|
| Mobile field-submission ingest (§5 upload) | `sync/service.ts:55-56,86` placeholders (`revokedAssignmentIds:[]`, "until a task-revoke mechanism lands (§5 ingest)") | `sync/routes.ts` has **only** `GET /download` — no upload/ingest endpoint anywhere |
| Field-task review → `SUBMITTED_FOR_REVIEW` | enum value (`cases.ts:18`); `complete` accepts it as a source state (`service.ts:305`) | **no writer** produces `SUBMITTED_FOR_REVIEW`; field tasks can only complete from `ASSIGNED` |
| Task REVOKE | `REVOKED` enum + `sync isRevoked` mapping (`sync/service.ts:41`) | no endpoint/writer |
| Recheck-clone / revisit | — | entirely absent (no code, no migration) |
| Commission / billing | perm `billing.generate` (`permissions.ts:52`); dashboard billing widget (`dashboard/repository.ts:118-131`) | **no billing/commission module, no table, no consumer** of `BILLING_GENERATE` as a route guard in any module; completion writes nothing financial |
| Task IN_PROGRESS (device "started visit") | enum value; dashboard/field-monitoring read it | no writer |
| Case COMPLETED/CANCELLED + rollup | enum values | no writer, no rollup service (§1) |

---

## 5. Finalize transition guard + scope/IDOR/OCC guards

**Finalize guard** (`modules/cases/service.ts:300-307`):
1. `CompleteTaskSchema.parse` → 400 VALIDATION.
2. `requireVersion(input)` → 400 VERSION_REQUIRED (OCC token outside the body schema).
3. `repo.taskAssignmentState(caseId, taskId, scope)` → **scope/IDOR guard**: out-of-scope or
   missing ⇒ `null` ⇒ 404 TASK_NOT_FOUND (indistinguishable; uses `taskScopePredicate`,
   `repository.ts:512-536`).
4. **Status guard:** `state.status !== 'ASSIGNED' && !== 'SUBMITTED_FOR_REVIEW'` ⇒ 409
   INVALID_TRANSITION (`service.ts:305-306`). So **{ASSIGNED, SUBMITTED_FOR_REVIEW} → COMPLETED**
   are the only legal finalize sources.
5. **OCC guard** in the write: `UPDATE … WHERE id=$1 AND case_id=$2 AND version=$6`
   (`repository.ts:653`); 0 rows ⇒ re-read; if missing/cross-case ⇒ 404, else 409 STALE_UPDATE
   with the current row (`repository.ts:657-660`). Every status writer bumps `version`, so a stale
   token is a true conflict.

**Assign guards** (`service.ts:256-286`): `AssignTaskSchema.parse` (400) → `requireVersion` (400)
→ `taskAssignmentState` scope guard (404) → status must be `PENDING`|`ASSIGNED` else 409
TASK_NOT_ASSIGNABLE (`service.ts:262`) → eligibility `eligibleTaskIdsForAssignee` (pool ∩ hierarchy
∩ FIELD-territory) else 400 INVALID_ASSIGNEE (`service.ts:266-272`) → OCC `WHERE version=$8`
(`repository.ts:556`), 409 STALE_UPDATE on mismatch (`repository.ts:569-573`). FK violation on
assignee ⇒ 400 INVALID_ASSIGNEE (`repository.ts:596`).
Bulk-assign (`tasks/service.ts:201-252`) runs the same per-row checks and funnels every write
through `caseRepository.assignTask` (the single OCC+history+notify path), reporting per-row status
without aborting the batch.

**Add-task guards** (`service.ts:170-193`): CPV-enablement (400 UNIT_NOT_ENABLED), applicant
ownership (400 INVALID_APPLICANT — no cross-case applicant leak, `service.ts:178-180`),
assign-at-create eligibility re-check against the same pool the FE offered (400 INVALID_ASSIGNEE).

---

## 6. Inconsistencies / holes / divergences

1. **No task→case rollup; case never COMPLETES.** Highest-impact gap. After the first task, a case
   is stuck `IN_PROGRESS` forever; `COMPLETED`/`CANCELLED` are dead enum values. Any
   dashboard/list/billing logic keying on case `COMPLETED` (e.g. `dashboard/repository.ts:131`)
   will always read 0. (`cases/repository.ts` — only `:381` writes status post-create.)
2. **4 of 7 task statuses are unreachable by code:** `IN_PROGRESS`, `SUBMITTED_FOR_REVIEW`,
   `REVOKED`, `CANCELLED` have no writer. The finalize guard accepts `SUBMITTED_FOR_REVIEW` as a
   source (`service.ts:305`) that the system can never enter → the field-review leg is half-wired:
   the *consumer* exists, the *producer* (mobile ingest) does not.
3. **Mobile sync is download-only.** `sync/routes.ts` exposes no upload — so the locked
   field-dispatch *down* contract is honored, but there is no path for the device to submit a
   completed visit. Placeholders (`revokedAssignmentIds`, `deletedTaskIds`, etc.) are hard-coded
   empty (`sync/service.ts:85-90`).
4. **Permission/role naming mismatch vs intent.** The finalize route is gated by
   `field_review.complete` (`routes.ts:21`), held by SUPER_ADMIN + BACKEND_USER only
   (`permissions.ts:89`). KYC_VERIFIER has only `case.view`+`page.dashboard`
   (`permissions.ts:94`) → a KYC verifier **cannot finalize** despite v2 treating KYC as an
   ordinary task. The result enum constant is named `KYC_RESULTS`/`KycResult` (`cases.ts:53`) but
   is the *generic* task outcome — misleading naming, single source of truth though.
5. **`completeTask` writes an audit row but assign/unassign do not** (only `task_assignment_history`,
   not the `audit_log` chain) — `repository.ts:662` vs none in assign/unassign. Case create audits
   (`repository.ts:253`) but task create does not. Audit coverage is uneven across the lifecycle.
6. **`distanceBand` is dead-ish.** `AssignTaskSchema.distanceBand` is optional/legacy
   (`cases.ts:322`); rate type now derives live from rate management (`repository.ts:84-94`). Still
   persisted to `case_tasks.distance_band` + history but no longer collected by the UI.
7. **Commission/billing entirely unbuilt** while the perm + dashboard widget imply it exists
   (§4). `BILLING_GENERATE` is never used as a route guard in any module — it gates only the
   dashboard billing-summary read indirectly via role.
8. **`addTasks` NEW→IN_PROGRESS flip is not OCC/version-guarded on the case** (plain
   `WHERE status='NEW'`, `repository.ts:381`) — benign (idempotent), but the only case mutation
   outside create and it bypasses the concurrency standard the tasks use.
9. **Two divergent "assignable users" code paths.** `caseRepository.assignableUsers`
   (whole-pool ∩ hierarchy via `worker_role`, `repository.ts:461-469`) vs
   `eligibleAssigneesForNew` (visit-type pool via `assignment_pool_roles` ∩ territory,
   `repository.ts:479-508`). The legacy whole-pool path is still reachable when `taskId` is omitted
   (`service.ts:248-249`) and uses a *different* role-resolution source than the ADR-0024 path.
