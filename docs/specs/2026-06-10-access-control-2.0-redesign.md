# Access Control 2.0 — Re-audit + Redesign (authorization · assignment · visibility)

- **Status:** Design complete — awaiting owner sign-off on ADR-0022 — 2026-06-10
- **Owner directive (2026-06-10):** make role↔assignment wiring fully admin-configurable. "Roles define permissions, while the admin controls which business entities and scope dimensions can be assigned to users of that role." No code change when new roles / assignment policies / business requirements arrive.
- **Owner decisions:** per-role hierarchy mode (ALL/SUBTREE/DIRECT_TEAM/SELF) = admin setting · per-dimension EXPAND/RESTRICT = admin setting · ONE milestone merging Epic E (editable RBAC + custom roles) with this redesign · day-1 dimensions: CLIENT, PRODUCT, PINCODE, AREA, STATE, CITY, VERIFICATION_TYPE.
- **Supersedes:** Epic E section of `2026-06-10-access-and-scope-milestone-design.md`; re-bases Epic F slices 5–8 onto the new model. Epic F slices 1–4 (shipped) are *inputs* — their seam (`platform/scope`, `caseScopePredicate`, fail-closed invariants) survives; their hardcoded wiring is replaced.

---

## 1. The principle: configuration is data, semantics are code

Two different things hide inside "role-specific mapping":

- **Assignability + policy** (which entities can be attached to users of a role; how a role sees the hierarchy; what a role may do) → becomes **pure data**, admin-editable, zero code per new role.
- **Enforcement semantics** (how a CLIENT assignment translates into `cs.client_id = ANY(...)`; how PINCODE territory reaches `cases.pincode_id`; how a subtree CTE walks `reports_to`) → stays **code**, in one registry. A new *kind* of data relationship (a new dimension) is a one-time, reviewed code addition; everything else about it is then admin-configurable forever.

Why not config-generated SQL: enforcement predicates generated from admin data is a rules engine with injection surface and untestable combinatorics. The registry keeps each dimension's predicate parameterized, reviewed, and unit-tested once.

## 2. Re-audit — what is hardcoded today (demolition map)

Verified inventory (file:line), 2026-06-10, working tree at slice 4 `9046e76`:

**2.1 Role catalog (4 mirrors + 2 DB checks)**
- `packages/access/src/permissions.ts:5-12` `ROLES` (source); `packages/sdk/src/access.ts:8-15` `ACCESS_ROLES`; `packages/sdk/src/users.ts:11-18` `USER_ROLES`; `packages/test-utils/src/helpers/authHeaders.ts:6-12` Role union.
- `db/v2/migrations/0007_users.sql:22-24` `chk_users_role` CHECK; `0001_verification_unit_registry.sql:26-27,53-66` `worker_role` CHECK (FIELD_AGENT|KYC_VERIFIER) + unit-kind→role cross-CHECKs.

**2.2 Permission mapping (frozen)**
- `permissions.ts:44-68` `ROLE_PERMISSIONS` constant; `:70-72` `roleHas()`; `packages/access/src/authorize.ts:14-27` `authorize()` resolves against the constant; `modules/access/*` read-only matrix endpoint; `permissions.ts:99-109` `buildAccessMatrix()`.

**2.3 Role-name conditionals in business logic**
- `platform/scope/repository.ts:41-62` `getScopedUserIds` if-chain (SUPER_ADMIN→undefined; MANAGER→recursive CTE; TEAM_LEADER→self+direct; else self).
- `platform/scope/repository.ts:100-115` `resolveScope` (`FIELD_AGENT|KYC_VERIFIER`→territory; `BACKEND_USER`→portfolio).
- `modules/cases/repository.ts:319-332` `assignableUsers` (`role IN ('FIELD_AGENT','KYC_VERIFIER')` pool; SA/MANAGER/TEAM_LEADER actor dispatch).
- `modules/portfolioAssignments/service.ts:7-13` `PORTFOLIO_ROLE='BACKEND_USER'` eligibility.
- `modules/cases/controller.ts:16` fallback role literal.
- Web: `features/cases/CaseDetailPage.tsx:19,25` `CAN_ASSIGN_ROLES` list; `features/users/UsersPage.tsx:265-270,309-310` `MANAGER_ROLE_FOR` reports-to filtering; `:34-42` `ROLE_LABELS`.
- Import samples default `'FIELD_AGENT'` (`modules/users/service.ts:103`, `modules/verificationUnits/service.ts:116`); users list role filter validates against the closed `USER_ROLES` (`modules/users/service.ts:54,119-121`).

