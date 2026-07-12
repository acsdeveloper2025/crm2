# ADR-0018: Rate Management — flat one-table model (supersedes ADR-0016)

> **Later extension:** [ADR-0093](./ADR-0093-multi-location-bulk-and-one-slot-one-type.md) adds multi-location **bulk** entry + the **one-slot-one-type** rule — additive, **no change to this decision** (same schema, same resolution; guard is app-layer on new saves).

- **Status:** Accepted
- **Date:** 2026-06-05
- **Supersedes:** ADR-0016 (rate-management resolution / versioning / workspace)

## Context

ADR-0016 specified a 4-table rate engine ported from V1: `rate_types` (eligibility
catalog) → `rate_type_eligibility` → `service_zone_rules` (geography → rate_type)
→ `rates`, with a strict no-fallback resolver and a DB eligibility trigger. During
the build the owner reversed that design mid-flight in favour of a single flat
table — "one line per rate" — because the 4-table chain was more machinery than the
operation needs and the eligibility/zone indirection added no value over storing the
geography and rate-type directly on each rate row.

## Decision

**A rate is one flat, effective-dated row.** Migrations `0013` (flatten) + `0014`
(rate-type lookup) implement it:

- **`rates`** = `(client_id, product_id, verification_unit_id, location_id,
  rate_type) → amount`, effective-dated (`effective_from` / `effective_to`). A
  revision inserts a new dated row and end-dates the prior one (never overwrites).
  `location_id` and `rate_type` are NULL for KYC units.
- **`rate_type`** is a `varchar` snapshot of a code chosen from a simple managed
  **`rate_types` lookup** (0014, 18 seeded codes: LOCAL/OGL/OUTSTATION + numbered
  variants). The lookup only supplies dropdown options — it carries no money and no
  eligibility relationship.
- **Dropped** (0013): `rate_type_eligibility`, `service_zone_rules`, the eligibility
  trigger (`trg_rates_check_eligibility` / `rates_check_eligibility()`), and the
  `rates.rate_type_id` FK. There is **no SZR geography→rate_type hop** and **no
  eligibility gate** — geography and rate-type are direct dimensions of a rate row.
- **UI** = ONE searchable table (`RateManagementPage`): columns Client · Product ·
  Kind · Verification Unit · Pincode · Area · Rate Type · Rate · Effective From …,
  with inline add / revise / history; pincode→area cascade; Kind-gating (KYC greys
  out + nulls geography/rate-type).
- **Freeze-by-copy preservation is unchanged** — a task still snapshots the resolved
  amount; issued invoices/commission stay immutable.

## Consequences

### Positive

- One table, one row per rate — trivial to read, edit, and reason about.
- No eligibility/zone indirection to keep consistent; fewer joins on the hot path.
- Effective-dating retained (revise = new dated row), so price history is preserved.

### Negative

- No DB-enforced eligibility (which rate-types are permitted per client/product/VU);
  the managed `rate_types` lookup + UI are the only guard. Acceptable per owner.
- ADR-0016 and `docs/RATE_MANAGEMENT_FREEZE.md` describe the abandoned model and are
  retained for history with a "superseded" banner, not rewritten (append-only
  governance).

## Alternatives Considered

- **Keep the ADR-0016 4-table model** — rejected by the owner: more machinery than
  the operation needs; eligibility/zone indirection added no operational value.

## Related ADRs

- ADR-0016 — superseded by this ADR.
- ADR-0017 — Effective-From temporal usability gating (master data); `rates` keeps
  its own effective-dated revision model defined here, not the ADR-0017 column.
- ADR-0010 — reporting strategy (consumes resolved rates).
