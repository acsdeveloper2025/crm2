# A3 — Excel/CSV Import & Export FIELD COVERAGE audit: rates · commissionRates · rateTypes

**Date:** 2026-06-22 · **Scope:** money-bearing, dimensionally-complex rate entities · **Mode:** READ-ONLY (no source edited)

**Engines:** export `apps/api/src/platform/export/format.ts` (`ExportColumn`, `toCsv`, `toXlsx`, `escapeCsvCell`, `neutralizeFormula`) + `export/index.ts` (`resolveExport` defaults `xlsx`, `csv` selectable; `selectColumns` filters by manifest id). Import `apps/api/src/platform/import/index.ts` (`ImportSpec{columns,schema,uniqueKey,sample,resolve}`; `resolve` runs in BOTH preview & confirm; confirm calls the audited per-row `service.create`).

**Shared verdicts (all three entities):**
- (i) **Both .xlsx & .csv:** YES for export (engine-level, `resolveExport`). Import template is XLSX-only by design (`buildTemplate`→`buildImportTemplate`); parser `parseImportFile` accepts xlsx/csv uploads.
- (vi) **Escaping:** YES, centralized. `escapeCsvCell` does CWE-1236 formula-neutralize + RFC-4180 quote on EVERY string cell; `toXlsx` runs `neutralizeFormula` on every string cell. No per-column opt-out. PASS for all string columns in both manifests.
- (ii) **Import schema reuses SDK Create schema:** PARTIAL by design (see notes). Import uses a separate **file-shape** zod (`*ImportFileSchema`) for the spreadsheet row (codes, not ids), and the numeric-id `Create*Schema` is enforced downstream in `service.create` (`CreateRateSchema.parse` / `CreateCommissionRateSchema.parse`). So the authoritative SDK validation IS NOT bypassed on confirm — but the file-shape schema **diverges** from the SDK on a few constraints (gap CR-P0-2, RT-P1-1 below).

---

## Entity 1 — rates (`apps/api/src/modules/rates/*`, SDK `packages/sdk/src/rates.ts`)

Routes: read `MASTERDATA_VIEW`; write/import `MASTERDATA_MANAGE`; **export `DATA_EXPORT`**. The rate **amount is a billing rate-card price** (client-facing), not compensation — `DATA_EXPORT` gate is acceptable.

### Field matrix

| field | required? | DB column | SDK Create field | transform | IMPORT (header) | EXPORT (header) |
|---|---|---|---|---|---|---|
| clientId (via clientCode) | yes | `client_id` | `clientId` | code→id (resolve) | ✓ `Client Code` | ✓ `Client` (clientCode) |
| productId (via productCode) | yes | `product_id` | `productId` | code→id | ✓ `Product Code` | ✓ `Product` (productCode) |
| verificationUnitId (via unitCode) | yes | `verification_unit_id` | `verificationUnitId` | code→id | ✓ `Unit Code` | ✓ `Verification Unit` (unitName) |
| unitKind | derived | (`vu.kind`) | — | none | ✗ (derived from unit) | ✓ `Kind` |
| locationId (via pincode+area) | no | `location_id` | `locationId` | pincode+area→id | ✓ `Pincode`+`Area` | ✓ `Pincode`,`Area` (split) |
| clientRateType | no | `client_rate_type` | `clientRateType` | free-text (NOT toUpper) | ✓ `Rate Type` | ✓ `Rate Type` |
| amount | yes | `amount` numeric(10,2) | `amount` | decimal | ✓ `Amount` (parseNumber) | ✓ `Rate` |
| currency | no (dflt INR) | `currency` | `currency` | 3-letter code | ✓ `Currency` | **✗ DROPPED** |
| effectiveFrom | no (dflt now) | `effective_from` | `effectiveFrom` | ISO date | ✓ `Effective From` (parseIsoDate) | ✓ `Effective From` |
| effectiveTo | derived | `effective_to` | — | — | ✗ (revise-managed) | **✗ DROPPED** |
| version (OCC) | system | `version` | — | int | ✗ | **✗ DROPPED** |
| isActive | system | `is_active` | — | bool | ✗ | ✓ `Status` (Active/Inactive) |
| createdAt/updatedAt | system | `created_at`/`updated_at` | — | date | ✗ | ✓ `Created`/`Updated` |

### Notes
- (iii) Every required add/edit dimension (client+product+unit codes, amount) is **importable AND exportable**. PASS. client_rate_type + location both round-trip. PASS.
- (iv) effective-from importable+exportable. **version/OCC NOT exported** → an exported rate can't be re-imported as an idempotent update (import is create-only anyway; no update-by-import path exists). For a **create-only** import this is acceptable; round-trip is "re-create", not "patch". `effective_to` not exported → superseded-row export (`history=true`) loses the end-date window. P1.
- (v) Money export RBAC: rate amount exported under `DATA_EXPORT`. Acceptable (rate card ≠ compensation).
- (vii) Round-trip: export→import is NOT lossless — **currency is dropped on export** (RT-P1-2) so an export of non-INR rates re-imports as INR.

