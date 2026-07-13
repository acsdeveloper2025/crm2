# ADR-0093: Multi-location bulk entry + one-slot-one-type rule (rate & commission)

- **Status:** Accepted — owner-directed (commission 2026-07-11, rate 2026-07-12). **Additive: no
  schema change, no resolution change, no migration.** Supersedes nothing; retro-documents shipped
  behavior at owner request so the decision record is complete.
- **Date:** 2026-07-12
- **Extends (all FROZEN, all unchanged):** [ADR-0016](./ADR-0016-rate-management-resolution-versioning-workspace.md)
  / [ADR-0018](./ADR-0018-rate-management-flat-one-table-model.md) (the rate model) ·
  [ADR-0036](./ADR-0036-billing-commission-model.md) (the commission model) ·
  [ADR-0048](./ADR-0048-rate-location-rank-fix.md) (location rank) ·
  [ADR-0050](./ADR-0050-commission-exact-match-rate-type-key.md) (resolution: client bill by location
  with `client_rate_type` **display-only**; commission by exact key incl. `field_rate_type`) ·
  [ADR-0068](./ADR-0068-rate-type-fk-conversion.md) (`rate_type_id` FK) ·
  [ADR-0071](./ADR-0071-rate-universal-product-unit.md) (Universal dims + the `*_no_overlap` EXCLUDE
  COALESCE(-1) sentinels).
- **Migrations:** none. **UI contract:** [docs/CREATE_PAGE_STANDARD.md](../CREATE_PAGE_STANDARD.md).

## Context

Rate cards and commission cards are created **one (location) at a time**. The admin master-data UX
audit ([2026-07-07](../audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md)) measured
onboarding one client's territory as dozens of identical saves differing only by location. Owner asks
(2026-07-10/11/12): **set the rate once, fan it across many locations → one row per location**, on one
create screen that also does the single case; a **row-wise result** styled like the list; **duplicate
hints on the picker before save**; **success/error toasts + inline alerts**; the CREATE_PAGE_STANDARD
look; and a **fixed import template**. Governance verdict (audit): the schema already supports it — the
`*_no_overlap` EXCLUDEs (ADR-0071) COALESCE `location_id`, so **N rows differing only by location are
already legal** — so this is additive: **no migration, no ADR was strictly required**; this ADR exists
because the owner asked the decision be recorded.

## Decision

### 1. Multi-location bulk entry — additive endpoint per resource (pure ergonomics)

- **`POST /api/v2/commission-rates/bulk`** (2026-07-11) fans across the field agent's **assigned
  territory** (`user_scope_assignments` PINCODE/AREA, role-wiring-intersected — a commission rate is
  per-user). **`POST /api/v2/rates/bulk`** (2026-07-12) fans across the **full location catalog**
  (a client bill-rate has **no user** → **no territory** to scope by; the picker is pincode-search →
  area chips from `locations`).
- **SAVEPOINT-per-row** over `locationIds`, one wrapping transaction, per-row result: **CREATED** /
  **EXISTS** (`23P01` overlap → **skipped, NEVER overwritten**) / **ERROR** (`23503` →
  `INVALID_REFERENCE`; plus per-resource guards below). Mirrors the CPV bulk pattern; **not**
  `platform/bulk.ts` (that helper is version-guarded mutate-existing).
- **Pure ergonomics.** Each fanned row is identical to a single create — same table, same columns,
  same effective-dating, same per-row audit. **Resolution is untouched** (`RATE_LATERAL` /
  `COMMISSION_LATERAL`, ADR-0050): the ladders read whatever rows exist and pick the best; whether an
  admin created N location rows one-by-one or via one fan is indistinguishable.
- **Merged single+multi create page** (CREATE_PAGE_STANDARD): a located/field type → tick 1..N
  locations → the bulk endpoint; a location-less (office/KYC) type → one plain `POST`. The record page
  becomes **revise-only** (`/:id`; keys immutable). `MAX_BULK_*_LOCATIONS = 500` per save.

