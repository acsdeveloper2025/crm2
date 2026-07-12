# Rate multi-location bulk add — build plan (2026-07-11)

**Owner sign-off (2026-07-11):** Option **A** (clone the commission pattern) + **impose one-rate-type-per-location** (mirror commission's `HAS_OTHER_RATE_TYPE`). Audit gate cleared.

Clone target = the commission multi-location entry (LIVE prod `ec2d071`). Governance: **additive — no migration, no ADR** (`rates_no_overlap` mig 0098 already keys `COALESCE(location_id,-1)`; `RATE_LATERAL` unchanged; CPV/commission-bulk precedent). Next mig stays 0117, next ADR stays 0093.

## Key difference from commission (do NOT copy blindly)
- A rate has **no user** → the fan-out axis is **location**, drawn from the **full location catalog** (pincode-search → area chips) — the same lookups `RateRecordPage` uses today (`GET /locations/pincodes?q=`, `GET /locations?pincode=`). **No territory, no CPV scoping.**
- `rate_type` is an **FK to `rate_types`** and is **display-only in resolution** (ADR-0050 — location most-specific-wins; rate_type is NOT a WHERE/ORDER key). Bulk create is therefore pure ergonomics.
- **Nullable dims:** product/unit/rate_type are all nullable (Universal / KYC). The one-type guard must COALESCE sentinels exactly like the overlap key.

## The one-type rule (owner: impose it)
**One active rate_type per `(client, COALESCE(product,-1), COALESCE(unit,-1), location)`.** A *different* rate_type at the same slot is rejected: single/import → `409 HAS_OTHER_RATE_TYPE`; bulk → per-row `ERROR`. Guard **all NEW-save paths**: single `create`, `bulk` (per-row), import (same create path), **and reactivation** (`setActive(true)` — the commission hole: Deactivate LOCAL → add OGL → Activate old LOCAL must 409). Revise carries type forward (safe). Same location + **same** rate_type that already overlaps = `EXISTS` skip (never overwrite). App-layer guard only; payout resolution + legacy rows untouched.
> Assumption to confirm at review: slot granularity = full non-rate-type overlap key `(client, product, unit, location)`. Faithful analog of commission's `(user, pincode, area)`.

## Slices (per-task review gate; full `pnpm verify` at the end)

### Slice 1 — Backend `POST /api/v2/rates/bulk` + one-type guard + SDK
- **SDK** `packages/sdk/src/rates.ts`: add `BulkCreateRateSchema` (pick-once fields + `locationIds: number[]` min 1, max `MAX_BULK_LOCATIONS=500`) + `BulkRateResult` (`{results:[{locationId,status:CREATED|EXISTS|ERROR,code?}],createdCount,existsCount,errorCount}`). Mirror `commissionRates.ts`.
- **Repo** `rates/repository.ts`: `bulkCreate(input, locationIds, userId)` — one `withTransaction`, **SAVEPOINT-per-row**, `23P01→EXISTS`, `23503→ERROR/INVALID_REFERENCE`; per-row one-type pre-check → `ERROR/HAS_OTHER_RATE_TYPE`. Add `otherTypeAtLocations(...)`. Add one-type guard to single `create` + to `setActive(true)`.
- **Service/controller/routes**: `bulkCreate` wiring; `POST /bulk` gated `MASTERDATA_MANAGE`; one-type guard on `create` (409) + activate.
- **Import** `rates/import.ts`: per-row create already surfaces `AppError` → row error; verify `HAS_OTHER_RATE_TYPE` + `RATE_EXISTS` both reported.
- Tests: extend `rates.api.test.ts`. Regen `pnpm openapi`.

### Slice 2 — Web `RateCreatePage` (merged single+multi)
- Extract create branch from `RateRecordPage` → new `RateCreatePage.tsx`; leave `RateRecordPage` **revise-only**. Route `/admin/rates/new`→Create, `/:id`→Record.
- Step cards · pick-once grid · **pincode→area chip tick-list** (grouped per pincode, Select-all) with **existing-rate hints** (red untickable = different type at slot; amber = same-type EXISTS skip) · sticky bar (count + money echo) · **result rows** styled like the list (Client·Product·Unit·Pincode·Area·RateType·Rate·EffectiveFrom·Status) · toasts + inline `role=alert` · per-page `friendlyError`.
- Tests: `RateCreatePage.test.ts` (export-style, no RTL).

### Slice 3 — Import template polish
- Add `sampleRows` (one per shape: product+location, Universal blank product/unit, KYC no-rate-type, no-location) + `templateNotes` (required cols · **both Pincode+Area or neither** · currency=3 letters · ISO Effective From · codes not names) to the rate `ImportSpec`. Reference = `scopeAssignments/service.ts` (NOT commission — same gap). Tidy stale export comment `service.ts:71`.

### Slice 4 — Review + verify ✅ DONE (2026-07-12, push pending)
- 6-lens adversarial review (CEO/CTO/design/security/standards/logicality) → **7 fixed, 3 by-design**
  (dispositions: `docs/COMPLIANCE_GAPS_REGISTRY.md` §rate-bulk-2026-07-12). Key fix: MAJOR one-type
  guard was NULL-blind → `otherTypeAtSlot` now `IS DISTINCT FROM` and runs for every located save
  (typeless↔typed both block); unknown rate-type code → 400; bulk-activate `RATE_EXISTS`→CONFLICT;
  Notes lists FIELD codes only; area limit 200→500 + truncation note; dead Select-all guarded;
  `toggleFriendlyError` tested.
- `pnpm verify` green; rates api 68 / web rateManagement 25 / SDK smoke 149. Browser-verified on
  crm2_dev (:5273 / :4000, admin/admin123): full bulk + skip + red-block + reactivation-block +
  typeless-plant 409 + unknown-code 400 + office single. **STOP for push OK.**

## Don't-regress
- Bulk = pure ergonomics — N rows differing only by `location_id`; `EXISTS`=skip, never overwrite; `RATE_LATERAL` untouched.
- RBAC gating on the list is **already complete** — verify-only, don't rebuild.
- Import engine (partial-success, CSV+XLSX sniff, streaming export, shared `ImportModal`) is healthy — only template content changes.
