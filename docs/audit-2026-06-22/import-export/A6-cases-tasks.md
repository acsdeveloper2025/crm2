# A6 — Import/Export Field-Coverage Audit: Cases · Tasks/Bulk-Assignment · Pipeline

> Audit-only (read-only). Working-tree state @ 2026-06-22 (branch `main`, parallel-session WIP in
> `cases/repository.ts`, `cases/__tests__`, `tasks/*` — flagged inline where relevant).
> Scope: Case Creation (case + applicant + task fields), Tasks/Bulk-Assignment, Pipeline export grid.
> Standard: `docs/IMPORT_EXPORT_STANDARD.md` (§3 Pipeline/Cases/Tasks export-mandatory; §4 **Case
> Creation + Bulk Assignment import-mandatory**). Constraining ADRs: 0053, 0056, 0055, 0058, 0054.

## Headline answers

- **Does a Case-Creation bulk import exist?** **NO.** No `cases/import.ts`, no `ImportSpec`, no
  route, no controller method, no SDK client method, no template, no web Import button. Neither
  `.xlsx` nor `.csv`. This is the largest gap (import-mandatory per §4). **P0.**
- **Does a Bulk-Assignment import exist + is it web-wired?** **NO file import.** Bulk Assignment is
  implemented as a **JSON API action** (`POST /api/v2/tasks/bulk-assign`, `BulkAssignSchema`),
  web-wired in the Pipeline workbench (`PipelinePage.tsx` → `BulkAssignAction`). It assigns the
  *currently-selected grid rows* to one executive — it does **not** accept an uploaded file of
  task-ref→assignee rows. §4 lists "Bulk Assignment" as import-mandatory; the file-upload path is
  absent. **P0** (file-import path missing) — see G6 for nuance.
- **Cases-grid export?** **NOT wired.** `CasesPage.tsx` renders a bare `<DataGrid>` with **no
  `exportFn`**; there is **no `/cases/export` route or controller**. Only the standalone *Dedupe
  Check* page exports (`DEDUPE_EXPORT_COLUMNS`, a `DuplicateMatch` manifest — a different entity).
  §3 lists Cases as export-mandatory. **P1.**
- **Pipeline (tasks) export?** **Wired and correct.** `/api/v2/tasks/export` + `taskExportColumns()`;
  money columns (`billAmount`, `commissionAmount`) are **RBAC-gated** on `billing.view`
  (`canViewBilling`) — the §5b money-export rule is satisfied. CSV/XLSX both supported via the shared
  engine. Formula-injection + RFC-4180 escaping handled centrally (`format.ts`).

---

## Entities covered

| Entity | Create import | Export | Web-wired |
|---|---|---|---|
| **Cases** (case + applicants) | ✗ none | ✗ Cases grid has no export (only Dedupe Check page) | n/a |
| **Tasks** (add-tasks) | ✗ none | ✓ Pipeline export (`/tasks/export`) | ✓ |
| **Bulk Assignment** | ✗ no file import (JSON action only) | n/a | JSON action ✓ / file import ✗ |
| **Pipeline grid** | n/a | ✓ RBAC-gated money columns | ✓ |

---

## Field matrix 1 — Case-creation fields (case + applicants)

Source of truth: `CreateCaseSchema`/`AddApplicantSchema` (`packages/sdk/src/cases.ts`),
`CaseCreatePage.tsx`, DB `INSERT INTO cases` / `case_applicants` (`cases/repository.ts:399-424,
466-471`). IMPORT column = "would-be header" (none exist today). EXPORT = Cases-grid export (absent)
unless noted.

| Field | Required? | DB column | SDK Create field | Transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| Client | yes | `cases.client_id` | `clientId` (positiveInt) | — (FK; file would carry CODE) | ✗ | ✗ (CasesPage no export; CaseView has `clientName`) |
| Product | yes | `cases.product_id` | `productId` (positiveInt) | — (FK CODE) | ✗ | ✗ |
| Backend contact no | yes | `cases.backend_contact_number` | `backendContactNumber` | `PHONE_REGEX` | ✗ | ✗ |
| Dedupe decision | yes | `cases.dedupe_decision` | `dedupeDecision` (enum) | enum | ✗ | ✗ |
| Dedupe rationale | cond. (CREATE_NEW) | `cases.dedupe_rationale` | `dedupeRationale` | **`toUpper`** | ✗ | ✗ |
| Dedupe matched case nos | optional | `cases.dedupe_matched_case_numbers` | `dedupeMatches[]` | — | ✗ | ✗ |
| Case location (pincode) | optional | (not on create insert; case-level) | `pincodeId` | — | ✗ | ✗ |
| Case location (area) | optional | (not on create insert) | `areaId` | — | ✗ | ✗ |
| Applicant name | yes (≥1 applicant) | `case_applicants.name` | `applicants[].name` | **`toUpper`** | ✗ | ✗ (CaseView `primaryName`) |
| Applicant mobile | optional | `case_applicants.mobile` | `applicants[].mobile` | `PHONE_REGEX` | ✗ | ✗ (`primaryMobile`) |
| Applicant PAN | optional | `case_applicants.pan` | `applicants[].pan` | `PAN_REGEX` (case-insensitive) | ✗ | ✗ (`primaryPan`) |
| Applicant company name | optional | `case_applicants.company_name` | `applicants[].companyName` | **`toUpper`** | ✗ | ✗ |
| Applicant type / primary | derived (idx 0 = primary) | `applicant_type`,`is_primary` | array order | — | ✗ | ✗ |
| Calling code | server-gen | `case_applicants.calling_code` | — | server (CC-token) | n/a | ✗ |
| Case number | server-gen | `cases.case_number` | — | server | n/a | ✗ |
| Status | server | `cases.status` | — | server | n/a | ✗ (CaseView `status`) |

