# TAT System — Design Spec (build slice before commission)

> **Governing ADR:** [ADR-0044](../adr/ADR-0044-task-tat-priority.md) (Accepted 2026-06-18). Companion:
> [commission cross-audit](../engineering/COMMISSION_RATE_CROSS_AUDIT_2026-06-18.md), consumed by
> [ADR-0046](../adr/ADR-0046-commission-location-and-tat-dimensions.md). **This is the FIRST build
> slice; commission (ADR-0046) follows.** Design-level spec — the bite-sized TDD implementation plan
> (`docs/plans/`) is written from this before any code.

**Goal:** give every task a configurable **target TAT** (SLA, with due-date + overdue) and measure the
**band the executive actually completed it in** (elapsed assign→complete), surfaced in a completion
report and (later) consumed by commission — without breaking the installed mobile app.

**Standards in force:** EFFECTIVE_FROM_STANDARD (master data is `is_active AND effective_from<=now()`),
CONCURRENCY_AND_EDITING_STANDARD (OCC `version`), API_VERSIONING (additive `/api/v2`, never break
mobile, ADR-0011), DATAGRID/MANAGEMENT_LIST standards for any new list, no `any`/suppressions/
`console.*`, raw SQL only in repositories/migrations, FE↔API via `@crm2/sdk` only.

---

## 1. Two concepts (from ADR-0044)

- **A. Target TAT** — assigned up front. `tat_hours ∈ {4,6,8,12,24,48}` (config), `due_at = assigned_at
  + tat_hours`, `overdue = now() > due_at`. Replaces the abstract priority as the operational SLA;
  `priority` is kept (derived) for mobile back-compat.
- **B. Completed-in band** — measured at completion. `elapsed = completed_at − assigned_at`
  (server-receipt clock, wall-clock), classified into the **smallest band ≥ elapsed**; `> max` →
  overflow (`>48h`). This is what the completion report shows and what commission (ADR-0046) keys on.

## 2. Data model

### 2.1 `tat_policies` (new master table)
```sql
-- migration <next, e.g. 0076>_tat_policies.sql
CREATE TABLE tat_policies (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tat_hours       integer NOT NULL CHECK (tat_hours > 0),
  label           varchar(40) NOT NULL,              -- e.g. '4 hours'
  is_active       boolean NOT NULL DEFAULT true,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_tat_policies_hours_active ON tat_policies (tat_hours) WHERE is_active;
-- seed: 4,6,8,12,24,48
```
USABLE = `is_active AND effective_from<=now()` (EFFECTIVE_FROM_STANDARD). Admin-managed; `masterdata.manage`.

### 2.2 `case_tasks` additive columns
```sql
-- migration <next+1>_case_tasks_tat.sql
ALTER TABLE case_tasks
  ADD COLUMN tat_hours integer,                       -- target TAT (nullable until backfilled)
  ADD COLUMN completed_elapsed_minutes integer;       -- set at completion; immutable elapsed fact
-- no stored due_at: derived as assigned_at + make_interval(hours => tat_hours) in read-models
-- no stored completed_tat_band: derived from completed_elapsed_minutes + tat_policies at read time;
--   commission (ADR-0046) snapshots the resolved band+amount at finalize.
```
`priority` column **retained**, kept populated (derived) for mobile back-compat; not dropped this slice.

### 2.3 Backfill
- Existing tasks: `tat_hours = CASE priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 8 WHEN 'MEDIUM' THEN 24 WHEN 'LOW' THEN 48 ELSE 24 END`.
- `completed_elapsed_minutes` backfilled for already-COMPLETED tasks where both `assigned_at` and `completed_at` exist: `EXTRACT(EPOCH FROM (completed_at - assigned_at))/60`.

## 3. Computation logic (repository-level SQL)

**due_at / overdue** (read-model column, no stored col):
```sql
(ct.assigned_at + make_interval(hours => ct.tat_hours))            AS due_at,
(ct.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
   AND now() > ct.assigned_at + make_interval(hours => ct.tat_hours)) AS overdue
```

