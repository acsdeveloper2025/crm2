# C4 — Assignment dependencies (User · Scope · Area/Pincode · pool roles)

**Audit lens:** bulk Case-Creation import (ADR-0059). READ-ONLY. Maps the assignment leg of case
creation: how a task's LOCATION resolves, who is ELIGIBLE to be assigned, and what a row needs at
import time depending on whether tasks are imported **PENDING** (no assignee) vs **assigned-at-import**.

**Headline:** Case creation is non-atomic and assignment is OPTIONAL. The cheap, robust importer
imports tasks **PENDING** — no executive, no commission gate, **no location required at all** (the
`pincodeId/areaId` columns are nullable everywhere; ADR-0056's "FIELD location required at create"
is a *web-form* rule, NOT a server/DB invariant). Assignment (executive + scope + pool-role +
commission) only becomes a dependency if the importer chooses to assign at import — and that pulls in
the full eligibility graph below plus the hard `NO_FIELD_COMMISSION` gate.

---

## 1. Location model — how a task's Area/Pincode resolves

### `locations` table
A row is keyed by **(pincode, area)** — `UNIQUE (pincode, area)` (the create path raises
`LOCATION_EXISTS` on `23505`). `locations.repository.ts:7` columns:
`id, pincode, area, city, state, country, is_active, effective_from, version, …`. ~157k rows
(full all-India directory). "USABLE" = `is_active AND effective_from <= now()` (ADR-0017).

A given **pincode spans many area rows** (each a distinct `id`) —
`scopeAssignments/repository.ts:51 locationIdsByPincode` returns an array; `findByPincodeArea` is the
exact (pincode, lower(area)) → single row lookup.

### How a task carries its location — `case_tasks.pincode_id` + `case_tasks.area_id`
Two nullable FK columns, **both → `locations(id)`** (mig `0039_visit_type_pool.sql:29-30`):
```
pincode_id integer REFERENCES locations (id)   -- coarse
area_id    integer REFERENCES locations (id)   -- finer
```
Per the migration comment they are meant as *coarse* (pincode-level row) vs *finer* (area-level row).
**But in practice the web sends the SAME id for both.** The Add-Tasks form resolves ONE `locations`
row from a free-text search and sets `{ pincodeId: locationId, areaId: locationId }`
(`apps/web/src/features/cases/AddTasksForm.tsx:139-140`); the eligible-assignee query does the same
(`AddTasksForm.tsx:306-308 p.set('areaId',…); p.set('pincodeId',…)` = one value). The location picker
is a single `GET /api/v2/locations?search=<text>` returning a flat `locations` row (`AddTasksForm.tsx:290-296`).

→ **The effective web model is one `locations` row id used as both legs.** The pincode/area split
exists in the schema and the rate-resolution `CASE` ranking but is collapsed by the only real client.

### Territory matching uses these ids verbatim
The field-eligibility check matches a user's `user_scope_assignments` (AREA or PINCODE dimension,
`entity_id`) against the task's `area_id`/`pincode_id` by **id-equality** — see §3. So whatever id the
importer puts in `area_id`/`pincode_id` MUST be the SAME `locations.id` the executive is scoped to.

### CSV "Pincode" + "Area" → location id (precedent EXISTS)
The rates import is the proven pattern (`rates/import.ts:89-105`): two file columns `Pincode` + `Area`
→ `locationRepository.findByPincodeArea(pincode, area)` (`locations/repository.ts:95`, case-insensitive
on area, USABLE-only) → `loc.id`. Rules already coded there the case importer should reuse verbatim:
- both present → resolve; **no usable row ⇒ row error** `no usable location for pincode <p> area <a>`.
- exactly one of the two present ⇒ row error `provide both Pincode and Area, or neither`.
- both absent ⇒ `locationId = undefined` (allowed — optional).

`scopeAssignments/repository.ts:59 locationIdByPincodeArea` is a second, identical resolver (scope import).

### Required only for FIELD? (ADR-0056)
**At the SCHEMA/server layer: location is NEVER unconditionally required.**
- `CreateCaseSchema.pincodeId/areaId` — `positiveInt.optional()` (`packages/sdk/src/cases.ts:377-378`);
  the case INSERT writes `pincode_id/area_id = NULL` when absent (`cases/repository.ts:401,412-413`).
