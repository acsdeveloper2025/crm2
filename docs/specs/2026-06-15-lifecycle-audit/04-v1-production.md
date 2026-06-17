# V1 Production Lifecycle Audit — Case / Task / KYC / Backend Review

**Date:** 2026-06-15 · **Mode:** READ-ONLY (no code changed) · cites the prior v1 audit docs AND verifies each claim against live code + `acs_db_final_version.sql`.

**Roots:** BE `CRM-BACKEND/` · FE `CRM-FRONTEND/` · schema `acs_db_final_version.sql` + `CRM-BACKEND/migrations/`.

**Verify note:** The SQL dump is CURRENT for status enums and transitions (confirmed `check_status_unified` and `chk_cases_status` both already carry `SUBMITTED_FOR_REVIEW`). Prior audits warned the dump was stale for KYC cycle tables — KYC claims here re-confirmed against migrations + controllers.

---

## 1. CASE STATUS state machine

**Enum** (`acs_db_final_version.sql:2424` `chk_cases_status`; live-updated by `migrations/2026-06-04_case_status_submitted_for_review.sql`):
`PENDING | ASSIGNED | IN_PROGRESS | SUBMITTED_FOR_REVIEW | COMPLETED | REVOKED`

**Authority:** Case status is **derived, never set by hand**. Sole writer = `CaseStatusSyncService.recalculateCaseStatus` (`services/caseStatusSyncService.ts:26`, ~31 call sites). It `SELECT status FROM verification_tasks WHERE case_id=$1 FOR UPDATE` (no `task_type` filter → field + KYC + revisit all count), tallies counts, first-match rollup (`caseStatusSyncService.ts:92-110`):

| Rule | New status | Note |
|---|---|---|
| `rv == T` | REVOKED | all tasks revoked |
| `c + rv == T` | COMPLETED | `completed_at = COALESCE(completed_at, NOW())` |
| `ip > 0` | IN_PROGRESS | ranks ABOVE sfr — a mixed case (1 SFR + 1 IN_PROGRESS) stays IN_PROGRESS |
| `a > 0` | ASSIGNED | |
| `p > 0` | PENDING | |
| else (`sfr > 0`) | SUBMITTED_FOR_REVIEW | no P/A/IP remain, ≥1 SFR → "all field work submitted, awaiting review" |

(T=total; c/rv/ip/a/p/sfr = COMPLETED/REVOKED/IN_PROGRESS/ASSIGNED/PENDING/SUBMITTED_FOR_REVIEW counts.) Rollup priority (post-SFR migration): `rv → (c+rv) → ip → a → p → sfr`.

