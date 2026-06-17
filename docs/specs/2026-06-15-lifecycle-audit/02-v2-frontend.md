# CRM2 (v2) Web Frontend — Case/Task Lifecycle UI Audit

READ-ONLY audit. Root: `crm2/apps/web`. SDK: `crm2/packages/sdk/src`.
Date: 2026-06-15. All citations are `file:line`.

---

## 1. Lifecycle-driving screens & actions

| Action | Component (file:line) | SDK method / wire shape | Endpoint | Perm gate | Who sees it |
|---|---|---|---|---|---|
| Create case | `CaseCreatePage.tsx:89` (`create` mutation) | `POST /api/v2/cases` body = `CreateCaseSchema` (`cases.ts:244`) | `POST /api/v2/cases` | `case.create` (route `cases/routes.ts:17`) | page reachable via nav `case.view` (`Layout.tsx:36`); Create button always rendered (`CasesPage.tsx:69`) but server 403s w/o `case.create` |
| Dedupe search (create-gate) | `CaseCreatePage.tsx:75` (`dedupe`) | `POST /api/v2/cases/dedupe`, returns `DuplicateMatch[]` (`cases.ts:178`) | `POST /api/v2/cases/dedupe` | `case.view` (`routes.ts:11`) | anyone on create page |
| Standalone Dedupe Check page | route `App.tsx:73` `/dedupe` | `GET /api/v2/cases/dedupe-search` | same | `dedupe.view` (`routes.ts:15`; nav `Layout.tsx:37`) | `dedupe.view` holders |
| Add tasks (PENDING, or assign-at-create) | `AddTasksForm.tsx:84` (`add`) | `POST /api/v2/cases/:id/tasks` body=`AddTasksSchema` (`cases.ts:272`) | `POST /cases/:id/tasks` | `case.create` (`routes.ts:18`) | gated `canCreate` in `CaseDetailPage.tsx:122`; also inline after create `CaseCreatePage.tsx:361` |
| Assign / Reassign task | `CaseDetailPage.tsx:179` (`assign`) + `AssignForm` (`:367`) | `AssignTaskSchema`+version (`cases.ts:319`) | `POST /cases/:id/tasks/:taskId/assign` | `case.assign` (`routes.ts:19`) | button gated `canAssign` (`CaseDetailPage.tsx:271`) |
| Unassign task | `CaseDetailPage.tsx:189` (`unassign`) | `{version}` | `POST /cases/:id/tasks/:taskId/unassign` | `case.assign` (`routes.ts:20`) | button only when `t.status==='ASSIGNED'` & `canAssign` (`CaseDetailPage.tsx:283`) |
| Finalize / Complete task (result+remark) | `CaseDetailPage.tsx:196` (`complete`) + `CompleteForm` (`:476`) | `CompleteTaskSchema`+version (`cases.ts:334`) | `POST /cases/:id/tasks/:taskId/complete` | `field_review.complete` (`routes.ts:21`) | button gated `canComplete` & status ∈ `FINALIZABLE={ASSIGNED,SUBMITTED_FOR_REVIEW}` (`CaseDetailPage.tsx:29,292`) |
| Bulk assign (Pipeline) | `PipelinePage.tsx:242` `BulkAssignAction` (`run` `:274`) | `BulkAssignSchema` (`tasks.ts:58`), per-row OCC | `POST /api/v2/tasks/bulk-assign` | `case.assign` (`tasks/routes.ts:15`) | DataGrid bulk action; pool via `GET /tasks/assignable-users` |
| Upload reference attachment | `CaseDetailPage.tsx:533` `AttachmentsSection` (`onPick` `:555`) | `apiUpload` raw bytes | `POST /cases/:id/attachments[?taskId=]` | `case.create` (`routes.ts:27`); upload UI gated `canUpload=canCreate` (`:120`) | delete also `case.create` (`routes.ts:34`) |
| Download / delete attachment | `CaseDetailPage.tsx:570,575` | signed-url `GET …/url`; `DELETE …` | `routes.ts:33,34` | view=`case.view`, delete=`case.create` | download visible to all `case.view` |
| Field Monitoring (no lifecycle write) | `FieldMonitoringPage.tsx` | roster + `request-location` ping (`:229`) | `/api/v2/field-monitoring/*` | `page.field_monitoring` nav (`Layout.tsx:39`) | supervisors |

OCC: assign/unassign/complete pass `version` outside the schema; 409 `STALE_UPDATE` → `ConflictDialog` (`CaseDetailPage.tsx:172,349`). Bulk assign returns per-row `CONFLICT/NOT_FOUND/NOT_ASSIGNABLE/INELIGIBLE_ASSIGNEE` (`tasks.ts:71`), summarized at `PipelinePage.tsx:285`.

---

## 2. How the FE renders status

