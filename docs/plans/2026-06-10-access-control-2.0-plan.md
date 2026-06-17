# Access Control 2.0 — Implementation Plan

> **For agentic workers:** execute slice-by-slice with the established CRM2 v2 workflow: scope → build → `pnpm verify` (green, ALONE, fresh :5433) → Audit Panel subagent → live/browser-verify the action → commit (author Mayur, conventional, no AI trailer) → ASK before push → update memory. Design SoT: `docs/specs/2026-06-10-access-control-2.0-redesign.md` + ADR-0022 (requires owner sign-off BEFORE slice 1 ships).

**Goal:** roles, role→permission mapping, hierarchy visibility, and role↔scope-dimension wiring all become admin-editable data; the scope/authz engine reads role attributes — zero role-name checks in code; new roles/policies require no code change.

**Carried invariants:** triple-write migrations + pg_constraint guards · uuid params pre-validated · fail-closed empty sets (RESTRICT-empty = no rows) · 404 IDOR detail · one scope seam · raw SQL in repos only · no magic numbers in business layer · DataGrid/import-engine/pagination standards · system roles locked · day-0 parity (byte-identical behavior before/after each cutover slice).

**Sequencing note:** the engine cuts over in two independent steps (permissions first, scope second) so each has its own parity gate. Epic F's remaining surface (FE Access tab, import/export, mobile checks, assignableUsers territory) lands ON the new model (slices 6–9). Epic F slice-4 commit `9046e76` ships as-is; its tables/API are migrated away in slice 3.

---

## Slice 1 — roles + role_permissions tables, seeds, parity test (no behavior change)
- mig 0033: `roles` (code PK, name, description, grants_all, hierarchy_mode CHECK, reports_to_role self-FK, is_system, is_active, effective_from, version, audit) + `role_permissions` (role_code FK CASCADE, permission_code, uq) — seed 6 system roles (SA grants_all+ALL+locked; modes SUBTREE/DIRECT_TEAM/SELF; reports_to_role FA/KYC/BE→TEAM_LEADER, TL→MANAGER) + permission rows mirroring `ROLE_PERMISSIONS`; `users.role` CHECK→FK swap (`chk_users_role` dropped, `fk_users_role` added, pg_constraint-guarded).
- **Parity test:** for each of the 6 roles, DB-resolved permission set === `ROLE_PERMISSIONS[role]` (the constant stays until slice 2 retires it).
- No runtime reads yet. Tests: migration idempotency, seed integrity, FK rejects unknown role.

## Slice 2 — authorize() cutover to DB-backed role attributes (permissions parity gate)
- `platform/access/` resolver: load `{grantsAll, permissions, hierarchyMode, dimensions}` by role_code; 5s in-process cache + `invalidateRoleCache()`; `authenticate`/testAuth enrich `req.auth`; `authorize(perm)` = grantsAll || set.has(perm).
- Editable mapping API: `GET /api/v2/roles` + `PUT /api/v2/roles/:code/permissions` (new `role.manage` perm, seeded SUPER_ADMIN-only; system-role guards; SUPER_ADMIN row immutable; OCC + audit + cache invalidation). Access matrix endpoint now reads DB.
- Retire `roleHas`/`ROLE_PERMISSIONS` readers. 6-role parity test re-asserted THROUGH HTTP (one route per permission class). Edit→effect live test (grant/revoke→403 flips within invalidation).

## Slice 3 — scope_dimensions + role_scope_dimensions + user_scope_assignments + generic assignment API
- mig 0034: the 3 tables (spec §3) + seeds (7 dimensions; FA/KYC→PINCODE+AREA EXPAND, BE→CLIENT+PRODUCT EXPAND) + **data migration** from the 4 Epic-F tables → `user_scope_assignments`, then DROP user_pincode/area/client/product_assignments.
- New `modules/scopeAssignments/` replacing territoryAssignments+portfolioAssignments: `GET /users/:id/scope-assignments` (grouped by dimension, joined display fields) · `POST /users/:id/scope-assignments` `{dimension, entityIds|entityValues}` · `DELETE /users/:id/scope-assignments/:assignmentId`. Gate ACCESS_SCOPE_ASSIGN (SA). Guards: uuid :id; dimension active for the target's role → else `400 DIMENSION_NOT_ALLOWED_FOR_ROLE`; catalog existence validation (ID-kind in-transaction; VALUE-kind against locations distinct values); idempotent adds.
- SDK userAssignments rewrite + client methods; re-point the territory/portfolio API tests to the generic endpoints (same assertions).