### 2. One-slot-one-type rule (owner) — app-layer, new-saves-only

At most **one active rate type per slot**, where the slot is the overlap key **minus** rate type:

| Resource | Slot | Why |
|---|---|---|
| **Commission** (2026-07-11) | `(user, location)` [pincode+area] | `field_rate_type` **is a resolver key** (LOCAL ≠ OGL price differently, ADR-0050 §2) — two types at a location = ambiguous payout. |
| **Rate** (2026-07-12) | `(client, product, unit, location)` | `client_rate_type` is **display-only** (ADR-0050 §1) — this is an owner **hygiene** rule preventing two active priced rows at one billing slot. |

- Enforced **app-layer, on NEW saves + reactivation only** (never a DB EXCLUDE — legacy multi-type
  and typeless-coexisting rows exist in prod and are **grandfathered**; a constraint would fail on
  existing data): single/import → **409 `HAS_OTHER_RATE_TYPE`**, bulk → **per-row ERROR**, activate +
  **bulk-activate** → **409 / per-row CONFLICT** (a `RATE_EXISTS` reactivation is a CONFLICT too, not
  a whole-batch abort). Rate's guard (`otherTypeAtSlot`) uses **`rate_type_id IS DISTINCT FROM`** and
  runs for **every located save** (typed or typeless) so a typeless row can't plant a second billing
  line at a typed slot and vice-versa.
- **Payout resolution + legacy rows are untouched.** A DB-level EXCLUDE for the rule is deferred until
  legacy rows are cleaned; a tiny concurrent-save race is accepted (matches the platform).

### 3. Duplicate / error surfacing (CREATE_PAGE_STANDARD)

- Picker shows **existing rates per location BEFORE save**: **amber** = same-type overlap (would
  EXISTS-skip; still tickable), **red + disabled** = different-type at the slot (rule-blocked, tooltip
  names the rule). "Select all" skips blocked chips; a rule-field change clears the selection.
- **Result screen** = one row per submitted item, styled like the module list + a Status column
  (Created / Skipped — already exists / plain-English error); honest "No new … created" at 0. Single
  saves navigate back instead.
- **Feedback:** success = green toast always (batch counts); error = red toast **and** a persistent
  inline `role="alert"`; every known code → plain English, unknown codes fall through raw. An **unknown
  rate-type code is a hard 400 `INVALID_RATE_TYPE`** (fail-loud, never a silent typeless rate).
- **Import template** = exact parser headers + **one sample row per shape** (`sampleRows`) + a live
  **"Notes"** worksheet (`templateNotes`, generated from config so it can't drift); confirm is
  per-row partial-success with Row·Column·Error.

## Consequences

- **No migration, no schema change, no resolution change.** `/api/v2` additive; **mobile untouched**.
- This is now **THE entry-page pattern** — `docs/CREATE_PAGE_STANDARD.md` is the UI source of truth;
  it is being rolled out to the other admin master-data pages one by one.
- **Also applied to Rate-Type Assignments (2026-07-13):** the same additive bulk pattern powers
  `POST /api/v2/rate-type-assignments/bulk` — Fork B "set the `(client, product?, unit?)` slot once,
  fan across N rate types" (the fan-out axis is the rate-type set, not location). No migration, no
  schema change; amber-only hints (no rule-blocked chips — nothing blocks a valid pick for this
  entity). EXISTS-skip is detected by a **pre-read of the slot's active set** (RTA's `create` is an
  idempotent `ON CONFLICT DO UPDATE` that never raises a conflict, so the 23P01-catch mechanism used
  for rates does not apply here). Model = ADR-0067.
- **Counters:** no migration consumed (next mig `0117`); this ADR consumes `0093` (**next ADR
  `0094`**).
- Review dispositions + don't-regress notes live in
  [docs/COMPLIANCE_GAPS_REGISTRY.md](../COMPLIANCE_GAPS_REGISTRY.md) (§commission-2026-07-11,
  §rate-bulk-2026-07-12) and `CRM2_MASTER_MEMORY.md` §8.
