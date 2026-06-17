# Epic F — Data Scope Implementation Plan

> **For agentic workers:** execute task-by-task. Each task = one slice in the established CRM2 v2 workflow: scope → build → `pnpm verify` (green, run ALONE) → Audit Panel subagent → browser-verify live → commit (author Mayur, conventional, no AI trailer) → ASK before push → update memory. Steps use `- [ ]` tracking.

**Goal:** Give every operational list a centrally-enforced data scope — hierarchy (already-partial), field territory (pincode/area), and backend portfolio (client/product) — so a user sees only the rows they're entitled to, closing the current "everyone sees all cases" gap.

**Architecture:** One scope seam in `platform/scope/` returns parameterized SQL fragments + an allowed-id resolution from the role-aware `reports_to` tree plus new assignment tables; repositories compose those fragments into list WHEREs. Additive — no RBAC-freeze reopen.

**Tech Stack:** Node 22 · TS strict · raw `pg` (repo layer) · Zod contracts (`@crm2/sdk`) · React 19 + TanStack Query (web) · Vitest · PG18 test DB :5433 / dev DB :54329.

**Reference patterns (copy shape, do not re-invent):** `modules/users` (CRUD+assignment-ish), `modules/cpv` (link tables + joined views + FK→400 mapping), `cases/repository.ts:assignableUsers` (the recursive `reports_to` CTE to extract), `modules/locations` (the pincode/area catalog + options).

**Carried invariants:** triple-write migrations (file + dev :54329 + test :5433); constraint-adds need pg_constraint-name guards; uuid path params validated before a uuid-col WHERE (the `e2dbf58` lesson); no magic numbers in `modules/**/service|controller|repository`; joined display columns stay OUT of sort/filter maps unless in the COUNT FROM; SUPER_ADMIN bypasses scope; empty allowed-set ⇒ `ANY('{}')` = no rows (never "all").

## ⚠️ Owner corrections (2026-06-10) — DO NOT SKIP

