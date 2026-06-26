# ADR-0072: User access scope = CLIENT + PRODUCT (remove the 3 unwired dimensions)

- **Status:** Accepted
- **Date:** 2026-06-26
- **Amends:** ADR-0022 (Access Control 2.0 — the generic scope-dimension model).

## Context

ADR-0022 shipped a generic data-scope engine with **seven** dimensions in the catalog
(`scope_dimensions`): CLIENT, PRODUCT, PINCODE, AREA, STATE, CITY, VERIFICATION_TYPE. In practice only
CLIENT/PRODUCT (operator caps) and PINCODE/AREA (field-agent territory) are wired to system roles. STATE,
CITY, and VERIFICATION_TYPE are selectable but **wired to no system role** — the COMPLIANCE registry flags
them as SR-10 (selectable, untested in prod) and SR-8 (VERIFICATION_TYPE RESTRICT under-filters at CASE
grain). Owner review (2026-06-26) chose to **remove the three unwired dimensions** so the user-access scope
surface is exactly what's used: **CLIENT + PRODUCT (+ PINCODE/AREA territory)**.

## Decision

Remove **STATE, CITY, VERIFICATION_TYPE** from the scope catalog:

- **Code** (`platform/scope/dimensions.ts`): drop them from the `DimensionCode` union and the `DIMENSIONS`
  registry. The `DimensionDef` VALUE-kind (`entityKind:'VALUE'`/`valueColumn`) and `taskPredicate` machinery
  is **retained as a latent extension point** (VERIFICATION_TYPE was the only `taskPredicate`; no dimension
  declares one now, so every dimension resolves via its `casePredicate` at TASK grain).
- **DB** (migration 0099): set `is_active=false` on the three `scope_dimensions` rows (deactivate, not
  delete — audit trail preserved, re-activatable) and defensively on any `role_scope_dimensions` /
  `user_scope_assignments` for them. UPDATE-only (no DDL → no rolling-deploy lock risk).
- **Contract** unchanged: a scope dimension `code` is `z.string()` (not a strict enum), so removal is **not a
  breaking change** — the server simply rejects an unknown dimension (`UNKNOWN_DIMENSION` 400).

### Why this is zero access change (no widening)
A `user_scope_assignment` can only be created for a dimension **wired to the user's role** (the add/import
path validates against `role_scope_dimensions` + the code registry). The three are wired to no role, so **no
active assignment can exist** for them (verified: 0 in crm2_dev; structurally guaranteed). Every scope reader
— the resolver (`composeScopePredicate`), the role-dimension feed, the assignment list/export, the
role-editor catalog — filters `is_active`, so deactivating the catalog rows removes the dimensions everywhere
at once. No user loses or gains visibility. Default-deny is unchanged.

## Consequences

### Positive
- The scope surface matches reality (CLIENT/PRODUCT + PINCODE/AREA) — no selectable-but-unwired dimensions.
- Closes COMPLIANCE SR-8 and SR-10 (the dimensions they concern no longer exist).
- The web Role editor + user Access tab are data-driven (catalog feed) → the three vanish automatically.

### Negative
- Re-introducing state/city/verification-type scope later means re-adding the catalog entry (a reviewed
  one-line `DIMENSIONS` entry + re-activating the row) — acceptable; the model still supports it.
- The VALUE-kind code paths (entity_value text) are now exercised by no active dimension (latent), kept for
  the model's generality.

## Alternatives Considered
- **Hard-DELETE the rows** — rejected (loses the audit trail; deactivation is reversible and idempotent).
- **Keep them, add integration coverage** (the old SR-10 disposition) — rejected by the owner: unused surface
  is a liability (SR-8 is a real under-filtering footgun if a role ever wires VERIFICATION_TYPE RESTRICT).
- **Remove PINCODE/AREA too** — rejected: they back field-agent territory; removing them changes visibility.

## Related ADRs
- ADR-0022 (Access Control 2.0 — amended here) · COMPLIANCE_GAPS_REGISTRY §SR (SR-8/SR-10 closed by this).
