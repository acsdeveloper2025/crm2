# ADR-0029: Dashboard — read-only operations overview

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

The web app's `Dashboard` nav was a disabled placeholder. Every other surface
(Pipeline, Cases, Field Monitoring) is a work surface; there was no at-a-glance
landing page summarising "where does my work stand right now", scoped to the
viewer's hierarchy. Zion (the reverse-engineered competitor) makes a persistent
3-bucket pipeline counter its universal spine and a client×product portfolio table
its home page — a model proven to be trivially learnable.

Constraints carried from the rest of the system:

- **Truthful data only.** Every number must trace to a live query over real
  columns. No mock, no placeholder-as-data, no fabricated bar. A widget without a
  real source renders `—`/empty.
- **One scope seam.** Visibility must reuse `resolveScope` +
  `taskScopePredicate`/`caseScopePredicate` (ADR-0022) — no new scope logic, so
  the dashboard's numbers are exactly the rows the Pipeline/Cases would show.
- **Frozen stack.** No charting dependency may be added without its own ADR.
- **6 roles**, FIELD_AGENT is mobile-only (no web page).

## Decision

We will add a **read-only operations overview** at `/dashboard`, scoped to the
actor's hierarchy, composed from a single aggregation module.

- **Backend** — one module `modules/dashboard/` (routes → controller → service →
  repository; raw SQL only in the repository).
  - `GET /api/v2/dashboard/stats` — one scan over `case_tasks ct JOIN cases cs`
    (≈18 `FILTER` aggregates, one round-trip): pipeline counter bar
    (bucket/assigned/in-progress/awaiting-review/completed/revoked) + today's
    throughput & trend (assigned/completed today, yesterday, 7d) + aging of open
    held work (≤24h/24-48/48-72/>72h, overdue, oldest-unassigned). Gated by a new
    `page.dashboard` permission. **Office-pool roles** (KYC_VERIFIER, resolved
    data-driven from `assignment_pool_roles`) get the OFFICE-scoped board
    (`visit_type='OFFICE'`), not the cross-visit pipeline.
  - `GET /api/v2/dashboard/portfolio` — client × product rollup (pending/
    completed/total cases), grouped by the FK ids (names are not unique). Gated by
    `billing.generate` — held by exactly SUPER_ADMIN + MANAGER, so no new
    permission is needed for the SA/MANAGER-only surface.
  - The field roster summary **reuses** `GET /api/v2/field-monitoring/stats`
    verbatim — no new endpoint, so the dashboard and the console can't disagree.
- **Scope is enforced server-side in the repository**, predicate in the OUTER
  `WHERE` (never inside a `FILTER`); SUPER_ADMIN / hierarchy-ALL resolves to an
  empty predicate (no filter). Client-side permission checks only decide whether a
  widget mounts — every endpoint independently 403s.
- **Frontend** — `features/dashboard/` composes the widgets and gates the
  supervisor surfaces by permission. All data viz is **no-dependency** (CSS
  proportional bars + inline SVG): `CounterBar`, `KpiCard` (with ▲/▼ trend delta),
  `AgingBuckets`, `PortfolioTable` (`.rtable`), `RosterSummary`. Tokens only.
  Every tile links INTO the Pipeline/Case/console pre-filtered; the dashboard
  never acts.
- **Migration 0047** grants `page.dashboard` to MANAGER/TEAM_LEADER/
  BACKEND_USER/KYC_VERIFIER (SA via grants_all; FIELD_AGENT excluded), mirroring
  `@crm2/access` `ROLE_PERMISSIONS` (the roles parity test keeps them byte-identical).
  No materialized view: a snapshot would go stale and break truthfulness, and
  per-actor scope makes a shared MV impossible.

**Deliberately deferred** (no truthful source today, shipped as `—` / absent, not
fabricated): a recent-activity feed (`audit_log` is master-data only, no lifecycle
stream), revisit/recheck counts (no lineage column), field idle/active
(`latest_device_location` empty until mobile rebases).

## Consequences

### Positive

- A scoped, truthful, at-a-glance landing for all 5 web roles; `/` now lands here.
- Zero new dependencies; reuses the scope seam and the field-monitoring stats
  endpoint, so numbers are consistent across surfaces by construction.
- One homogeneous scan for the whole counter+throughput+aging payload; live
  aggregation is fast on the indexed access paths (no MV to keep fresh).

### Negative

- BACKEND_USER (SELF scope, no pool) sees a near-empty board until assigned/owning
  work — a product gap, not a code bug.
- The portfolio `total` is `count(*)` while `pending+completed` excludes any future
  CANCELLED cases; they reconcile today only because no code writes CANCELLED.
- The deferred widgets leave the dashboard less rich than v1 until their sources
  are built (lifecycle audit stream, task lineage, device-location producer).

## Alternatives Considered

- **Materialized view (v1's `mv_dashboard_kpi_7d`)** — rejected: per-actor scope
  makes a shared MV impossible, and a snapshot breaks "every number is live".
- **Fold Pipeline into the dashboard (Zion's single screen)** — rejected for now:
  bigger change to an existing route; kept Dashboard as a read-only overview and
  Pipeline as the work surface.
- **Add a charting library (recharts, as in v1)** — rejected: frozen stack; the
  no-dependency CSS/SVG bars meet the need without a frozen-stack reopen.
- **A dedicated `dashboard.portfolio` permission** — rejected: `billing.generate`
  already partitions exactly SUPER_ADMIN + MANAGER; the parity test locks it.

## Related ADRs

- ADR-0022 — Access Control 2.0 (the scope seam + role/permission model this reuses).
- ADR-0026 — Field Monitoring (the `/stats` endpoint the roster summary reuses).
- ADR-0028 — Server-authoritative time (the IST day-boundary windowing pattern).