**2.4 Assignment model (dimension-specific)**
- 4 tables: `user_pincode_assignments`/`user_area_assignments` (mig 0030) + `user_client_assignments`/`user_product_assignments` (mig 0032).
- 2 modules: `territoryAssignments` + `portfolioAssignments` (10 routes under `/users/:id/{territory,portfolio}/...`); SDK `userAssignments.ts` + 10 client methods.

**2.5 Scope enforcement (the part that already generalizes well)**
- `platform/scope/` is the single seam; `caseScopePredicate` (`modules/cases/repository.ts:84-109`) composes hierarchy + 4 dimension legs, shared by list + findById (IDOR-safe 404); fail-closed empty-array handling. **KEEP the seam, generalize the composition.**
- Dimension-capable columns confirmed: `cases.client_id/product_id` (0010), `cases.pincode_id/area_id` (0031), `case_tasks.assigned_to/verification_unit_id` (0010), `locations(id,pincode,area,city,state)` (0004/0006).

**2.6 Verdict.** The scope *seam* (one chokepoint, parameterized fragments, fail-closed, 404-IDOR) is sound and survives. Everything that *names a role* is configuration leakage into code — replaced below. Slices 2–4's tables/APIs are subsumed by the generic assignment model (data migrated, then dropped).

## 3. Target data model (all new tables OCC + audit-chained like every v2 admin entity)

```
roles
  code            varchar PK (UPPER_SNAKE, immutable)
  name            varchar NOT NULL          -- display, admin-editable
  description     text
  grants_all      boolean NOT NULL DEFAULT false   -- true ONLY for SUPER_ADMIN (locked)
  hierarchy_mode  varchar NOT NULL CHECK IN ('ALL','SUBTREE','DIRECT_TEAM','SELF')
  reports_to_role varchar NULL REFERENCES roles(code)  -- who users of this role report to (form filter)
  is_system       boolean NOT NULL DEFAULT false       -- delete/code-locked; SUPER_ADMIN fully locked
  is_active, effective_from, version, created_by/updated_by/timestamps

role_permissions
  role_code       varchar REFERENCES roles(code) ON DELETE CASCADE
  permission_code varchar NOT NULL   -- validated against the CODE catalog at write time
  UNIQUE (role_code, permission_code)

scope_dimensions                      -- CODE-SEEDED catalog (rows mirror the code registry)
  code        varchar PK             -- CLIENT, PRODUCT, PINCODE, AREA, STATE, CITY, VERIFICATION_TYPE
  label       varchar NOT NULL
  entity_kind varchar NOT NULL CHECK IN ('ID','VALUE')  -- id-keyed catalog vs text-valued (STATE/CITY)
  level       varchar NOT NULL CHECK IN ('CASE','TASK')
  is_active   boolean

role_scope_dimensions                 -- admin wiring: what the Access tab offers per role + the policy
  role_code      varchar REFERENCES roles(code) ON DELETE CASCADE
  dimension_code varchar REFERENCES scope_dimensions(code)
  mode           varchar NOT NULL CHECK IN ('EXPAND','RESTRICT')
  is_active      boolean NOT NULL DEFAULT true
  UNIQUE (role_code, dimension_code)

user_scope_assignments                -- replaces the 4 Epic-F tables
  id             int identity PK
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
  dimension_code varchar NOT NULL REFERENCES scope_dimensions(code)
  entity_id      int NULL            -- ID-kind dimensions (locations/clients/products/verification_units id)
  entity_value   text NULL           -- VALUE-kind dimensions (state/city name)
  assigned_by uuid, is_active boolean DEFAULT true, created_at
  CHECK ((entity_id IS NULL) <> (entity_value IS NULL))
  UNIQUE (user_id, dimension_code, entity_id, entity_value)   -- via two partial unique indexes

users.role  → FK roles(code) (drop chk_users_role)
verification_units.worker_role → FK roles(code) (drop the FA/KYC CHECK + kind-cross-CHECKs; ADR-0022)
```