**Completed-in band classifier** (from `completed_elapsed_minutes`):
```sql
COALESCE(
  (SELECT tp.tat_hours FROM tat_policies tp
     WHERE tp.is_active AND tp.effective_from<=now()
       AND tp.tat_hours >= ceil(ct.completed_elapsed_minutes/60.0)
     ORDER BY tp.tat_hours ASC LIMIT 1),
  -1)  AS completed_tat_band_hours      -- -1 sentinel = overflow (>max band)
```
Boundary semantics: exactly 4h00m → 4h band; 4h01m → 6h band; > 48h → overflow (`-1`, labelled `>48h`).
SDK maps `-1` → `null`/`'>48h'`. Set `completed_elapsed_minutes` once, in the completion transaction
(`apps/api/src/modules/cases/repository.ts` completion path, alongside `completed_at = now()`).

## 4. API + SDK (all additive)

| Endpoint / type | Change | Gate |
|---|---|---|
| `GET/POST/PATCH /api/v2/tat-policies` (+ activate/deactivate) | New module `apps/api/src/modules/tatPolicies/` (routes/controller/service/repository), OCC-guarded, effective-dated, audited | `masterdata.manage` |
| `packages/sdk/src/tatPolicies.ts` | New SDK module: `TatPolicy`, `Create/ReviseTatPolicySchema` | — |
| Case/task create + assign | Accept `tatHours` (validated ∈ usable `tat_policies`); persist on `case_tasks` | existing case write perms |
| `packages/sdk/src/cases.ts` task views | Add `tatHours`, `dueAt`, `overdue`; for completed tasks `completedElapsedMinutes`, `completedTatBand` (additive) | — |
| `packages/sdk/src/tasks.ts` Pipeline `TaskView` | Add `completedAt` (currently absent), `tatHours`, `dueAt`, `overdue`, `completedTatBand` (additive) | — |
| Mobile sync DTO (`apps/api/src/modules/sync/`) | Send `tatHours`+`dueAt` **alongside** the existing `priority` label (derived) — never break the installed app | — |
| Completion report `GET /api/v2/...` (see §5) | New read-model: assign time, complete time, elapsed, completed-in band | `case.view` (scope-applied) |

**Back-compat priority derivation** (one helper, used wherever `priority` is emitted):
`4–6h→URGENT, 8–12h→HIGH, 24h→MEDIUM, 48h→LOW` (matches ADR-0044 Alt 3).

## 5. Web surfaces

1. **Creation/assignment** (`CaseCreatePage`, `AddTasksForm`): TAT bucket selector sourced from usable
   `tat_policies` (replaces the priority dropdown; priority becomes derived). Default = configurable
   (e.g. 24h).
2. **Per-task TAT indicator (owner req):** wherever a task row shows the existing **"Out of TAT"**
   badge (Pipeline rows, case-detail task rows), **keep it** and append the hours: show **hours
   overdue first** (e.g. `Out of TAT · +3h`), **then the target TAT** (e.g. `(8h)`). On-time open
   tasks show the target TAT hours (and may show time-remaining); completed tasks show the completed-in
   band. Re-point the badge's overdue truth to the new `overdue` (`now() > assigned_at + tat_hours`),
   not the legacy hard-coded `created_at` thresholds — without regressing the existing bucket.