Notes: case creation captures **multi-applicant** + a **mandatory dedupe gate** (ADR-0053). A flat
CSV/XLSX import row cannot natively express "1 case → N applicants" or the dedupe verdict — any
Case-Creation import must define a parent/child or repeated-applicant-column shape, and must thread
the dedupe decision/rationale. (This is *why* it is non-trivial, not a reason to skip it.)

## Field matrix 2 — Task / assignment fields (add-tasks)

Source: `AddTasksSchema` (`cases.ts:410-457`), `AddTasksForm.tsx`, DB `INSERT INTO case_tasks`
(`cases/repository.ts:631-651`). EXPORT = Pipeline (`taskExportColumns`, `tasks/service.ts:58-82`).

| Field | Required? | DB column | SDK Create field | Transform | IMPORT | EXPORT (Pipeline header) |
|---|---|---|---|---|---|---|
| Verification unit | yes | `case_tasks.verification_unit_id` | `tasks[].verificationUnitId` | — (CPV-enabled check) | ✗ | ✓ `Unit` (code — name) |
| For applicant | yes | `case_tasks.applicant_id` | `tasks[].applicantId` (uuid) | — | ✗ | ✓ `Applicant` (primaryName) |
| Address | cond. (FIELD) | `case_tasks.address` | `tasks[].address` | **`toUpper`**, default `''` | ✗ | ✗ |
| Latitude | optional | `case_tasks.latitude` | `tasks[].latitude` | range −90..90 | ✗ | ✗ |
| Longitude | optional | `case_tasks.longitude` | `tasks[].longitude` | range −180..180 | ✗ | ✗ |
| Trigger (instruction) | optional | `case_tasks.trigger` | `tasks[].trigger` | **`toUpper`**, default `''` | ✗ | ✗ |
| Priority | optional | `case_tasks.priority` | `tasks[].priority` | enum, default MEDIUM | ✗ | ✗ |
| Target TAT (hours) | optional | `case_tasks.tat_hours` | `tasks[].tatHours` | int>0; else derived from priority | ✗ | ✓ via `tatHours`/`Completed In` band col |
| Visit type | cond. (assign/ADR-0056) | `case_tasks.visit_type` | `tasks[].visitType` | enum FIELD/OFFICE | ✗ | ✓ (in TaskView; not a default export col) |
| Field rate type | server-derived (ADR-0056) | `case_tasks.field_rate_type` | `tasks[].fieldRateType` (back-compat) | enum; OFFICE auto-stamped | ✗ | ✗ (commission key — RBAC) |
| Location pincode | cond. (FIELD assign) | `case_tasks.pincode_id` | `tasks[].pincodeId` | — | ✗ | ✗ |
| Location area | cond. (FIELD assign) | `case_tasks.area_id` | `tasks[].areaId` | — | ✗ | ✗ |
| Assignee | optional (assign-at-create) | `case_tasks.assigned_to` | `tasks[].assigneeId` (uuid) | — (eligibility re-check) | ✗ | ✓ `Assignee` |
| Per-task attachment | optional | (separate `case_attachments`) | n/a (multipart upload) | — | ✗ | ✗ |
| Task number | server-gen | `case_tasks.task_number` | — | server | n/a | ✓ `Task` |
| Bill count | assign-time | `case_tasks.bill_count` | (AssignTask/BulkAssign) | int 0..50 | ✗ | ✓ `Bill Count` |

## Field matrix 3 — Pipeline export (`taskExportColumns`, `tasks/service.ts:58-82`)

| Export column id | Header | Source field | RBAC gate |
|---|---|---|---|
| caseNumber | Case | `r.caseNumber` | — |
| taskNumber | Task | `r.taskNumber` | — |
| clientName | Client | `r.clientName` | — |
| primaryName | Applicant | `r.primaryName` | — |
| unitName | Unit | `${unitCode} — ${unitName}` | — |
| unitKind | Kind | `r.unitKind` | — |
| status | Status | `r.status` | — |
| assignedToName | Assignee | `r.assignedToName` | — |
| billCount | Bill Count | `r.billCount` | — |
| **billAmount** | Bill Amount | `r.billAmount` | **`billing.view`** ✓ |
| **commissionAmount** | Commission | `r.commissionAmount` | **`billing.view`** ✓ |
| assignedAt | Assigned At | `r.assignedAt` | — |
| createdAt | Created | `r.createdAt` | — |
| updatedAt | Updated | `r.updatedAt` | — |