Referential integrity for `entity_id` (no polymorphic FK): the assignment service validates existence against the dimension's catalog table in the same transaction; v2 catalogs **deactivate, never hard-DELETE**, so dangling references cannot arise. Accepted, documented tradeoff.

## 4. The engine (one seam, zero role names)

**4.1 Dimension registry (code)** — `platform/scope/dimensions.ts`:
```ts
interface DimensionDef {
  code: DimensionCode; entityKind: 'ID' | 'VALUE'; level: 'CASE' | 'TASK';
  caseExpr(params: unknown[], ids: (number|string)[]): string;  // parameterized leg
  validateRefs(ids): Promise<void>;                              // catalog existence check
  optionsFeed: { path: string };                                 // what the Access tab multiselect queries
}
```
Day-1 registry: CLIENT→`cs.client_id=ANY($::int[])` · PRODUCT→`cs.product_id=ANY` · PINCODE→`cs.pincode_id=ANY` · AREA→`cs.area_id=ANY` · STATE→`EXISTS(SELECT 1 FROM locations l WHERE l.id=cs.pincode_id AND l.state=ANY($::text[]))` · CITY→same on `l.city` · VERIFICATION_TYPE (TASK-level)→`EXISTS(SELECT 1 FROM case_tasks ct WHERE ct.case_id=cs.id AND ct.verification_unit_id=ANY($::int[]))` + a task-list leg `ct.verification_unit_id=ANY` + an assignableUsers intersection.

**4.2 Role attribute resolution (cached).** `authenticate` enriches `req.auth` from a 5s in-process cache (invalidate on any role/permission/dimension-config edit): `{ userId, roleCode, grantsAll, permissions: Set, hierarchyMode, dimensions: [{code, mode}] }`. `authorize(perm)` = `grantsAll || permissions.has(perm)`. **No role-name checks anywhere.**

**4.3 Scope resolution.** `resolveScope(actor)`:
1. `hierarchyMode`: ALL→no user filter (and skip the rest — global) · SUBTREE→recursive `reports_to` CTE (existing, depth-cap 16) · DIRECT_TEAM→self+direct · SELF→[self].
2. Load the actor's assignments grouped by dimension, intersected with the role's *active* dimension config: `expand: {dim→ids}` / `restrict: {dim→ids}`.

**4.4 Predicate composition** (generalizes `caseScopePredicate`, stays shared by list + findById + COUNT):
```
visible ⇔ (hierarchy leg OR any-EXPAND-dimension leg) AND (every RESTRICT dimension leg)
```
- EXPAND with no assignments → leg omitted (no over-grant; `ANY('{}')` never emitted on the OR side).
- RESTRICT with no assignments → **fail-closed** (the AND leg matches nothing): a role configured RESTRICT-on-CLIENT sees zero rows until the admin assigns clients. Locked invariant (consistent with "empty allowed-set ⇒ no rows, never all"); the Role Management UI warns when enabling RESTRICT.
- `grants_all`/ALL → predicate `''` (today's SA bypass, now attribute-driven).

**4.5 Eligibility + assignability without role names.**
- Generic assignment guard: an entity may be assigned to a user only if the user's role has that dimension active → `400 DIMENSION_NOT_ALLOWED_FOR_ROLE` (generalizes `NOT_PORTFOLIO_ELIGIBLE`).
- `assignableUsers` pool: users whose `role = unit.worker_role` (already data on the VU row; FK→roles makes it admin-extensible), intersected with the actor's scope + (Epic F slice 6) the case's territory.
- FE `CAN_ASSIGN_ROLES` → permission check (`case.assign`). `MANAGER_ROLE_FOR` → `roles.reports_to_role` served by a `/roles/options` feed. `ROLE_LABELS`/role filters → DB feed.

**4.6 Mobile.** Unchanged seam: every `/api/v2` read the device consumes goes through `resolveScope` — enforcement is consumer-agnostic. Contract tests per MOBILE_API_COMPATIBILITY.

## 5. Admin surface

1. **Role Management** (new page, `role.manage` = SUPER_ADMIN-seeded): Universal DataGrid of roles; create/edit dialog = identity (code locked post-create) + hierarchy mode + reports-to-role + grouped permission matrix + dimension wiring (per-dimension on/off + EXPAND/RESTRICT). System roles: delete/code-locked (SUPER_ADMIN fully read-only). Replaces the read-only Access Control matrix.
2. **User dialog Access tab** (Epic F slice 5, re-based): rendered **dynamically** from the target role's `role_scope_dimensions` — one multiselect per active dimension (fed by the dimension's options feed; locations search-first). Create = staged→applied post-create (photo pattern); Edit = live. No dimension hardcoding in the FE.
3. **Bulk import/export** (Epic F slice 7, re-based): one generic assignment template (`username, dimension, entity`) through the import-engine; DataGrid export of assignments.

