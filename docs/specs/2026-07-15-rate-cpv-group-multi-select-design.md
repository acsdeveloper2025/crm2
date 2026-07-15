# Rate Management + Rate-Type Assignments — assign to a CPV group (design spec)

- **Date:** 2026-07-15
- **Status:** Design — owner-approved shape (2026-07-15). **Frontend-only.** No migration, no ADR, no
  API change, no SDK change. Extends (all FROZEN, all untouched): **ADR-0016/0018** (flat one-table
  rate model) · **ADR-0071** (Universal = NULL product/unit) · **ADR-0093** (multi-location bulk +
  one-slot-one-type) · **ADR-0050** (resolution) · **ADR-0074** (Universal CPV) · **ADR-0067** (RTA
  model). UI contract: [docs/CREATE_PAGE_STANDARD.md](../CREATE_PAGE_STANDARD.md).
- **Kickoff:** [docs/plans/2026-07-15-rate-management-cpv-group-kickoff.md](../plans/2026-07-15-rate-management-cpv-group-kickoff.md)
- **Owner ask (2026-07-15, verbatim):** *"we want to fix rate management — in that we have missed
  multiple selection of product and verification type for one client. we have universal option but
  sometimes we have to assign rate and rate type for certain cpv group. it is currently missing —
  user can add one at a time but it's a lengthy process."*

## 1. The gap

For one client an admin can today target **one exact `(product, unit)` slot** or **Universal = ALL**
(ADR-0071). There is no middle ground — "apply this to *these 3 products × these 4 units*", a **CPV
group**. Doing it today means one save per combination. This affects both surfaces and they ship
together:

| Surface | Endpoint | Fans across |
|---|---|---|
| **Rate Management** (`/admin/rates`) | `POST /api/v2/rates/bulk` | one slot × N **locations** |
| **Rate-Type Assignments** (`/admin/rate-type-assignments`) | `POST /api/v2/rate-type-assignments/bulk` | one slot × N **rate types** |

## 2. Decisions

1. **Fan the cross product CLIENT-SIDE. Server diff = ZERO.** Both `/bulk` endpoints already accept
   exactly one `(product, unit)` slot; a CPV group is N of those calls. The page's `mutationFn`
   loops the resolved pairs and issues one existing `/bulk` request each. **No `productIds[]`, no
   `otherTypeAtSlot` change, no `BulkRateRow` change, no new cap, no ADR, no migration.**
2. **Only CPV-enabled pairs are offered** (owner, 2026-07-15). The picker resolves them; there is
   **no new server-side CPV gate** (see §6).
3. **Live counter only** — no confirm dialog (owner, 2026-07-15). The count is on screen the whole
   time; the row-wise `CREATED | EXISTS | ERROR` grid is the receipt.
4. **Universal and concrete picks are mutually exclusive** on each axis. Ticking "Universal (all
   products)" clears the concrete products and vice-versa. Wanting both = two saves (today's
   behaviour). Rationale: `Universal + product A` writes a Universal row *and* an A row — legal
   under the RANK resolver but incoherent as a single user intent.
