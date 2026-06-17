# Architecture Decision Records — CRM2

This directory holds the Architecture Decision Records (ADRs) for CRM2.
An ADR captures a single significant architectural decision, the context that
forced it, and its consequences. ADRs are the durable, version-controlled
memory of *why* the system is built the way it is.

The architecture is **FROZEN**. The ADRs below **record decisions that have
already been made and accepted** — they are documentation, not proposals.

## Purpose

- Give every engineer a single, authoritative answer to "why was it done this
  way?" without archaeology through chat logs or commit history.
- Make the cost of changing a frozen decision explicit and deliberate.
- Preserve the alternatives that were evaluated and rejected, so they are not
  re-litigated by accident.

## When an ADR is required

- **Every major / architectural decision** must have an ADR: data model,
  persistence strategy, framework choices, cross-cutting patterns, naming
  standards, design system, reporting strategy, and similar.
- **Changing a frozen decision** does not edit the old ADR. It requires a
  **new ADR that supersedes the old one**, and it requires sign-off from the
  **CTO** plus the relevant **domain owner**. The superseded ADR is marked
  `Superseded` and links forward to its replacement.

Trivial, reversible, or purely local implementation choices do not need an ADR.

## Lifecycle

```
Proposed → Accepted → Superseded | Deprecated
```

- **Proposed** — drafted, under review.
- **Accepted** — agreed and in force.
- **Superseded** — replaced by a later ADR (link to it).
- **Deprecated** — no longer relevant, with no direct replacement.

## Numbering

ADRs are numbered sequentially as `ADR-NNNN` (zero-padded, four digits).
Numbers are never reused. Filenames follow `ADR-NNNN-kebab-slug.md`. Use
[`_template.md`](./_template.md) (MADR-style) for new records.

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [ADR-0001](./ADR-0001-verification-unit-registry-model.md) | Verification Unit registry model | Accepted | 2026-06-04 |
| [ADR-0002](./ADR-0002-case-task-verification-unit-model.md) | Case → Task → Verification Unit model | Accepted | 2026-06-04 |
| [ADR-0003](./ADR-0003-postgresql-17.md) | PostgreSQL 17 | Accepted | 2026-06-04 |
| [ADR-0004](./ADR-0004-no-prisma-no-orm.md) | No Prisma / no ORM | Accepted | 2026-06-04 |
| [ADR-0005](./ADR-0005-repository-pattern-data-access.md) | Repository pattern + data-access strategy | Accepted | 2026-06-04 |
| [ADR-0006](./ADR-0006-verification-workspace.md) | Verification Workspace | Accepted | 2026-06-04 |
| [ADR-0007](./ADR-0007-naming-standards.md) | Naming standards | Accepted | 2026-06-04 |
| [ADR-0008](./ADR-0008-design-system.md) | Design system | Accepted | 2026-06-04 |
| [ADR-0009](./ADR-0009-feature-flags.md) | Feature flags | Accepted | 2026-06-04 |
| [ADR-0010](./ADR-0010-reporting-strategy.md) | Reporting strategy | Accepted | 2026-06-04 |
| [ADR-0011](./ADR-0011-api-versioning-strategy.md) | API versioning strategy | Accepted | 2026-06-04 |
| [ADR-0012](./ADR-0012-mobile-integration-strategy.md) | Mobile integration strategy | Accepted | 2026-06-04 |
| [ADR-0013](./ADR-0013-governance-engineering-standards.md) | Governance & engineering standards | Accepted | 2026-06-04 |
| [ADR-0014](./ADR-0014-authentication-session-management.md) | Authentication & session management | Accepted | 2026-06-05 |
| [ADR-0015](./ADR-0015-case-workspace-and-per-client-product-reporting.md) | Case Workspace & per-client+product reporting | Accepted | 2026-06-05 |
| [ADR-0016](./ADR-0016-rate-management-resolution-versioning-workspace.md) | Rate Management resolution, versioning & workspace | Superseded → ADR-0018 | 2026-06-05 |
| [ADR-0017](./ADR-0017-effective-from-temporal-usability-gating.md) | Effective-From temporal usability gating | Accepted | 2026-06-05 |
| [ADR-0018](./ADR-0018-rate-management-flat-one-table-model.md) | Rate Management — flat one-table model (supersedes 0016) | Accepted | 2026-06-05 |
| [ADR-0019](./ADR-0019-concurrency-and-editing-standard.md) | Concurrency & editing standard (optimistic concurrency control) | Accepted | 2026-06-05 |
| [ADR-0020](./ADR-0020-correctable-identity-keys-while-unreferenced.md) | Correctable identity keys while unreferenced (amends ADR-0001) | Accepted | 2026-06-06 |
