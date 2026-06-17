# ADR-0017: Effective-From temporal usability gating for master data

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

Master-data rows (clients, products, verification units, rate types,
locations, users, report templates) need to be **scheduled to become usable on a
future date** and to remain visible-but-not-yet-usable until then. Today the only
lifecycle switch is `is_active` (a boolean on/off), which cannot express "exists,
configured, but not in effect until <date>". The `rates` table already carries an
effective-dated model (`effective_from`/`effective_to`, ADR-0016); the owner has
directed that **"Effective From" become a real, user-settable temporal feature
across every administration master-data table**, gating operational use.

## Decision

We add a single user-settable column **`effective_from timestamptz NOT NULL
DEFAULT now()`** to the seven master-data tables above, and define one platform
rule:

> A master-data row is **USABLE** when `is_active = true AND effective_from <= now()`.

- **`is_active`** remains the off-switch (end-of-life / disable). We do **not**
  add `effective_to` to these tables — deactivation is the way a row ends. (`rates`
  keeps its own `effective_from`/`effective_to` revision model from ADR-0016; it is
  out of scope here.)
- **Operational / active reads gate on USABLE.** The list-query filter
  **`?active=true` means USABLE** (`is_active AND effective_from <= now()`), not
  merely `is_active`. Every hard-coded operational read (auth login, assignable-user
  pools, CPV available-units, the rate-management dropdowns and pincode/area
  cascade, the rate-type lookup) adds `AND effective_from <= now()` beside its
  existing `is_active` filter.
- **Administration list reads show ALL rows** (no `active` filter) including
  future-dated ones, expose `effective_from`, and render a three-state status:
  **ACTIVE** (`is_active AND effective_from <= now()`), **SCHEDULED**
  (`is_active AND effective_from > now()`), **INACTIVE** (`is_active = false`).
- **User-settable:** create and update accept an optional `effectiveFrom`
  (ISO datetime); when omitted on create it defaults to `now()`, and on update an
  omitted value leaves the existing value unchanged.
- Existing rows are backfilled `effective_from = created_at`, so nothing already
  in the system changes behaviour (every existing row stays immediately usable).

**Scope also covers the CPV enablement join tables** (added in migration `0016`):
`client_products` and `client_product_verification_units`. These are where a
client / product / verification-unit set is *onboarded*, so they are the most
schedule-worthy config of all. The same USABLE rule applies — `?active=true` on
their lists means usable, and the case-creation reads (`availableUnits`,
`allUnitsEnabled`) gate on `cp.effective_from <= now() AND cpvu.effective_from <= now()`
(alongside the existing `vu.effective_from`). The CPV admin screen also shows an
active enabled-unit count per link so the unit-mapping action is discoverable.

## Consequences

### Positive

- Master data can be pre-configured and switched on at a planned date without a
  human flipping `is_active` at midnight.
- One predicate (`is_active AND effective_from <= now()`) is the single definition
  of "usable", applied identically at every operational read — no per-module drift.
- Future-dated rows are safely invisible to operations (won't appear in pickers,
  pools, or logins) while remaining manageable in admin.
- Reuses the `rates` effective-dating idiom already proven in the codebase.

### Negative

- Every operational read site must be audited to add the `effective_from <= now()`
  gate; missing one would let a SCHEDULED row leak into operations.
- `?active=true` now means USABLE (active **and** in effect), a semantic change for
  any caller that expected it to mean only `is_active`. Admin screens that need to
  see scheduled/inactive rows must omit the filter (they already do — they render
  status chips and activate/deactivate controls).

## Alternatives Considered

- **`effective_from` + `effective_to` on master data** — rejected: end-dating
  duplicates `is_active`; the owner asked for "Effective From", and `is_active`
  already ends a row's life. Keeps the model minimal.
- **A separate `status` enum column (DRAFT/SCHEDULED/ACTIVE/RETIRED)** — rejected:
  redundant with the `is_active` + `effective_from` pair; status is derivable, so
  storing it invites inconsistency.
- **Gate only specific tables (e.g. rates only)** — rejected: the owner explicitly
  chose platform-wide ("everywhere as a real feature").

## Related ADRs

- ADR-0016 — Rate Management already uses effective-dated `rates`; this ADR
  generalises the user-facing "Effective From" concept to the other master data
  (without importing the rates revision/overlap model).
- ADR-0005 — repository pattern: the gate lives in repository SQL, not services.
- ADR-0007 — naming standards (snake SQL / camel TS).
