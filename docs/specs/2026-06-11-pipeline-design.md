# Pipeline (Operations) — task lists & assignment workbench — Design

- **Status:** Design complete — 2026-06-11 (CTO-approved per the autonomous-build directive)
- **Phase:** OPERATIONS, first screen. Frozen nav: OPERATIONS → **Pipeline** (KYC Queue merged in
  as a kind filter — MASTER_MEMORY §1 nav row, contradiction report "KYC Queue → merged").
- **Binds:** ADR-0002 (Case→Task→VU) · ADR-0015 (workspace sequencing: Assignment precedes the
  Workspace) · ADR-0022 (Access Control 2.0 — every operational list composes the one scope seam)
  · DATAGRID / PAGINATION / IMPORT_EXPORT / CONCURRENCY (OCC) / RESPONSIVE freezes.
- **Activates the AC2.0 close-out deferrals** (ceo-quality-sentinel + B-20 residuals): VT
  task-LEVEL predicate · assignableUsers narrowed by unit.worker_role ∩ hierarchy ∩ territory ·
  append-only assignment history.

---

## 1. What Pipeline is

The operational task queue: **every `case_task` across all cases**, in one Universal DataGrid,
scoped by the actor's resolved scope. Zion's 3-bucket work model maps onto status buckets
(Unassigned = PENDING · Assigned/In-progress · Completed), with bulk assignment as the core
workbench action. A task row is the unit of field/KYC work; the case stays the container
(row click → `/cases/:id`).

Out of scope (later build-order steps): Verification Workspace (per-task data entry / FE mobile
data), Reports, MIS, Billing. Pipeline only LISTS and ASSIGNS.

## 2. API surface (`/api/v2/tasks`, new module `modules/tasks`)

| Route | Perm | Notes |
|---|---|---|
| `GET /tasks` | `case.view` | `Paginated<TaskView>`; PageSpec; **task-level scope predicate** |
| `GET /tasks/stats` | `case.view` | scoped status-bucket counts honoring search+filters (minus status) |
| `GET /tasks/export` | `data.export` | B-13 pattern: reuses the list query; modes current/all/selected (uuid ids → `::uuid[]`) |
| `GET /tasks/assignable-users?taskIds=` | `case.assign` | per-task eligible pool, INTERSECTION across tasks (≤100 ids, uuid-validated) |
| `POST /tasks/bulk-assign` | `case.assign` | ≤500 items, per-row OCC + scope + eligibility; per-row result, never all-or-nothing |

`TaskView` = CaseTaskView columns + case context: caseNumber, clientId/clientName,
productName, primaryName, unitKind, plus `version` (new). All joins from `case_tasks ct` are 1:1
(cases/vu/clients/products by PK; assignee by PK; primary applicant partial-unique) → the COUNT
uses the same FROM with zero fan-out (CPV envelope precedent).

**PageSpec.** sortMap: caseNumber·clientName·primaryName·unitName·unitKind·status·
assignedToName·assignedAt·createdAt·updatedAt (default createdAt desc; tiebreaker `ct.id`).
filterMap: status (enum CASE_TASK_STATUSES) · unitKind (enum FIELD_VISIT|KYC_DOCUMENT — the
"KYC merged into Pipeline" filter) · caseNumber/unitName/clientName/assignedToName/primaryName
(text) · createdAt/assignedAt (date). Domain params: `status` (bucket bar), `clientId`,
`assignedTo` (uuid), `unitId`. Global search: case_number | primary name | unit name (ILIKE).

## 3. Scope: the task-level predicate path (registry extension)

`DimensionDef` gains optional **`taskPredicate(params, values)`**; `composeScopePredicate`
gains an optional `level: 'CASE' | 'TASK'` (default CASE) that picks
`def.taskPredicate ?? def.casePredicate`. Contract for TASK level: FROM aliases `case_tasks ct`
JOIN `cases cs` — so every existing cs-based leg (CLIENT/PRODUCT/PINCODE/AREA/STATE/CITY) works
unchanged, and **VERIFICATION_TYPE gets the direct task leg `ct.verification_unit_id = ANY(...)`**
(no per-case EXISTS — this is the deferred "task-level leg" activation).

Task hierarchy leg: `(ct.assigned_to = ANY(ph) OR cs.created_by = ANY(ph))` — a task is in
hierarchy scope if it is assigned to an in-scope user or its case was created by one (the exact
task-side mirror of the case predicate; the two lists never disagree about ownership).

Invariants unchanged + machine-held: RESTRICT unknown-registry dim → literal FALSE; empty EXPAND
legs omitted; empty RESTRICT kept (fail-closed); SA bypass via `grants_all`/ALL attributes; zero
role-name literals (noRoleLiterals gate covers the new module); out-of-scope detail = 404.

## 4. Assignment hardening

