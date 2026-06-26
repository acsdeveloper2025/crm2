# Plan — Rate Management: Universal product + Universal verification unit (ADR-0071, mig 0098)

**Owner-directed 2026-06-26.** Rates must support a **Universal product** and/or **Universal verification
unit** — a single rate that applies to *all products* / *all units* of a client — exactly like
`rate_type_assignments` (ADR-0069) and `commission_rates` (ADR-0050). NULL = Universal, rendered the word
"Universal" in the UI.

Branch `feat/rate-universal` off `origin/main` (`3dd4aee`). Next free: **ADR-0071, migration 0098**.

## Locked design (owner)
- `rates.product_id` + `rates.verification_unit_id` → **NULLABLE** (NULL = Universal).
- `rates_no_overlap` EXCLUDE COALESCEs both to `-1` (mirrors the existing `COALESCE(location_id,-1)` term
  and the commission_rates dimensions pattern in mig 0079/0094). So a Universal row and a specific row
  coexist; two Universal rows for the same client/location/type/period collide → 409.
- **Billing resolver wildcards product/unit, MOST-SPECIFIC WINS** (exact > Universal), mirroring
  `commission_rates`: `(col IS NULL OR col = task.col)` + `col DESC NULLS LAST` *before* the location rank.
  Dimension specificity outranks location specificity (the commission_rates contract).
- Product + Verification Unit dropdowns gain a "Universal (all)" option (NULL stored). List renders "Universal".

## Resolver sites (billing correctness — the critical surface)
`git grep "FROM rates"` → exactly three resolution sites read product/unit:
1. **`apps/api/src/platform/billing/laterals.ts` `RATE_LATERAL`** — the bill-AMOUNT lateral, shared by the
   billing read-model, the tasks read-model (`BILLING_AMOUNT_COLS`), and `mis/resolver.ts`. **THE critical one.**
2. **`apps/api/src/modules/cases/repository.ts` `TASK_VIEW_COLS`** (~261) — `client_rate_type` label subquery.
3. **`apps/api/src/modules/cases/repository.ts` `ratePreview`** (~537) — task-creation rate-type preview.

Each: `r.product_id = X` → `(r.product_id IS NULL OR r.product_id = X)` (same for unit), and prepend
`r.product_id DESC NULLS LAST, r.verification_unit_id DESC NULLS LAST` to the ORDER BY, ahead of the
existing location CASE rank. **No-op for existing all-specific data** (all matched rows share one product/unit
→ the new ORDER BY terms are constant) → billing byte-identical; only Universal fallback rows change anything.

The `EXISTS(SELECT 1 FROM rates WHERE product_id=$1)` delete-guards in clients/products/verificationUnits
repos are **unaffected** (a Universal rate has NULL there, so it correctly doesn't block a specific delete).

## Files
- **db**: `db/v2/migrations/0098_rate_universal_product_unit.sql` — DROP NOT NULL on product_id +
  verification_unit_id; DROP + re-ADD `rates_no_overlap` with `COALESCE(product_id,-1)` +
  `COALESCE(verification_unit_id,-1)`. Tracked runner ⇒ applies **once**; guard the ADD with the standard
  `IF NOT EXISTS pg_constraint` DO-block (house idiom, survives the 3× rerun-test). `idx_rates_resolve`
  unchanged (btree indexes NULLs fine).
- **sdk** `packages/sdk/src/rates.ts`: `Rate.productId`/`verificationUnitId` → `number | null`;
  `RateView.productCode/productName/unitCode/unitName` → `string | null`;
  `CreateRateSchema.productId`/`verificationUnitId` → `positiveInt.nullish()` (absent/null = Universal).
- **api repo** `modules/rates/repository.ts`: `RATE_FROM` `JOIN products`/`JOIN verification_units` →
  **LEFT JOIN** (else a NULL dim drops the row from list/view); `create`/`revise` pass `?? null`;
  `history()` key-match adds `COALESCE(product_id,-1)`/`COALESCE(verification_unit_id,-1)` (NULL≠NULL else).
- **api resolver**: `platform/billing/laterals.ts` + `modules/cases/repository.ts` (2 sites) — wildcard as above.
- **web** `RateRecordPage.tsx`: product + unit SearchableSelect get a `Universal (all)` option (sentinel
  `'UNIVERSAL'` → POST null). `comboReady` treats Universal as a made selection. Rate-type labels: when both
  dims specific → `/rate-types/available` (today); when either is Universal → `/rate-types/options` (all
  usable — the assignment combo doesn't apply). Validation payload mirrors the POST (Universal → null).
- **web** `RateManagementPage.tsx`: product cell `r.productCode ?? 'Universal'`; unit cell
  `r.unitName ?? 'Universal'`.

Out of scope (don't touch): the `available` endpoint contract (stays required-3-dims); import/export Universal
support (CODE columns can't express Universal cleanly — leave specific-only, no regression).

## TDD (strict — billing resolver first)
1. `modules/rates/__tests__/rates.api.test.ts`:
   - create with product null → 201, row.productId null; unit null → null; both null → null.
   - no-overlap: two both-Universal rows (client/loc/type/period equal) → 409; a specific + a Universal coexist (201/201).
   - list/view returns null product/unit + `productCode`/`unitName` null (LEFT JOIN proves the row survives).
2. `modules/billing/__tests__/billing.commission.test.ts` (or rates.api): **most-specific resolution, both directions**
   - SPECIFIC (C,P1,U1,L1,₹500) + UNIVERSAL-product (C,NULL,U1,L1,₹100):
     task@(P1,U1,L1) bills ₹500 (specific wins — *don't regress exact*); task@(P2,U1,L1) bills ₹100 (Universal fallback).
   - UNIVERSAL-unit fallback symmetric.
   - **dimension > location**: (C,P1,U1,loc NULL,₹500) + (C,NULL,U1,loc L1,₹100), task@(P1,U1,L1) → ₹500
     (product-specific outranks location-specific). Proves the ORDER BY priority.
   - `client_rate_type` label resolves through a Universal rate on the case-task view.

## Verify
Full `pnpm verify` GREEN on crm2_test. Apply 0098 to crm2_dev (`sh db/v2/migrate.sh`, empty SEED_DIR).
Browser-verify (Playwright .mjs in apps/web/): create a Universal-product rate → list shows "Universal";
a specific rate still wins billing over a Universal one (proven by test, spot-checked in UI).

## Adversarial review before commit
Billing lens: a SPECIFIC rate must NEVER be overridden by a Universal one (most-specific holds in every
direction); no double-count; existing all-specific billing unchanged. Security lens: NULL dims don't widen
any scope/RBAC; delete-guards intact.
