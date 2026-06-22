# A4 — Import/Export Field-Coverage Audit: Users + RBAC (roles, access, policies)

**Scope (this agent):** `users`, `roles`, `access` (RBAC matrix), `policies`.
**Date:** 2026-06-22 · **Mode:** READ-ONLY audit (no source edits).
**Engines:** export `apps/api/src/platform/export/format.ts` · import `apps/api/src/platform/import/index.ts` + `.../import/format.ts`.
**Standard:** `docs/IMPORT_EXPORT_STANDARD.md` — §3 export-mandatory: Users · Roles · Permissions. §4 import-mandatory: Users (only). Roles/Permissions/Policies are NOT import-mandatory.

---

## Permission topology (the load-bearing fact for the PII findings)

`packages/access/src/permissions.ts` `ROLE_PERMISSIONS`:
- `page.users` (USER_VIEW) and `page.access` (ACCESS_VIEW) → **SUPER_ADMIN only**.
- `data.export` (DATA_EXPORT) → **SUPER_ADMIN, MANAGER, TEAM_LEADER, BACKEND_USER**.

So any route gated by `data.export` **alone** is reachable by MANAGER/TL/BE — three roles that **cannot** read the underlying list. The scope-assignment export already encodes this lesson: `users/routes.ts:95-97` gates `/scope/export` with `ACCESS_SCOPE_ASSIGN` (SUPER_ADMIN-only) precisely because "*data.export alone would WIDEN access*". The Users and Roles row exports do **not** follow that rule.

---

## ENTITY 1 — USERS

Add/edit fields gathered from: FE form `apps/web/src/features/users/UsersPage.tsx` (inline dialog, lines 483-588) · SDK `packages/sdk/src/users.ts` (CreateUserSchema L97 / UpdateUserSchema L114) · DB `apps/api/src/modules/users/repository.ts` (COLS L13, INSERT L186).

Import spec: `users/service.ts` `USER_IMPORT_SPEC` L102 (columns L94, schema = `CreateUserSchema`). Export manifest: `USER_EXPORT_COLUMNS` L71.
Routes: `users/routes.ts` — export `GET /users/export` gated `DATA_EXPORT` (L30); import `POST /users/import` gated `USER_MANAGE` (L36-41).

### Field matrix — Users

| field | required? | DB column | SDK Create field | transform | IMPORT (✓/✗ + header) | EXPORT (✓/✗ + header) |
|---|---|---|---|---|---|---|
| username | yes | `username` | `username` | none (lowercase regex) | ✓ "Username" | ✓ "Username" |
| name | yes | `name` | `name` | **toUpper** | ✓ "Name" | ✓ "Name" |
| email | no | `email` | `email` | email (no upper) | ✓ "Email" | **✗ (no export column)** |
| phone | no | `phone` | `phone` | none (E.164) | **✗ (no import column)** | ✓ "Phone" |
| role | yes | `role` | `role` | none (UPPER code) | ✓ "Role" | ✓ "Role" |
| departmentId | no | `department_id` | `departmentId` | fkId | **✗ (no import column)** | ✓ "Department" (name, via join) |
| designationId | no | `designation_id` | `designationId` | fkId | **✗ (no import column)** | ✓ "Designation" (name) |
| reportsTo (manager) | no | `reports_to` | `reportsTo` | uuid | ✗ (deliberate — FK-free import, documented L86-93) | ✓ "Reports To" (name) |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✓ "Effective From" | ✓ "Effective From" |
| password | no (create) | `password_hash` (write-only) | `password` | **secret** | ✗ | ✗ **MUST-NOT-EXPORT (correct)** |
| mfaRequired | no (edit) | `mfa_required` | (Update only) | bool | ✗ | **✗ (no export column)** |
| employeeId | server-minted | `employee_id` | — (not client-set) | none | ✗ (correct) | ✓ "Employee ID" |
| isActive / status | edit (activate) | `is_active` | — | bool | ✗ | ✓ "Status" |
| createdAt/updatedAt | system | `created_at`/`updated_at` | — | — | ✗ | ✓ "Created"/"Updated" |
| password_hash / password_set_at | system secret | `password_hash` etc. | — | **secret** | ✗ | ✗ **never present (correct)** |
| failed_login_count / locked_until | system | — | — | — | ✗ | ✗ (correct) |
| profile_photo_key | edit (separate upload) | `profile_photo_key` | — | — | ✗ | ✗ (storage key — correctly absent) |

