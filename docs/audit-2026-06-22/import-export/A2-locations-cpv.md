# A2 — Import/Export Field-Coverage Audit: Locations · CPV Mapping · Scope Assignments

**Date:** 2026-06-22  **Scope:** `cpv`, `locations`, `scopeAssignments` modules + their SDK + web surfaces.
**Method:** enumerate every add/edit field (web form ∪ SDK Create/Update zod ∪ DB INSERT/UPDATE), then cross-check the IMPORT spec (columns/schema/resolve) and EXPORT manifest. AUDIT-ONLY — no code changed.

Shared engines: export `apps/api/src/platform/export/format.ts` (`ExportColumn`, `toCsv`/`toXlsx`, `escapeCsvCell`, `neutralizeFormula` CWE-1236); import `apps/api/src/platform/import/index.ts` (`ImportSpec{columns,schema,uniqueKey,sample,resolve}`) + `format.ts` (XLSX *and* CSV readers, auto-detected by `PK` magic bytes).

---

## Entity 1 — CPV Mapping › `client_products` (client↔product link)

DB cols (`repository.ts:19`): `id, client_id, product_id, is_active, effective_from, version, created_at, updated_at`.
SDK Create (`cpv.ts:56`): `clientId`, `productId`, `effectiveFrom?`. Update: `effectiveFrom` only (keys immutable).
Import file schema (`cpv/import.ts:14`): `clientCode`, `productCode`, `effectiveFrom?` → `resolve` maps codes → ids → reuses `CreateClientProductSchema` downstream via `clientProductService.create`.

| field | required? | DB column | SDK Create field | transform | IMPORT (✓/✗ + header) | EXPORT (✓/✗ + header) |
|---|---|---|---|---|---|---|
| clientId (FK→clients.code) | yes | client_id | clientId | code→id (resolve) | ✓ "Client Code" (by CODE) | ✓ "Client" (`CODE — Name`, combined) |
| productId (FK→products.code) | yes | product_id | productId | code→id (resolve) | ✓ "Product Code" (by CODE) | ✓ "Product" (`CODE — Name`, combined) |
| effectiveFrom | no (def now()) | effective_from | effectiveFrom | parseIsoDate | ✓ "Effective From" | ✓ "Effective From" |
| isActive/status | no (def true) | is_active | — (set via activate/deactivate) | — | ✗ | ✓ "Status" (Active/Inactive) |
| unitCount | derived | (subquery) | — | — | ✗ (n/a) | ✓ "Units" |
| createdAt/updatedAt | system | created_at/updated_at | — | — | ✗ (n/a) | ✓ "Created"/"Updated" |

**Notes:** Import schema does NOT bypass the SDK — `resolve` builds `CreateClientProductInput` and confirm calls `clientProductService.create` which runs `CreateClientProductSchema.parse` (validation + 409 dup per row). FK resolve covers BOTH required FKs (by code, USABLE-only maps). Both .xlsx & .csv supported (shared `parseImportFile`). Export escaping ✓ (engine). RBAC: read=`MASTERDATA_VIEW`, export=`DATA_EXPORT`, import=`MASTERDATA_MANAGE`; no per-column drop (no sensitive cols). **Round-trip caveat:** export emits `Client`/`Product` as `"CODE — Name"` single cells; import expects two separate `Client Code`/`Product Code` columns → an exported file is NOT directly re-importable (would need to split the combined column).

---

## Entity 2 — CPV Mapping › `client_product_verification_units` (per-link unit enablement)

DB cols (`repository.ts:20`): `id, client_product_id, verification_unit_id, is_active, effective_from, version, created_at, updated_at`.
SDK Create (`cpv.ts:63`): `clientProductId`, `verificationUnitId`, `effectiveFrom?`. Full CRUD + activate/deactivate service + routes (`routes.ts` `cpvUnitRoutes`). Web: managed inline via `UnitManager` (CpvPage.tsx:361, expand-row).

| field | required? | DB column | SDK Create field | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| clientProductId (FK) | yes | client_product_id | clientProductId | — | ✗ **NONE** | ✗ **NONE** |
| verificationUnitId (FK→verification_units.code) | yes | verification_unit_id | verificationUnitId | — | ✗ **NONE** | ✗ **NONE** |
| effectiveFrom | no | effective_from | effectiveFrom | — | ✗ | ✗ |
| isActive/status | no | is_active | — | — | ✗ | ✗ |

**Notes:** This entity has **no ImportSpec, no ExportColumn manifest, no `/import`/`/export` route, no web import/export button.** `cpvUnitRoutes` exposes only list/create/update/activate/deactivate. The standard (`IMPORT_EXPORT_STANDARD.md:39,45`) lists "CPV Mapping" as both export- and import-mandatory; the per-unit enablement leg (the second half of the CPV graph that actually gates which verification units a case can request) is entirely uncovered. Bulk enabling units across many client-products is a real operator workflow with no file path.

---

## Entity 3 — Location hierarchy › `locations` (flat pincode·area·city·state·country)