**Task status enum** (`cases.ts:18` `CASE_TASK_STATUSES`): `PENDING, ASSIGNED, IN_PROGRESS, SUBMITTED_FOR_REVIEW, COMPLETED, REVOKED, CANCELLED`. There is **no `*_LABELS` map** for task status — every surface renders `status.replace(/_/g,' ')` raw.

**Case status enum** (`cases.ts:10` `CASE_STATUSES`): `NEW, IN_PROGRESS, COMPLETED, CANCELLED` only. (Note: smaller than the v1/prod set — no `SUBMITTED_FOR_REVIEW`/`REVOKED`/`REVISIT` case statuses that the prod DB CHECK carries per project memory.)

**Result enum** `KYC_RESULTS` (`cases.ts:53`): `POSITIVE/NEGATIVE/REFER/FRAUD`, with display map `KYC_RESULT_LABELS` (`cases.ts:55`).

| Surface | Rendering | file:line |
|---|---|---|
| Pipeline status chip | `STATUS_TONE` map → only `PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED` keyed; else `bg-surface-muted` (gray). Text = raw `replace(/_/g,' ')` | `PipelinePage.tsx:28,128` |
| Pipeline bucket bar | `BUCKETS`: All, Unassigned(PENDING), Assigned, In Progress, Completed, Cancelled | `PipelinePage.tsx:37` |
| `TaskStats` counts | `pending/assigned/inProgress/completed/cancelled/total` | `tasks.ts:40` |
| Case-detail header badge | raw `data.status.replace(/_/g,' ')` but **hardcoded** `st-in-progress` color regardless of status | `CaseDetailPage.tsx:62` |
| Task row status cell | raw status text + ` — <KYC_RESULT_LABELS[outcome]>` when `verificationOutcome` set | `CaseDetailPage.tsx:242` |
| Cases list status | raw `replace(/_/g,' ')`; filter options Title-cased from `CASE_STATUSES` | `CasesPage.tsx:50,8` |

**COMPLETED-with-result** displays only on the case-detail task row (`CaseDetailPage.tsx:243`: `Completed — Positive`). The Pipeline grid does **not** render the result at all (`TaskView` has no `verificationOutcome` field, `tasks.ts:11`); Cases list shows only case-level status, never the per-task result.

---

## 3. Terminal / result-state UI; verifier vs field role

- Terminal states `COMPLETED`/`CANCELLED`: Assign/Reassign button `disabled` (`CaseDetailPage.tsx:278`); Complete hidden (status not in `FINALIZABLE`); Unassign hidden (not `ASSIGNED`).
- Result is recorded by the finalizing back-office user via `CompleteForm` (`:476`) — one result dropdown (default unset) + mandatory remark; gated `field_review.complete`.
- **Role differences are permission-driven, not role-named** (`CaseDetailPage.tsx:24,36`). `canAssign`=`case.assign`, `canComplete`=`field_review.complete`, `canCreate`=`case.create`. A read-only KYC_VERIFIER (no `field_review.complete`) sees the case + tasks read-only — no Complete/Assign/Add/Upload affordances, but the Action column is hidden entirely when `!canAct` (`:206`). There is **no field-agent-facing UI in web at all** — field execution happens on the (separate, unmodified v1) mobile app; web is office/backend only.

---

## 4. GAPS — backend capability / status with no FE surface

