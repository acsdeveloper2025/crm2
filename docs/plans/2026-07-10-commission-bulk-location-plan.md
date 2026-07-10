# Commission multi-location bulk entry — build plan (2026-07-10)

**Owner-confirmed feature.** Add commission rates for **one field agent** across **many of their
assigned pincode/area locations** in a single save — set the rate once, fan it across the agent's
territory, one commission-rate row per (pincode, area). Pure data-entry ergonomics: no change to
storage or payout resolution (ADR-0050 untouched).

Audit + design sign-off trail: this session's audit (create path, no-overlap key, payout lateral,
bulk precedents, `user_scope_assignments` territory) + the interactive mockup
(`https://claude.ai/code/artifact/19a68556-196c-4727-807c-b29ddd7d2802`).

## Confirmed spec

**Pick once (one value each, applied to every row):** Field User (one, **FIELD_AGENT only**) ·
Client (Universal-able) · Product (Universal-able) · Verification Unit (Universal-able) · **Rate
Type (one, FIELD)** · TAT Band (Universal-able) · **Amount (one)** · Effective-From (one date).
Field order mirrors the single form.

**Pick many:** the field agent's **assigned pincodes/areas** (`user_scope_assignments`, PINCODE =
all areas / AREA = one). The picker shows ONLY the user's territory — no full-catalog search.

**Save once →** one row per selected location. Overlaps (`23P01` → `COMMISSION_RATE_EXISTS`) are
**skipped and reported per-row, never overwritten** (partial success). Result: "N created, M
skipped (already exist)".

**Revise** stays single-row (existing flow, keys locked, amount+effective editable). Bulk-created
rows are ordinary commission rates.

## Governance (confirmed by audit)

- **No migration** — `commission_rates_no_overlap` already keys on `COALESCE(location_id,-1)`; N
  distinct-location rows coexist. Next mig stays **0117**.
- **No ADR** — bulk-action parity is free/additive under existing standards (CPV bulk `cdc3fad`
  UX-6, RTA bulk `d25ff11` UX-11 shipped without ADRs). ADR-0050 resolution untouched. Next ADR
  stays **0093**.
- `/api/v2` additive-only; mobile is not a consumer of `/commission-rates` (web-only). Never break
  mobile.
- Territory read exposes a field agent's covered pincodes/areas to `masterdata.manage` holders
  (operational config, not PII; same audience that already manages commission comp data).

## Non-goals

KYC-verifier location-based commission (they're office/location-less on the single form) · bulk
revise · bulk deactivate · Rate-Management multi-location (note only) · touching import or the
onboarding workbook (already row-per-line).

## Slices (dependency order; each: TDD → per-task review → `pnpm verify` green → browser-verify)

### Slice A — Territory read (API + SDK) [foundation]
The picker's data source. Reuse the assignee-pool resolution SQL (`user_scope_assignments.entity_id
= locations.id`, dims PINCODE/AREA, `is_active`).
- **API** `apps/api/src/modules/commissionRates/`: new lookup `GET
  /api/v2/commission-rates/lookups/territory?userId=<uuid>` gated `masterdata.manage`, returns the
  user's covered `Location[]` (id, pincode, area, city), ordered pincode/area. Repository
  `coveredLocationsForUser(userId)`; service passes through; route declared before `/:id`.
- **SDK** `packages/sdk/src/commissionRates.ts` + `client.ts`: `commissionRates.territory(userId)`
  → `Location[]` (reuse the existing `Location` type from locations SDK).
- **Tests** (api): PINCODE grant → all areas of the pincode; AREA grant → just that location;
  `is_active=false` excluded; user with no territory → `[]`; permission gate (masterdata.manage
  200 / lesser 403).

### Slice B — Bulk create (API + SDK)
Clone the CPV bulk triplet, adapted for report-as-EXISTS (not upsert).
- **SDK** `commissionRates.ts`: `BulkCreateCommissionRatesSchema` = the shared dims (userId,
  fieldRateType, amount, clientId?, productId?, verificationUnitId?, tatBand?, effectiveFrom?,
  currency?) + `locationIds: number[]` (min 1, max cap e.g. 500). `BulkCommissionRateRow` `{
  locationId, status: 'CREATED'|'EXISTS'|'ERROR', error? }` + `BulkCommissionRateResult` `{ results,
  createdCount, existsCount, errorCount }`.
- **API** repository `bulkCreate`: single `withTransaction`, SAVEPOINT-per-row over `locationIds`,
  INSERT (reuse the `create` SQL), catch `23P01` → `EXISTS`, `23503` → `ERROR`
  (`INVALID_REFERENCE`); unexpected pg errors re-throw (abort). Service: **trust-boundary
  validation** — reject non-FIELD_AGENT user (400), reject OFFICE rate type on this route (400,
  bulk is field/location-only), and mark any `locationId` **outside the user's territory** as
  `ERROR` (`NOT_IN_TERRITORY`) — don't trust the client's picker. Controller + route `POST
  /api/v2/commission-rates/bulk` gated `masterdata.manage`, static before `/:id`.
- **SDK** `client.ts`: `commissionRates.bulkCreate(input)`.
- **Tests** (api): N locations → N CREATED rows; overlapping location → EXISTS (others still
  created); location outside territory → ERROR; non-field-agent → 400; OFFICE type → 400; counts
  correct; single wrapping transaction (partial success survives).

### Slice C — Bulk-add web screen
The mockup, built with real components. Reached from a **"Bulk add"** button on
`CommissionRatesPage`. **No prominent "Bulk add" page title** (per owner) — match the record-page
header pattern.
- New route `/admin/commission-rates/bulk` (embeddable via `clientId?`/`returnTo` like the record
  page) + button on the list.
- User picker = `commissionEligibleUsers` filtered to **FIELD_AGENT** (extend `eligibleUsers.ts`).
  On user select → fetch territory (Slice A) → render pincode groups with area tick-list +
  Select-all; empty-territory hint; disabled until a location is ticked. Shared fields once; live
  count; `bulkCreate` (Slice B) → result summary (created/skipped) → navigate to list.
- Reuse existing `Button`, selects, `friendlyError`, toast. FIELD rate types only in the picker.
- **Tests:** web tests are export-style only (no RTL/jsdom) → cover selection/count helpers as pure
  fns; the flow is browser-verified. e2e (`apps/web/e2e/`) journey if a natural fit.

### Slice D — Scope the single form's picker
`CommissionRateRecordPage.tsx`: when a **field-agent** user + a **FIELD** rate type is selected,
drive the pincode/area picker from that user's territory (Slice A) instead of the full catalog.
OFFICE rate types stay location-less. Keep `FIELD_AGENT + KYC_VERIFIER` in the single-form user
picker (KYC → OFFICE only).

## Order & gating

A → (B ∥ D) → C. Commit each slice at a green `pnpm verify`
(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C`). Adversarial
multi-lens review before "done". Browser-verify on crm2_dev (:54329, admin/admin123). **Nothing
pushed/merged without owner OK.** Update `CRM2_MASTER_MEMORY.md` §8 + registry + Claude memory at
ship.
