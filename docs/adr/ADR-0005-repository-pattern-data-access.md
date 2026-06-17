# ADR-0005: Repository pattern + data-access strategy

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

Having chosen raw `pg` over an ORM (ADR-0004), we need a disciplined,
consistent way to access data so that SQL does not leak across the codebase and
so that read and write concerns stay separated.

## Decision

We adopt the **repository pattern** with three repository kinds plus a shared
scope layer:

- **entity repositories** — read/write of domain entities.
- **report repositories** — query-side access for reporting.
- **view repositories** — read access over database views.
- a **shared scope** layer that all repositories use for access scoping.

**Raw SQL lives only in repositories and migrations** — nowhere else.
**Reporting is served via `v_` (views) and `mv_` (materialized views)** through
the report/view repositories.

## Consequences

### Positive

- SQL is contained; the rest of the application talks to repositories, not the
  database.
- Clear separation between transactional entity access and reporting access.
- Consistent scoping in one shared layer rather than re-implemented per query.

### Negative

- More structure/boilerplate than ad-hoc queries.
- Discipline required: any raw SQL outside repositories/migrations is a defect.

## Alternatives Considered

- **Ad-hoc queries in services/controllers** — rejected: SQL sprawl, no
  separation, inconsistent scoping.
- **Single generic repository** — rejected: conflates entity, report, and view
  access concerns.

## Related ADRs

- ADR-0004 — raw `pg` is what these repositories wrap.
- ADR-0010 — reporting strategy built on `v_`/`mv_` read through view repos.
