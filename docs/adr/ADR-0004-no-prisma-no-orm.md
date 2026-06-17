# ADR-0004: No Prisma / no ORM

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

A default instinct for a Node/TypeScript backend is to reach for an ORM such as
Prisma. The deciding factor is whether an ORM's schema model can faithfully
express our database design.

## Decision

We use **raw `pg`** with a **repository pattern** and **zod** for validation.
**No ORM. Prisma is rejected.**

The reason: **every core table is integrity-heavy**, relying on **CHECK
constraints, triggers, partitions, partial-unique indexes, and recursive
CTEs** — constructs that **`schema.prisma` cannot model**. An ORM would either
hide or fight these, leaving the real schema in migrations anyway.

## Consequences

### Positive

- The database design is expressed directly and fully in SQL, with no
  abstraction lying about what the schema actually enforces.
- Full use of PostgreSQL features (triggers, partial uniques, recursive CTEs).
- zod provides explicit, typed validation at the application boundary.

### Negative

- We hand-write SQL and mapping code instead of getting it generated.
- No ORM-provided query builder or automatic migration diffing.

## Alternatives Considered

- **Prisma (full ORM)** — rejected: cannot model the constraint/trigger/
  partition/partial-unique/recursive-CTE schema.
- **Hybrid (Prisma for simple tables, raw SQL elsewhere)** — evaluated and
  rejected: a split data-access story adds complexity for little gain when the
  core tables all need raw SQL.

## Related ADRs

- ADR-0003 — the PostgreSQL features that the schema depends on.
- ADR-0005 — the repository pattern that wraps raw `pg`.
