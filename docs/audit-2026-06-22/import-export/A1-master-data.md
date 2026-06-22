# A1 — Master-Data Import/Export Field-Coverage Audit

**Date:** 2026-06-22 · **Scope (this agent):** `clients`, `products`, `verificationUnits`, `departments`, `designations` · **Mode:** READ-ONLY (no source changed).

Audits Excel(.xlsx)/CSV import & export FIELD coverage for the five admin master-data entities, diffing the three authoring layers (web add/edit form · SDK Create/Update zod · DB INSERT/UPDATE) against the IMPORT spec (`ImportColumn[]`+`schema`+`resolve`) and EXPORT manifest (`ExportColumn[]`).

---

## Shared-engine facts (apply to all five entities)

- **Import accepts BOTH .xlsx AND .csv.** `parseImportFile` (`apps/api/src/platform/import/format.ts:159-162`) auto-detects by the `PK` zip magic → XLSX, else CSV (`parseImportCsv`, full RFC-4180 parser at `:110-152`). **The header doc-comment at `format.ts:6` is STALE** — it says *"XLSX only for now … CSV import is a later follow-up"* but `parseImportCsv` is fully implemented and on the live path. (Doc-only defect — see GAP-DOC-1.)
- **Import → SDK schema reuse:** All five reuse the SDK `Create*Schema` as the import `schema` (validated at `index.ts:142` `spec.schema.safeParse`). So ADR-0058 `.transform(toUpper)`, regex, enum, min/max and cross-field invariants **all apply on import** for every entity. No bypass anywhere.
- **Export emits STORED values** (the read-model row, already uppercased by the write path) and routes every cell through `escapeCsvCell` (CSV, `format.ts:55`) / `neutralizeFormula` (XLSX, `format.ts:44`) — CWE-1236 formula-injection guard present on all five.
- **RBAC column drop:** none of the five carry money/PII columns, so no server-side column drop is required or present. (Correct — not a gap.)
- **Background-import tier:** only `locations` registers an import runner (`registerJobs.ts`). None of the five entities here are background-wired → all import synchronously and 413 at ≥10k rows. Acceptable for master-data volumes (informational, GAP-P2 level at most).

---

## Entity matrices

### 1. clients — `MasterDataCrud` + shared glue

Import spec: `masterDataImportSpec<CreateClientInput>('clients', CreateClientSchema)` (`modules/clients/service.ts:41`). Export: `masterDataExportColumns` (shared). Web: `MasterDataCrud` (ImportButton wired).

| field | required? | DB column | SDK Create | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| code | yes | `code` | `code` | UPPER_SNAKE regex (no toUpper) | ✓ `Code` | ✓ `Code` |
| name | yes | `name` | `name` | toUpper | ✓ `Name` | ✓ `Name` |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✓ `Effective From` | ✓ `Effective From` |
| (isActive) | n/a (toggle) | `is_active` | — | — | — | ✓ `Status` |
| (createdAt/updatedAt) | auto | — | — | — | — | ✓ `Created`/`Updated` |

**Verdict: CLEAN.** All editable fields round-trip; toUpper applied on import; both formats accepted. No gaps.

### 2. products — `MasterDataCrud` + shared glue

Import: `masterDataImportSpec<CreateProductInput>('products', CreateProductSchema)` (`modules/products/service.ts:41`). Export: shared `masterDataExportColumns`. Web: `MasterDataCrud` (ImportButton wired). Schema is **identical** to clients (code/name/effectiveFrom only — no product-type/category/verification-type fields exist).

| field | required? | DB column | SDK Create | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| code | yes | `code` | `code` | UPPER_SNAKE regex | ✓ `Code` | ✓ `Code` |
| name | yes | `name` | `name` | toUpper | ✓ `Name` | ✓ `Name` |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✓ `Effective From` | ✓ `Effective From` |
| (isActive/audit) | auto | … | — | — | — | ✓ `Status`/`Created`/`Updated` |

**Verdict: CLEAN.** No gaps.

### 3. verificationUnits — CUSTOM import + CUSTOM export

