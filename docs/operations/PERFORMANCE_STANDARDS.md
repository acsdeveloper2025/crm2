# Part 12 — Performance Standards

Status: architecture FROZEN. These targets are **ratified** and enforced in CI.
A release that breaches a budget is **blocked**.

## Ratified Targets (p95)

| Screen | p95 budget |
|---|---|
| Dashboard | < 2s |
| Pipeline | < 2s |
| Case Open | < 2s |
| Workspace | < 2s |
| MIS filters | < 3s |
| Exports | **background job** (never inline; see below) |

## Pagination, Loading & Long-Running Operations (FROZEN 2026-06-05)

The full UX/scalability freeze lives in **`docs/PAGINATION_AND_LOADING_STANDARDS.md`** (SoT).
Performance-relevant rules ratified here:
- **Server-side pagination on every list endpoint** — default `25`; allowed `25/50/100/200`;
  extended max `500` (MIS/reporting only); **above 500 forbidden** (require filters or export).
  No endpoint returns unbounded rows. Standard envelope: `items,totalCount,page,pageSize,totalPages,sort,filters`.
- **Loading time-bands:** 0–300ms no loader · 300ms–1s skeleton · 1–3s loader+%, · 3–8s
  loader+%+operation · **>8s ⇒ background job**. Real (stage-based) percentages only; tables use
  skeleton rows.
- **Long-running ops (>8s)** — PDF/MIS/Billing/Commission export, bulk import, bank-API batch
  sync, report regen — run as **background jobs**; user keeps working; completion via bell/toast/
  in-app. Exports never paginate.

## What's Measured
- **Server response**: p50 / p95 / p99 per endpoint.
- **Client TTI** (Time To Interactive) per screen.
- The p95 screen target above = server response + client render to interactive.

## Per-Screen Budgets
Each of the four screens above gets a documented split: server p95 + client TTI
must sum under 2s. Hot list endpoints (Dashboard, Pipeline) carry the tightest
server budgets since they fan out to aggregations.

## Query-Count / N+1 Protection (Part 23)
- Hot list endpoints have **query-count assertions** in their integration tests.
- A handler that exceeds its declared query threshold (the N+1 signature) **fails CI**.
- New list/detail endpoints must declare a query budget before merge.

## Database Performance Rules
- **Indexes** on every filter/join/sort column on hot paths.
- **Partition pruning** verified for partitioned tables (queries must hit the pruning predicate).
- **`mv_` materialized views** for heavy aggregations (dashboard/MIS rollups); never aggregate raw on the request path.
- **`EXPLAIN`** required on every hot-path query in review; no seq-scans on large tables.
- **Pagination mandatory** on all list endpoints — no unbounded result sets.

## Frontend Budgets
- **Bundle budget** per route (code-split; lazy-load non-critical screens).
- **Payload budget** per list response (page size capped; no over-fetching).
- Breaching a bundle/payload budget fails the CI perf check.

## Caching
- **Valkey** caches **scope resolution** (RBAC subtree / territory / portfolio) at scale — the hottest cross-cutting lookup — with explicit invalidation on hierarchy change.

## Continuous Tracking
- p50/p95/p99 + TTI tracked continuously per `MONITORING_STRATEGY.md` and
  `OBSERVABILITY_STANDARDS.md`. Dashboards alert on sustained budget approach.

## Regression Policy
- A release that **breaches any budget is blocked**.
- Query-count regressions on hot endpoints block CI (Part 23).
- Bundle/payload budget overruns block CI.
- See `docs/CI_CD_STANDARDS.md` for gate wiring and override (ADR-only) process.

## Universal DataGrid (FROZEN 2026-06-05) — SoT `docs/DATAGRID_STANDARD.md`
All tables are the one TanStack-Table-based DataGrid doing **server** search/filter/sort/pagination
(no large client-side datasets, no client-side filtering on operational screens). Budgets unchanged
(dashboard/pipeline/cases/workspace <2s, MIS <3s, exports=background job). Export respects the
current view and runs as a job. DB: indexed sort/filter columns, no `SELECT *`, `EXPLAIN` reviewed.
