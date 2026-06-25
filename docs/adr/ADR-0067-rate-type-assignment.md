# ADR-0067: Rate-type per-combination assignment layer (Phase B)

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

ADR-0064 promoted the `rate_types` catalog to the managed source of truth and laid out a phased rollout
(A: catalog + admin CRUD — shipped; B: assignment layer; C: FK conversion). v1 let admins declare **which
rate types are available per (client × product × verification type)** and gated the Rate-Management /
case-creation pickers on that declaration. v2 Phase A shipped the catalog but nothing yet records
per-combination availability.

The owner wants the v1 per-combination assignment surface back, while preserving v2's resolution model
(ADR-0050/0064): the client bill resolves by location, commission by rate-type key + location + Universal
dims; no geo / `service_zone_rules` mapping.

Numbering: the unpushed `feat/rbac-scope-cluster` branch already uses ADR-0065/0066 and migration 0095, so
this layer is **ADR-0067 / migration 0093** (collision-proof, owner-confirmed 2026-06-25); the 0065/0066
gap in the index resolves when that branch ships.

## Decision

We will add a `rate_type_assignments(client_id, product_id, verification_unit_id, rate_type_id, is_active)`
table (migration 0093, `UNIQUE(client_id, product_id, verification_unit_id, rate_type_id)`, partial index
on the combo `WHERE is_active`) that declares which catalog rate types are available per
(client × product × verification unit).

It is maintained by a **bulk set-the-set** API — `POST /api/v2/rate-type-assignments/bulk` replaces the
active assigned set for a combo (no per-row OCC `version`; a checkbox matrix is naturally an atomic replace,
last-write-wins per combo) — and read by `GET /api/v2/rate-type-assignments` (the admin matrix's current
state) and `GET /api/v2/rate-types/available?clientId&productId&verificationUnitId` (the resolver consumed
by Rate Management + case-creation in Phase C). View is `page.masterdata`; manage is `masterdata.manage`;
the `available` resolver is reachable by **either** `page.masterdata` **or** `case.create` via a new
`authorizeAny(...)` any-of guard added to `@crm2/access`.

Resolution is **unchanged** in Phase B: assignments only *bound availability* at the pickers (wired in
Phase C); they do not alter how the bill amount or commission resolve. The **Commission picker stays ALL
active catalog rows** — commission dims (client/product/unit) are Universal-able, so a per-combo assignment
can't bound them (matches v1).

## Consequences

### Positive

- Admins curate rate-type availability per combo through a single matrix page.
- The `available` resolver gives Phase C a clean, RBAC-correct seam to gate the Rate-Management picker.
- Bulk set-the-set keeps the API and the matrix UI trivially consistent (the saved set *is* the screen).

### Negative

- An unassigned combo resolves to an empty available-set, so admins must assign before a rate can reference
  a rate type for that combo at the (Phase C) assignment-gated Rate-Management picker. Mitigated by leaving
  the Commission picker un-gated and deferring the picker wiring to Phase C.
- A second writer to the same combo wins last (no OCC) — acceptable for a low-contention admin surface.

## Alternatives Considered

- **Per-row CRUD with OCC `version`** — rejected; a checkbox matrix is a set replace, and per-row OCC adds
  churn with no admin benefit.
- **Combo-gate the Commission picker too** — rejected by the owner; commission dims are Universal-able.
- **Reintroduce v1 `service_zone_rules` (geo → rate-type)** — out of scope per ADR-0064 (resolution preserved).

## Related ADRs

- ADR-0064 — the rate-type management parent decision (catalog as managed FK SoT); this is its Phase B.
- ADR-0050 / ADR-0056 — the preserved resolution model (location billing; commission key + location + dims).