- `AddTasksSchema` task — `pincodeId/areaId` optional (`cases.ts:436-437`). The ONLY refinement that
  forces a location is **conditional on assign-at-create**:
  `!assigneeId || visitType!=='FIELD' || (areaId && pincodeId)` (`cases.ts:450-453`,
  `'a FIELD assignment requires the verification location (pincode + area)'`). i.e. location is
  required **iff** you assign a FIELD task at create. A FIELD task added **PENDING** (no assigneeId)
  needs **no location** (it gets one when later dispatched).

ADR-0056's "FIELD location required at create" = the requirement to derive the executive's commission
band (LOCAL/OGL) at assignment, which needs the task location. It is an **assign-time** dependency, not
a create-time one. (The address column has the matching exact rule
`visitType!=='FIELD' || address.length>=1`, `cases.ts:442-444` — address required iff FIELD.)

---

## 2. Assignment-pool roles — which role serves which visit type

`assignment_pool_roles` (mig `0039_visit_type_pool.sql:35-44`): PK `visit_type`, FK `role_code → roles(code)`.
Seeded **data** (admin-extensible; no role literal in code — every query reads the role from this table):

| visit_type | role_code     | label  |
|------------|---------------|--------|
| `FIELD`    | `FIELD_AGENT` | Field  |
| `OFFICE`   | `KYC_VERIFIER`| Office |

`VISIT_TYPES = ['FIELD','OFFICE']` (`packages/sdk/src/cases.ts:77`). Every eligibility query resolves the
candidate role via the subquery `(SELECT role_code FROM assignment_pool_roles WHERE visit_type = $N)`
(`tasks/repository.ts:279,317`; `cases/repository.ts:796`). **Constraint:** an assignee MUST hold the
pool role for the task's visit type. A FIELD task can only go to a `FIELD_AGENT`; an OFFICE task only to
a `KYC_VERIFIER`. (Per the master-memory ADR-0050 two-actor relay, the KYC_VERIFIER relays but never
completes; closing is a separate desk role — not part of the *assignment* gate.)

---

## 3. User scope — territory + portfolio; the eligibility check

### `user_scope_assignments`
`(user_id, dimension_code, entity_id | entity_value, is_active, assigned_by, …)`. Dimensions
(`platform/scope/dimensions.ts:9-16`): `CLIENT, PRODUCT, PINCODE, AREA, STATE, CITY, VERIFICATION_TYPE`.
`PINCODE`/`AREA` are **ID-kind** referencing `locations.id`; `CLIENT`/`PRODUCT` reference their catalogs;
`STATE`/`CITY` are VALUE-kind (location columns). The role's wiring
(`role_scope_dimensions`, EXPAND/RESTRICT) governs which dimensions a role actually holds.

**Two distinct uses of scope — do not conflate:**
1. **Actor (creator) data-scope** — `resolveScope(actor)` / `getScopedUserIds(actor)`
   (`platform/scope/repository.ts`): "whose rows may THIS operator see/assign within", from the role's
   **hierarchy mode** (`ALL` → no filter · `SUBTREE` → reports_to subtree · `DIRECT_TEAM` · `SELF`).
   Caps the candidate pool to the operator's hierarchy (`u.id = ANY(scopeUserIds)`).
2. **Candidate (executive) territory-scope** — the FIELD candidate's OWN `user_scope_assignments`
   AREA/PINCODE rows must cover the task's location.

### The eligibility check (3 implementations, ONE model — ADR-0024)
- `cases/repository.ts:780 eligibleAssigneesForNew(visitType, pincodeId, areaId, scopeUserIds)` — the
  **assign-at-create** pool (what the import path would hit).
- `tasks/repository.ts:264 eligibleAssignees(taskIds, visitType, scopeUserIds)` — bulk-assign pool
  (must fit EVERY selected task).
- `tasks/repository.ts:299 eligibleTaskIdsForAssignee(...)` — per-row bulk check.

All three require ALL of:
1. **USABLE user** — `u.is_active AND u.effective_from <= now()`.
2. **Pool role** — `u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = $N)`.
3. **Actor hierarchy** — `u.id = ANY(scopeUserIds)` (omitted ⇒ no cap, e.g. SUPER_ADMIN `ALL`).
4. **FIELD territory** (OFFICE skips this leg): the candidate holds an ACTIVE
   `user_scope_assignments` with `(dimension='AREA' AND entity_id = task.area_id)` **OR**
   `(dimension='PINCODE' AND entity_id = task.pincode_id)` (`cases/repository.ts:799-805`).
   - Fail-closed: in `eligibleAssignees`, a FIELD task **with no location**
     (`area_id IS NULL AND pincode_id IS NULL`) ⇒ covered by **no one** (`tasks/repository.ts:284`).
   - In `eligibleAssigneesForNew` the territory leg simply finds no match if the location id isn't in
     the candidate's scope rows.