> The v2 model is ONE flat table (not separate country/state/city/pincode entities). The standard's "Country · State · City · Pincode" import mandate is satisfied by this single importable table; parent-FK columns do not exist (denormalized).

DB cols (`repository.ts:7`): `id, pincode, area, city, state, country, is_active, effective_from, version, created_by, updated_by, created_at, updated_at`.
SDK Create (`locations.ts:33`): `pincode`, `area`, `city`, `state`, `country(def 'India')`, `effectiveFrom?` — area/city/state/country carry `.transform(toUpper)`.
Import spec (`locations/service.ts:89`): `schema: CreateLocationSchema` — **reuses the SDK Create schema directly (transforms + validation intact)**; no `resolve` (FK-free), no `uniqueKey` (pincode repeats across areas).

| field | required? | DB column | SDK Create field | transform | IMPORT (✓/✗ + header) | EXPORT (✓/✗ + header) |
|---|---|---|---|---|---|---|
| pincode | yes | pincode | pincode | regex `^[1-9]\d{5}$` | ✓ "Pincode" | ✓ "Pincode" |
| area | yes | area | area | toUpper | ✓ "Area" | ✓ "Area" |
| city | yes | city | city | toUpper | ✓ "City" | ✓ "City" |
| state | yes | state | state | toUpper | ✓ "State" | ✓ "State" |
| country | no (def 'India') | country | country | toUpper, default | ✓ "Country" | ✓ "Country" |
| effectiveFrom | no (def now()) | effective_from | effectiveFrom | parseIsoDate | ✓ "Effective From" | ✓ "Effective From" |
| isActive/status | no (def true) | is_active | — (activate/deactivate) | — | ✗ | ✓ "Status" (Active/Inactive) |
| createdBy/updatedBy | system | created_by/updated_by | — | — | ✗ (n/a) | ✗ (not in grid) |
| createdAt/updatedAt | system | created_at/updated_at | — | — | ✗ (n/a) | ✓ "Created"/"Updated" |

**Notes:** Best-covered entity. Import schema reuses SDK Create (transforms applied → stored values uppercased; export emits the stored uppercase values → lossless on create fields). Both .xlsx & .csv. Background tier wired (`importConfirmOrEnqueue`, `exportOrEnqueue`) for the 157k catalog. Export escaping ✓. Selected-rows export (`mode:'selected'`) supported. RBAC as above; no per-column drop. **Round-trip:** create fields round-trip cleanly (export Pincode/Area/City/State/Country re-import as-is); `Status` exported but not importable (parity with every module — status is set via activate/deactivate, by design). The multi-area `createBatch` (web "add pincode + N areas") has no file equivalent, but the flat import covers the same rows one-per-line.

---

## Entity 4 — Scope Assignments › `user_scope_assignments` (Bulk Assignment)

DB write (`scopeAssignments/repository.ts:166` `add`): `user_id, dimension_code, entity_id | entity_value, assigned_by` (idempotent upsert).
SDK Create (`userAssignments.ts` `AssignScopeSchema`): `dimension`, exactly one of `entityIds[]` | `entityValues[]`.
Import file schema (`scopeAssignments/service.ts:26` `ScopeImportFileSchema`): `username`, `dimension`, `entity` → `resolveImportRow` resolves to `{userId, dimension, entityIds|entityValues}`.

| field | required? | DB column | API Create field | transform | IMPORT (✓/✗ + header) | EXPORT (✓/✗ + header) |
|---|---|---|---|---|---|---|
| userId (FK→users.username) | yes | user_id | (path `:id` in API) | username→id (resolve) | ✓ "Username" (by username) | ✓ "Username" + "Name" + "Role" |
| dimension | yes | dimension_code | dimension | uppercase | ✓ "Dimension" | ✓ "Dimension" (code) |
| entity (ID or VALUE) | yes | entity_id / entity_value | entityIds[] / entityValues[] | dimension-specific resolve | ✓ "Entity" (code/value/`PINCODE:AREA`) | ✓ "Entity" (resolved label) |
| assignedBy | system | assigned_by | — (actor) | — | ✗ (n/a) | ✗ |
| assignedAt | system | created_at | — | — | ✗ (n/a) | ✓ "Assigned At" |

**Notes:** Import file schema does NOT reuse `AssignScopeSchema` (file carries human username/dimension/entity codes, not the userId/numeric-entityIds the API schema needs) — **but `resolveImportRow` re-implements the same guards**: unknown dimension → error, unknown/inactive user → error, dimension-not-enabled-for-role → error, entity existence per dimension kind (VALUE / PINCODE / AREA `PINCODE:AREA` / catalog CODE). Confirm calls `repo.add` directly (not `scopeAssignmentService.add`), so the service-level role/dimension/reference checks are bypassed — **acceptable because resolve already performs equivalent checks** (role-dimension wiring + reference existence). Both .xlsx & .csv. Export escaping ✓. RBAC: all scope routes are `ACCESS_SCOPE_ASSIGN` (SUPER_ADMIN-only); no per-column drop needed. **Round-trip:** the "Entity" export emits the *resolved label* (e.g. client name, `String(entityId)` fallback), while import expects the *code/value*; for catalog dimensions the exported label is the name (`labelExpr`), not the code — so an exported scope file is generally NOT re-importable without remapping label→code. Export also does NOT honour any DataGrid filter/sort (`allForExport` takes no query) — it always dumps every active assignment up to the threshold.