3. **Pipeline TAT tab (owner req):** add a new **"TAT"** bucket/tab to `PipelinePage` `BUCKETS`
   alongside the existing ones (the per-task Out-of-TAT indicator from item 2 stays). The TAT tab lists
   **open tasks ordered by urgency** — most-overdue first, then closest-to-due — with overdue rows
   clearly flagged (reconciles the owner's "overdue + ordered by urgency"). Server: a `tat=1`-style
   filter/sort on the tasks read-model (`order by overdue desc, due_at asc`); additive to the existing
   `outOfTat` bucket.
4. **Case-detail tabs (owner req):** `CaseDetailPage` has **no tabs today** — add status tabs that
   filter the **tasks within that case**: **TAT · In Progress · Complete** (plus an All/default). The
   in-case **TAT** tab uses the same urgency-ordered/overdue-flagged view as item 3, scoped to the
   case. In Progress / Complete filter the case's tasks by `status`.
5. **Completion report** (the owner's "one table — he completed in which TAT"): a new DataGrid-standard
   page/section listing per completed task: executive, case/task, **assigned-at**, **completed-at**,
   **elapsed**, **completed-in band**, filterable by executive/date/band. Route gated `case.view`,
   scope-applied; amounts NOT shown here (that's the Billing page, ADR-0046).
6. **`tat_policies` admin** (`/admin/tat-policies`): Management-List-standard CRUD, `masterdata.manage`,
   OCC conflict dialog, effective-from + ACTIVE/SCHEDULED/INACTIVE.
7. **MIS/dashboard**: SLA/overdue columns + an overdue KPI (reuse the dashboard pattern).

## 6. Mobile (never break — ADR-0011)

- Sync DTO is **additive**: `tatHours`+`dueAt` added; `priority` still emitted (derived). The unmodified
  installed app keeps displaying/sorting on `priority`. Contract test asserts `priority` still present.
- A future app release can read TAT natively (gate via `min_supported_version`); not required this slice.
- No new mobile field for the completed-in band (server-receipt clock — server already stamps
  `completed_at`).

## 7. RBAC

- `tat_policies` config: `masterdata.manage` (SUPER_ADMIN) — read + write, like other master data
  config. (Confirm: TAT bands are operational config, lower sensitivity than commission; if MANAGER/TL
  need read, expose via `page.masterdata` read like rates — decide in plan, default SA-only to start.)
- Completion report + SLA columns: existing `case.view`, scope-applied. No new permission (no ₹).

## 8. Test strategy

- **Unit (band classifier + due_at/overdue):** boundaries — 0<e≤4h→4; 4h<e≤6h→6; … ; e>48h→overflow;
  exact-boundary at each band edge; null `tat_hours`; overdue true/false around `due_at`; reassign
  changes `assigned_at`→`due_at`. Integration tests need `DATABASE_URL` on the `:5433` test DB, `LC_ALL=C`.
- **Integration (API):** `tat_policies` CRUD + OCC + effective-from gating; create task with `tatHours`
  (reject non-usable); completion sets `completed_elapsed_minutes`; completion report rows + scope;
  mobile sync DTO still carries `priority` (back-compat assertion).
- **e2e (Playwright; NO jsdom — frozen stack ADR-0042):** creation TAT picker; overdue badge; the
  completion report renders + filters; `tat_policies` admin CRUD + conflict dialog. All viewports
  (RESPONSIVE_DESIGN_STANDARD).
- **Coverage:** floors ratchet up only.

## 9. Task breakdown (expands into the bite-sized `docs/plans/` plan)

1. `tat_policies` migration + seed (4/6/8/12/24/48).
2. `tatPolicies` API module + SDK + admin page (CRUD, OCC, effective-from).
3. `case_tasks.tat_hours` + `completed_elapsed_minutes` migration + backfill + priority-derivation helper.
4. Target TAT in create/assign (API validate ∈ usable policies; SDK; web picker) + `due_at`/`overdue` read-model.
5. Per-task TAT indicator (§5.2): enhance the existing "Out of TAT" badge to show hours-overdue then target TAT; re-point overdue truth to `now() > assigned_at + tat_hours` (no regression to the existing bucket). Shared across Pipeline + case-detail task rows.
6. Pipeline **TAT tab** (§5.3): new `BUCKETS` entry + server `tat` filter/sort (`order by overdue desc, due_at asc`); additive to the `outOfTat` bucket.
7. **Case-detail tabs** (§5.4): add TAT · In Progress · Complete (+ All) tabs to `CaseDetailPage`, filtering the case's tasks; the in-case TAT tab reuses the urgency-ordered/overdue view scoped to the case.
8. Completed-in band: set `completed_elapsed_minutes` in the completion txn; band classifier in read-models; SDK fields.
9. Completion report (API read-model + SDK + web DataGrid page).
10. MIS/dashboard SLA/overdue columns + KPI.
11. Mobile sync DTO additive + back-compat contract test.

## 10. Definition of done (TAT slice)

- Migrations apply clean on a fresh DB; backfill correct; `priority` still populated.
- Target TAT pickable; `due_at`/overdue correct; completion sets immutable elapsed; band classifier
  correct on all boundaries (the §8 unit matrix).
- Completion report shows assign/complete/elapsed/band, filterable, scope-correct.
- `tat_policies` admin CRUD live-verified in the browser (perform the action + confirm persisted).
- Mobile `/api/v2` unbroken (priority still emitted; contract test green).
- Full `pnpm verify` GREEN; e2e GREEN. Then commission (ADR-0046) slice begins.

## 11. Open items deferred to ADR-0046 (commission) slice — NOT built here
- The decoupled `commission_rates` location/client/product/VU/`tat_band` dimensions + resolver rewrite.
- `bill_count` multiplier fix in the billing rollup.
- Pipeline "Commissionable" surface removal + Billing & Commission page redesign.
- Snapshotting the completed-in band + amount at finalize.