### Service-side re-check (the gate that fires at import-with-assignee)
`cases/service.ts:217-224 addTasks`: for every task with an `assigneeId`, the service re-runs
`eligibleAssigneesForNew(...)` and throws **`400 INVALID_ASSIGNEE`** if the chosen user isn't in the
pool. (Schema already guarantees `assigneeId ⇒ visitType` and `FIELD ⇒ areaId+pincodeId`.)
`taskService.bulkAssign` mirrors this per-row as status `INELIGIBLE_ASSIGNEE` (`tasks/service.ts:268`).

**Errors when an executive is out of scope / wrong pool:**
| Path | Error |
|------|-------|
| assign-at-create (addTasks) | `400 INVALID_ASSIGNEE` (whole request fails) |
| single assign (`assignTask`) | `400 INVALID_ASSIGNEE` (`cases/service.ts:303-308`) |
| bulk-assign (per row) | status `INELIGIBLE_ASSIGNEE` (batch continues) |

---

## 4. Assign at create vs separate (PENDING)

Case creation is **non-atomic and assignment-optional**:
- `POST /cases` → case + applicants only (`cases/repository.ts:395` create). NO tasks.
- `POST /cases/:id/tasks` → tasks (`cases/service.ts:203 addTasks` → `cases/repository.ts:575 addTasks`).
  Each task is **born PENDING by default**; it becomes ASSIGNED only if `assigneeId` is supplied:
  `INSERT … status = CASE WHEN $10::uuid IS NULL THEN 'PENDING' ELSE 'ASSIGNED' END`
  (`cases/repository.ts:644`; `assigned_to`/`assigned_at` likewise NULL when no assignee, `642-643`).
- A PENDING task is later assigned from the Pipeline (`POST /tasks/bulk-assign`,
  `tasks/service.ts:235 bulkAssign`) or case-detail single assign (`assignTask`).

**What ADR-0056 "FIELD location required at create" actually requires:** see §1 — a *location on the
task* **only if** that FIELD task is assigned at create (so the server can derive the executive's
commission band). A PENDING FIELD task needs neither location nor assignee. There is no DB/server
invariant forcing a location onto an unassigned FIELD task.

---

## 5. The commission gate — `NO_FIELD_COMMISSION` (the pivotal create-time pricing block)

Fires **only** for a FIELD task **being assigned** (assign-at-create OR later assign). NEVER for a
PENDING task; NEVER for OFFICE (auto-stamped `field_rate_type='OFFICE'`).

- assign-at-create: `cases/repository.ts:614-628` — if `assignee && visitType==='FIELD' &&
  !explicitFieldRateType`, derive via `deriveFieldRateTypeForNewTask` (`:204`); none ⇒
  `400 NO_FIELD_COMMISSION { assigneeId, areaId, pincodeId }`.
- single assign / reassign: `cases/repository.ts:855-858, 1184-1187` (`deriveFieldRateTypeForTask :166`).
- bulk-assign: per-row status `NO_FIELD_COMMISSION` (`tasks/service.ts:277`); batch continues.

The derive query (`cases/repository.ts:166-199`) reads the assignee's active `commission_rates` at the
task location set `location_id IN (task.area_id, task.pincode_id, case.area_id, case.pincode_id)`,
most-specific wins, `field_rate_type <> 'OFFICE'`, LIMIT 1. So **the executive's commission row must
pre-exist at the task's location** for a FIELD assign to succeed (ADR-0056 §2 — owner chose hard block
over assign-at-₹0).

---

## Import-lens column map