| Gap | Detail | Evidence |
|---|---|---|
| **`IN_PROGRESS` & `SUBMITTED_FOR_REVIEW` are unreachable in v2** | No mobile-submit/execute/upload write route exists in the v2 API (`sync` is `GET /download` only, `sync/routes.ts:12`; no POST in tasks/cases routes advances a task past ASSIGNED). So nothing transitions a task to IN_PROGRESS or SFR. The enums + dashboard counts (`dashboard/repository.ts:96` `awaiting_review`) + `complete` accepting SFR as source (`cases/service.ts:305`) are **dead/forward-declared** until the field app rebases onto v2. | grep: only writers are create/assign/unassign/complete |
| **No backend-review / "Submitted for Review" queue page** | Prod v1 has a dedicated `/backend-review` queue + SFR pages + a per-task "Backend Review" card (project memory PR #20/#23/#24). v2 has **none** — no review route in `App.tsx`, no nav item, no review SDK module. Finalize is folded into the inline `CompleteForm` on case detail. | `App.tsx:55-77`; `Layout.tsx:33-39` |
| **No field-submission / evidence review UI** | The `CompleteForm` comment explicitly notes "no field-evidence layer for desk/KYC" (`CaseDetailPage.tsx:475`). Office user finalizes a result blind — there is no surface to view the field agent's captured photos/form before recording POSITIVE/NEGATIVE/etc. | `CaseDetailPage.tsx:475-489` |
| **No revoke action; REVOKED has no label/UI** | `REVOKED` is in the task enum (`cases.ts:24`) and sync maps `isRevoked` (`sync/service.ts:41`), but there is **no revoke button/endpoint** in v2 and no STATUS_TONE/label for REVOKED → if ever present it renders as plain gray "REVOKED". | `PipelinePage.tsx:28` (no key); no route |
| **No revisit / recheck anywhere in v2** | grep for `revisit|recheck|REWORK|RETURNED` across `apps/api/src`, `apps/web/src`, `packages/sdk/src` → **zero hits**. These v1 lifecycle legs are entirely absent from v2 (no FE and no backend). | grep (§ above) |
| **Pipeline bucket bar omits SFR & REVOKED** | `BUCKETS` (`PipelinePage.tsx:37`) and `TaskStats` (`tasks.ts:40`) have no SUBMITTED_FOR_REVIEW or REVOKED bucket/count. A task in either state (once reachable) would be invisible to every bucket except "All", and its chip would be gray (unkeyed in `STATUS_TONE`). | `PipelinePage.tsx:28,37` |
| **Case-status badge color is hardcoded** | `CaseDetailPage.tsx:62` always uses `st-in-progress` tokens. A `COMPLETED`/`CANCELLED`/`NEW` case shows in-progress (amber) styling. Cosmetic but misleading. | `CaseDetailPage.tsx:62` |
| **Case-status enum narrower than prod** | v2 `CASE_STATUSES` = 4 values (`cases.ts:10`); prod DB promoted `SUBMITTED_FOR_REVIEW` to a real case status and has REVISIT etc. If v2 ever ingests those rows the FE has no label/filter option (`CasesPage.tsx:8` builds options only from the 4). | `cases.ts:10` |
| **Result never reaches Pipeline or Cases list** | `TaskView` (`tasks.ts:11`) omits `verificationOutcome`; `CaseView` (`cases.ts:105`) carries no per-task result. Only the case-detail task row shows the official result. No FE roll-up of the backend decision to list views. | `tasks.ts:11`, `cases.ts:105` |

---

## 5. Inconsistencies / holes / ambiguities

1. **`FINALIZABLE` includes SFR but SFR is unproducible** — `CaseDetailPage.tsx:29` lets Complete show for SFR tasks, yet no v2 path creates an SFR task. Forward-declared dead branch.
2. **No FE feature-flag infra** — confirmed: no `useFeatureFlag`/flag gating anywhere; affordances gate purely on permission. (Matches project memory "NO FE feature-flag infra yet".)
3. **"Documents / Tasks" label drift** — case detail calls the task table "Documents / Tasks" (`CaseDetailPage.tsx:212`) and Add Tasks "Add Documents / Tasks" (`CaseCreatePage.tsx:396`), but Pipeline/SDK call them Tasks. Document-centric naming half-applied.
4. **Add-tasks affordance is `case.create`, not `case.assign`** — adding tasks (including assign-at-create) requires `case.create` (`routes.ts:18`); the assign-at-create *sub-fields* additionally need `canAssign` (`AddTasksForm.tsx:96`). A `case.assign`-only user cannot add tasks at all, only assign existing ones.
5. **Dedupe decision is auto-derived, not operator-chosen** — `CaseCreatePage.tsx:87` sets `CREATE_NEW` vs `NO_DUPLICATES_FOUND` purely from whether matches exist; the operator never explicitly chooses, though the SDK models it as a decision (`cases.ts:67`). Dedupe search only uses the *primary* applicant's name/mobile/pan (`CaseCreatePage.tsx:78`), omitting co-applicants and company, even though the contract supports company + all-applicant matching (`cases.ts:206`).
6. **Reassign pool depends on the task's own stored location** — `AssignForm` (`CaseDetailPage.tsx:388`) blocks FIELD reassign when `!task.areaId`; a FIELD task added without a location can never be (re)assigned via the UI ("Task has no location", `:434`).
7. **`distanceBand` collected nowhere** — legacy/optional in schemas (`cases.ts:322`, `tasks.ts:66`) but no UI field; `rateType` is display-only on the task row (`CaseDetailPage.tsx:256`).
8. **No cancel-task / cancel-case action** — `CANCELLED` exists in both enums but no FE (or v2 API) path sets it.

---

### Summary of v2 vs v1/prod lifecycle coverage
v2 web implements only the **office-side forward path**: create → add tasks → assign/reassign/unassign → finalize(result+remark)→COMPLETED, plus reference attachments. The entire **field-execution + review loop** (mobile submit → IN_PROGRESS → SUBMITTED_FOR_REVIEW → backend-review queue → field-evidence review → revoke/revisit/recheck) that exists in v1/prod has **no v2 backend writer and no v2 FE surface** — the statuses are declared in enums but inert.