Pipeline export verification: re-runs the same scoped list query (`exportData`); `selected` mode
filters UUIDs and never falls through to "all"; `all` mode enforces the ≥-threshold 413
(`assertExportable`). Money columns appended only when `canViewBilling`. **No RBAC leak.** ✓

---

## Ranked gap list

| ID | Pri | Entity | Field/scope | I/E | Location | Fix sketch |
|---|---|---|---|---|---|---|
| **G1** | **P0** | Cases | **Entire Case-Creation bulk import missing** (case + applicants + dedupe) | import | (absent) `apps/api/src/modules/cases/` — no `import.ts`/route/controller; cf. `rates/import.ts` model | Add a `cases` `ImportSpec` reusing **`CreateCaseSchema`** (don't bypass — keeps `toUpper` on name/company/rationale + PAN/PHONE regex + dedupe refinement). File shape carries client/product **CODE** (resolve→id via `clientService.options()`/`productService.options()` like `rates/import.ts`), repeated applicant columns or a parent-row+child-row shape for N applicants, and an explicit dedupe decision/rationale column. Register a `registerImportRunner('cases', …)`, add `GET /cases/import-template` + `POST /cases/import?mode=preview\|confirm`, SDK methods, and an `<ImportModal>` on `CasesPage`. Both `.xlsx` (template) and `.csv` (parse) via the shared engine. |
| **G2** | **P0** | Bulk Assignment | **No file-import path** (task-ref → assignee, visit type, bill) | import | `POST /tasks/bulk-assign` is JSON-only; §4 lists Bulk Assignment import-mandatory | Add a `bulk-assignment` `ImportSpec`: file columns `Task Number → Assignee (username) → Visit Type → Bill Count`; `resolve` maps task-number→id + username→userId, then reuses the per-row `BulkAssignSchema`/service path (eligibility re-check, per-row OCC, `NO_FIELD_COMMISSION`). Wire `<ImportModal>` on `PipelinePage`. Reuses the existing bulk-assign service — additive. |
| **G3** | **P1** | Cases | Cases-grid export not wired (no `exportFn`, no route) | export | `apps/web/.../CasesPage.tsx:74-86` (no `exportFn`); `cases/routes.ts` (no `/export`); `cases/service.ts` (no `CaseView` manifest) | Add `caseExportColumns: ExportColumn<CaseView>[]` (caseNumber, primaryName, primaryMobile, primaryPan, clientName, productName, status, taskCount, applicantCount, verificationOutcome, createdAt), an `exportData` service method (re-run scoped `list` query like tasks), `GET /cases/export` (`data.export`), and `exportFn` on the `CasesPage` DataGrid. No money columns → no extra RBAC needed. |
| **G4** | **P1** | Cases/Tasks | Round-trip is **lossy** — many editable create fields (backend contact, dedupe, address, trigger, TAT, lat/long, visit type, location) are not exported anywhere | export | matrices 1–3 | Once G1/G3 exist, widen the Cases/Pipeline export manifests so an export can seed a re-import (or document the intentionally-dropped set). At minimum surface backend-contact, dedupe decision, and per-task address/trigger/TAT on export. |
| **G5** | **P2** | Tasks | Pipeline export omits `visitType`, `fieldRateType` (commission key), `dueAt`/`overdue`, `completedElapsedMinutes` | export | `tasks/service.ts:58-82` | Add `visitType`, `dueAt`, `overdue`, `completedTatBand` as non-money columns; keep `fieldRateType` behind `billing.view` if treated as comp data. Polish — TaskView already carries them. |
| **G6** | **P2** | Bulk Assignment | Standard ambiguity: "Bulk Assignment" import may be *satisfiable* by the in-grid JSON action | n/a | `IMPORT_EXPORT_STANDARD.md:46` vs `tasks/service.ts` bulkAssign | Governance call: if the in-grid bulk-assign action is deemed to satisfy §4, mark G2 WONTFIX with an ADR note; otherwise build the file path. Either way **disposition explicitly** in `COMPLIANCE_GAPS_REGISTRY.md` (don't silently drop). |

### WIP flag (parallel session)
`cases/repository.ts`, `cases/__tests__`, `tasks/*` are uncommitted. The audited create/insert
columns (`case_tasks` insert at `repository.ts:631-651`, applicant insert `466-471`) and the task
export manifest were read from the current working tree; no field appeared mid-rename, but re-verify
G1/G3 manifests against the final committed state.

## Disposition
All six gaps should land in `docs/COMPLIANCE_GAPS_REGISTRY.md` as DEFERRED (pending owner approval) —
G1/G2 are import-mandatory P0s, G3 an export-mandatory P1.