Import: `VU_IMPORT_SPEC` (19 columns, `modules/verificationUnits/service.ts:78-131`, schema = `CreateVerificationUnitSchema`). Export: `VU_EXPORT_COLUMNS` (9 columns, `service.ts:61-71`). Web: custom page; ImportButton wired (`VerificationUnitsPage.tsx:185`). System rows (`is_system`, the 9 mobile FIELD_VISIT types) hide Edit/Deactivate.

| field | required? | DB column | SDK Create | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| code | yes | `code` | `code` | UPPER_SNAKE regex | ✓ `Code` | ✓ `Code` |
| name | yes | `name` | `name` | toUpper | ✓ `Name` | ✓ `Name` |
| description | no | `description` | `description` | toUpper | ✓ `Description` | ✗ **dropped** |
| category | yes | `category` | `category` | toUpper | ✓ `Category` | ✓ `Category` |
| kind | yes (edit=locked) | `kind` | `kind` | enum | ✓ `Kind` | ✓ `Kind` |
| workerRole | yes | `worker_role` | `workerRole` | enum | ✓ `Worker Role` | ✗ **dropped** |
| assignmentMethod | yes | `assignment_method` | `assignmentMethod` | enum | ✓ `Assignment Method` | ✗ **dropped** |
| requiredFormCode | cond. | `required_form_code` | `requiredFormCode` | none | ✓ `Required Form Code` | ✗ **dropped** |
| requiredPhotos | yes | `required_photos` | `requiredPhotos` | int (default 0) | ✓ `Required Photos` | ✗ **dropped** |
| requiredGps | yes | `required_gps` | `requiredGps` | bool | ✓ `Required GPS` | ✗ **dropped** |
| **requiredAttachments** | cond. (KYC ≥1) | `required_attachments` | `requiredAttachments` | array (default `[]`) | ✗ **NO COLUMN** | ✗ **dropped** |
| resultSet | yes | `result_set` | `resultSet` | csv-list | ✓ `Result Set` | ✗ **dropped** |
| reviewRequired | yes | `review_required` | `reviewRequired` | bool | ✓ `Review Required` | ✗ **dropped** |
| billingProfile | yes | `billing_profile` | `billingProfile` | enum | ✓ `Billing Profile` | ✓ `Billing` |
| commissionProfile | yes | `commission_profile` | `commissionProfile` | enum (default NONE) | ✓ `Commission Profile` | ✗ **dropped** |
| reportTemplateType | yes | `report_template_type` | `reportTemplateType` | enum | ✓ `Report Template Type` | ✗ **dropped** |
| reverificationRule | yes | `reverification_rule` | `reverificationRule` | enum | ✓ `Reverification Rule` | ✗ **dropped** |
| piiSensitive | no | `pii_sensitive` | `piiSensitive` | bool | ✓ `PII Sensitive` | ✗ **dropped** |
| sortOrder | no (form-hidden) | `sort_order` | `sortOrder` | int | ✓ `Sort Order` | ✗ **dropped** |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✓ `Effective From` | ✓ `Effective From` |
| (isSystem) | read-only | `is_system` | — | — | — | ✗ |
| (isActive/audit) | auto | … | — | — | — | ✓ `Status`/`Created`/`Updated` |

**Verdict: TWO real gaps.**
- **`requiredAttachments` has no import column** → import always defaults it to `[]`. The KYC_DOCUMENT invariant (`packages/sdk/src/verificationUnit.ts:99-100`) requires `length >= 1`, so **every KYC_DOCUMENT row imported via file fails validation** (`requiredAttachments: "KYC_DOCUMENT requires at least one required attachment"`) with no way for the user to satisfy it from the file. FIELD_VISIT rows import fine. This makes file-import of KYC verification units impossible. → **GAP-VU-1 (P1).**
- **Export drops 14 importable/editable fields** (description, workerRole, assignmentMethod, requiredFormCode, requiredPhotos, requiredGps, requiredAttachments, resultSet, reviewRequired, commissionProfile, reportTemplateType, reverificationRule, piiSensitive, sortOrder). Round-trip (export→re-import) is therefore **lossy by ~14 fields** even though the import side accepts them — a re-imported file silently reverts those to schema defaults. → **GAP-VU-2 (P1).**