**Web gap:** the API has `/api/v2/users/scope/import-template`, `/scope/import`, `/scope/export` (`users/routes.ts:88-97`), but there is **no web UI surface** — `UserAccessSection.tsx` / `UsersPage.tsx` expose only per-user add/remove; no `ImportButton` and no export button for bulk scope assignment anywhere in `apps/web`.

---

## Ranked gap list

| id | priority | entity | field/area | import\|export | file:line | fix sketch |
|---|---|---|---|---|---|---|
| A2-01 | **P0** | client_product_verification_units (CPV unit) | clientProductId + verificationUnitId (both required FKs) | import | `apps/api/src/modules/cpv/` (no import.ts entry for units) | Add a CPV-unit ImportSpec: file cols `Client Code`, `Product Code`, `Unit Code`(+`Effective From`); `resolve` maps (client,product)→client_product_id and unit code→verification_unit_id, reuse `cpvUnitService.create`; wire `/import-template`+`/import` on `cpvUnitRoutes` + `ImportButton` in `UnitManager`. Standard lists CPV Mapping as import-mandatory (`IMPORT_EXPORT_STANDARD.md:45`); the unit-enablement leg is the half that gates case unit selection. |
| A2-02 | **P0** | client_product_verification_units (CPV unit) | all fields | export | `apps/api/src/modules/cpv/service.ts` (no `cpvUnit` export manifest/route) | Add `ExportColumn<...View>[]` (Client, Product, Unit, Effective From, Status) + `cpvSvc.exportData` + `/cpv-units/export` route (`DATA_EXPORT`) + grid exportFn. Standard lists CPV Mapping as export-mandatory (`:39`). |
| A2-03 | P1 | user_scope_assignments | whole import/export feature | both (web) | `apps/web/src/components/UserAccessSection.tsx`, `apps/web/src/features/users/UsersPage.tsx` | API routes exist + work but no web surface. Add an `ImportButton` (basePath `/api/v2/users/scope`) + an Export button on the Users/Access page. "Bulk Assignment" is import-mandatory (`:46`); today it is API-only. |
| A2-04 | P1 | client_products | Client/Product export cells | export (round-trip) | `apps/api/src/modules/cpv/service.ts:30-31` | Export emits combined `"CODE — Name"`; import needs separate `Client Code`/`Product Code`. Either add hidden `clientCode`/`productCode` export columns (so an exported file re-imports), or document that export ≠ re-importable. Non-lossless round-trip. |
| A2-05 | P1 | user_scope_assignments | Entity export label vs import code | export (round-trip) | `apps/api/src/modules/scopeAssignments/repository.ts:96-99` | Export "Entity" is the resolved label/name; import expects the code/value. Exported scope files aren't re-importable for catalog dimensions. Emit the code (or both code + label columns) for lossless round-trip. |
| A2-06 | P1 | user_scope_assignments | export ignores grid filter/sort | export | `apps/api/src/modules/scopeAssignments/service.ts:180` (`exportData`) | `allForExport` takes no query → export always dumps all active rows, ignoring any DataGrid filter/sort/selected-rows. Other modules re-run the filtered list query; scope export does not. Re-run a filterable list query for consistency (or document the "all rows" behaviour). |
| A2-07 | P2 | (engine docs) | stale "CSV import is a later follow-up" comment | import | `apps/api/src/platform/import/format.ts:6` | The header comment claims XLSX-only, but `parseImportFile`/`parseImportCsv` fully support CSV (auto-detected). Correct the comment so it doesn't mislead future audits into flagging a missing-CSV P1. |
| A2-08 | P2 | locations | createBatch (multi-area) has no file form | import | `apps/api/src/modules/locations/service.ts:213` | Minor — the flat import covers the same rows one-area-per-line; no functional gap, note only. |

### Cross-cutting verifications (PASS)
- **.xlsx AND .csv:** all four importable entities go through the shared `parseImportFile` → both formats supported. (PASS; comment A2-07 is stale.)
- **Import reuses SDK Create schema:** locations ✓ (`CreateLocationSchema` directly). client_products ✓ (resolve → `CreateClientProductSchema` via `service.create`). scope ✗-by-design (separate file schema) **but resolve re-checks the same invariants**. No required-field validation is silently bypassed.
- **Export escaping:** all manifests stream through `escapeCsvCell`/`neutralizeFormula` (CWE-1236). PASS.
- **Export emits stored values:** locations export emits stored (uppercased) values → matches DB. PASS.
- **RBAC:** read `MASTERDATA_VIEW`, export `DATA_EXPORT`, import `MASTERDATA_MANAGE`; scope = `ACCESS_SCOPE_ASSIGN` (SUPER_ADMIN). No sensitive columns requiring per-column drop in these three entities. PASS.