1. **Assigning scope = SUPER_ADMIN ONLY.** Permission is **`access_scope.assign`** (renamed from `territory.assign` — it governs territory AND portfolio; group = Administration). MANAGER/TEAM_LEADER do NOT assign; they only **VIEW** their subtree's data (slice 1). Hierarchy: field user → TEAM_LEADER → MANAGER; TEAM_LEADER → MANAGER. **Admin (SUPER_ADMIN) sees ALL data irrespective of scope.** No subtree-target guard needed on the assign routes (SA is global).
2. **Each page must be COMPLETE per the frozen standards — no half-features:**
   - **Import/Export** (IMPORT_EXPORT_STANDARD): the Access assignment is a **Bulk-Assignment** surface → it needs **bulk import** (assign territory/portfolio to many users from a spreadsheet via the `@crm2/import-engine` flow: template→fill→upload→validate→preview→confirm→background→result + import audit) and **export** (a user's scope, and an all-assignments export) via the DataGrid export menu. Forbidden-import lists (audit/billing) do NOT include assignments, so import IS allowed.
   - **Mobile-first** (MOBILE_API_COMPATIBILITY): scope MUST enforce on the `/api/v2` endpoints the mobile app consumes — a FIELD_AGENT's territory governs what they sync/see on the device (case/sync/task reads), not just the web list. When wiring scope into a list, check the mobile contract isn't bypassing it.
   - **New v2 design**: the FE Access tab uses the Universal **DataGrid** + design tokens + Hexagon loader + skeletons + server-pagination (PAGINATION/DATAGRID standards); no bespoke tables. Mobile-responsive.
3. **Don't regress earlier-closed compliance gaps** (COMPLIANCE_GAPS_REGISTRY) — every new list/detail is scoped + paginated + DataGrid + import/export-capable from day one.

These are tracked in COMPLIANCE_GAPS_REGISTRY; slices 5–7 below carry the import/export + DataGrid + mobile-enforcement work explicitly.

---

## File structure (locked before tasks)

**Backend (`apps/api/src/`):**
- Create `platform/scope/index.ts` — `getScopedUserIds`, `resolveScope`, `appendScopeConditions`, types. The ONE scope seam.
- Create `platform/scope/__tests__/scope.test.ts` — unit tests of the resolver with an injectable pool.
- Modify `modules/cases/repository.ts` + `service.ts` + `controller.ts` — pass `actor`, compose scope into `list` (cases) and the task-list reads; reuse the extracted CTE.
- Create `modules/territoryAssignments/{repository,service,controller,routes}.ts` + `__tests__` — pincode/area + client/product assignment for a user.
- Modify `modules/users/routes.ts` — mount the assignment routes under `/users/:id/...` (delegate, like the slice-6 admin session routes) OR a dedicated `/assignments` prefix (decide in Task 2).
- Migrations `db/v2/migrations/0030..0033`.

**Packages:**
- `packages/access/src/permissions.ts` — add `TERRITORY_ASSIGN='territory.assign'`, `PORTFOLIO_ASSIGN='portfolio.assign'` (SUPER_ADMIN auto via `Object.values`; grant to MANAGER explicitly).
- `packages/sdk/src/{userAssignments.ts (new), client.ts, client.test.ts}` — contracts + methods.

**Web (`apps/web/src/`):**
- Create `components/UserAccessSection.tsx` — territory + portfolio assignment, mounted in the user dialog (components/, not features/ — dep-cruiser).

---

## Task 1 — Scope module + hierarchy filter on cases/tasks (closes the security gap)

**Files:**
- Create: `apps/api/src/platform/scope/index.ts`
- Create: `apps/api/src/platform/scope/__tests__/scope.test.ts`
- Modify: `apps/api/src/modules/cases/repository.ts` (extract the `assignableUsers` CTE → reuse), `service.ts` (thread `actor` into `list`), `controller.ts` (pass `actor(req)`)
- Modify: `apps/api/src/modules/cases/__tests__/cases.api.test.ts`

**Interface (Task 1 establishes these signatures; later tasks extend `resolveScope`):**
```ts
export interface Actor { role: Role; userId: string }
export interface Scope {
  /** undefined = no user-id filter (SUPER_ADMIN / global). */
  userIds?: string[];
}
/** The operational user-ids whose rows `actor` may see (role-aware reports_to subtree). */
export function getScopedUserIds(actor: Actor): Promise<string[] | undefined>;
/** Task 1: only the user-id layer. Territory/portfolio layers added in Tasks 3-4. */
export function resolveScope(actor: Actor): Promise<Scope>;
/** Compose scope into a list query: returns the extra WHERE clause + pushes params.
 *  `userExpr` is the column to match (e.g. 'ct.assigned_to'). Empty allowed-set ⇒ '1=0'. */
export function appendScopeConditions(
  params: unknown[],
  scope: Scope,
  exprs: { userExpr: string },
): string; // '' when no filter (SUPER_ADMIN), else 'AND (...)'
```

- [ ] **Step 1 — Write failing unit tests** (`scope.test.ts`): with a seeded tree (MGR→TL→{FA,KYC,BE}), assert `getScopedUserIds`: SUPER_ADMIN→`undefined`; MANAGER→self+whole subtree; TEAM_LEADER→self+direct reports; FIELD_AGENT/KYC/BACKEND→`[self]`. Assert `appendScopeConditions`: SUPER_ADMIN→`''`; a 2-id scope→`AND (ct.assigned_to = ANY($1))` with params `[[id,id]]`; empty set→`AND (1=0)`. Use `setPool(testDb)`.
- [ ] **Step 2 — Run, verify FAIL** (`pnpm --filter @crm2/api test -- scope`).
- [ ] **Step 3 — Implement `platform/scope/index.ts`**: move the recursive `reports_to` CTE out of `assignableUsers` into `getScopedUserIds` (depth-cap 16, cycle-guard); `resolveScope` returns `{ userIds }`; `appendScopeConditions` builds the fragment. No magic numbers (name the depth cap).
- [ ] **Step 4 — Refactor `assignableUsers`** to call `getScopedUserIds` (no behavior change; its existing tests must stay green).
- [ ] **Step 5 — Wire `cases.list`**: thread `actor` (controller `actor(req)` → service → repo); compose `appendScopeConditions(params, await resolveScope(actor), { userExpr: '<the case/task assignee expr> ' })` into the list WHERE. Cases are scoped by whether the actor may see the case's tasks' `assigned_to` (or the case creator) — choose the case-visibility rule: **a case is visible if any of its tasks is assigned to an in-scope user, OR the actor is SUPER_ADMIN/created it**. Implement as an `EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND <scope>)` subquery to avoid row multiplication.
- [ ] **Step 6 — Integration tests** (`cases.api.test.ts`): create MGR/TL/FA, a case with a task assigned to FA; assert FA sees it, the TL (FA's leader) sees it, an unrelated TL does NOT, SUPER_ADMIN sees all. Assert the list COUNT matches items (scope in both).
- [ ] **Step 7 — `pnpm verify` ALONE** (fresh :5433): green.
- [ ] **Step 8 — Audit Panel** (CEO/Security/API/DB subagent) → PASS.
- [ ] **Step 9 — Browser-verify**: log in as a scoped user, open Cases, confirm the list is filtered; SUPER_ADMIN sees all.
- [ ] **Step 10 — Commit** `feat(cases): central data-scope module + hierarchy visibility on case/task lists (epic F slice 1)`; ASK push; update memory.

---

## Task 2 — Territory assignment tables + API

**Files:**
- Create migration `db/v2/migrations/0030_user_territory_assignments.sql`
- Create `apps/api/src/modules/territoryAssignments/{repository,service,controller,routes}.ts` + `__tests__/territoryAssignments.api.test.ts`
- Modify `packages/access/src/permissions.ts` (+`TERRITORY_ASSIGN`), `packages/sdk/src/userAssignments.ts` (new) + `client.ts` + `client.test.ts`
- Modify `apps/api/src/http/app.ts` (mount), `modules/users/routes.ts` (or a `/user-assignments` prefix)

**Migration 0030 (triple-write):**
```sql
-- 0030_user_territory_assignments.sql — field-territory scope (epic F). Forward-only, idempotent.
CREATE TABLE IF NOT EXISTS user_pincode_assignments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pincode_id  integer NOT NULL REFERENCES locations(id),
  is_active   boolean NOT NULL DEFAULT true,
  assigned_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_area_assignments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id     integer NOT NULL REFERENCES locations(id),  -- a locations row = (pincode, area)
  is_active   boolean NOT NULL DEFAULT true,
  assigned_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_user_pincode') THEN
    ALTER TABLE user_pincode_assignments ADD CONSTRAINT uq_user_pincode UNIQUE (user_id, pincode_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_user_area') THEN
    ALTER TABLE user_area_assignments ADD CONSTRAINT uq_user_area UNIQUE (user_id, area_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_upa_user ON user_pincode_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_uaa_user ON user_area_assignments(user_id);
```

**Endpoints** (gated `TERRITORY_ASSIGN` = SUPER_ADMIN + MANAGER):
- `GET /users/:id/territory` → `{ pincodes: Location[], areas: Location[] }` (joined names from `locations`).
- `POST /users/:id/territory/pincodes` `{ pincodeIds: number[] }` (replace-set or add; choose add+remove endpoints, mirror v1).
- `DELETE /users/:id/territory/pincodes/:pincodeId`; same for `areas`.

- [ ] Step 1 — failing API tests: assign 2 pincodes → GET returns both with city/state; duplicate → 409 or idempotent; FK to a missing pincode → 400 INVALID_REFERENCE; non-uuid :id → 400 (the uuid-guard lesson); a non-MANAGER/SA → 403.
- [ ] Step 2 — run, FAIL.
- [ ] Step 3 — migration 0030 (triple-write: file + psql :54329 + the harness migrates :5433); add the permission; repo (`mapWriteError`: 23503→400, 23505→409), service, controller (parseId uuid-guard), routes; SDK contract + client methods + `client.test` count bump.
- [ ] Step 4 — run tests, PASS.
- [ ] Step 5 — `pnpm verify` ALONE → green.
- [ ] Step 6 — Audit Panel → PASS.
- [ ] Step 7 — browser-verify (assign a pincode to a FIELD_AGENT via API; UI lands in Task 5).
- [ ] Step 8 — commit `feat(users): field-territory assignment tables + API (epic F slice 2)`; ASK push; memory.

---

## Task 3 — Case location + territory scoping

**Files:** migration `0031_cases_location.sql`; modify `modules/cases/{repository,service}.ts` (set `pincode_id` on create from the applicant address; add territory predicate), `platform/scope/index.ts` (extend `Scope` + `resolveScope` + `appendScopeConditions`), `modules/cases/__tests__`.

**Migration 0031:** `ALTER TABLE cases ADD COLUMN IF NOT EXISTS pincode_id integer REFERENCES locations(id); ADD COLUMN IF NOT EXISTS area_id integer REFERENCES locations(id);` + index on `pincode_id`.

**Scope extension:**
```ts
export interface Scope {
  userIds?: string[];
  pincodeIds?: number[]; // FIELD_AGENT/KYC territory; undefined = not territory-limited
  areaIds?: number[];
}
// appendScopeConditions gains exprs.pincodeExpr/areaExpr; a territory user sees a case when
// its assignee is in-scope OR the case's pincode/area is in their territory.
```

- [ ] Step 1 — failing tests: a FIELD_AGENT with pincode P sees a case located in P even if unassigned; does NOT see a case in pincode Q; a MANAGER is unaffected by territory (hierarchy only); SUPER_ADMIN sees all.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — migration 0031; case create resolves `pincode_id` from the applicant address (pincode → `locations` lookup); extend scope; compose the territory predicate (`OR cs.pincode_id = ANY($p) OR cs.area_id = ANY($a)`).
- [ ] Step 4 — PASS.
- [ ] Steps 5-8 — verify ALONE / Audit / browser-verify / commit `feat(cases): case location + field-territory scoping (epic F slice 3)`; ASK push; memory.

---

## Task 4 — Portfolio (client/product) assignment + scoping

**Files:** migration `0032_user_portfolio_assignments.sql` (`user_client_assignments`, `user_product_assignments` — same shape as 0030, FK clients/products, uq guards, indexes); extend `territoryAssignments` module (or a sibling `portfolioAssignments`) with assign/list/remove (gated `PORTFOLIO_ASSIGN`); extend `platform/scope` (`clientIds`/`productIds` for BACKEND_USER); wire into `cases.list`.

- [ ] Step 1 — failing tests: a BACKEND_USER assigned client C sees only cases for C; unassigned client → hidden; assigning client/product to a FIELD_AGENT is rejected (operations-eligibility guard, mirror v1 `isOperationsEligibleUser`); 403 for non-MANAGER/SA.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — migration 0032; assignment API; scope extension (`clientExpr`/`productExpr` on `cs.client_id`/`cs.product_id`); SDK + client.test bump.
- [ ] Step 4 — PASS.
- [ ] Steps 5-8 — verify / Audit / browser-verify / commit `feat(users): backend portfolio assignment + scoping (epic F slice 4)`; ASK push; memory.

---

## Task 5 — FE Access tab in the user dialog (CREATE + EDIT)

**Owner decision (2026-06-10):** an **"Access" tab inside the Edit-User dialog** (Option A), available in **both Create and Edit** flows. The dialog gains a tab strip `[ Profile | Access ]` so the (already long) Profile fields don't bloat; MFA + Active Sessions stay on Profile (edit-only). Role-aware: **Territory** (pincode/area) shows for FIELD_AGENT/KYC_VERIFIER, **Portfolio** (client/product) for BACKEND_USER.

**Create vs Edit (same pattern as the slice-7 profile photo):**
- **Edit** (`userId` set): live — multiselects query `/users/:id/territory` + `/portfolio` and add/remove immediately.
- **Create** (no id yet): **stage** the selected pincode/area/client/product ids in dialog state; after the create POST succeeds, apply them to the new user id (best-effort — a created user is never lost if an assignment call fails; remaining can be added in edit). Mirrors `UserPhoto`'s `onPick` staging + post-create upload.

**Files:** Create `apps/web/src/components/UserAccessSection.tsx` (props `{ userId?: string; staged?: {...}; onStageChange?: (...) => void }` — live when `userId`, staged otherwise); modify `features/users/UsersPage.tsx` (add the `[Profile|Access]` tab strip; in create-mode hold staged scope state and apply it in the mutation `onSuccess(saved)` after the photo upload, best-effort). Lives in `components/` (dep-cruiser).

- [ ] Step 1 — build `UserAccessSection` with both modes (live query+mutate when `userId`; controlled staged value + `onStageChange` otherwise). Reuse `/locations` (search), `/clients/options`, `/products/options` feeds.
- [ ] Step 2 — add the tab strip to the dialog; mount Access tab; role-gate territory vs portfolio; keep MFA/Sessions on Profile (edit-only).
- [ ] Step 3 — create-mode: thread staged scope into the create mutation `onSuccess(saved)` → POST territory/portfolio to `saved.id` (best-effort, after the photo upload).
- [ ] Step 4 — `pnpm verify` ALONE → green.
- [ ] Step 5 — Audit Panel (design-quality + API-contract) → PASS.
- [ ] Step 6 — browser-verify: (edit) assign a pincode + client to an existing user; (create) stage a pincode in the New-User dialog → after save, confirm it persisted on the new user + the scoped list reflects it.
- [ ] Step 7 — commit `feat(web): Access tab — territory + portfolio in create + edit user dialog (epic F slice 5)`; ASK push; memory.

---

## Task 6 — assignableUsers territory filter (close the deferred TODO)

**Files:** modify `modules/cases/repository.ts:assignableUsers` (+ the case it assigns within) + tests.

- [ ] Step 1 — failing test: for a task on a case located in pincode P, `assignableUsers` returns only FIELD_AGENT/KYC whose territory covers P (intersect with the existing hierarchy eligibility); a SUPER_ADMIN actor still sees all eligible; an agent with no territory is excluded for a located case.
- [ ] Step 2 — FAIL.
- [ ] Step 3 — add the territory intersection (the `cases/repository.ts:262` deferred comment); reuse `resolveScope`/territory lookup.
- [ ] Step 4 — PASS.
- [ ] Steps 5-8 — verify / Audit / browser-verify (assign-flow shows only territory-matching agents) / commit `feat(cases): territory-aware assignableUsers (epic F slice 6)`; ASK push; memory.

---

## Self-review vs spec

- Spec "central scope module + hierarchy on lists" → Task 1. "Territory tables + API" → Task 2. "Case location + territory scoping" → Task 3. "Portfolio + scoping" → Task 4. "FE assignment UI" → Task 5. "assignableUsers territory filter" → Task 6. All six spec slices covered.
- Invariants (SUPER_ADMIN bypass, `1=0` empty-set, uuid-guard, no magic numbers, triple-write, pg_constraint guards) called out per task.
- Open spec detail (case-location source = applicant address) resolved in Task 3 Step 3.
- Out of scope (Epic E, clusters G/H) excluded.

## Task 7 — Access bulk import + export (standards completeness)

Per IMPORT_EXPORT_STANDARD (owner directive: don't ship a half-feature). The Access assignment is a Bulk-Assignment surface.
- **Import** via the in-app import-engine flow (template → fill → upload → validate → preview-errors → confirm → background-if-large → result + permanent import-audit row). Template columns: `username` (resolve→user id), `pincode`/`area` (resolve→locations id) and/or `client_code`/`product_code` (resolve→portfolio). Validator reuses the zod contracts; processor calls the same repo upserts. Gated `access_scope.assign` (SUPER_ADMIN).
- **Export** via the DataGrid export menu: a user's scope, and an all-assignments export (`<10k` immediate, `≥10k` background job).
- [ ] template + validator + mapper + processor (import-engine plug-in, never a bespoke flow) · export columns · SDK · tests (valid/invalid rows, FK resolve, audit row) · verify ALONE · Audit · browser-verify (import a small sheet, see preview+result) · commit · ASK push.

## Task 8 — Mobile scope enforcement (MOBILE_API_COMPATIBILITY)

The FIELD_AGENT's territory must govern what the device syncs/sees, not only the web list.
- [ ] Identify the `/api/v2` endpoints the mobile app consumes for case/task/sync reads; confirm each routes through `resolveScope` (or add it) so a device cannot fetch out-of-scope cases. Add a contract test asserting a field agent's mobile reads are territory-scoped. Never break a field-required mobile field/shape (additive only). verify ALONE · Audit · device/contract-verify · commit · ASK push.

## Epic E note

Epic E (Editable RBAC) is a SEPARATE plan, written after Epic F ships, starting with the ADR to reopen the RBAC freeze. The `access_scope.assign` permission and the read-only Access Control matrix already exist; Epic E makes the role→permission mapping DB-editable. Not in this plan.