## Slice 4 — generic scope engine (visibility parity gate)
- `platform/scope/dimensions.ts` registry (7 defs: caseExpr/taskExpr, validateRefs, optionsFeed). `resolveScope` reads hierarchy_mode (ALL/SUBTREE/DIRECT_TEAM/SELF — CTE preserved) + assignments grouped by configured dimension into `{expand, restrict}`. `composeScopePredicate` in platform/scope replaces cases' local predicate: `(hierarchy OR expand-legs) AND (restrict-legs)`; EXPAND-empty omitted, RESTRICT-empty fail-closed; shared by cases list/findById/COUNT (+ task-level legs where applicable).
- Delete every role-name conditional in api src (scope repository if-chains, portfolioAssignments eligibility, cases controller fallback). `assignableUsers`: pool = `users.role = unit.worker_role` via mig 0035 `verification_units.worker_role` CHECK→FK(roles); actor dispatch via hierarchyMode/grants_all.
- **Parity tests:** all existing scope tests (hierarchy/territory/portfolio, in/out, detail 404, fail-closed) green THROUGH the new engine; +RESTRICT-mode test (config CLIENT RESTRICT → user sees only assigned-client rows; empty → zero rows); +grep gate: no `'SUPER_ADMIN'|'MANAGER'|'TEAM_LEADER'|'BACKEND_USER'|'FIELD_AGENT'|'KYC_VERIFIER'` literals in apps/api/src outside seeds/tests.

## Slice 5 — Role Management screen (custom roles end-to-end)
- `POST /api/v2/roles` (create custom role: code/name/hierarchy_mode/reports_to_role/permissions/dimensions; default zero perms) + `PUT /roles/:code` + activate/deactivate; system-role locks.
- FE: Roles page (Universal DataGrid) + role dialog (identity · hierarchy mode · reports-to-role · grouped permission matrix · dimension wiring w/ EXPAND/RESTRICT + RESTRICT warning). Replaces read-only Access Control page. `/roles/options` feed.
- E2E proof: admin creates "ZONE_AUDITOR" (CASE_VIEW + PINCODE RESTRICT), creates a user with it, assigns pincodes, verifies the user sees exactly those cases — **zero code touched**.

## Slice 6 — User dialog Access tab (dynamic; re-bases Epic F slice 5)
- `components/UserAccessSection.tsx`: renders one multiselect per active dimension of the selected role (options feeds; locations search-first; VALUE-kind state/city distinct feeds). Edit = live; Create = staged→applied post-create (photo pattern). `[Profile | Access]` tab strip in UserDialog; role change re-renders the tab. FE de-hardcode: role selects/labels/filters + reports-to filtering from `/roles/options` (`reports_to_role`); `CAN_ASSIGN_ROLES` → `case.assign` permission gate.

## Slice 7 — derived + task-level dimensions live (STATE/CITY/VERIFICATION_TYPE)
- STATE/CITY legs (EXISTS over locations via cs.pincode_id) + VALUE-kind assignment UX; VERIFICATION_TYPE task-level enforcement (task lists + assignableUsers intersection + case-level EXISTS leg). Tests per dimension in/out + mode matrix.

## Slice 8 — assignments bulk import/export (re-bases Epic F slice 7)
- Import-engine plugin: template `username, dimension, entity` (name/code→id resolve; VALUE-kind passthrough; role-dimension guard per row) → preview-errors → confirm → import-audit row. DataGrid export (per-user + all-assignments). Gate ACCESS_SCOPE_ASSIGN.

## Slice 9 — mobile scope contract + milestone close (re-bases Epic F slice 8)
- Verify every `/api/v2` endpoint the device consumes composes the scope seam; contract test: field-role mobile reads are territory-scoped; additive-only shapes. Close-out: COMPLIANCE_GAPS_REGISTRY entries, FROZEN_DECISIONS_REGISTRY row (ADR-0022 supersedure), MASTER_MEMORY update, retire dead access exports, final grep gate.

## Day-0 parity ledger (every cutover slice must keep green)
hierarchy: SA all · MGR subtree · TL team · others self — `cases.api.test` scope block · territory: FA in/out pincode + detail 404 · portfolio: BE client/product in/out + fail-closed `[]` · permission gates: 403 matrix · assignment guards: 400 ineligible-dimension / 404 missing user / uuid 400.
