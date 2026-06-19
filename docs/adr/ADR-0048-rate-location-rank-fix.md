# ADR-0048: Client-rate location ranking — the location-less default must outrank a non-matching location override

- **Status:** **Accepted** — owner sign-off 2026-06-19. Narrowly **supersedes the location-specificity
  `ORDER BY` ladder of ADR-0018** (`RATE_LATERAL`); the flat one-table rate model, dimensions, and
  effective-dating of ADR-0018 are **unchanged**. Supersedes a FROZEN decision — see
  [docs/governance/LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md).
- **Date:** 2026-06-19
- **Origin:** COMPLIANCE_GAPS_REGISTRY §G-8, discovered while building ADR-0046 (the same flaw was
  present in `COMMISSION_LATERAL` and fixed there; this ADR carries the identical fix to the
  client-bill resolver, which ADR-0046 left untouched as out-of-scope/frozen).

## Context

`RATE_LATERAL` (`apps/api/src/platform/billing/laterals.ts`) and its mirror in
`apps/api/src/modules/cases/repository.ts` (`TASK_VIEW_COLS`, the `rate_type` display subquery) resolve
the most-specific active client rate for a task's CPV using:

```sql
ORDER BY (r.location_id = ct.area_id)    DESC NULLS LAST,
         (r.location_id = ct.pincode_id) DESC NULLS LAST,
         (r.location_id = cs.area_id)    DESC NULLS LAST,
         (r.location_id = cs.pincode_id) DESC NULLS LAST,
         (r.location_id IS NULL)         DESC,
         r.location_id
```

**Bug:** for a candidate rate scoped to a location that does **not** match the task, `r.location_id = X`
evaluates to **`FALSE`** (a non-null). Under `DESC NULLS LAST`, a non-null `FALSE` sorts **above** the
location-less default's `NULL` (which goes last). So when a CPV has **both** a location-less default rate
**and** a rate scoped to some *other* location, a task at a *third* (unmatched) location resolves the
**wrong (other-location) override** instead of the intended **default**.

The intended precedence (ADR-0018's own wording) is `task.area > task.pincode > case.area > case.pincode
> location-less default > (any other)`. The ladder above does not encode the last two steps correctly.

**Production impact (verified 2026-06-19, read-only):** **0** CPVs currently have both a location-less
default and a location override (the dev-only prod env has 1 active rate total). The bug is therefore
**latent — no client is mis-billed today**; this fix is **preventive**, correct once location-tiered
rates are configured.

## Decision

Replace the boolean location ladder — in **both** `RATE_LATERAL` and the `cases/repository.ts`
`TASK_VIEW_COLS` mirror — with a single deterministic `CASE` rank (identical to the ADR-0046
`COMMISSION_LATERAL` fix):

```sql
ORDER BY (CASE
           WHEN r.location_id = ct.area_id    THEN 5
           WHEN r.location_id = ct.pincode_id THEN 4
           WHEN r.location_id = cs.area_id    THEN 3
           WHEN r.location_id = cs.pincode_id THEN 2
           WHEN r.location_id IS NULL         THEN 1   -- location-less default
           ELSE 0 END) DESC,                            -- a non-matching scoped rate ranks LAST
         r.location_id
LIMIT 1
```

A location **match** (task.area 5 > task.pincode 4 > case.area 3 > case.pincode 2) outranks the
**location-less default** (1), which outranks a **non-matching** scoped rate (0). `LIMIT 1` keeps the
lateral 1:1 (`COUNT`/`SUM` exact). The trailing `r.location_id` is retained as the within-rank tiebreak.

## Consequences

- **Positive:** a task at an unmatched location now correctly bills the location-less default; mirrors
  the commission resolver (one consistent location-rank idiom across both laterals).
- **Behaviour change:** only for the trigger configuration (default + other-location override + task at
  a third location). No current prod data hits it, so no bill totals change today.
- **Sync obligation preserved:** the `cases/repository.ts` mirror is fixed in lockstep (the laterals.ts
  header's ⚠ note still applies — change both together).
- **Mobile / `/api/v2`:** none — this is a server read-model resolution; no contract change (ADR-0011).

## Alternatives considered

- **Leave deferred (latent only).** Rejected by the owner 2026-06-19 ("then fix it") — the fix is cheap,
  mirrors the proven ADR-0046 change, and removes a future mis-billing risk before tiered rates exist.
- **`COALESCE`-based ladder instead of `CASE`.** Equivalent; the `CASE` rank is the clearer, already-
  reviewed form from ADR-0046.

## Sign-off

Owner/CTO approved 2026-06-19 (supersedes the frozen ADR-0018 ordering on this narrow point). Tested by
a billing read-model case proving the location-less default wins for an unmatched-location task; full
`pnpm verify` green.
