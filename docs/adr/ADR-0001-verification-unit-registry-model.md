# ADR-0001: Verification Unit registry model

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

CRM2 must verify two very different kinds of work — physical field
visits and KYC document checks — within one operational model. The legacy
system fragmented these across separate catalogs and config axes, so there was
no single authoritative inventory of "what can be verified."

## Decision

We model every verifiable thing as a **Verification Unit** in one **unified
catalog**. The catalog is the union of:

- **9 FIELD_VISIT** units, and
- **59 KYC_DOCUMENT** units,

for a total of **68 Verification Units**.

Each unit carries **17 metadata attributes** describing how it is verified,
billed, and reported. Units are **CPV-gated** (Client / Product / Verification
exposure governs which units are available where). Unit **codes are immutable**
and **versioned** — a code never changes meaning; behavioral changes produce a
new version rather than mutating an existing one.

## Consequences

### Positive

- One authoritative inventory of everything that can be verified.
- Field and KYC work share one catalog, one metadata shape, and one set of
  downstream consumers (assignment, billing, reporting).
- Immutable + versioned codes keep history and reports coherent over time.

### Negative

- 68 units with 17 attributes each is a non-trivial seed/maintenance surface.
- Versioning discipline must be enforced; ad-hoc edits to live codes are
  forbidden.

## Alternatives Considered

- **Separate field and KYC catalogs** — rejected: reintroduces the
  fragmentation that 2.0 exists to eliminate.
- **Mutable unit codes** — rejected: breaks historical reports and audit
  coherence.

## Related ADRs

- ADR-0002 — Verification Units are the leaf granularity of the Case → Task
  model.