### 4. departments — CUSTOM import + CUSTOM export (no `code`; `name` is the identity)

Import: `DEPARTMENT_IMPORT_SPEC` (`modules/departments/service.ts:62-67`, schema = `CreateDepartmentSchema`). Export: `DEPARTMENT_EXPORT_COLUMNS` (`service.ts:47-54`). Web: custom page; ImportButton wired (`DepartmentsPage.tsx:109`).

| field | required? | DB column | SDK Create | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| name | yes | `name` (UNIQUE) | `name` | toUpper | ✓ `Name` | ✓ `Name` |
| description | no (default `''`) | `description` | `description` | toUpper | ✓ `Description` | ✓ `Description` |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✓ `Effective From` | ✓ `Effective From` |
| (isActive/audit) | auto | … | — | — | — | ✓ `Status`/`Created`/`Updated` |

**Verdict: CLEAN** with one weakness — the import spec has **no `uniqueKey`** (`name` is the DB-unique identity but in-file duplicate names are not caught at preview; they fail only at confirm via the 23505 DB error). Minor robustness gap. → **GAP-DEPT-1 (P2).**

### 5. designations — CUSTOM import + CUSTOM export · has a **department FK** that import drops

Import: `DESIGNATION_IMPORT_SPEC` (`modules/designations/service.ts:66-71`, schema = `CreateDesignationSchema`, **no `resolve`**). Export: `DESIGNATION_EXPORT_COLUMNS` (`service.ts:48-56`, 7 cols incl. `departmentName`). Web: custom page; ImportButton wired (`DesignationsPage.tsx:115`).

| field | required? | DB column | SDK Create | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| name | yes | `name` | `name` | toUpper | ✓ `Name` | ✓ `Name` |
| description | no (default `''`) | `description` | `description` | toUpper | ✓ `Description` | ✓ `Description` |
| **departmentId** | no (nullable FK) | `department_id` | `departmentId` (`.nullable().optional()`) | none | ✗ **NO COLUMN / no resolve** | ✗ FK-id not exported (name shown read-only as `Department`) |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✓ `Effective From` | ✓ `Effective From` |
| (isActive/audit) | auto | … | — | — | — | ✓ `Status`/`Created`/`Updated` |

**Verdict: ONE real gap (asymmetric round-trip).** The web form lets you link a designation to a department; export shows the joined **`Department`** name column (`service.ts:50`); but the import spec has **no Department column and no `resolve` department-name/code→id** (intentional per the in-code comment `service.ts:58-59` "Import is FK-free … linked later via the edit dialog"). So export→re-import **silently unlinks every designation from its department** (`departmentId` → null). The user sees a Department column in the exported file, edits other cells, re-imports, and loses all department associations with no warning. → **GAP-DESIG-1 (P1).** Same missing-`uniqueKey` weakness as departments (`name` not declared unique in spec). → **GAP-DESIG-2 (P2).**

---

## Ranked gap list

### P0
*(none)* — no required field is silently dropped by BOTH import and export, no import bypasses the SDK schema, and there is no unguarded money/PII export. The verificationUnits `requiredAttachments` case is loud-fail (validation error), not silent, so it lands at P1.

### P1

**GAP-VU-1 · P1 · verificationUnits · `requiredAttachments` · IMPORT**
`VU_IMPORT_COLUMNS` (`apps/api/src/modules/verificationUnits/service.ts:78-99`) has no `requiredAttachments` column. The KYC_DOCUMENT cross-field invariant requires `requiredAttachments.length >= 1` (`packages/sdk/src/verificationUnit.ts:99-100`), so **every KYC_DOCUMENT row imported from a file fails validation** with no file-side way to supply attachments — file-import of KYC verification units is impossible. (FIELD_VISIT rows are unaffected.)
*Fix sketch:* add `{ id: 'requiredAttachments', header: 'Required Attachments', parse: parseCsvList }` (or a JSON parse) to `VU_IMPORT_COLUMNS` and a matching sample value, so KYC rows can satisfy the invariant. Mirror in the export manifest for round-trip.

