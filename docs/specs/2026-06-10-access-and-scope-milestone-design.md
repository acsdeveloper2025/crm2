# Access & Scope Milestone — Design Spec

- **Status:** Approved (design) — 2026-06-10
- **Owner decisions (2026-06-10):** Editable RBAC = YES (sanctioned frozen-reopen, ADR required) · Full cluster F · Territory = pincode + area for FIELD_AGENT + KYC_VERIFIER · Build order F → E · Custom-role creation INCLUDED in Epic E (as a later slice).
- **Context:** Follows the completed User-Management epic (origin/main `e2dbf58`). Closes the v1↔v2 access gap: v2 has identity + hierarchy (role-aware `reports_to`) but no *data scope* (territory/portfolio) and a *frozen* code-defined RBAC.

## Problem

Two distinct gaps vs the v1 production model (audited 2026-06-10):

1. **No data-visibility scope.** `cases.list` / `case_tasks` reads are **unscoped** — any user who can open the list sees *all* cases (a real security gap). The hierarchy-subtree logic exists only in `cases/repository.ts:assignableUsers`; territory scoping is explicitly stubbed ("deferred until cases/users carry location"). v1 enforces a 3-layer scope (hierarchy + field territory + backend portfolio) centrally on every list.
2. **RBAC is not editable.** v2's role→permission mapping is a code constant (`@crm2/access` `ROLE_PERMISSIONS: Record<Role, Permission[]>`); v1 lets an admin edit it at runtime (RBAC Admin screen, `role_permissions` table). Owner wants v1 parity.

These are **orthogonal**: scope governs *which rows* you see; RBAC governs *which permissions* you hold. They are built as two independent epics, **F first** (additive, closes the security gap, no freeze reopen), then **E** (reopens the RBAC freeze behind an ADR; rewrites the auth chokepoint).

## Invariants preserved (both epics)

- **No per-user permission overrides** (v1 has none either — `role_permissions` only; no `user_permissions`).
- **SUPER_ADMIN bypasses all scope** and holds all permissions.
- The **6 system roles** remain (SUPER_ADMIN · MANAGER · TEAM_LEADER · BACKEND_USER · FIELD_AGENT · KYC_VERIFIER); system roles are name/delete-locked.
- **Default-deny**, append-only hash-chained audit, OCC, DataGrid/import/pagination standards, triple-write migrations, all engineering-freeze gates.
- The **permission catalog stays code-owned** — you cannot grant a permission that no route checks. Editability is over the *mapping*, not the catalog.

---

# Epic F — Data Scope (cluster F)

## Architecture

A central scope module mirrors v1's `userScope`/`dataScope` split, but reads from v2's existing catalogs (`locations` 157k pincodes, `clients`, `products`) and the **single role-aware `reports_to`** tree (v2's simplification of v1's two FKs — same tree, one column).

**`apps/api/src/platform/scope/` (new):**
- `getScopedUserIds(actor)` → the set of operational user-ids whose rows `actor` may see:
  - SUPER_ADMIN → `undefined` (no filter).
  - MANAGER → `self + recursive reports_to subtree` (depth-capped, cycle-guarded — extract the existing CTE from `assignableUsers`).
  - TEAM_LEADER → `self + direct reports`.
  - BACKEND_USER / FIELD_AGENT / KYC_VERIFIER → `[self]`.
- `resolveScope(actor)` → `{ userIds?, pincodeIds?, areaIds?, clientIds?, productIds? }` — aggregates territory (FIELD_AGENT/KYC) and portfolio (BACKEND_USER) from the assignment tables.
- `appendScopeConditions(sql, params, scope, exprs)` → injects `assigned_to = ANY($u)` **AND** (`pincode_id = ANY($p)` OR `area_id = ANY($a)`) **AND** `client_id/product_id = ANY()` into list WHEREs; an empty allowed-set injects `1=0` (returns nothing — never falls through to "all").

Raw SQL stays in repositories; the scope module returns parameterized fragments the repo composes (no DB calls in services/controllers).

## Data model (new migrations, triple-write)

- `user_pincode_assignments (id, user_id uuid, pincode_id int→locations, assigned_by, is_active, created_at)` — many per user.
- `user_area_assignments (id, user_id uuid, pincode_id int, area_id int, is_active, created_at)` — areas nested under a pincode; v2 `locations` rows are `(pincode, area)` pairs so `area_id` = a `locations.id`.
- `user_client_assignments (id, user_id uuid, client_id int→clients, is_active, …)` — BACKEND_USER portfolio.
- `user_product_assignments (id, user_id uuid, product_id int→products, is_active, …)`.
- **Case location:** add `pincode_id int → locations` (+ optional `area_id`) to `cases`. This is the "cases carry location" prerequisite the code flags as missing; a FIELD_AGENT/KYC is territory-scoped against it. (Open detail for the plan: derive the case location from the applicant address vs. a dedicated case field — recommend a dedicated `cases.pincode_id` set at creation, sourced from the applicant address.)
- All assignment writes recorded in the existing audit chain; assignment is gated by a new `TERRITORY_ASSIGN` / `PORTFOLIO_ASSIGN` permission (SUPER_ADMIN + MANAGER), default-deny.