**4.1 Eligibility (replaces the flat pool for per-task use).** A user is eligible for task T iff:
1. USABLE (`is_active AND effective_from <= now()`), and
2. `role = T.unit.worker_role` (data-driven; custom worker roles ride free), and
3. inside the **actor's** hierarchy scope (getScopedUserIds), and
4. **territory** — only when the case is located (`cs.pincode_id IS NOT NULL`) AND the
   candidate's role has an ACTIVE PINCODE or AREA wiring: the candidate must hold an active
   assignment matching the case (`PINCODE entity_id = cs.pincode_id OR AREA entity_id =
   cs.area_id` — id-equality, mirroring the visibility engine's PINCODE/AREA legs exactly).
   Roles without territory wiring (desk roles) skip leg 4. A territory-wired candidate with zero
   matching assignments is EXCLUDED for located cases (fail-closed, consistent with the engine).
   Unlocated case → leg 4 skipped for everyone.

Dimension codes in this SQL come from the code registry constants — they are dimension codes,
not role names; the noRoleLiterals gate stays green.

`GET /cases/:id/assignable-users` (CaseDetail) keeps its shape but is upgraded to the same
eligibility (per-task variant exposed via `taskIds` on `/tasks/assignable-users`; multi-task =
intersection, since one assignee must fit all selected tasks).

**4.2 OCC + scope on assignment writes (migration 0036).**
- `case_tasks` + `version int NOT NULL DEFAULT 1` (the ops OCC carve-out C-10 deferred — now
  activated for assignment writes; `CaseTaskView.version` exposed; AssignTaskSchema requires
  `version` → 400 VERSION_REQUIRED / 409 STALE_UPDATE per CONCURRENCY standard).
- **Scope guard on writes (closes a live gap):** assign/unassign/bulk-assign verify the task is
  inside the actor's resolved scope (same predicate as the list) → out-of-scope = 404 (IDOR-safe;
  today the per-case assign route checks only the assignee pool, not case visibility).

**4.3 Append-only `task_assignment_history` (B-20 residual).** Every assignment event:
`(task_id, case_id, action ASSIGNED|REASSIGNED|UNASSIGNED, assigned_to, previous_assigned_to,
visit_type, distance_band, bill_count, assigned_by, created_at)`. Insert in the SAME transaction
as the case_tasks UPDATE. Mutation-blocked by trigger (0017 pattern). Read surface: history rows
included on the case detail task block later (workspace phase); table + writes land now so no
event is ever lost. `audit_log` rows continue unchanged (history is the domain ledger, audit is
the platform ledger — same split as rates/rate_history).

**4.4 Bulk assign.** `POST /tasks/bulk-assign` `{items: [{id, version}], assignedTo, visitType,
distanceBand, billCount}` (≤500, platform/bulk parse pattern with uuid kind). Per row, in its own
transaction: scope-visible? → status PENDING|ASSIGNED? → assignee eligible for THIS task? → OCC
UPDATE (version match) + history row. Per-row outcomes (`UPDATED · CONFLICT · NOT_FOUND ·
NOT_ASSIGNABLE · INELIGIBLE_ASSIGNEE`); failures never abort the batch (B-23/import precedent).

## 5. FE: Pipeline page (`/pipeline`, features/pipeline)

Universal DataGrid (server pagination/search/filters/sort — nothing bespoke):
- **Status bucket bar** above the grid: All · Unassigned · Assigned · In Progress · Completed ·
  Cancelled, with scoped counts from `/tasks/stats` (chips set the `status` domain param;
  URL-synced).
- Columns: Case # · Client · Applicant · Unit · Kind · Status · Assignee · Bill · Assigned At ·
  Created · Updated (Created/Updated date-time per MANAGEMENT_LIST_STANDARD; column visibility,
  header filters, date filters Created+Assigned all inherited).
- Row select (B-23) + **Assign action**: dialog fetches `/tasks/assignable-users?taskIds=…`
  (intersection pool, 3-branch async select), visit type / distance band / bill count inputs,
  per-row result summary (UPDATED / CONFLICT / …) mirroring BulkStatusActions; ConflictDialog
  semantics via per-row CONFLICT reporting (bulk = per-row OCC, no silent overwrite).
- Export menu (current/all/selected), Hexagon loading bands, skeleton rows, responsive-first,
  tokens, UPPERCASE display — all inherited from the shared grid.
- Row click → `/cases/:id`. Nav: OPERATIONS → Pipeline enabled; FE gate = `case.view` permission
  (grantsAll-aware), no role names.
- Import: **not listed** for tasks in IMPORT_EXPORT_STANDARD (tasks are created via the case
  flow) → no import button.

## 6. Mobile contract

New endpoints are additive under `/api/v2`; nothing mobile consumes changes shape.
`CaseTaskView.version` is an additive field (never-break-mobile). Scope-contract clause of
MOBILE_API_COMPATIBILITY holds: the task list composes the server-side seam, so a future device
sync endpoint reuses it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| AssignTaskSchema now requires `version` (breaking for FE callers) | only consumer is CaseDetailPage's panel — updated in the same slice; mobile does not call assign |
| Territory leg empties the pool in thin dev data | leg applies only to located cases + territory-wired roles; assignable-users response distinguishes "no eligible users" honestly |
| COUNT cost of the wider FROM | all joins 1:1 PK/partial-unique; `idx_case_tasks_*` already exist; date/status filters indexed |
| Bulk 500 × per-row tx latency | matches B-23 bulk precedent (<500 cap); >500 = future job tier |
| cases.api seed flake (fired in a gate run) | root-cause fix FIRST: factory helpers assert HTTP status before reading bodies |
