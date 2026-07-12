# ADR-0071: Rate Management — Universal product + verification unit

> **Later extension:** [ADR-0093](./ADR-0093-multi-location-bulk-and-one-slot-one-type.md) adds multi-location **bulk** entry + the **one-slot-one-type** rule — additive, **no change to this decision** (same schema, same resolution; guard is app-layer on new saves).

- **Status:** Accepted
- **Date:** 2026-06-26
- **Extends:** ADR-0016 (the Rate model) · mirrors ADR-0050/0046 (commission Universal) + ADR-0069 (rate-type-assignment Universal).

## Context

A `rates` row prices a verification unit under a client + product (the billing authority). `client_id`,
`product_id`, `verification_unit_id` were all NOT NULL, so a rate that should apply to **all products** or
**all verification units** of a client had to be duplicated per product/unit. Owner direction (2026-06-26):
support a **Universal product** and/or **Universal verification unit** — one rate covering all — exactly like
the two Universal models already live in the codebase: `commission_rates` (ADR-0050/0046) and
`rate_type_assignments` (ADR-0069), both of which store the dimension as NULL = "applies generally" and
render the literal word **"Universal"** in the UI (the user never sees NULL).

Unlike rate-type *availability* (a set, where a Universal assignment only ever *widens* the picker — ADR-0069),
a rate resolves to a **single amount the client is charged**. So Universal here must follow **most-specific-wins**,
the same single-value resolution `commission_rates` uses (a SPECIFIC rate must never be overridden by a Universal one).

## Decision

Make `rates.product_id` and `rates.verification_unit_id` **NULLABLE**, where **NULL = Universal**, stored as
NULL but **always rendered "Universal" in the UI**. `client_id` stays NOT NULL (a rate is always client-scoped).

- **No-overlap (mig 0098):** the `rates_no_overlap` GiST EXCLUDE COALESCEs both dims to `-1`
  (`COALESCE(product_id,-1)`, `COALESCE(verification_unit_id,-1)`) — mirroring its existing
  `COALESCE(location_id,-1)`/`COALESCE(rate_type_id,-1)` terms and the commission pattern (mig 0079/0094). A
  Universal row and a specific row coexist (their COALESCEd keys differ); two equal Universal rows still
  collide → 409. `-1` is collision-safe (ids are positive `GENERATED ALWAYS AS IDENTITY`).
- **Billing resolver — most-specific-wins:** the three rate-resolution sites — `RATE_LATERAL`
  (`platform/billing/laterals.ts`, the bill-amount lateral shared by the billing/tasks/MIS read-models) and
  the two `client_rate_type` label sites in `cases/repository.ts` (`TASK_VIEW_COLS`, `ratePreview`) —
  wildcard-match each dim (`col IS NULL OR col = task.col`) and lead the ORDER BY with
  `product_id DESC NULLS LAST, verification_unit_id DESC NULLS LAST` **ahead of** the location rank. So a
  specific rate always outranks a Universal one, and dimension specificity outranks location specificity —
  identical to `COMMISSION_LATERAL`. For existing all-specific data every matched row shares one product/unit,
  so the new ORDER BY terms are a no-op → billing is byte-identical.
- **UI:** Rate Management's Product + Verification Unit pickers gain a "Universal (all)" option (NULL stored);
  the list renders "Universal" for a null dim. A Universal (NULL) dim can't use the assignment-combo rate-type
  resolver (it needs concrete ids), so a Universal field rate sources its rate-type labels from the existing
  `/rate-types/options` (all usable) instead of `/rate-types/available`.

We rejected a **stored boolean/sentinel "all" marker**: you can't FK to "all products," so it needs a NULL id
plus a redundant flag that can drift; and it would force a rewrite of the live, money-critical RATE_LATERAL /
no-overlap for zero functional gain. NULL-stored + "Universal"-rendered gives the explicit experience with no
money-path risk and stays consistent with commission.

## Consequences

### Positive
- One Universal rate covers all products / all units of a client (no row-per-product/unit).
- Consistent with the live commission + rate-type-assignment Universal models.
- Existing billing unchanged (byte-identical for all-specific data).

### Negative
- The billing resolver gains two ORDER BY terms that MUST lead the location rank (a SPECIFIC rate must win) —
  guarded by `rates.resolution.test.ts` (fallback both dims, specific-wins, dimension>location).
- `rates.product_id`/`verification_unit_id` (and the joined `productCode`/`unitName`) become nullable in the
  SDK; the list query LEFT-JOINs products/units so a Universal row still lists.
- Import/export of Universal rates is **deferred** (CODE columns can't cleanly express Universal) — no regression.

## Alternatives Considered
- **Stored boolean/sentinel "all" marker** — rejected (redundant with the required NULL id; money-path rewrite).
- **Universal field rates restricted to Office-flat** (to dodge the rate-type picker) — rejected (owner wants
  Universal field rates too; sourcing labels from `/rate-types/options` is a one-line fallback).
- **Most-specific availability semantics** — N/A (a rate is a single amount, not a set).

## Related ADRs
- ADR-0016 (Rate model — extended here) · ADR-0050/0046 (commission Universal — the most-specific model this mirrors) · ADR-0069 (rate-type-assignment Universal — the *set* sibling) · ADR-0048 (the location-rank CASE preserved here).