## Enforcement wiring

- `cases.list` + `case_tasks` list reads gain an `actor` arg → `appendScopeConditions`. Closes the unscoped-list gap.
- `assignableUsers` gains the **territory filter** (the deferred TODO): a task's eligible agents are intersected with agents whose territory covers the case's pincode/area.
- SUPER_ADMIN unaffected (no filter).

## Admin UI

An **Access** section on the user dialog (or a dedicated tab): Territory assignment (pincode/area multiselect from the `locations` catalog, shown for FIELD_AGENT/KYC_VERIFIER) + Portfolio assignment (client/product multiselect, shown for BACKEND_USER). Reuses DataGrid/options/import patterns.

## Slices (≈6, each: build → `pnpm verify` → audit panel → browser-verify → commit → ask-push)

1. **Scope module + hierarchy filter** — extract the subtree resolver to `platform/scope/`; wire user-id scope into `cases.list` + `case_tasks` lists. Closes the security gap. Tests: MGR sees subtree, TL sees team, BE/FA see self, SA sees all.
2. **Territory tables + assignment API** — `user_pincode_assignments` + `user_area_assignments`; assign/list/remove endpoints (`TERRITORY_ASSIGN`); SDK + tests.
3. **Case location + territory scoping** — `cases.pincode_id`/`area_id`; territory predicate in scope; FIELD_AGENT/KYC list scoped by territory.
4. **Portfolio tables + assignment + scoping** — `user_client_assignments` + `user_product_assignments`; assign API; portfolio predicate for BACKEND_USER.
5. **FE assignment UI** — Access section on the user dialog (territory + portfolio).
6. **assignableUsers territory filter** — intersect eligible agents with case territory; tests.

---

# Epic E — Editable RBAC (cluster E)

## Architecture (behind a NEW ADR reopening the RBAC freeze)

The permission **catalog** stays in `@crm2/access` (`PERMISSIONS`) — tied to routes. What moves to the DB is the **role→permission mapping** (today `ROLE_PERMISSIONS`).

- Seed the code catalog into a `permissions` table (code, module, description) — source of truth for what's editable in the UI.
- `role_permissions (role, permission_code, allowed)` — the editable mapping; seeded from the current `ROLE_PERMISSIONS` so day-0 behavior is byte-identical.
- **`authorize()` cutover** (the high-blast-radius change, at the single middleware chokepoint): from "check role against the code matrix" → "check the user's **effective permission codes**, loaded from DB by role, **cached** (short TTL + invalidate-on-edit)". SUPER_ADMIN stays `*`.
- **RBAC Admin screen**: permission-matrix editor; system roles name/delete-locked; SUPER_ADMIN row read-only (always all).
- **Custom roles** (later slice): allow creating non-system roles (`is_system=false`) with a chosen permission set; `users.role` CHECK relaxes to reference the roles table. Bounded to its own slice so the core cutover ships first.

## Migration safety

- Day-0 `role_permissions` seed == current code matrix → a **parity test** asserts all 6 roles resolve to byte-identical permission sets before and after the cutover.
- Cache: short TTL (e.g. 5s, matching v1) + explicit invalidation on any role-permission edit; cross-worker invalidation deferred (single-process dev) and noted for GA.

## Slices (≈5)

1. **ADR + tables** — ADR-00xx (reopen RBAC freeze: catalog code-owned, mapping DB-editable, no per-user overrides); `permissions` + `role_permissions` migrations seeded from `ROLE_PERMISSIONS`.
2. **Effective-permission loader + cache + invalidation.**
3. **`authorize()` cutover** (code matrix → DB codes) + the 6-role parity test.
4. **RBAC Admin API** (read matrix, edit a role's permission set; `permission.manage`-gated).
5. **RBAC Admin screen** + (custom-role creation as a sub-slice).

---

## Risks & mitigations

- **E auth cutover blast radius** → single chokepoint change + day-0 parity test + cache-invalidation; ship F first so the cutover lands on an already-scoped, well-tested surface.
- **Scope "leak" via an un-scoped new endpoint** → the scope module is the one seam; a list endpoint not calling it is the regression to guard (add a checklist/CI note).
- **Territory data quality** (157k pincodes) → reuse the existing `locations` catalog + options/search; no new geo data.
- **Empty allowed-set must mean "nothing"** (`1=0`), never "all" — explicit in `appendScopeConditions`.

## Out of scope (this milestone)

Per-user permission overrides (none in v1); clusters G (DPDP consents/export/erasure) and H (stats/activity analytics) — remain deferred.