5. **Group mode is FIELD-only** for rates, mirroring the shipped commission precedent ("FIELD only;
   OFFICE single", ADR-0093).
6. **Rate-type dropdown across a group = UNION, never intersection** (see §6).
7. **Import is untouched.** A workbook row already *is* one combo, expressed longhand.

### 2.1 Why client-side fanning is the correct shape, not a shortcut

- **It deletes the kickoff's stated main risk.** "A product × unit fan-out multiplies the slots the
  one-slot-one-type rule must be checked against" — each request carries one slot, so ADR-0093's
  guard runs against its own slot using the existing, tested code. The risk cannot arise.
- **Atomicity was never the model.** ADR-0093 chose SAVEPOINT-per-row explicitly so a per-row
  failure does *not* abort the batch; the endpoint returns 200 + per-row status. N transactions is
  the same semantic granularity as one, not a weakening.
- **Re-submit is already safe** — EXISTS-skip is idempotent on both surfaces.
- **It is strictly better for the DB**: N short transactions instead of one long one holding 1 of
  `DB_POOL_MAX=10` connections and locks on the money table against the GiST EXCLUDE.
- **The owner's pain was UI labour, not HTTP count** — 12 requests behind one click is the fix.

### 2.2 Two live bugs the rejected server-side design would have shipped

Recorded so no future reader re-proposes `productIds[]` without reading this.

- **The `[null]` fail-open (HIGH).** `COALESCE(product_id,-1) = ANY(ARRAY[NULL]::int[])` matches
  **zero rows** (`x = NULL` → NULL → filtered); the scalar `COALESCE(product_id,-1) =
  COALESCE(NULL::int,-1)` in use today matches correctly. Verified in psql (PG18). `otherTypeAtSlot`
  ([rates/repository.ts:175](../../apps/api/src/modules/rates/repository.ts)) has three direct
  callers (`create` :185, `bulkCreate` :217, `activate` :289) plus two indirect
  (`importConfirm`→`create`, `bulkSetActive`→`activate`). Widening it to arrays makes every caller
  wrap a Universal dim as `[null]` ⇒ the ADR-0093 guard silently fails open ⇒ **two active
  differently-typed rates at one slot = double-billing**. `rates_no_overlap` does not catch it
  (`rate_type_id` is part of the EXCLUDE key, mig 0098:49). **CI would stay green**: all six
  `HAS_OTHER_RATE_TYPE` tests use a concrete product+unit; all five Universal tests
  (rates.api.test.ts:263–323) omit `locationId`, and the guard is gated on `locationId != null`
  (service.ts:183). **The Universal × located × guard intersection has zero coverage.**
- **The `Set<number>` over-block (HIGH).** `service.ts:215-225` folds the guard result into a
  `Set<number>` of bare `locationId`. Under a cross product that is no longer a unique key, so a
  LOCAL rate at (P1,U1,L5) would block the legal, distinct (P2,U1,L5). It contradicts the pinned
  test at `rates.api.test.ts:728` — which would still **pass**, because it sends a scalar productId.

If a server-side fan is ever revisited, both must be fixed first, and the missing Universal ×
located × guard regression test written first.

## 3. The cap question — resolved by dissolution

`MAX_BULK_RATE_LOCATIONS = 500` ([sdk/rates.ts:95](../../packages/sdk/src/rates.ts)) **stays
exactly as-is, per request.** No new total cap.

- A cap must exist because the array crosses a **trust boundary** (a browser POST). That bound is
  already enforced server-side per request, which is the only place it can't be routed around. An
  FE-side total cap would be theatre.
- **`IMPORT_JOB_THRESHOLD` was considered and rejected**: it is unreachable from `apps/web`
  (`@crm2/sdk` depends only on `zod`; importing it ships server env-parsing into the browser
  bundle), it is env-tunable at runtime so the FE's compiled-in value would drift from the server's
  (defeating the stated reason `MAX_BULK_*` lives in the SDK), and it semantically marks where work
  is *too big to run synchronously* — not a row cap.
- The historical 500 was never measured (its own comment says it "mirrors the commission/CPV bulk
  caps"; the RTA cap admits "a sanity cap, not a real limit"). It does not need to be: with
  client-side fanning no single transaction grows, so the number is not load-bearing.

## 4. Web — shared shape for both pages

### 4.1 Pair resolution (the jagged-CPV problem)

CPV is **jagged** — product A maps to units 1–2, product B to 2–3 — but two independent multi-selects
pick a **rectangle**. Resolving the difference is what makes the counter honest.

- `useQueries` fans the existing `GET /cpv-units/available?clientId&productId` over each picked
  product (precedent: the areas fan in the same file, RateCreatePage.tsx:199-205). **No new
  endpoint** — `availableUnits` stays per-single-product.
- **Unit picker** = the **union** of those sets (a unit valid for ≥1 picked product is offerable).
- **Resolved pairs** = for each picked product, its picked units **∩** that product's CPV units.
- Pairs render as **read-only chips in the product's own nouns** ("PERSONAL · RESIDENCE"), reusing
  the existing chip markup (RateCreatePage.tsx:744-792) — no new component.
- One muted line names the shortfall: *"2 pairs aren't in this client's CPV mapping — set them up in
  CPV Mapping"* + link to `/admin/cpv`.
- **Counter = `resolvedPairs.length × |third axis|`** (locations on rates, ticked rate types on RTA)
  — computed from the resolved pairs, never the rectangle, so the sticky bar cannot promise rows the
  save won't produce.

### 4.2 Step structure (CREATE_PAGE_STANDARD)

Step 1's on-screen hint is *"These values are identical on every row created below."* The multi-picks
are the **fan-out axis**, so they must not live there or that line becomes false.

| Step | Contents |
|---|---|
| **1 — pick once** | client, rate type, amount, effective-from (hint intact) |
| **2 — pick many** | Products & verification units tick-lists + resolved pair chips + right-aligned pill badge ("8 pairs") |
| **3 — pick many** | pincodes & areas (rates) / rate types (RTA) |

### 4.3 Invalidation (fixes a real work-loss bug)

`changeProduct`/`changeUnit` today call `setSelected(new Set())` (RateCreatePage.tsx:298-308) —
correct for a single-select, **catastrophic** for a multi-select: ticking a 2nd product would erase
200 hand-ticked areas with no undo.

- **Adding** a product/unit clears nothing except `clientRateType`, and only if the current pick
  falls out of the new set.
- **Removing** one clears nothing.
- **`changeClient` keeps today's wipe-everything.**
- **`selected` (locations) is never cleared by a product/unit toggle** — locations are orthogonal to
  the CPV axes.

### 4.4 Location chips in group mode

Blockedness is per `(product, unit, location)`; `blockedLocations()` returns `Set<number>` and
disables the chip (:772), so it structurally cannot carry per-pair state — product 4's OGL would
hard-block a legal product-3 LOCAL save at the same pincode.

- **Group mode:** chips are binary — plain, or **one amber** "already priced for part of this group"
  (**tickable, never red, never disabled**); tooltip lists the specifics.
- **Red + disabled survives only when EVERY picked pair is blocked.** A 1-pair group therefore
  reduces to today's exact behaviour — **one code path, not two**.

### 4.5 Pre-save strip

Above the sticky bar, in the vocabulary the result screen already teaches:

> **22 rates will be created · 2 skipped (already priced) · 1 blocked (different rate type)**

with a bounded list naming actual rows ("PERSONAL · RESIDENCE · 400053 Andheri East — has OGL ₹220")
and "and N more".

### 4.6 Honest hint data

The hint query is `?clientId&active=true&limit=500` and `.then((r) => r.items)` **discards
`totalCount`** (RateCreatePage.tsx:214-216); `MAX_PAGE_SIZE = 500` is the server's hard ceiling. In
group mode the relevant rows multiply by `|pairs|`, making truncation the norm — so a stated count
would be confidently wrong on a money page.

- **Keep the `Paginated` envelope** (drop the `.then`).
- When `totalCount > items.length`, **replace the count with the page's own honest-disclosure
  pattern** — it already exists twice ("showing N of M" :689-698; RTA's "Couldn't check existing
  assignments — any duplicates will be skipped on save").

### 4.7a Owner amendments (2026-07-15, from the live page — built same day)

1. **The pickers are CPV-scoped end to end.** The product tick-list offers ONLY the client's usable
   `client_products` (`GET /client-products?clientId=&active=true`, ADR-0017 effective-gate applied
   client-side), and the unit pool is the **union of those products' CPV units** — never the full
   catalog, in any picker shape (no product picked, Universal picked, concrete picked). A client with
   no usable mapping gets a note + the `/admin/cpv` link. ADR-0074 unchanged: a Universal CPV row
   still yields all units *for that product*. Rationale: a rate or assignment at an unmapped combo is
   a dead row no case can reach.
2. **Existing coverage up front (rates page).** When pairs are picked, the page lists the group's
   already-priced locations — pincode, area, pair, **rate type and amount** (`coverageRows`, same
   pair-scoping as `locationGroupStates`, office rows excluded, display-capped at `COVERAGE_DISPLAY_CAP
   = 30` with "and N more", honest note when the hint read is truncated) — so coverage is visible
   without hunting pincode by pincode. Display-only; the Step-3 chips stay the interaction surface.

### 4.7 Submit

```
const pairs = resolvedPairs;                       // jagged, CPV-intersected
for (const p of pairs) {                           // sequential; ~200ms each
  const res = await api('POST', `${BASE}/bulk`, { ...shared(), productId: p.productId,
                verificationUnitId: p.unitId, clientRateType, locationIds: [...selected] });
  out.push({ pair: p, res });                      // the page tags its own rows
}
```

Each request is byte-identical to today's single-slot save, so `otherTypeAtSlot`, the `Set<number>`,
the savepoint naming and the sorted-`locationIds` deadlock guard all stay untouched. The result grid
merges the responses and gains **Product · Unit** columns. Progress indicator while fanning.

## 5. Per-page specifics

### 5.1 Rate Management (`RateCreatePage.tsx`)

- **OFFICE mode must lock.** `mode` is freely switchable mid-form and the OFFICE branch does one
  plain `POST /rates` (:341-345); no schema uses `.strict()`, so a stray array would be silently
  stripped. Tick 5 products → flip to Office → save → **one rate, green toast, 4 combos missing**: a
  silent wrong-price write, which CREATE_PAGE_STANDARD §5 classes as a defect. Extend the already-
  tested `modeHasDownstream()` guard (:61-66) to include the multi-picks so the Field/Office toggle
  locks once >1 product or unit is ticked, with the existing inline "Clear fields" recovery (UX-9).

### 5.2 Rate-Type Assignments (`RateTypeAssignmentCreatePage.tsx`)

- **`submitPlan` silently collapses a group.** `mode = ids.length === 1 ? 'single' : 'bulk'` (:90)
  routes to the **singular** endpoint whenever exactly one rate type is ticked — so 3 products × 2
  units × 1 rate type writes **1 row, green toast, 5 combos missing**. Gate on
  **`combos === 1 && ids.length === 1`**; a group always routes to `/bulk` (per pair) so the result
  grid exists.
- The **muted "covered" chip** (UNION resolver-mirror) gets the same binary treatment as §4.4:
  "covered for part of this group", never blocking.
- The **rate-type axis stays the full catalog** (`/rate-types/options?active=true`, :134-137) — see
  §6.

## 6. Two rules deliberately NOT built

### 6.1 Rate-type intersection across a group — REJECTED

- **Its mechanism is inverted.** `rateTypes/repository.available()` (:92-124) *drops* an omitted
  dim's predicate — omitting params returns the client-wide **UNION**, the widest set. Its own
  comment: *"This only WIDENS the picker's set relative to a fully-concrete combo."*
- **It gates nothing.** `bulkCreate` validates catalog existence + non-OFFICE category only
  (service.ts:206-210); the eligibility trigger was dropped in **mig 0013:9-11**; `RATE_LATERAL`
  never joins `rate_type_assignments` (platform/billing/laterals.ts:27-46). So an intersection would
  **block a save the server accepts and bills**.
- **It has no target on surface B.** The RTA page loads the full catalog — rate types are its
  fan-out *axis*, and `/rate-types/available` is the resolver **over** that page's own writes.
  Intersecting would hide exactly the types the admin came to assign, and be **empty on a fresh
  client**.
- **It dead-ends the flagship case.** The owner's case is a group that *isn't set up yet*; one
  unassigned pair of twelve empties the intersection and the dropdown goes blank with no diagnosis —
  rebuilding "the lengthy process" inside the fix.
- **Instead:** the dropdown shows the **union**; one muted line names pairs where the *picked* type
  isn't assigned, reusing the shipped `NO_RATE_TYPES_FOR_COMBO` copy + `ASSIGN_RATE_TYPES_PATH`
  (:48-49). For a 1-pair group the union equals today's set — behaviour unchanged. The comment must
  say this is **UX policy, not an invariant**, so no later reader assumes the server backs it.

### 6.2 Per-row `NOT_IN_CPV` server skip — REJECTED

- There is **no CPV check on any rate/RTA write path today** — not `service.create` (:176-199), not
  `importConfirm` (:247-256, which reuses `create`), not RTA create/bulkCreate. The DB eligibility
  trigger was deliberately dropped in mig 0013.
- Adding one only to `/bulk` is a **new rule on one of three doors**: the same non-CPV combo stays
  creatable via `POST /rates` and via import.
- It **breaks ~14 existing tests** — `seedKey` (rates.api.test.ts:39-43) and the RTA `beforeEach`
  seed no `client_products`/cpv-units, so every existing bulk test's combo is non-CPV.
- The owner's decision — *"only CPV-enabled combos are offered by the picker"* — is satisfied in
  full by §4.1. The belt-and-braces half guards only against a SUPER_ADMIN with `masterdata.manage`
  hand-rolling a POST, which is not a threat model.
- A real CPV gate belongs in `service.create`, where bulk + single + import all route through — **one
  guard, all callers** — and it is **its own ADR**, because it would reject payloads that succeed in
  prod today.

## 7. Invariants / DON'T-REGRESS

1. **Never widen `otherTypeAtSlot` to arrays** without fixing §2.2 first — `ANY(ARRAY[NULL])` matches
   nothing and fails the ADR-0093 guard **open** on five live paths.
2. **Never key a fanned guard result by bare `locationId`** — under a cross product it is not unique.
3. `MAX_BULK_RATE_LOCATIONS = 500` **per request** is the trust boundary. Never move it to the FE.
4. **Never clear `selected` (locations) on a product/unit toggle** — orthogonal axes; it destroys work.
5. **Group ⇒ never the singular endpoint** on either page (silent row loss, green toast).
6. **Group ⇒ FIELD only** on rates.
7. Resolution untouched (ADR-0050). Universal stays NULL (ADR-0071). No `-1` sentinel may ever reach
   the FE — `camelize` (platform/db.ts:31-39) would surface `COALESCE(...) AS product_id` as
   `productId === -1`, not `null`.
8. A pair chip's count must never be stated from truncated hint data (§4.6).

## 8. Verification (at build)

- `pnpm verify` green (typecheck → lint → format → no-suppressions → boundaries → test → build).
- **Every regression test must FAIL on revert — verify, don't assume.**
- **Backfill first (pre-existing coverage gap, independent of this feature):** Universal-product
  LOCAL rate at a location, then Universal-product OGL at that location ⇒ `HAS_OTHER_RATE_TYPE`.
  This closes the Universal × located × guard hole found in §2.2. Note it is a **characterization
  test — it PASSES on today's code** (verified in psql: the scalar guard matches a NULL product_id
  correctly), so the "fails on revert" check does not apply to it in the usual way. Its purpose is to
  make the §2.2 fail-open impossible to reintroduce silently: it fails against the rejected array
  design, which is exactly the regression it exists to catch.
- **FE unit tests** (the exported helpers are already testable): pair resolution against a jagged CPV
  matrix; the counter equals `pairs × locations`, not the rectangle; `Universal ⊻ concrete`
  exclusivity; add/remove a product does **not** clear `selected`; a 1-pair group reproduces today's
  red+disabled chip behaviour exactly.
- **FE routing tests:** a >1-pair group never calls a singular endpoint (both pages); the
  Field/Office toggle locks once >1 product or unit is ticked.
- **Server tests: none needed** — the server does not change. Existing bulk tests must stay green
  untouched; if any needs editing, the design has drifted.
- **Browser-verify (mandatory, `feedback_browser_verify_perform_actions`):** perform a real group
  save on both pages in the preview and confirm the rows persisted with the right product/unit dims.

## 9. Governance & sequencing

- **No ADR, no migration, no API/SDK change** (next ADR stays `0095`, next mig stays `0119`).
- Additive `/api/v2` untouched ⇒ **mobile untouched**.
- **Phase 1** = the group on both pages (§4, §5). **Phase 2 (optional)** = deep-link the picked group
  from the rate page into the RTA create page (which already parses `clientId` + `returnTo`,
  RateTypeAssignmentCreatePage.tsx:104-107) — assign once, land back on the priced group. One round
  trip instead of two blind ones; the literal "rate **and** rate type for a certain CPV group".
- Dispositions → `docs/COMPLIANCE_GAPS_REGISTRY.md`; status → `CRM2_MASTER_MEMORY.md` §8 + file-memory
  at ship.