### Users — verification checklist
- (i) both .xlsx & .csv on import? **Yes** — engine auto-detects PK magic bytes → XLSX else CSV (`import/format.ts:159-161`); web file input accepts both (`ImportModal.tsx:183`).
- (ii) import schema reuses SDK Create schema? **Yes** — `schema: CreateUserSchema` (service L105). ADR-0058 transforms (name→toUpper) and password policy run on import. ✓
- (iii) every add/edit field importable & exportable except secrets? **No** — see gaps U-2..U-5.
- (iv) export never emits hash/token? **Yes** — manifest has no credential columns; `COLS` is the only projection and the export re-uses the list query (no hash columns selected). ✓
- (v) escaping? **Yes** — `escapeCsvCell`/`neutralizeFormula` (CWE-1236) applied to every cell in both CSV and XLSX paths. ✓
- (vi) round-trip lossless for non-secret editable fields? **No** — email is importable but not exportable; phone/department/designation are exportable but not importable → an export→edit→re-import cycle silently drops those columns (U-2..U-4).
- (vii) PII / admin gating — **FAILS**, see U-1 (P0).

---

## ENTITY 2 — ROLES

Add/edit from: FE `apps/web/src/features/access/RolesPage.tsx` (RoleDialog) · SDK `packages/sdk/src/roles.ts` (CreateRoleSchema L80 / UpdateRoleSchema L98 / UpdateRolePermissionsSchema L115) · repo `apps/api/src/modules/roles/repository.ts`.
Export manifest: `roles/service.ts` `ROLE_EXPORT_COLUMNS` L47. **No import** (correct per standard).
Routes: `roles/routes.ts` — export `GET /roles/export` gated `DATA_EXPORT` (L13); read `GET /roles/` gated `ACCESS_VIEW` (L16).

### Field matrix — Roles (export-only entity)

| field | required? | DB column | SDK Create field | transform | IMPORT | EXPORT (header) |
|---|---|---|---|---|---|---|
| code | yes | `code` | `code` | none (UPPER) | n/a (no import) | ✓ "Code" |
| name | yes | `name` | `name` | toUpper | n/a | ✓ "Name" |
| description | no | `description` | `description` | toUpper | n/a | **✗ (no export column)** |
| hierarchyMode | yes | `hierarchy_mode` | `hierarchyMode` | enum | n/a | ✓ "Sees" |
| reportsToRole | no | `reports_to_role` | `reportsToRole` | code | n/a | ✓ "Reports To" |
| permissions[] | no | `role_permissions` | `permissions` | none | n/a | ✓ "Permissions" (ALL or csv-joined) |
| dimensions[] | no | wiring table | `dimensions` | none | n/a | ✓ "Scope Dimensions" |
| passwordExpiryDays | no | `password_expiry_days` | `passwordExpiryDays` | int/null | n/a | ✓ "Password Expiry (days)" |
| idleLogoutMinutes | no | `idle_logout_minutes` | `idleLogoutMinutes` | int/null | n/a | **✗ (no export column)** |
| maxSessionMinutes | no | `max_session_minutes` | `maxSessionMinutes` | int/null | n/a | **✗ (no export column)** |
| isSystem / kind | system | `is_system` | — | — | n/a | ✓ "Kind" |
| isActive / status | edit | `is_active` | — | — | n/a | ✓ "Status" |
| createdAt/updatedAt | system | — | — | — | n/a | ✓ "Created"/"Updated" |

### Roles — verification checklist
- Import correctly absent (standard §4 does not list Roles). ✓
- Escaping ✓ (shared engine). The `permissions` column joins codes with `, ` — internal but **sanctioned** (the standard mandates Permissions export; RBAC topology is admin-only data, not a secret). It is NOT a credential leak. The exposure concern is the *audience* (R-1), not the content.
- Export emits no secret. ✓
- Gaps: description / idleLogoutMinutes / maxSessionMinutes editable but not exported (R-2..R-4, all P1/P2).

---

## ENTITY 3 — ACCESS (RBAC matrix)

`apps/api/src/modules/access/service.ts` + `routes.ts`: single read-only `GET /access/matrix` (gated `ACCESS_VIEW`). Returns role codes, the code-owned permission catalog (label/group), and grants map. **No DataGrid, no import, no export — by design** (`access/routes.ts:8` "No writes by design"). The standard's "Permissions" export-mandate (§3) is satisfied by the **Roles** export `permissions` column. **No gap** — the matrix is display metadata feeding the role editor, not a grid surface. Verified it contains no secrets (only codes + labels).