| COLUMN | RESOLVE (CSV → entity) | REQUIRED? | PRE-EXIST (+error if missing) | BLOCKS vs DEFERS | CARDINALITY |
|--------|------------------------|-----------|-------------------------------|------------------|-------------|
| **Pincode** + **Area** (task location) | `findByPincodeArea(pincode, area)` → `locations.id` (USABLE, case-insensitive area) → write to BOTH `pincode_id` & `area_id` (web convention) | CONDITIONAL — required **iff** assigning a FIELD task at import; else optional/NULL | `locations` row must exist & be USABLE → row error `no usable location for pincode <p> area <a>`. One-of-two → `provide both or neither` | **BLOCKS** the row if assigning FIELD & no location (schema refine `cases.ts:450`). DEFERS if PENDING (no location needed) | one row ← exactly one (pincode,area) pair; pincode alone is ambiguous (spans areas) |
| **Visit Type** (FIELD/OFFICE) | enum `VISIT_TYPES` | CONDITIONAL — required iff `assigneeId` present (`cases.ts:446`); also implied by FIELD location/address rules | n/a (enum) | **BLOCKS** if assigneeId set without visitType | 1 per task |
| **Executive / Assignee** (username or id) | username → `users.id` (precedent `scopeAssignments/repository.ts:43 userIdByUsername`, USABLE only); or accept uuid | OPTIONAL — omit ⇒ task imported PENDING | (a) user exists & USABLE; (b) holds **pool role** for visitType (`assignment_pool_roles`); (c) inside operator hierarchy (`getScopedUserIds`); (d) FIELD: holds AREA/PINCODE scope = task location; (e) FIELD: has a `commission_rates` row at the location | **BLOCKS** the row at import: `INVALID_ASSIGNEE` (a–d) or `NO_FIELD_COMMISSION` (e). **DEFERS** entirely if left PENDING | 1 assignee per task |
| **Field Rate Type** (LOCAL/OGL) | enum | OPTIONAL — server **derives** from the executive's commission (ADR-0056); web never sends it | only if explicitly supplied (back-compat) | DEFERS — derived | 1 per FIELD task |
| **Client / Product** (case-level, drive territory portfolio scope but not assignment directly) | code → id (see C2/C3) | required at case level | catalog rows | — | 1 per case |

---

## Assignment dependency graph (for assign-at-import)

```
import row (task, assigneeId set, visitType=FIELD)
        │
        ▼
 [Pincode]+[Area] ──findByPincodeArea──▶ locations.id ──▶ task.pincode_id = task.area_id
        │ (USABLE, both-or-neither)                              │
        │ missing ⇒ ROW ERROR (no usable location)               │
        ▼                                                        ▼
 [Executive] ──username→users.id (USABLE)                  used by ▼ (territory + commission)
        │
        ├─ (a) user.is_active && effective_from<=now()           ── else INVALID_ASSIGNEE
        ├─ (b) user.role == assignment_pool_roles[visitType]     ── else INVALID_ASSIGNEE
        ├─ (c) user.id ∈ getScopedUserIds(operator)              ── else INVALID_ASSIGNEE (hierarchy)
        ├─ (d) FIELD: ∃ user_scope_assignments(AREA|PINCODE,     ── else INVALID_ASSIGNEE (out of territory)
        │            entity_id = task.area_id|pincode_id)
        └─ (e) FIELD: ∃ commission_rates(user, location, band)   ── else NO_FIELD_COMMISSION (hard block)
        │
        ▼
   task born ASSIGNED  (else, omit assignee ⇒ task born PENDING, none of a–e apply)
```

For a **PENDING** import the entire right-hand chain (executive + a–e) is skipped; only the optional
location resolve (Pincode+Area, if provided) remains, and even that is not required.

---

## What PENDING-task import needs vs assign-at-import

| | PENDING import (recommended) | Assign-at-import |
|---|---|---|
| Executive column | not used | required per assigned row |
| Visit type | optional (set later at dispatch) | required (pool selection) |
| Location (Pincode+Area) | optional (NULL ok) | **required for FIELD** (territory + commission) |
| Pool-role match | n/a | enforced (`INVALID_ASSIGNEE`) |
| Operator hierarchy | n/a | enforced (`INVALID_ASSIGNEE`) |
| Territory scope cover | n/a | enforced for FIELD (`INVALID_ASSIGNEE`) |
| Commission at location | n/a | enforced for FIELD (`NO_FIELD_COMMISSION`, hard) |
| Failure granularity | per-row location resolve only | whole-request fail in `addTasks` (`INVALID_ASSIGNEE`/`NO_FIELD_COMMISSION` are thrown, abort the batch) |

**Key risk for assign-at-import via `addTasks`:** unlike `bulkAssign` (which degrades to per-row
statuses), `cases.service.addTasks` **throws** `INVALID_ASSIGNEE` / the repo throws
`NO_FIELD_COMMISSION` → the WHOLE `POST /cases/:id/tasks` request fails atomically
(`cases/service.ts:222`, `cases/repository.ts:624`,`687-693` wraps in a single tx). One bad assignee
row kills the case's entire task batch. A robust importer should either (a) import PENDING, or (b) add
each task in its own request / pre-validate eligibility, or (c) route assignment through the
per-row-tolerant `bulkAssign` after creation.

