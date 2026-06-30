# ADR-0081: Periodic per-field-user commission summary export

- **Status:** Accepted (CTO) · owner sign-off pending at push
- **Date:** 2026-07-01
- **Relates to:** ADR-0036 (billing/commission read-model, export-only scope) · ADR-0046/0050 (commission resolution) · ADR-0047 (commission frozen at SUBMIT) · ADR-0056 (field_rate_type derived) · ADR-0037 (MIS). No migration.
- **Extends:** ADR-0036 — adds a second commission read-model grain (per-agent × period); does **not** change resolution, the schema, or any existing endpoint. Stays inside the **export-only** scope (no invoice / GST / payout engine — those remain WONTFIX).
- **Audit:** closes `docs/engineering/FIELD_COMMISSION_EXPORT_AUDIT_2026-07-01.md` gaps **FC-1** (periodic export) + **FC-2** (per-field-user aggregation) and bakes in **FC-5** (earned-at anchor). FC-3/FC-4 stay DEFERRED (15-day was implemented anyway — see Decision); FC-6/FC-7/FC-8 stay WONTFIX.

## Context

The audit found the per-case Billing read-model (ADR-0036) could not answer the operational question it exists to serve — **"how much do we owe each field agent for this pay period."** It is grained per **case** (the assignee appears only inside the per-case accordion and is not even a column in the export), and both Billing and MIS accept only a freeform `completedFrom`/`completedTo` range on `ct.completed_at` — no period preset, no per-agent rollup.

v1 had this: a commission **pivot export** with `week/month/quarter/year` presets keyed on `case_completed_at`, pivotable user × client × product. v2 was behind v1. Zion is not a parity model (salaried field execs, no commission engine).

A further defect (FC-5): commission **freezes at SUBMIT** (`submitted_at`, ADR-0047) but every existing filter keys on `completed_at` — so a SUBMITTED-not-yet-completed task (with `completed_at = NULL`) drops out of any dated view, and a task submitted in one period but completed in the next is attributed to the wrong period.

## Decision

Add a third Billing read-model: **Commission Summary** — a periodic, per-field-user agent-commission rollup, read-only and export-capable, gated `billing.view` (same audience as the rest of Billing; the export carries the same compensation amounts so it shares the gate, never `data.export` alone).

- **Endpoints (additive):** `GET /api/v2/billing/commission-summary` (paginated list) + `GET /api/v2/billing/commission-summary/export` (DataGrid export). No new module — extends `modules/billing`.
- **Grain:** one row per field-user × **period bucket**, optionally also × client × product (`groupBy = agent | agentClientProduct`). Columns: agent, [client, product,] period, tasks, billable units, commission total.
- **Periods (`period`):** `week` (ISO Mon–Sun), `fortnight`, `month`, `quarter`. **`fortnight` = the twice-monthly Indian payroll cycle — 1st–15th (`-H1`) / 16th–EOM (`-H2`)**, NOT a rolling 14 days. This is the one assumption to confirm with the owner; if the pay cycle is rolling-14 instead, only the `fortnight` SQL fragment in `PERIOD_SQL` changes. (FC-3 had deferred 15-day; it is cheap over the same machinery so it ships now.)
- **Amounts:** the SAME `COALESCE(ct.commission_amount, com.commission_amount)` (frozen snapshot preferred, else the live `COMMISSION_LATERAL`) × `bill_count` the Billing page sums — no new money path, no divergence.
- **FC-5 fix — earned-at anchor:** the period bucket AND the `from`/`to` range both key on `COALESCE(ct.submitted_at, ct.completed_at)` (when the field earned), not `completed_at`. Rows are `status IN ('SUBMITTED','COMPLETED')`, so a submitted-not-completed task's frozen commission is counted in the period it was earned.
- **Security:** `period`/`groupBy` are whitelisted in the service against a fixed map and never interpolated raw; the case-scope predicate (defence-in-depth) is reused from the Billing read-model; pagination + the ≥10k export-job threshold reuse the platform helpers.

Read-only, derived, no persisted state. No migration, no schema change. Mobile/`commission_rates`/resolution untouched.

## Consequences

- **Restores v1 parity, inside the export-only scope.** Operators can export each agent's commission by week / fortnight / month / quarter, per agent and (optionally) per client+product, as an Excel/CSV payout sheet — paid outside the CRM per ADR-0036/the 2026-06-25 export-only decision.
- **No new attack surface or money path.** Same gate, same scope predicate, same resolver and snapshot; only a new GROUP BY + period bucketing in SQL and a new read-only page.
- **FC-5 corrected for this report only.** The per-case Billing list/breakdown still key on `completed_at` (unchanged — those are client-bill views, billed at COMPLETE). The new summary is the commission/earned-at view.
- **OpenAPI regenerated** (+2 paths). SDK gains `billing.commissionSummary` / `commissionSummaryExport` + `CommissionSummary*` types. Web gains a `Commission Summary` page + nav (gated `billing.view`).
- **Coverage:** new API integration tests prove per-agent monthly rollup, `groupBy` client+product split, the FC-5 earned-at anchor (bucket + range), and quarter/fortnight bucketing; new SDK transport tests cover the two methods. Full `pnpm verify` green.
- **Sort is fixed** (period DESC, then agent) — no server sort param yet; add one if operators need it (YAGNI today). `bill_count` is effectively ×1 since SHIP-2, so `billableUnits ≈ taskCount` until/unless multi-bill returns.

## Alternatives considered

- **Add a `period`/`groupBy` to the existing `/billing/cases`.** Rejected — that endpoint is per-case; bolting a per-agent grain onto it overloads one route with two incompatible shapes.
- **Reuse MIS layouts.** Rejected — MIS is per-task, per single client+product, layout-authored; it can show an assignee column but cannot aggregate per agent across clients or bucket by period.
- **Persist a commission ledger / payout run.** Out of scope — ADR-0036 keeps billing/commission export-only (WONTFIX); this is a read-model, not a payout engine.
- **Rolling-14-day fortnight.** Rejected as the default in favour of twice-monthly (matches "15-day" literally + common Indian payroll); swappable in one SQL fragment if the owner's cycle differs.
