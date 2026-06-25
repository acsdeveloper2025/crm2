# ADR-0069: Rate-type assignment — Universal product/unit + per-unit table

- **Status:** Accepted
- **Date:** 2026-06-25
- **Amends:** ADR-0067 (the Phase B per-combination assignment layer, LIVE on prod).

## Context

ADR-0067 shipped `rate_type_assignments(client_id, product_id, verification_unit_id, rate_type_id)` with
all four columns NOT NULL and a bespoke 3-select + checkbox page. Owner review (2026-06-25): the page does
not follow the v2 design standard; the rate-type selection should sit **beside the verification unit** in a
**table**; and admins need a **Universal ("all")** option for **product** and **verification unit** so a
rate type can be assigned to every product / every unit of a client at once (flow: pick client, then
optionally Universal product + Universal unit).

The codebase already has one Universal model: `commission_rates` (ADR-0050/0046) stores `client_id`/
`product_id`/`verification_unit_id`/`tat_band` as nullable = "applies generally," and the UI renders the
literal word **"Universal"** for a NULL dimension (`commissionRates/service.ts`). The user never sees NULL.

## Decision

We will make `rate_type_assignments.product_id` and `verification_unit_id` **NULLABLE**, where **NULL =
Universal ("all")**, stored as NULL but **always rendered as the word "Universal" in the UI** — matching the
live commission model. `client_id` stays NOT NULL. The unique key becomes
**`UNIQUE NULLS NOT DISTINCT (client_id, product_id, verification_unit_id, rate_type_id)`** (PG18) so a
Universal (NULL) row is a single value the bulk `ON CONFLICT` upsert can dedupe (migration 0096).

Availability resolves as a **union-with-wildcards**: `GET /rate-types/available?clientId&productId&
verificationUnitId` returns the DISTINCT rate types assigned to that combo **or to any Universal parent**
(`(product_id IS NULL OR product_id = $p) AND (verification_unit_id IS NULL OR verification_unit_id = $u)`).
Availability is a set, so a Universal assignment **adds to** every matching combo (not most-specific-wins,
which is for single-value money resolution).

The page is rewritten as a v2-styled **per-unit table**: Client (required) + Product (with "All products
(Universal)"); a searchable table with an "All verification units (Universal)" row + a row per active unit,
each carrying an inline rate-type multi-select; one Save writes a bulk-set per changed row.

We rejected a **stored explicit marker** (a boolean/sentinel for "all"): you cannot FK to "all products," so
it still needs a NULL id plus a redundant flag that can drift into contradiction; and a marker *everywhere*
would mean rewriting the live, money-critical COMMISSION_LATERAL / no-overlap / derive for zero functional
gain. NULL-stored + "Universal"-rendered gives the explicit experience with no money-path risk and stays
consistent with commission.

## Consequences

### Positive
- One Universal assignment covers all products / all units of a client (no row-per-product).
- Consistent with the live commission Universal model; zero change to the money path.
- The page follows the v2 table standard with rate types beside each unit.

### Negative
- The `available` resolver becomes a union (must only ever *widen* the picker, never narrow — guarded by a test).
- The unique-constraint swap to `NULLS NOT DISTINCT` is the load-bearing migration re-run item (proven by `migrations.rerun.test.ts`).

## Alternatives Considered
- **Stored boolean/sentinel marker for "all"** — rejected (redundant with the required NULL id; contradiction risk).
- **Retrofit commission_rates to the same explicit marker** — rejected (large, money-critical rewrite of the live resolver for no functional benefit).
- **Most-specific-wins availability** — rejected (availability is a set; a specific assignment must not suppress a Universal one).

## Related ADRs
- ADR-0067 (Phase B assignment — amended here) · ADR-0064 (rate-type management parent) · ADR-0050/0046 (the commission Universal model this mirrors).