---

## Recommendation for ADR-0059

1. **Import tasks PENDING.** Zero assignment dependencies; the `NO_FIELD_COMMISSION` and
   `INVALID_ASSIGNEE` gates never fire; location optional. Dispatch/assign is a separate, already-built,
   per-row-tolerant bulk step (Pipeline `bulkAssign`). This matches the non-atomic create model and the
   existing `addTasks` PENDING default.
2. If an **Executive column** is desired, treat it as best-effort: import the task PENDING, then run the
   existing `bulkAssign` (per-row statuses `OK / INELIGIBLE_ASSIGNEE / NO_FIELD_COMMISSION / CONFLICT`)
   so one bad row never aborts the file. Do **not** funnel assignment through `addTasks`'s throwing path.
3. Reuse `locationRepository.findByPincodeArea` + the rates-import two-column (Pincode/Area) resolve
   contract verbatim for the location column.

---

## Open questions

- **pincode_id vs area_id semantics for import.** The web collapses them to one id; the rates importer
  resolves a single (pincode,area) row. Should the case importer keep the collapse (both = same id) or
  let the schema's coarse-pincode / fine-area distinction be expressed by two separate `locations`
  lookups? Collapse is simplest and matches every live caller. (anchor: `AddTasksForm.tsx:139-140`,
  `cases/repository.ts:184` rate-derive ranks the four ids separately.)
- **Executive key in CSV.** Username vs employee-code vs uuid. `userIdByUsername` (USABLE-only) is the
  existing precedent (`scopeAssignments/repository.ts:43`). Need a deactivated/missing-user row error.
- **Assign-at-import policy.** Confirm owner wants assignment in v1 at all, or PENDING-only. If assign
  is in scope, confirm it routes through `bulkAssign` (per-row tolerant) not `addTasks` (atomic throw).
- **Leftover `bulkAssign` re-points a live ASSIGNED task in place** (master-memory ADR-0055 follow-up;
  `tasks/service.ts:266` accepts `status === 'ASSIGNED'`). If the importer reuses `bulkAssign`, an
  already-assigned task could be silently re-pointed — confirm this is acceptable or guard it.
- **OFFICE assignment at import.** OFFICE needs only pool-role + hierarchy (no location, no commission,
  no territory). Lower-friction than FIELD if the importer assigns at all.

## File:line anchors
- `locations/repository.ts:7` (cols), `:95 findByPincodeArea`
- `scopeAssignments/repository.ts:43 userIdByUsername`, `:51 locationIdsByPincode`, `:59 locationIdByPincodeArea`
- `db/v2/migrations/0039_visit_type_pool.sql:29-30` (task pincode_id/area_id), `:35-44` (assignment_pool_roles seed)
- `platform/scope/dimensions.ts:9-16` (dimensions), `platform/scope/repository.ts:36 getScopedUserIds`, `:94 resolveScope`
- `cases/repository.ts:395 create`, `:575 addTasks` (`:644` PENDING/ASSIGNED CASE), `:780 eligibleAssigneesForNew`, `:842 assignTask`, `:166/:204 derive…`, `:614-628 NO_FIELD_COMMISSION`
- `cases/service.ts:203 addTasks` (`:217-224` INVALID_ASSIGNEE re-check), `:291 assignTask`
- `tasks/repository.ts:264 eligibleAssignees`, `:299 eligibleTaskIdsForAssignee`, `:240 tasksForAssignment`
- `tasks/service.ts:235 bulkAssign` (per-row statuses incl. `:268 INELIGIBLE_ASSIGNEE`, `:277 NO_FIELD_COMMISSION`)
- `packages/sdk/src/cases.ts:77 VISIT_TYPES`, `:364 CreateCaseSchema` (`:377-378` optional location), `:410 AddTasksSchema` (`:442/:446/:450` conditional refines)
- `apps/web/src/features/cases/AddTasksForm.tsx:139-140` (pincodeId=areaId=locationId), `:290-313` (location picker + eligible pool)
- `apps/api/src/modules/rates/import.ts:89-105` (Pincode+Area resolve precedent)
- `docs/adr/ADR-0024-field-office-assignment-pool.md`, `docs/adr/ADR-0056-field-rate-type-auto-derived-from-executive.md`
