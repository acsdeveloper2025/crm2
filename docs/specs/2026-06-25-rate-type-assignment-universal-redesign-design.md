# Rate Type Assignment — Universal + v2-table redesign (design spec)

- **Date:** 2026-06-25
- **Status:** Design — owner-approved shape (2026-06-25). Amends **ADR-0067** (Phase B assignment layer, LIVE on prod). New record: **ADR-0069**, migration **0096** (verify next-free vs origin/main at build).
- **Owner feedback (2026-06-25):** the live `/admin/rate-type-assignments` page "does not follow the standard design of v2"; the rate-type selection should sit **beside the verification unit**; show a **table**; add a **Universal (all)** option for **product** and **verification unit**; flow = pick **client**, then optionally Universal product + Universal unit.

## 1. Decisions (owner-approved)
1. **Per-unit table** (owner-picked): rows = verification units, with the rate-type selection inline beside each unit.
2. **Client required; Product + Verification Unit are Universal-able.** Universal = "applies to all."
3. **Universal is stored as NULL, rendered as the word "Universal" in the UI** (Option A — CTO decision). This matches the **live `commission_rates` model** (ADR-0050/0046: client/product/unit/tat_band nullable = Universal; `commissionRates/service.ts` already renders the literal `'Universal'` for NULL dims). The user never sees NULL. Rejected: a stored boolean/sentinel marker (B/C) — it still needs a NULL FK id (you can't FK to "all"), is redundant, can drift into contradiction, and (C) would mean rewriting the live money path (COMMISSION_LATERAL/EXCLUDE/derive) for zero functional gain.
4. **Availability = union-with-wildcards** (not most-specific-wins): a combo `(client, product, unit)` gets every rate type assigned to it **or** to any Universal parent. (Availability is a *set*; most-specific-wins is for single-value money resolution.)
5. **All active verification units** are shown as rows (searchable table); **one Save button** for the whole table.

## 2. Data model — migration 0096 (amends Phase B's `rate_type_assignments`, mig 0093)
- `ALTER TABLE rate_type_assignments ALTER COLUMN product_id DROP NOT NULL; ALTER COLUMN verification_unit_id DROP NOT NULL;` (`client_id` stays NOT NULL). NULL = Universal.
- Replace `uq_rate_type_assignment` with **`UNIQUE NULLS NOT DISTINCT (client_id, product_id, verification_unit_id, rate_type_id)`** (PG18) so a Universal (NULL) row is a single value — otherwise `ON CONFLICT` can't dedupe Universal upserts (default NULLS DISTINCT lets duplicate NULL rows in). Drop+re-add guarded; idempotent + re-run-safe; extend `migrations.rerun.test.ts`.
- Existing rows are all non-NULL → unaffected. The partial index `idx_rta_combo` is NULL-tolerant (used for lookup).

## 3. API (additive / modified `/api/v2`)
- **SDK `BulkSetRateTypeAssignmentsSchema`:** `productId` + `verificationUnitId` become **nullable** (`posInt.nullable()`; null/omitted = Universal). `rateTypeIds` unchanged.
- **`bulkSet` (repository):** upsert keyed on the NULLS-NOT-DISTINCT constraint; the complement-deactivate WHERE matches the same combo incl. NULLs (`product_id IS NOT DISTINCT FROM $2`, `verification_unit_id IS NOT DISTINCT FROM $3`).
- **`GET /rate-type-assignments?clientId&productId`** (productId nullable): returns the active assignments for that client+product across all units (incl. the Universal-unit rows), joined to `rate_types` code/name — the page maps them onto unit rows (NULL unit → the "All units" row).
- **`GET /rate-types/available?clientId&productId&verificationUnitId`** (the resolver Phase C wires into Rate Management): change from exact-match to **union-with-wildcards** — `WHERE client_id=$1 AND (product_id IS NULL OR product_id=$2) AND (verification_unit_id IS NULL OR verification_unit_id=$3) AND a.is_active AND rt.is_active AND rt.effective_from<=now()` → `DISTINCT` rate types, ordered by sort_order/code. (Billing stays display-only; this only widens the picker's available set.)
- OpenAPI regen + contract test. RBAC unchanged (view `page.masterdata`; manage `masterdata.manage`; `available` = `authorizeAny(MASTERDATA_VIEW, CASE_CREATE)`).

## 4. Web — `/admin/rate-type-assignments` (v2-styled per-unit table)
- **Header:** Client `<select>` (required) + Product `<select>` whose first option is **"All products (Universal)"** (→ productId = null). Both via `/options`.
- **Table** (v2 tokens + management-list look; bespoke, since a multi-value cell isn't the single-value DataGrid): a search box; first row **"All verification units (Universal)"** (→ unit = null); then a row per active verification unit. Each row: the unit's `code — name` + an **inline rate-type multi-select** (chips of the active catalog via `rateTypes.list()`/`/options`, pre-filled with that row's current assigned set from the `GET ?clientId&productId` load). A row with no rate types shows "(none)".
- **Save:** one button; for each row whose set changed, `POST /rate-type-assignments/bulk { clientId, productId|null, verificationUnitId|null, rateTypeIds }` (reuses Phase B's endpoint). On success invalidate + a brief "Saved" confirmation.
- RBAC self-guard (`page.masterdata`); loading/empty/error states (Hexagon + Retry); tokens only; no `any`/suppressions.
- **"Universal" is always shown as the word** — in the product option, the "All units" row, and any place a NULL dim would render.

## 5. Resolution / billing (PRESERVED)
- Billing + commission resolution unchanged. The only resolver touched is `available` (the picker gate), which becomes union-with-wildcards. Commission's own Universal model (NULL) is **not** changed (Option A keeps the two consistent).

## 6. Governance & sequencing
- **ADR-0069** amends ADR-0067 (owner-directed change to a frozen-area model; owner = domain owner + CTO sign-off).
- The `available` change **layers on the unpushed Phase C** version (which made it exact-match). Sequence with the owner at build: either bundle onto the Phase C branch, or push C first then branch this off the new origin/main.

## 7. Invariants / DON'T-REGRESS
- Money path (billing/commission resolution, COMMISSION_LATERAL, EXCLUDEs) UNCHANGED. Existing assignments stay valid (all non-NULL). Mobile/SDK string contracts unchanged. Migration idempotent + re-run-safe (`migrations.rerun.test` green; the NULLS-NOT-DISTINCT swap is the load-bearing re-run item). Universal rendered as "Universal" everywhere (never NULL). `available` is now a *union* — confirm it only widens (never narrows) the picker.

## 8. Verification (at build)
Per-phase: `pnpm verify` (api integration on `:5433`) + the 3× `migrations.rerun.test` + full Playwright e2e + browser-verify on `crm2_dev` (assign a Universal-product + a Universal-unit row, confirm the union resolves at the Rate-Management picker, confirm the table shows "Universal"). Disposition in `docs/COMPLIANCE_GAPS_REGISTRY.md`.