- REVOKED tasks count as "done" (don't block COMPLETED). KYC participates in the same rollup (no separate KYC case status).
- Revisit/Recheck re-open a COMPLETED case (insert a new active task → next recalc pulls case back to ASSIGNED/IN_PROGRESS; `completed_at` cleared to NULL — `caseStatusSyncService.ts:118-121` `ELSE NULL`).
- **No working manual "Mark Complete"**: `POST /cases/:id/complete` only flips `case_data_entries.is_completed`, explicitly does NOT touch `cases.status` (`CRM_CORE_WORKFLOW_AUDIT_2026-06-03.md:78-81`). Case completion is 100 % task-driven.

---

## 2. TASK / verification_task STATUS state machine

**Enum** (`acs_db_final_version.sql:2685` `check_status_unified`; added by `migrations/2026-06-03_backend_review_p0_foundation.sql:54`):
`PENDING | ASSIGNED | IN_PROGRESS | SUBMITTED_FOR_REVIEW | COMPLETED | REVOKED`. No REWORK / RETURNED / APPROVE / REJECT.

`task_type ∈ NORMAL | REVISIT | KYC`. Transitions gated by `task_status_transitions` (trigger `enforce_verification_task_status_transition`); seeded edges (`acs_db_final_version.sql:34715-34727`):
`PENDING→ASSIGNED · PENDING→REVOKED · ASSIGNED→IN_PROGRESS · ASSIGNED→REVOKED · IN_PROGRESS→{COMPLETED,REVOKED,ASSIGNED,SUBMITTED_FOR_REVIEW} · SUBMITTED_FOR_REVIEW→{COMPLETED,REVOKED,IN_PROGRESS} · REVOKED→ASSIGNED · COMPLETED→ASSIGNED`. (`COMPLETED→ASSIGNED` = the revisit re-open edge; the 4 SFR edges from the p0 migration.)

| Transition | Endpoint | Role / perm | Web/Device | Side-effects |
|---|---|---|---|---|
| Create →ASSIGNED | POST /cases/create | case.create | web | task + `task_assignment_history`; KYC adds kdv + cycle (`createCase.ts`, `verificationTaskCreationService.ts:256`) |
| Start ASSIGNED→IN_PROGRESS | POST /verification-tasks/:id/start | assignee | device/web | `started_at` |
| Submit IN_PROGRESS→**SFR** (flag ON) / →COMPLETED (flag OFF) | POST /mobile/.../verification/<type> | assignee agent | **device** | `target = reviewOn ? SUBMITTED_FOR_REVIEW : COMPLETED` (`mobileFormController.ts:124`); writes `verification_reports`, `form_submissions`; if COMPLETED → snapshot + commission |
| Submit (web) same gate | POST /verification-tasks/:id/complete | `visit.submit` ownership:task (assignee-only) | web | `reviewOn = isBackendReviewEnabled`; `targetStatus` (`verificationTasksController.ts:2454-2457`); 4 evidence gates (location, ≥5 photos, form exists, form-time ≥ location-time) |
| **Finalize SFR→COMPLETED** | POST /verification-tasks/:id/finalize | **`field_review.complete`** (BE/MGR/SA), NOT assignee | web | §6 — append `task_backend_reviews`, set `verification_outcome`, snapshot, recalc, commission |
| KYC verify →COMPLETED | PUT /kyc/tasks/:id/verify | `kyc.complete` (BE/MGR/SA) | web | steps parent PENDING→ASSIGNED→IN_PROGRESS→COMPLETED internally; cycle KYC_COMPLETED |
| Revoke →REVOKED | POST /verification-tasks/:id/revoke | `task.revoke` | web | in-place; `task_revocations`; guard `status NOT IN (REVOKED,COMPLETED)` |
| Revisit (new child) | POST /verification-tasks/revisit/:id | `visit.revisit` | web | new REVISIT child task |
| Recheck (new KYC task) | POST /kyc/tasks/:id/recheck-clone | `kyc.reverify` | web | new KYC task + kdv + cycle |

**Mobile normalization:** when an old-app agent reads a task, raw `SUBMITTED_FOR_REVIEW` is normalized → `COMPLETED` at the single sync ingestion chokepoint (the agent never sees the review state).

---

## 3. The TWO-LAYER result model (the "result fragmentation" issue)

Four result columns exist; **none is reconciled into one authoritative case verdict**:

| Layer | Column | Writer | Mutability |
|---|---|---|---|
| **FE assessment** (field agent) | `verification_reports.final_status` (CHECK Positive/Negative/Refer/Fraud) | mobile/web submit, in-tx | INSERT-only, **immutable**, one per task |
| **Backend final decision** (field) | `task_backend_reviews.backend_final_result` (CHECK Positive/Negative/Refer/Fraud) | `/finalize` | append-only; `is_current` flag (`uq_tbr_task_current`), prior rows flipped `is_current=false` |
| **KYC backend decision** | `kyc_document_verifications.final_status` | PUT /kyc/.../verify | per kdv |
| **Task outcome rollup** | `verification_tasks.verification_outcome` | set = `backend_final_result` on finalize (`verificationTasksController.ts:2699`); = FE value on flag-OFF complete | last write |
| **Case "result"** | `cases.verification_outcome` | **last-write-wins** across the 9 mobile paths (`UPDATE cases SET verification_outcome=$2`) | overwritten by last task to complete |

**Which is authoritative for the client report?** Per `TASK_RESULT_VS_CASE_RESULT_VALIDATION_2026-06-03.md:9` and prod evidence (VT-000199): the official result is **per-task `task_backend_reviews.backend_final_result`** (else coalesce to FE `final_status` for legacy tasks). BUT the rendered client PDF header prints `cases.verification_outcome` (`reportContextBuilder.ts:688` exposes both `case.verificationOutcome` AND per-task) — the **stale / last-write value, NEVER the backend decision**. Prod-proven divergence: FE Refer / backend Positive / case-header Untraceable on one task. The unified read view `v_task_finalization` (`migration p0:73`) has **0 readers**. **There is no stored case-level human verdict and the validation explicitly recommends never adding one** — a single case verdict, where required, must be derived compute-on-read from per-task backend results. `cases.verification_outcome` is to be deprecated as a result.

---

## 4. REVISIT vs RECHECK vs REVOKE

| Action | Endpoint / perm | Creates | Original | Lineage col | Status / case effect | Billing / commission |
|---|---|---|---|---|---|---|
| **REVOKE** (field) | POST /verification-tasks/:id/revoke · `task.revoke` | nothing new (in-place) | → REVOKED, `assigned_to=NULL`, `revoked_at/by/reason`; `task_revocations` audit; guard `NOT IN (REVOKED,COMPLETED)` | n/a (reassign creates child via `parent_task_id`) | task terminal REVOKED; case → REVOKED if all revoked, else counts as done | none — no snapshot, never commissioned (gated `status='COMPLETED' AND !='REVOKED'`) |
| **REVISIT** (field) | POST /verification-tasks/revisit/:id · `visit.revisit` | **NEW child** `task_type='REVISIT'`, status PENDING/ASSIGNED; blank `case_data_entries` | requires original COMPLETED; original untouched/immutable; **KYC excluded → 400 `KYC_USES_SEPARATE_WORKFLOW`** | `parent_task_id = original.id` | re-opens case (COMPLETED→active, `completed_at`→NULL) | copies parent `rate_type_id`+`estimated_amount` (R2 same rate); own billable line; **commission YES** (normal engine) |
| **RECHECK** (KYC) | POST /kyc/tasks/:id/recheck-clone · `kyc.reverify` | **NEW KYC task** + new `kyc_document_verifications` + new `kyc_verification_cycles` (cycle 1, billable=true, billed=false, fresh rate); **409 `KYC_ACTIVE_EXISTS`** if active KYC exists | original kdv stays COMPLETED/immutable | `kyc_document_verifications.recheck_of_kyc_id = orig.id` | re-opens case | fresh billable cycle; **commission NONE** (KYC `rate_type_id` NULL) |

Per `REVISIT_RECHECK_LIFECYCLE_VALIDATION_2026-06-03.md`: no `RETURNED` status — original terminates via existing COMPLETED (Backend result, `Refer` = "needs more") or REVOKED; the child IS the operational/billable/commission/TAT unit; the task chain + per-task review rows ARE the audit trail.

---

## 5. Commission / billing touchpoints

Financial state (no `task_financials` table): `verification_tasks.actual_amount` (snapshot), `commission_calculations` (per-task UNIQUE(verification_task_id)), `kyc_verification_cycles` (billable/billed/rate_amount), `invoice_item_tasks` (bill-once junction).

| Event | actual_amount snapshot | Commission | Gated on |
|---|---|---|---|
| Field complete (flag OFF) | ✅ in-tx `snapshotFinancials` (`taskCompletionFinalizer`) | ✅ post-commit `autoCalculateCommissionForTask` | `status='COMPLETED' AND !='REVOKED'` + `rate_type_id` + `assigned_to` + active `commission_assignments` (`commissionManagementController.ts:1123-1139`) |
| Field submit (flag ON) → SFR | ❌ deferred | ❌ deferred | engine only fires at COMPLETED — SFR is non-terminal, so both defer to /finalize |
| **Finalize** SFR→COMPLETED | ✅ `snapshotFinancials` in-tx (`verificationTasksController.ts:2709`) | ✅ post-commit `triggerPostCompletionHooks` if `rateTypeId && assignedTo` (`:2723`) | same gate; commission DEFERRED to the finalize step |
| Revisit child complete | ✅ (parent rate copied) | ✅ normal engine | per-task |
| Revoke | ❌ | ❌ | excluded |
| KYC complete / recheck | ✅ `cycle.rate_amount` | ❌ NONE | KYC `rate_type_id` NULL → hook no-op |

Commission is **per-task**, immutable (`ON CONFLICT(verification_task_id) DO NOTHING`), and **gated on COMPLETED** — so the review gate cleanly defers it without engine changes.

---

## 6. The finalize spine

`POST /api/verification-tasks/:taskId/finalize` (`routes/verificationTasks.ts:218`, `authorize('field_review.complete')`, `reportUpload.single('report')`) → `VerificationTasksController.finalizeFieldReview` (`:2550`):

1. **Flag gate** is upstream at submit: `TaskCompletionFinalizer.isBackendReviewEnabled(client)` reads `SELECT enabled FROM feature_flags WHERE flag_key='backend_review_enabled'` (`taskCompletionFinalizer.ts:61`, live per-request, no restart). Flag OFF → submit goes straight to COMPLETED, /finalize unused.
2. Guard `task.status === 'SUBMITTED_FOR_REVIEW'` else 409 `TASK_NOT_SUBMITTED_FOR_REVIEW` (`:2629`). NOT assignee-gated (reviewer ≠ agent); case scope enforced inside via `enforceBackendUserCaseScope`.
3. Pin latest `form_submissions` row as `fe_submission_id` (immutability anchor) (`:2640`).
4. Append-only: flip prior `is_current=false`, INSERT `task_backend_reviews` (FIELD, `backend_final_result`, remarks(req), findings/observations/recommendation, optional report file) — **never touches FE tables** (`:2666-2693`).
5. `UPDATE verification_tasks SET status='COMPLETED', verification_outcome = backend_final_result, completed_at=NOW()` (`:2696`).
6. `snapshotFinancials` in-tx → COMMIT → post-commit `recalculateCaseStatus` + `triggerPostCompletionHooks` (commission) (`:2709-2725`). Reuses the same finalizer/sync/audit owners as completeTask (no duplication).

Report-attach field was later REMOVED from the UI (PR #25) — `report_*` cols + multipart leg left INERT but present.

---

## 7. What v2 SIMPLIFIED / DROPPED vs what v1 does that v2 has NOT replicated

**v2 schema (`crm2/db/v2/migrations/`):**
- Case status **collapsed** to `NEW | IN_PROGRESS | COMPLETED | CANCELLED` (`0010_cases.sql:25`) — dropped PENDING/ASSIGNED/REVOKED/SFR at the case grain.
- `case_tasks` status = `PENDING|ASSIGNED|IN_PROGRESS|SUBMITTED_FOR_REVIEW|COMPLETED|CANCELLED` (`0037:64`) — keeps SFR, but **REVOKED→CANCELLED**.
- **Single result column** `case_tasks.verification_outcome` (POSITIVE/NEGATIVE/REFER/FRAUD, `0041_task_completion_result.sql`) recorded by "the generic task-finalize leg" — collapses v1's 4-column fragmentation into ONE per-task result.
- `verification_unit_registry` (`0001`) unifies field+KYC config: `billing_profile (AGENT_COMMISSION|CLIENT_INVOICE)`, `commission_profile (FIELD_RATE|NONE)`, `reverification_rule (REVISIT_PARENT_RATE|RECHECK_FRESH_RATE)` — config-driven instead of v1's hardcoded NORMAL/KYC fork.

**Top 5 things v2 is MISSING vs v1:**
1. **No separate two-layer result table** — v1's append-only `task_backend_reviews` (FE-assessment vs immutable backend decision, `is_current` history) is collapsed to one `verification_outcome` column. v2 loses the FE-immutable vs backend-decision separation and the audit history of decisions.
2. **No `backend_review_enabled` feature-flag gate** — v1 toggles the SFR review gate live per-request; v2 has the SFR status but no flag infra / no `/finalize` spine wired (and no FE feature-flag infra exists yet).
3. **No case-status REVOKED / SUBMITTED_FOR_REVIEW rollup** — v1's `recalculateCaseStatus` 6-bucket priority rollup (incl. case-level SFR and REVOKED) is not present; v2 case status is a 4-value enum with no documented task-count rollup authority.
4. **Revisit/Recheck lineage not yet built** — v1 has live `parent_task_id` (REVISIT) and `recheck_of_kyc_id` (RECHECK) chains, the active-sibling 409 guards, and the re-open-case behavior. v2 encodes the *intent* (`reverification_rule` in the registry) but the endpoints/lineage columns/cycle tables are not yet implemented.
5. **No commission/billing finalize wiring** — v1's per-task `commission_calculations` (UNIQUE, ON CONFLICT, COMPLETED-gated, deferred to /finalize) + `kyc_verification_cycles` billable lines + `invoice_item_tasks` are not yet in v2; `commission_profile`/`billing_profile` are config flags awaiting an engine.

**Net:** v2 deliberately simplifies the *fragmented result model* (1 column vs 4 — fixing v1's #1 risk) and makes field/KYC config-driven, but has not yet replicated v1's battle-tested operational machinery: the two-layer decision audit, the flag-gated finalize spine, the full case rollup, revisit/recheck lineage, and the commission/billing engine.
