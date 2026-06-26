# Plan — CPV Universal (all-units) mapping + CPV-scoped unit pickers (ADR-0074, mig 0101)

**Owner-directed 2026-06-26, design locked via AskUserQuestion.** Two coupled changes:

- **Issue 1 — Universal CPV.** A CPV mapping (client+product → verification unit) can be **"Universal (all
  units)"**: `client_product_verification_units.verification_unit_id` → NULLABLE, **NULL = all units** (mirrors
  rates/rate_type_assignments). The CPV admin page offers a "Universal (all units)" choice. `availableUnits`
  returns **every active unit** when a Universal CPV exists for the client+product, else the specifically-mapped ones.
- **Issue 2 — CPV-scoped pickers.** The three config unit-pickers (**Rate-Type Assignment, Commission Rates,
  Rate Management**) load **only the CPV-mapped units** for the selected client+product (case creation already
  does). **Keep** each page's existing "Universal (all units)" wildcard option. **No** new server validation.

Branch `feat/cpv-universal` off origin/main `6a46f09`. Next free: **ADR-0074, mig 0101**.

## Issue 1 — Universal CPV
- **db** `0101_cpv_universal.sql`: `ALTER ... DROP NOT NULL verification_unit_id`; DROP `uq_cpvu` + re-ADD as
  **`UNIQUE NULLS NOT DISTINCT (client_product_id, verification_unit_id)`** (PG18, like mig 0096) so one
  Universal NULL row per client_product dedupes. Lock-retry preamble (ALTERs a hot reference table read by
  case-creation during a rolling deploy — mirror 0097/0098). Idempotent.
- **sdk** `cpv.ts`: `CreateCpvSchema.verificationUnitId` → `positiveInt.nullish()` (absent/null = Universal);
  the view's `unitCode`/`unitName` → `string | null`.
- **api** `cpv/repository.ts`: `create` passes `?? null`; `list` LEFT JOINs verification_units (NULL unit row
  survives); FK existence-check skips null.
- **api** the shared CPV resolvers in `cases/repository.ts`:
  - `availableUnits(clientId, productId)` → a unit is available if **a Universal CPV row exists** for the
    client+product OR it is specifically CPV-mapped (Universal ⇒ all active units; else the mapped set).
  - `allUnitsEnabled(clientId, productId, unitIds)` → true if a Universal CPV exists OR every unitId is mapped
    (so task creation accepts any unit under a Universal CPV).
- **web** `CpvPage.tsx` (UnitManager): the add-unit `<select>` gets a "Universal (all units)" option (sentinel
  → POST null); the enabled-units table renders **"Universal"** for the NULL-unit row (like rates).

## Issue 2 — CPV-scoped config pickers
- **api** new `GET /api/v2/cpv-units/available?clientId&productId` (masterdata.view-gated) → the CPV-scoped
  units (the SAME Universal-aware `availableUnits` logic; shared resolver). `/cases/available-units` stays
  CASE_CREATE-gated for the operational picker; the config pages need a masterdata-gated feed.
- **web** RateTypeAssignmentRecordPage, CommissionRateRecordPage, RateRecordPage: when **client + product are
  both specific**, the unit `<select>`'s option list comes from `/cpv-units/available?clientId&productId`
  (CPV-scoped), not `/verification-units/options`. **Keep** the leading "Universal (all units)" wildcard
  option. When product = Universal (NULL) or not chosen, fall back to all units (no single product to scope by).

## TDD
1. `cpv` api test: create a Universal CPV (unitId null → 201, unit null in view, renders "Universal"); the
   `NULLS NOT DISTINCT` unique blocks a 2nd Universal row (409); a Universal + a specific row coexist.
2. `cases` api test (the critical resolver): `availableUnits` returns ALL active units when a Universal CPV
   exists, else only the mapped ones; `allUnitsEnabled`/task-create accepts any unit under a Universal CPV but
   rejects an unmapped unit without one.
3. `GET /cpv-units/available` returns the CPV-scoped units + is masterdata.view-gated (403/401).

## Verify
Full `pnpm verify` GREEN. Apply 0101 to crm2_dev; browser-verify: map a Universal CPV on `/admin/cpv` (renders
"Universal"); the three config pages' unit pickers show only the mapped units for a chosen client+product (and
all units when the CPV is Universal). Adversarial review: no money-path/resolution regression; the Universal
wildcard option still works.
