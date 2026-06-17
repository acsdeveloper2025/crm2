# ADR-0003: PostgreSQL 17

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

CRM2 is an integrity-heavy transactional system that also drives
reporting. It must run on managed infrastructure. The choice of database
engine and version anchors many downstream decisions (constraints, partitioning,
reporting views).

## Decision

We standardize on **PostgreSQL 17**.

- It is **available on RDS** (managed), satisfying our hosting requirement.
- It provides the capabilities the data model depends on: **partitioning**,
  **jsonb**, **CHECK constraints**, and **triggers**.
- **PostgreSQL 18 is deferred** until it reaches **managed GA**.

## Consequences

### Positive

- Managed (RDS) operation: backups, patching, failover handled by the platform.
- Full access to the constraint/trigger/partitioning/jsonb feature set the
  schema relies on.

### Negative

- We forgo any PG18-only improvements until managed GA.

## Alternatives Considered

- **PostgreSQL 18** — rejected for now: not yet GA on managed infrastructure.
- **Non-PostgreSQL engines** — rejected: the data model is built on
  PostgreSQL-specific constructs (see ADR-0004).

## Related ADRs

- ADR-0004 — the constraint/trigger-heavy schema that requires these features.
- ADR-0010 — reporting via PostgreSQL views and materialized views.