---

## ENTITY 4 — POLICIES

Add/edit from: FE `apps/web/src/features/policies/PoliciesPage.tsx` + `PolicyDialog.tsx` · SDK `packages/sdk/src/policies.ts` (CreatePolicySchema L49 / UpdatePolicySchema L58 / PolicyEffectiveFromSchema L68) · repo `apps/api/src/modules/policies/repository.ts`.
**No export manifest. No import spec.** `policies/controller.ts` has NO export/import handlers; `routes.ts` has NO `/export` or `/import` routes; `PoliciesPage.tsx` renders `DataGrid` **without** an `exportFn` (no Export button) and only a "+ New Policy" button (no Import).

### Field matrix — Policies

| field | required? | DB column | SDK Create field | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| code | yes | `code` | `code` | none (UPPER) | ✗ | ✗ |
| name | yes | `name` | `name` | toUpper | ✗ | ✗ |
| description | no | `description` | `description` | toUpper | ✗ | ✗ |
| content | yes | `content` | `content` | none (markdown blob) | ✗ | ✗ |
| contentVersion | system | `content_version` | — | — | ✗ | ✗ |
| effectiveFrom | no | `effective_from` | (separate schema) | isoDate | ✗ | ✗ |
| isActive | edit | `is_active` | — | — | ✗ | ✗ |

### Policies — verification checklist
- (vii) Is policies import appropriate? **NO — staying non-importable is correct.** `content` is a multi-line versioned legal/acknowledgement blob (the seeded FIELD_EXEC_ACKNOWLEDGEMENT is ~9000 chars); `content_version` bumps drive a **global forced re-acceptance** of every live user (`policies/service.ts:85` `bumpContent`). Bulk-importing policy content would (a) be unworkable in a spreadsheet cell, (b) risk silently triggering org-wide re-accept storms, (c) bypass the deliberate single-authoring path. The standard §4 does NOT list policies as import-mandatory; §11 treats versioned admin content as author-once. **WONTFIX import.** This matches `IMPORT_EXPORT_STANDARD` intent.
- **Export, however, IS expected** for any operational DataGrid (§1 "Every operational DataGrid is the only export surface"). Policies is a DataGrid admin page with none → gap P-1 (P1). An export here is low-risk (no secrets; content is admin-authored), so it is a straightforward consistency fix, not a security issue.

---

## RANKED GAP LIST

### P0 (required-field drop · secret leak · ungated PII · schema bypass)

| id | entity | field/issue | import\|export | file:line | fix sketch |
|---|---|---|---|---|---|
| **U-1** | users | **Ungated PII export.** `GET /users/export` is gated by `DATA_EXPORT` **only**, but the user list read (`GET /users/`) needs `page.users` (SUPER_ADMIN-only). MANAGER/TEAM_LEADER/BACKEND_USER hold `data.export` but NOT `page.users`, so they can download every user's **name + email-via-import-template? no, name+phone+employeeId+reportsTo** (PII) without being able to view the user grid. Export audience is strictly wider than the read audience. | export | `apps/api/src/modules/users/routes.ts:30` (`authorize(PERMISSIONS.DATA_EXPORT)`) | Require BOTH perms on the export route: `authorize(PERMISSIONS.USER_VIEW)` (and keep `DATA_EXPORT` if a combined guard exists), mirroring the `/scope/export` precedent at `routes.ts:95-97`. The read perm must gate the row export, not the generic export perm alone. |

> **NOTE on U-1 scope:** the exported columns are name, phone, employeeId, department, designation, reportsTo, dates, status (`USER_EXPORT_COLUMNS` L71). Phone is PII; email is *not* currently exported (see U-2). No password hash/token is exported (that part is correct). The defect is the **authorization gate**, not the column set.

### P1 (optional field dropped · non-lossless round-trip · missing export on a grid)

