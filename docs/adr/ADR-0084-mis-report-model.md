# ADR-0084 — MIS report model: predefined report types + code-owned column allow-list

**Status:** Accepted · Owner-confirmed (2026-07-01) · **Date:** 2026-07-01 ·
**Supersedes:** ADR-0037 (MIS Layout Engine), ADR-0049 (MIS generation & export engine) — both already torn
out by ADR-0083. **Migration:** `0109` (seeds `mis.view` + `mis.export`; no new data table). **Design spec:**
[docs/specs/2026-07-01-mis-rebuild-design.md](../specs/2026-07-01-mis-rebuild-design.md). **Adversarial review
folded in** (2026-07-01; dispositions in [COMPLIANCE_GAPS_REGISTRY §MIS-2026-07-01](../COMPLIANCE_GAPS_REGISTRY.md)).

## Context

The previous MIS (ADR-0037 + ADR-0049) was removed on 2026-07-01 ([ADR-0083](./ADR-0083-remove-mis-report-layout-engine.md),
mig 0108) for terminal complexity: one shared `report_layouts` table with five `kind`s, a `source_type → SQL`
grammar whose stored config strings were the injection boundary, and MIS / Billing MIS / office Data-Entry
tangled behind one designer. MIS must return — ACS needs an operational report over cases/tasks (state,
outcomes, TAT, counts, money) that ops runs daily and exports — but built simply and safely.

Constraints: frozen-architecture build-only; `/api/v2` additive-only; raw SQL only in repositories;
centralized logger; never break mobile; money stays `billing.view`-gated; out-of-scope ⇒ 0 rows (never IDOR).

Owner decisions (2026-07-01): report model = **predefined types + configurable view**; **two report types,
task-grain first** (`TASK_OPERATIONAL`, then `CASE_OPERATIONAL`); **v1 = internal operational MIS** (bank
identifiers are data-model gaps); **full PII export accepted** (owner-signed); **read-only** (blank → `—`, no
completion/mobile change). A 3-reviewer adversarial review (security/architecture/domain) upheld the approach
and surfaced defects now fixed in the spec.

## Decision

**We will build MIS as a small registry of code-owned report types, each exposing a fixed column allow-list the
user toggles/filters/groups/exports — no SQL grammar, no admin-authored columns, no config table.**

- **Two report types, task-grain first.** `TASK_OPERATIONAL` (one row per task) ships first; `CASE_OPERATIONAL`
  (one row per case — correct for case counts / bank-style rows) follows. **Grains are never mixed on one
  sheet** (mixing double-counts). Later: `TAT_SLA`, `BILLING_COMMISSION`.
- **Columns are code-owned constants.** The API accepts only registry **keys** (per selected type); unknown /
  duplicate / wrong-type key → 400 (MIS does its own strict validation, not the lenient platform helpers).
  Filter values + LIMIT/OFFSET are bound; `ORDER BY` direction is a switch; `form_data` access is fixed
  fragments only (**no request-supplied jsonb path**). Injection surface removed by construction.
- **Formats:** Tabular + Summary only. Summary sums reuse billing's **exact** expressions, copied verbatim
  from the shared laterals (`FILTER(status='COMPLETED') · × bill_count · COALESCE(snapshot, live)`). A
  summary money-value equality test vs the `/billing` endpoint is a tracked follow-up (registry
  §MIS-2026-07-01); the shipped tests guard the money-gate + every column's SQL validity.
- **Base predicate = all in-scope work, NOT the billing status filter.** Reuse the laterals for money only;
  the billing read-model's `status IN ('SUBMITTED','COMPLETED')` is **not** inherited (it would hide open
  work). Status is a user filter; open rows show `—` for money.
- **DB:** no new data table for v1 — a live query over `cases`/`case_tasks` with registry-driven **conditional
  1:1-join composition**; 1-to-many relations (assignment history, co-applicants, photo counts, per-case
  outcome counts) are **never plain joins** (fan-out doubles rows/money) — they are excluded or computed as
  correlated subqueries. Mig `0109` seeds the two permissions.
- **API:** additive `/api/v2/mis` — `GET /report-types` (gated `mis.view`), `/:type/rows`, `/:type/summary`,
  `/:type/export`. Export is **sync only**; `≥10k` returns an honest **413** (matching billing/tasks). The
  async job tier is **not** built for MVP — its `ExportBuild` signature carries no role/scope and would leak
  (BUSINESS_LOGIC-03); a real async slice (re-applying scope + `billing.view` inside the builder) is deferred.
- **RBAC + money:** `mis.view` (page, ≠ money) + `mis.export`. Money (`bill_amount`, `commission_amount`,
  `bill_line_amount`; case totals `case_bill_total`/`case_commission_total`) is gated by `billing.view` on
  **every** surface — dropped from FROM (laterals omitted), catalog, projection, **sort/filter/group keys**,
  and summary sums — via one shared guard; the `selectColumns` manifest is built already-money-stripped. Rate
  codes + `bill_count` are not money. Row-scope via `composeScopePredicate` (out-of-scope ⇒ 0 rows + count 0).
- **PII (accepted):** PAN/mobile/GPS/geocoded-address are exportable to `mis.export` holders with no extra
  gate/masking — formally ACCEPTED (owner-signed), recorded in the registry; extends the deferred DATABASE-04.
- **Read-only:** MIS never changes create/complete or the mobile contract; absent values render `—`.

## Consequences

### Positive
- No config-as-SQL surface; the removed engine's injection boundary cannot recur.
- Grain-correct by design (two report types) — no double-counting; each column belongs to one grain.
- Maximum reuse (laterals, export, DataGrid, scope, RBAC); adding a report type/column is code + a test.
- Money-gating and row-scope reuse audited patterns; the leak channels the review found are closed up front.

### Negative / accepted
- Report types/columns require a deploy to change (intended — ACS's report set is fixed).
- No ad-hoc pivots (matrix deferred); no >10k export until the async slice is built (413 meanwhile).
- **Bank-format MIS is out of scope** — LOS/LAN, case-type, region/zone, sampling-TAT, the doc-count matrix
  are data-model gaps (deferred; own ADR + migration + create-flow capture).
- **Bulk PII export is an accepted DPDP exposure** (owner-signed) — plaintext PAN/mobile/geo can leave in a
  spreadsheet; recorded, not mitigated.

## Alternatives considered
Revive ADR-0037/0049 (the removed injection engine) — rejected · full custom report builder — rejected
(reintroduces injection) · fixed hard-coded reports — rejected (too rigid) · mv/worker for MVP — deferred
(ADR-0010) · DB config table for report defs — rejected (code registry safer) · **one mixed case+task grain
sheet** — rejected (double-counts; split into two report types) · async export tier for MVP — deferred (leak
risk; sync + 413 instead).

## Related ADRs
Supersedes ADR-0037, ADR-0049; follows ADR-0083. ADR-0010 (reporting — `mv_` deferred), ADR-0081
(commission-summary read-model — reused shape/laterals), ADR-0022/0072/0078 (RBAC + scope), ADR-0080
(field-report snapshot), ADR-0032 (two-layer outcome — field evidence vs official verdict), ADR-0076/0082
(security; DATABASE-04 PII-at-rest — extended by the accepted PII export).
