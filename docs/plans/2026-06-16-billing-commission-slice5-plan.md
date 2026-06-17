# Slice 5 — Billing & Commission (per-case, unified) — PLAN

- **Date:** 2026-06-16
- **Status:** Proposed (awaiting owner go-ahead to build sub-slice 5a)
- **ADR:** ADR-0036 (to be written at 5a) · next mig = 0058
- **Lifecycle:** ADR-0032 two-track; "task is the unit of billing"

## Decisions (owner-confirmed 2026-06-16)

1. **Unified surface** — one Billing & Commission view covering BOTH money flows per case:
   - **Client billing** (money in): amount per completed task from the EXISTING `rates`
     engine (resolved area > pincode > case > default, temporal). No new billing-rate table.
   - **Agent commission** (money out): amount per completed task from a NEW `commission_rates`
     config table (user × rate_type × client → amount), v1-`field_user_commission_assignments`
     parity, most-specific-client-wins + temporal.
2. **Eligibility = ANY COMPLETED task** (not field-only; diverges from v1/Zion which are
   field-only). The task assignee (field agent / office / KYC verifier) earns commission iff a
   `commission_rates` row matches; the client bill always resolves from `rates`. Revoked never
   bills (it is never COMPLETED — revoke is blocked on COMPLETED → revisit). A revisit task
   bills as its own COMPLETED task; a reassign-after-revoke replacement bills once when it
   completes (the revoked original never reached COMPLETED).
3. **Derived amounts now; engine later.** Slice 5 COMPUTES amounts at read time and renders the
   view; it does NOT persist a billed-state or generate invoices/payouts. The ONLY new
   persistence is the `commission_rates` CONFIG table (master data, like `rates`). The
   billed-marker (`case_tasks.billed/billed_at`), invoice generation, GST, and the payout run
   are the NEXT slice (the "engine").
4. **Outcome-independent** — commission/bill do not depend on `verification_outcome` (v1 parity).

## Model

Per COMPLETED task `t` with assignee `u`, resolved `rate_type rt` (already on TASK_VIEW_COLS),
case client `c`:
- `billAmount(t)` = `rates.amount` for (c.client, product, t.unit) via the existing ladder.
- `commissionAmount(t)` = `commission_rates.amount` for (u, rt, c.client) — most-specific-client
  (`client_id = c OR client_id IS NULL`, `ORDER BY client_id DESC NULLS LAST`), temporal,
  `is_active`; NULL when the assignee has no matching rate (shown as "—/unset", honest).
- `billingClass(t)` = `task_origin` (ORIGINAL | REVISIT) — label only; both bill.
- Per-case rollup = Σ billAmount + Σ commissionAmount over the case's COMPLETED tasks.

## Sub-slices (each = one vertical → verify → audit panel → live E2E + browser-verify → commit → push → memory)

### 5a — `commission_rates` master-data module  *(foundation; ADR-0036 here)*
- **mig 0058** `commission_rates` (id, user_id FK users, rate_type varchar, client_id FK clients
  NULL=universal, amount numeric(12,2), currency, is_active, effective_from, effective_to,
  version, created_by/updated_by/created_at/updated_at). Partial/unique to prevent overlapping
  active rows per (user, rate_type, client) — mirror `rates` constraints. Triple-write
  :54329 + :5433.
- **@crm2/access**: new perms (reuse `billing.*` family — confirm existing billing perms; add
  `billing.commission_rate.manage` or fold into an existing billing-config perm). Roles parity.
- **API** module `commission-rates` (repo/service/controller/routes): scoped CRUD list/create/
  update/delete + resolver helper `resolveCommissionAmount(userId, rateType, clientId)`. OCC
  version on writes. Default-deny + scope.
- **SDK** types + client methods. **openapi** regen (new routes).
- **Web**: a commission-rate assignment section (MasterDataCrud pattern, like `rates`) — likely
  under the Billing page or an Admin/Rates area. DataGrid standard (Created/Updated cols).
- Tests (CRUD + resolver most-specific-wins + temporal + scope isolation) + audit panel
  (DB/Principal/Security/API-Contract/CEO).

### 5b — billing read-model + per-case rollup
- **API**: a billing query — per-case summary over COMPLETED tasks with `billAmount` +
  `commissionAmount` + `billingClass` per task and case totals. New endpoint
  `GET /api/v2/billing/cases` (Paginated, scoped via the case scope seam; filters: client,
  date range, has-commission). Reuse the rates resolver; add the commission resolver subquery.
  Export (data.export, async-job tier already exists).
- **SDK** types (BillingCaseRow + BillingTaskLine) + client. **openapi** regen.
- Tests (rollup correctness; any-completed-task eligibility; revoked excluded; revisit bills;
  scope) + audit panel.

### 5c — Billing & Commission frontend page
- **Web**: `/billing` page (nav, perm-gated). Per-case DataGrid → expand a case to its
  completed-task lines (task #, type, assignee, billingClass, bill amount, commission amount) +
  case totals (Σ bill, Σ commission); filters (client/date/has-commission); export. Single-
  column accordion for the per-case lines (owner's no-empty-pane preference). Follows the
  CRM2 2.0 "MIS & Billing" screen vision (consolidate later).
- e2e (Playwright) + viewport/a11y + browser-verify on :5273 (render real data, 0 console
  errors). Audit (CEO/Design-Quality/Principal).

### 5d — Pipeline billable / commissionable column + bucket
- **API/SDK**: extend `TaskView` with `billable` (status=COMPLETED) + `billAmount` +
  `commissionAmount`. **Web**: a Pipeline column + a "Commissionable" bucket/filter (mutually
  exclusive with status buckets, mirrors the SLA bucket pattern from slice 2a/2b).
- e2e + browser-verify. Audit (CEO/API-Contract).

## Out of scope (next "engine" slice)
- Persisted billed-state (`case_tasks.billed/billed_at`) + a "mark billed" action + double-bill
  guard; invoice generation + GST + invoice PDF/export; commission payout run + PENDING→
  APPROVED→PAID lifecycle; case-detail financial summary card.

## Risks / notes
- Amount resolution must reuse the EXACT existing rates ladder (don't fork it) — extend
  TASK_VIEW_COLS or a billing-specific query consistently.
- `commission_rates` is CONFIG, not billed-state — the "no migration for billed-state" decision
  is honored; this one config table is the agreed exception that makes the unified view real.
- Eligibility "any completed task" means an OFFICE/KYC assignee with no commission rate shows
  commission "—"; that's correct (configure to enable), not a bug.
- KYC: a KYC task is COMPLETED like any other → billable by the rates engine; commission only
  if its assignee has a commission rate. No separate KYC billing path (simpler than v1).