## 6. Migration plan (greenfield — no production data; dev data migrated)

Day-0 behavior is byte-identical, proven by tests:
- Seed `roles` (6 system rows: SA grants_all/ALL · MANAGER SUBTREE · TEAM_LEADER DIRECT_TEAM · BACKEND_USER/FIELD_AGENT/KYC_VERIFIER SELF; reports_to_role: FA/KYC/BE→TEAM_LEADER, TL→MANAGER) + `role_permissions` from `ROLE_PERMISSIONS` (**parity test**: resolved set per role == retired constant) + `scope_dimensions` (7) + `role_scope_dimensions` (FA/KYC: PINCODE+AREA EXPAND · BE: CLIENT+PRODUCT EXPAND).
- Migrate rows from the 4 Epic-F tables into `user_scope_assignments`; drop the old tables; replace `/users/:id/{territory,portfolio}` with generic `/users/:id/scope-assignments` (GET grouped-by-dimension · POST `{dimension, entityIds|entityValues}` · DELETE one). SDK `userAssignments.ts` rewritten. The territory/portfolio scope tests are re-pointed, not weakened (same visibility assertions through the new engine).
- `users.role`/`verification_units.worker_role` CHECK→FK swaps.
- `@crm2/access` keeps the permission catalog + `authorize()`; `ROLES`/`ROLE_PERMISSIONS`/`roleHas`/`buildAccessMatrix` retire after cutover.

## 7. Invariants (unchanged, now attribute-driven)

Default-deny · fail-closed empty sets · out-of-scope detail = 404 · append-only hash-chained audit on every config/assignment write · OCC on role edits · permission catalog code-owned · no per-user permission overrides · uuid params validated pre-query · raw SQL only in repositories · one scope seam (any new operational list MUST compose it) · system roles delete-locked, SUPER_ADMIN fully locked · DataGrid/import-engine/pagination standards on all new admin surfaces.

## 8. Risks

| Risk | Mitigation |
|---|---|
| `authorize()` cutover blast radius | single chokepoint + day-0 parity test + 5s cache w/ invalidate-on-edit |
| RESTRICT misconfiguration locks users out | fail-closed is the locked choice; UI warning + role-config audit trail; admin can flip mode instantly |
| Polymorphic assignment integrity | service-side catalog validation in-transaction; catalogs never hard-DELETE |
| Custom role under-permissioned/over-permissioned | permission matrix is explicit per role; default new role = zero permissions (default-deny) |
| Cache staleness window (5s) on permission edits | matches v1 precedent; invalidate-on-edit makes it best-effort instant in-process; cross-worker invalidation deferred to GA (single-process today) |
| VU worker_role CHECK relaxation | FK to roles preserves integrity; seed keeps FIELD_VISIT→FIELD_AGENT defaults; admin owns exceptions |

## 9. Out of scope

Per-user permission overrides · admin-defined dimensions (new dimension = code registry addition by design) · row-level rules beyond dimensions (e.g. amount thresholds) · clusters G/H (unchanged, deferred).
