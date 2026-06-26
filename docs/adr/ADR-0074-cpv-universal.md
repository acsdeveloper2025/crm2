# ADR-0074: CPV Universal (all units) + CPV-scoped config unit pickers

- **Status:** Accepted
- **Date:** 2026-06-26
- **Extends:** ADR-0017 (the CPV enablement model) · mirrors ADR-0069 (rate-type-assignment Universal — the *set* sibling).

## Context

A `client_product_verification_units` (CPV) row enables one verification unit under a client + product —
the source of truth for which units case-creation may pick (`cases.availableUnits` / `allUnitsEnabled`).
`verification_unit_id` was NOT NULL, so enabling **every** unit of a client+product meant one row per unit.

Two owner asks (2026-06-26, design locked via AskUserQuestion):

1. **Universal CPV** — let one mapping mean "all units," exactly like the Universal models already live in
   the codebase: `rates` (ADR-0071), `commission_rates` (ADR-0050) and `rate_type_assignments` (ADR-0069),
   all of which store the dimension as NULL = "applies generally" and render the literal **"Universal"** (the
   user never sees NULL).
2. **CPV-scoped config pickers** — Rate Management, Commission Rates and Rate-Type Assignment all pick a
   verification unit, but offered *every* active unit regardless of what the chosen client+product actually
   has CPV-mapped. Narrow those pickers to the CPV-scoped units.

Like rate-type *availability* (ADR-0069) and unlike `rates`, a CPV is a **set membership**, not a single
resolved value — a Universal CPV only ever *widens* "which units are allowed" to all of them. So there is no
most-specific-wins resolution here; "Universal OR specifically-mapped" is the whole rule.

## Decision

### Issue 1 — Universal CPV
Make `client_product_verification_units.verification_unit_id` **NULLABLE**, where **NULL = Universal (all
units)**, stored NULL but **always rendered "Universal (all units)"** in the UI.

- **Unique key (mig 0101):** `uq_cpvu` swaps to `UNIQUE NULLS NOT DISTINCT (client_product_id,
  verification_unit_id)` (PG18, mirroring mig 0096) so a single Universal (NULL) row per client_product
  dedupes — a second Universal CPV for the same client_product → 409. A Universal row and specific rows
  coexist. The migration carries the standard lock-retry preamble (0097/0098) so a rolling deploy never hangs
  on the still-serving old api.
- **Resolvers Universal-aware:** `cases.availableUnits` and `cases.allUnitsEnabled` (case-creation) and the
  new `cpvUnitRepository.availableUnits` (the picker feed) all read **"every active unit when a Universal CPV
  exists for the client+product, else only the specifically-mapped units."** `allUnitsEnabled` returns true if
  a Universal CPV exists OR every requested unit id is specifically mapped.
- **List:** the CPV list LEFT-JOINs `verification_units` so a Universal (NULL unit) row still lists with null
  unit codes; `CpvPage` renders "Universal (all units)" for a null unit. The "Add unit" picker gains a
  **"Universal (all units)"** option (`UNIVERSAL` sentinel → null on POST).

### Issue 2 — CPV-scoped config pickers
New **`GET /api/v2/cpv-units/available?clientId&productId`** (`masterdata.view`, returns `{id,code,name}[]`)
— the CPV-scoped units for a client+product (a Universal CPV ⇒ all active units), the same rule as
case-creation's `availableUnits`. The 3 config record pages (RateRecordPage, CommissionRateRecordPage,
RateTypeAssignmentRecordPage) load this feed when a **specific** client+product is chosen, else fall back to
`/verification-units/options` (all units) — the fallback covers "no product yet" and "Universal product"
(RateRecordPage's `'UNIVERSAL'` sentinel; the other two represent Universal product as empty selection). Each
page **keeps** its own "Universal (all units)" rate-side wildcard option (ADR-0071/0069) — that is the
*rate's* Universal dimension, orthogonal to the CPV being Universal.

**No new server validation** (chosen): the picker is a UX narrowing only. Case-creation already validates unit
eligibility via `allUnitsEnabled`; rate/commission/assignment rows intentionally allow any unit (a rate may
exist before its CPV mapping). Adding a write-time gate would be a behavior change the owner did not ask for.

We rejected a **stored boolean/sentinel "all" marker**: you can't FK to "all units," so it needs a NULL id
plus a redundant flag that can drift — NULL-stored + "Universal"-rendered gives the explicit experience with
no drift and stays consistent with rates/commission/rate-type-assignment.

## Consequences

### Positive
- One Universal CPV enables every unit of a client+product (no row-per-unit); case-creation honors it.
- Config unit pickers reflect what the client+product is actually CPV-mapped to (less mis-selection).
- Consistent with the three live Universal models (rates / commission / rate-type-assignment).

### Negative
- The Universal-aware `availableUnits` SQL is **duplicated** in `cpv/repository.ts` and `cases/repository.ts`
  (different return aliases) with "keep in sync" comments — accepted; a shared helper would couple two modules
  for ~10 lines.
- `verificationUnitId` (and the joined `unitCode`/`unitName`/`unitWorkerRole`) become nullable in the SDK; the
  list LEFT-JOINs so a Universal row still lists.
- Import/export of a Universal CPV is **deferred** — the export INNER-joins `vu`, so Universal (null-unit)
  rows don't export (same deferral as Universal rates, ADR-0071). No regression for specific rows.

## Alternatives Considered
- **Stored boolean/sentinel "all" marker** — rejected (redundant with the required NULL id; can drift).
- **Most-specific-wins resolution** — N/A: a CPV is set membership, not a single resolved value (the ADR-0069 *set* model, not the ADR-0071 *amount* model).
- **Write-time validation that a rate/commission/assignment unit be CPV-mapped** — rejected (owner did not ask; rates legitimately predate their CPV mapping).

## Related ADRs
- ADR-0017 (CPV enablement model — extended here) · ADR-0069 (rate-type-assignment Universal — the *set* sibling this mirrors) · ADR-0071 (rate Universal — the *amount* sibling) · ADR-0050 (commission Universal).
