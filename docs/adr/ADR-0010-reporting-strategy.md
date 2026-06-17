# ADR-0010: Reporting strategy

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

Reporting must be fast, consistent, and decoupled from application code, and the
client-facing report must reflect the correct, verification-type-aware result.
Inline ad-hoc SQL for reporting is what we are deliberately avoiding.

## Decision

Reporting is served through database objects, read via repositories:

- **Views (`v_`)** provide **live** reporting reads.
- **Materialized views (`mv_`)** provide pre-aggregated reads, **refreshed by a
  worker** using **`REFRESH MATERIALIZED VIEW CONCURRENTLY`**.
- All reporting reads go through **view repositories** — **never inline SQL**.
- The **client report is config-driven and verification-type-aware**, produced
  as a **sealed report**.

## Consequences

### Positive

- Heavy aggregation lives in `mv_` and refreshes off the request path;
  concurrent refresh avoids read locks.
- Live needs use `v_`; the view/materialized split is explicit.
- Config-driven, vtype-aware sealed reports keep output correct and consistent.

### Negative

- Materialized views add a refresh worker and a freshness/lag consideration.
- The view layer must be maintained alongside the schema.

## Alternatives Considered

- **Inline reporting SQL in application code** — rejected: SQL sprawl, no
  reuse, bypasses the repository discipline.
- **Live views only (no materialization)** — rejected: heavy aggregations on
  the request path do not scale.

## Related ADRs

- ADR-0005 — reporting reads go through view/report repositories.
- ADR-0009 — reporting is a flagged high-risk surface.