---

## Entity 2 — commissionRates (`apps/api/src/modules/commissionRates/*`, SDK `packages/sdk/src/commissionRates.ts`)

Routes: **EVERY route (list, export, import, create) gates `MASTERDATA_MANAGE` (SUPER_ADMIN)** — commission amounts are compensation. Export is intentionally NOT `DATA_EXPORT` (routes.ts comment: a data.export-only role must not exfiltrate comp data). **(v) Money-export RBAC: PASS** — strongest gate, correct by design.

### Field matrix

| field | required? | DB column | SDK Create field | transform | IMPORT (header) | EXPORT (header) |
|---|---|---|---|---|---|---|
| userId (via username) | yes | `user_id` | `userId` (uuid) | username→id | ✓ `Username` | ✓ `User` (userName) |
| fieldRateType | yes | `field_rate_type` | `fieldRateType` enum LOCAL/OGL/OFFICE | enum (NOT toUpper) | ✓ `Rate Type` | ✓ `Rate Type` |
| clientId (via clientCode) | no (Universal) | `client_id` | `clientId` | code→id | ✓ `Client Code` | ✓ `Client` (or "Universal") |
| locationId (via pincode+area) | **yes for LOCAL/OGL**, no for OFFICE | `location_id` | `locationId` | pincode+area→id | ✓ `Location Pincode`+`Area` | **✗ DROPPED** (pincode/area not in manifest) |
| productId (via productCode) | no (Universal) | `product_id` | `productId` | code→id | ✓ `Product Code` | **✗ DROPPED** |
| verificationUnitId (via unitCode) | no (Universal) | `verification_unit_id` | `verificationUnitId` | code→id | ✓ `Unit Code` | **✗ DROPPED** |
| tatBand | no (Universal) | `tat_band` | `tatBand` int (incl -1) | int (parseInteger) | ✓ `TAT Band` | **✗ DROPPED** |
| amount | yes | `amount` numeric(12,2) | `amount` | decimal | ✓ `Amount` (parseNumber) | ✓ `Amount` |
| currency | no (dflt INR) | `currency` | `currency` | 3-letter | ✓ `Currency` | **✗ DROPPED** |
| effectiveFrom | no (dflt now) | `effective_from` | `effectiveFrom` | ISO date | ✓ `Effective From` | ✓ `Effective From` |
| effectiveTo | derived | `effective_to` | — | — | ✗ | ✗ |
| version (OCC) | system | `version` | — | int | ✗ | ✗ |
| isActive | system | `is_active` | — | bool | ✗ | ✓ `Status` |
| createdAt/updatedAt | system | | — | date | ✗ | ✓ `Created`/`Updated` |

### Notes — the central finding
- (iii) **EXPORT DROPS FOUR resolution dimensions that IMPORT and the DataGrid carry:** `location` (pincode/area — **a REQUIRED key for LOCAL/OGL rows**), `product`, `verificationUnit`, `tatBand`. The FE DataGrid (`CommissionRatesPage.tsx` columns `product`/`verificationUnit`/`location`/`tatBand`, lines 344–381) shows all four; the import template (`COMMISSION_RATE_IMPORT_COLUMNS`) accepts all four; but `COMMISSION_RATE_EXPORT_COLUMNS` (`service.ts:50–59`) has only `user, client, fieldRateType, amount, status, effectiveFrom, createdAt, updatedAt`. **An export collapses every dimensioned commission line to user+client+type+amount — two distinct rows (e.g. same user/client/type, different location or TAT band, different amount) export as visually identical/ambiguous rows, and the export cannot be round-tripped back through import.** This is the headline P0.
- (iv) effective-from exported; **version/OCC not exported** (create-only import → acceptable, same as rates).
- (vii) Round-trip: NOT lossless and **NOT reconstructable** — dropped required `location` means an exported LOCAL/OGL set can't be re-imported at all (the import would reject for missing location, or silently create a different Universal-location row).
- (ii) Import file-schema divergence: SDK `CreateCommissionRateSchema` has a `.refine` enforcing `locationId` required unless `fieldRateType==='OFFICE'`. The import **file** schema makes pincode/area optional and re-implements that rule manually in `resolve` (`import.ts:141–145`). Functionally equivalent today, but it's a **parallel validation** that can drift from the SDK refine (CR-P0-2 is the export half; this is a latent maintenance risk, P2).

---

## Entity 3 — rateTypes (`apps/api/src/modules/rateTypes/*`, SDK `packages/sdk/src/rateTypes.ts`)

**Read-only lookup.** Routes = `GET /` only (`MASTERDATA_VIEW`). No create/update/delete, **no import, no export** anywhere. Service = `list(activeOnly)`. Fields: `code`, `sortOrder`, `isActive`, `effectiveFrom`.