| id | entity | field/issue | import\|export | file:line | fix sketch |
|---|---|---|---|---|---|
| **R-1** | roles | **RBAC topology export gated by `data.export` only.** `GET /roles/export` (gated `DATA_EXPORT`) dumps every role's full permission set + scope wiring + reporting line; the roles read needs `ACCESS_VIEW` (SUPER_ADMIN-only). MANAGER/TL/BE can export the complete access-control topology they cannot view. Not a credential leak, but an access-widening info-disclosure (recon value). | export | `apps/api/src/modules/roles/routes.ts:13` | Gate with `ACCESS_VIEW` (mirror the read route L16) rather than `DATA_EXPORT` alone. Same precedent as `/scope/export`. *(Borderline P0/P1: no PII/secret, so P1 — but fix alongside U-1, identical root cause.)* |
| **U-2** | users | `email` importable (`USER_IMPORT_COLUMNS` has "Email") but **not in the export manifest** → export is missing an editable, import-supported field; round-trip non-lossless. | export | `apps/api/src/modules/users/service.ts:71-84` (no email column) | Add `{ id: 'email', header: 'Email', value: (u) => u.email ?? '' }`. **PII** — ship together with U-1's gating fix so the column is not exposed to non-admins. |
| **U-3** | users | `phone` exportable but **not importable** (no "Phone" import column) → can't bulk-load a documented Create field; round-trip non-lossless. | import | `apps/api/src/modules/users/service.ts:94-100` | Add `{ id: 'phone', header: 'Phone' }` to `USER_IMPORT_COLUMNS`; schema already accepts `phone` (CreateUserSchema L104). |
| **U-4** | users | `departmentId` / `designationId` are Create-schema fields (required by the FE create form) but **not importable** (no columns) → a bulk-imported user is created with null dept/designation; round-trip non-lossless (exported as names, never re-importable). | import | `apps/api/src/modules/users/service.ts:94-100` | Add code→id resolved columns via an `ImportSpec.resolve` (department CODE/name → id, designation → id), mirroring the FK-resolve pattern other domains use. If kept FK-free, document explicitly like `reportsTo`. |
| **P-1** | policies | Policies is an operational admin DataGrid with **no export** (no `exportFn`, no `/export` route, no manifest) — violates standard §1 ("every operational DataGrid is the only export surface"). Low risk (admin-authored content, no secrets). | export | `apps/web/src/features/policies/PoliciesPage.tsx:103` (DataGrid, no exportFn) + `apps/api/src/modules/policies/{routes,controller,service}.ts` (no export) | Add a `POLICY_EXPORT_COLUMNS` manifest (code, name, contentVersion, isActive, effectiveFrom, dates — **exclude/condense `content`** to keep cells sane), an `exportData` service method + `GET /policies/export` gated `POLICY_VIEW` (page-scoped, not `DATA_EXPORT`-only), wire `exportFn` on the grid. |

### P2 (polish)

| id | entity | field/issue | import\|export | file:line | fix sketch |
|---|---|---|---|---|---|
| **U-5** | users | `mfaRequired` is an edit field (UpdateUserSchema L126) but not exported → an admin can't audit MFA-required flags via export. | export | `apps/api/src/modules/users/service.ts:71-84` | Add `{ id: 'mfaRequired', header: 'MFA Required', value: (u) => (u.mfaRequired ? 'Yes' : 'No') }`. |
| **R-2** | roles | `description` is a Create/Update field but not in the export manifest. | export | `apps/api/src/modules/roles/service.ts:47-71` | Add a Description column. |
| **R-3** | roles | `idleLogoutMinutes` (ADR-0045) editable but not exported. | export | `apps/api/src/modules/roles/service.ts:47-71` | Add an "Idle Logout (min)" column (null → "Exempt"). |
| **R-4** | roles | `maxSessionMinutes` (ADR-0045) editable but not exported. | export | `apps/api/src/modules/roles/service.ts:47-71` | Add a "Session Cap (min)" column (null → "No cap"). |

---

## Secret-leak check (explicit)

| entity | password hash / token / session secret exported? | verdict |
|---|---|---|
| users | NO — `USER_EXPORT_COLUMNS` has no credential column; export re-uses the list query whose projection (`repository.ts` list SELECT) excludes `password_hash`, `password_set_at`, `failed_login_count`, `locked_until`. | ✓ SAFE |
| roles | NO — only role config + permission codes. | ✓ SAFE (audience gap = R-1) |
| access | NO — read-only catalog metadata. | ✓ SAFE |
| policies | n/a (no export today). | ✓ |

**No secret-leak P0 found.** The single P0 (U-1) is an **ungated-PII** authorization gap on the users export route, plus its sibling RBAC-topology gap (R-1).

---

## Summary counts
- **P0: 1** (U-1 ungated PII export).
- **P1: 5** (R-1, U-2, U-3, U-4, P-1).
- **P2: 4** (U-5, R-2, R-3, R-4).
- Import correctly reuses SDK Create schema (Users). Both .xlsx + .csv supported. Escaping (CWE-1236) correct everywhere. Policies non-import = correct (justified). No password-hash/token leak in any export.