**GAP-VU-2 · P1 · verificationUnits · 14 fields · EXPORT (lossy round-trip)**
`VU_EXPORT_COLUMNS` (`apps/api/src/modules/verificationUnits/service.ts:61-71`) emits only 9 columns; it drops description, workerRole, assignmentMethod, requiredFormCode, requiredPhotos, requiredGps, requiredAttachments, resultSet, reviewRequired, commissionProfile, reportTemplateType, reverificationRule, piiSensitive, sortOrder — all of which the IMPORT side accepts. Export→re-import is lossy: dropped fields revert to schema defaults on re-import.
*Fix sketch:* expand `VU_EXPORT_COLUMNS` to mirror the 19 import columns (booleans/enums as strings, `resultSet`/`requiredAttachments` joined). Keeps export↔import symmetric and the round-trip lossless.

**GAP-DESIG-1 · P1 · designations · `departmentId` (department FK) · IMPORT (asymmetric round-trip)**
Export includes a `Department` column (`apps/api/src/modules/designations/service.ts:50`) but the import spec (`service.ts:66-71`) has no Department column and no `resolve` department→id mapping (FK-free by design, `service.ts:58-59`). Export→re-import silently nulls `department_id` for every row — the user-visible Department column in the file cannot be re-imported.
*Fix sketch:* either (a) add a `department` column + a `resolve` that maps department name→id (reusing the engine's FK-resolve pattern, reporting "department not found" as a per-row error), making the round-trip lossless; or (b) if FK-free import is the deliberate contract, **drop `departmentName` from the export manifest** so the exported file no longer advertises a column it cannot round-trip. (a) is preferred for a bulk-update workflow.

### P2

**GAP-DOC-1 · P2 · shared engine · doc-comment · (neither)**
`apps/api/src/platform/import/format.ts:6` says *"XLSX only for now … CSV import is a later follow-up,"* but `parseImportCsv` (`:144-152`) is fully implemented and on the live `parseImportFile` path (`:159-162`). Stale comment only — behavior is correct (both formats accepted). *Fix:* update the comment.

**GAP-DEPT-1 · P2 · departments · `name` · IMPORT (no in-file dedupe)**
`DEPARTMENT_IMPORT_SPEC` (`apps/api/src/modules/departments/service.ts:62-67`) declares no `uniqueKey`, though `name` is the DB-unique identity (`uq_departments_name`). In-file duplicate names aren't caught at preview; they fail only at confirm via the DB 23505. *Fix:* add `uniqueKey: 'name'` to surface duplicates in the preview error file.

**GAP-DESIG-2 · P2 · designations · `name` · IMPORT (no in-file dedupe)**
`DESIGNATION_IMPORT_SPEC` (`apps/api/src/modules/designations/service.ts:66-71`) declares no `uniqueKey`. Same pattern as GAP-DEPT-1. *Fix:* add `uniqueKey: 'name'` (confirm `name` is intended unique for designations).

---

## Wiring/format sanity (all five)

| entity | import wired (web) | xlsx+csv | import schema = SDK Create | export uses escape guard | RBAC drop needed |
|---|---|---|---|---|---|
| clients | ✓ MasterDataCrud | ✓ both | ✓ | ✓ | none |
| products | ✓ MasterDataCrud | ✓ both | ✓ | ✓ | none |
| verificationUnits | ✓ custom page | ✓ both | ✓ | ✓ | none |
| departments | ✓ custom page | ✓ both | ✓ | ✓ | none |
| designations | ✓ custom page | ✓ both | ✓ | ✓ | none |

All five reuse the SDK Create schema on import (ADR-0058 transforms apply), accept both file formats, and route export cells through the CWE-1236 guard. The gaps are coverage-asymmetries (VU/designations), not validation or security bypasses.