### Field matrix

| field | required? | DB column | SDK Create field | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| code | yes | `code` | (no Create schema) | — | ✗ | ✗ |
| sortOrder | yes | `sort_order` | — | — | ✗ | ✗ |
| isActive | yes | `is_active` | — | — | ✗ | ✗ |
| effectiveFrom | yes | `effective_from` | — | — | ✗ | ✗ |

### Notes
- No add/edit surface exists (managed via migration/seed only), so "import OR export drops an add/edit field" cannot trigger a P0. The total absence of import/export is **consistent with the entity being a read-only seeded lookup** — flagged P2 (consistency), not a coverage gap. The `rates` import's `Rate Type` column is **free-text `client_rate_type`**, NOT a FK to `rate_types` (rates SDK comment + repo confirm `client_rate_type` is a free string snapshot), so rateTypes has no import dependency to round-trip.

---

## Ranked gap list

| id | pri | entity | field | side | file:line | fix sketch |
|---|---|---|---|---|---|---|
| **CR-P0-1** | **P0** | commissionRates | location (pincode/area) — **required key for LOCAL/OGL** | EXPORT | `commissionRates/service.ts:50–59` (`COMMISSION_RATE_EXPORT_COLUMNS`) | Add `{id:'location'…}` or split `{id:'pincode'},{id:'area'}` export columns reading `r.pincode`/`r.area` (already on `CommissionRateView`). Required dimension currently un-exportable → export not round-trippable and visually ambiguous. |
| **CR-P0-2** | **P0** | commissionRates | productId, verificationUnitId, tatBand (Universal-able resolution dims) | EXPORT | `commissionRates/service.ts:50–59` | Add `product` (productCode/productName), `verificationUnit` (verificationUnitName), `tatBand` columns to the manifest (all already on the view + the FE DataGrid + the import). Without them two differently-dimensioned rows export identically and can't be re-imported. |
| **CR-P1-1** | P1 | commissionRates | currency | EXPORT | `commissionRates/service.ts:50–59` | Add `{id:'currency', value:(r)=>r.currency}`. Import accepts `Currency`; export drops it → non-INR comp rates re-import as INR. |
| **RT-P1-2** | P1 | rates | currency | EXPORT | `rates/service.ts:66–79` (`RATE_EXPORT_COLUMNS`) | Add a `Currency` export column. Import has `Currency`; export omits it → non-INR rate cards not round-trippable. |
| **RT-P1-3** | P1 | rates | effectiveTo (history rows) | EXPORT | `rates/service.ts:66–79` | When `history=true` exports superseded versions, `effective_to` is dropped so the validity window is lost. Add an `Effective To` column (value `r.effectiveTo`). Same applies to commission history. |
| **CR-P2-1** | P2 | commissionRates | locationId required-rule | IMPORT validation | `commissionRates/import.ts:141–145` vs SDK `commissionRates.ts:95–98` | Import file-schema re-implements the SDK `.refine` (location required unless OFFICE) by hand in `resolve`; risk of drift from the canonical SDK rule. Consider asserting the resolved input through `CreateCommissionRateSchema` once before `create` (it already is, in `service.create`) and dropping the manual duplicate, or unit-test parity. |
| **RT-P2-2** | P2 | rates | currency import constraint not from SDK | IMPORT schema | `rates/import.ts:24` | File-schema `currency: z.string().length(3)` mirrors SDK by hand; if SDK currency constraint changes it won't track. Low risk; note for parity. |
| **RT-P2-3** | P2 | rateTypes | whole entity | IMPORT+EXPORT | `rateTypes/*` | No import/export at all. Consistent with read-only seeded lookup; flag only for completeness — add export if admins ever need the list off-platform. No action required. |
| **RT-P2-4** | P2 | rates / commissionRates | version (OCC) | EXPORT | both manifests | OCC token not exported; acceptable because import is create-only (no update-by-import). Documented as a deliberate non-goal, not a fix. |

**No P0 found for:** money-export RBAC (commissionRates correctly SA-only `MASTERDATA_MANAGE`; rates `DATA_EXPORT` acceptable for client rate-card); escaping (centralized, applied to all string cells, both formats); import bypassing SDK on a required field (confirm always runs `service.create` → `Create*Schema.parse`).

## Summary counts
- **rates:** P0 = 0 · P1 = 2 (RT-P1-2 currency, RT-P1-3 effectiveTo) · P2 = 2
- **commissionRates:** P0 = 2 (CR-P0-1 location, CR-P0-2 product/unit/tatBand) · P1 = 1 (currency) · P2 = 1
- **rateTypes:** P0 = 0 · P1 = 0 · P2 = 1 (no import/export, by design)
- **TOTAL: P0 = 2 · P1 = 3 · P2 = 4**
