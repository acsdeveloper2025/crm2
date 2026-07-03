# ADR-0086 — Separate Billing from Commission + redesign the Billing page

**Status:** Accepted · Owner-approved (2026-07-03) · **Date:** 2026-07-03 · **Migration:** `0112`
(rename the commission-summary permission code in `role_permissions`, grant-carrying every holder).
**Extends:** ADR-0022 (roles/`role_permissions` as the runtime RBAC authority), ADR-0046 (billing read-model +
commission location/TAT dimensions), ADR-0081 (commission-summary periodic export). **Supersedes:** the ADR-0046
decision that Billing and Commission share one page/surface (the `/billing` "Billing & Commission" page and the
`billing.commission_summary.view` permission's `billing.` namespace). **Design spec:** inline (§Redesign brief) —
the redesign stays a derived read-model, no separate spec doc.

## Context

`/billing` today is **one page** ("Billing & Commission", `features/billing/BillingPage.tsx`, ADR-0046) that renders
**both** concerns: per-case **client billing** (bill totals over completed tasks) **and** per-executive
**commission** (a "Commission" grid column, per-task commission line-totals, and the ADR-0046 §6 breakdown panels'
commission columns). The periodic **Commission Summary** page (ADR-0081) hangs off it as the **sub-route**
`/billing/commission-summary`, and its permission is namespaced **under** billing as `billing.commission_summary.view`.
The owner wants the two concerns cleanly separated: Billing-only on `/billing`, Commission promoted to its own
top-level page + nav + permission, and the Billing page **redesigned properly**.

Discovery (2026-07-03, five parallel readers, all `file:line`-verified) established the ground truth:

- **Billing is a fully DERIVED read-model — there is NO stored billing/invoice table.** `/billing/cases`,
  `/billing/cases/:id/tasks`, `/billing/breakdown` compute amounts at read time from the live `rates`/`commission_rates`
  engine via `platform/billing/laterals.ts` (`RATE_LATERAL` = client bill; `COMMISSION_LATERAL` = field commission).
  Only `case_tasks.commission_amount` is persisted (the ADR-0047 submit-time snapshot). So a Billing redesign that
  stays derived needs **no schema change**.
- **The RBAC money-gate trap, and why it's avoidable.** `billing.view` is the **platform-wide money-gate**: the
  Pipeline/Tasks read-model (`modules/tasks`, **mobile-facing**) and MIS (`modules/mis`) include bill *and* commission
  ₹ columns **only** for `billing.view` holders (`canViewBilling` in both controllers keys off `PERMISSIONS.BILLING_VIEW`).
  `billing.commission_summary.view` gates **only** the commission page + its four endpoints — **nothing else keys off it.**
  Therefore renaming the commission perm while **leaving `billing.view` untouched** cannot regress any money-gate.
- **Mobile does not consume `/api/v2/billing/*` or any commission endpoint** (verified against the `contract:mobile`
  module allow-list and ADR-0054 scope). Billing/commission is web-only; changes here are additive-safe for mobile
  regardless.
- **RBAC authority is the DB `role_permissions` table** (ADR-0022): `authorize()` resolves a role's permission codes
  from `role_permissions` (cached); `@crm2/access` `ROLE_PERMISSIONS` is a retired-at-runtime **mirror**, kept
  parity-tested against the migration seeds; `PERMISSIONS`/`PERMISSION_META` is the validated code catalog. A perm
  rename is thus a **triple-write** (code catalog + code mirror + a `role_permissions` migration).

Owner decisions (2026-07-03, §3.5 of the kickoff), all the recommended option:
(a) promote Commission to top-level `/commission-summary` with its own Operations nav item;
(b) rename the permission out of the `billing.` namespace → `commission_summary.view`, grant-carrying every current
holder, `billing.view` untouched, Commission Rates left on `masterdata.manage`;
(c) redesign Billing as a **summary dashboard + drill-down that stays a derived read-model** (no new billing tables);
(d) remove **all** commission from the Billing page (column + line-totals + breakdown columns) **and from the billing
export**, and add a link Billing → Commission.

## Decision

**We split the single Billing-&-Commission surface into two independent surfaces — Billing (`/billing`,
`billing.view`) and Commission (`/commission-summary`, `commission_summary.view`) — without touching the `billing.view`
money-gate, and redesign Billing as a derived summary-dashboard-plus-drill-down. Ship in two slices.**

1. **Commission leaves the Billing page and its export (owner d).** Remove from `BillingPage.tsx`: the "Commission"
   DataGrid column, the per-task commission line-total footer, and the breakdown panels' commission columns
   (by-location and by-TAT-band). Stop selecting commission on the billing surface at the source — drop
   `commissionTotal` from the `/billing/cases` and `/billing/breakdown` queries (`repository.ts`) and from the
   `BillingCaseRow` / `BillingLocationGroup` / `BillingBandGroup` SDK DTOs — so the billing **export** (which reuses the
   list query) carries no commission. `BillingTaskLine.commissionAmount`/`tatBand` likewise drop from the per-task
   surface. The `RATE_LATERAL`/`COMMISSION_LATERAL` helpers stay (Pipeline/MIS/commission still use them). Add a link
   from Billing → the Commission page. Relabel nav `Layout.tsx` "Billing & Commission" → **"Billing"** and the page
   `<h1>`/subtitle.

2. **Commission is promoted to a top-level page (owner a).** Move the route `/billing/commission-summary` →
   **`/commission-summary`** (own Operations nav item); keep the page's **inline** perm check (consistent with the
   sibling Billing route and every other Operations route — `RequirePerm` is the Administration-route pattern; the API
   `authorize()` is the authoritative gate either way). The web feature folder `features/commissionSummary` stays
   top-level (import path unchanged). The four API
   endpoints keep their **URLs** (`/api/v2/billing/commission-summary`, `/commission-detail` + exports) — the web route
   is already decoupled from the API path, mobile doesn't use them, and re-homing the API URL is deferred (see
   Alternatives) as pure churn with no consumer benefit.

3. **The commission permission is renamed out of the `billing.` namespace (owner b), grant-carried, triple-write.**
   `billing.commission_summary.view` → **`commission_summary.view`**:
   - Code catalog: `packages/access/src/permissions.ts` — the constant **value** `'billing.commission_summary.view'` →
     `'commission_summary.view'`, the constant **key** `BILLING_COMMISSION_SUMMARY_VIEW` → `COMMISSION_SUMMARY_VIEW`,
     the `PERMISSION_META` key → the new code with `group: 'Commission'`, and the `ROLE_PERMISSIONS` mirror rows.
   - **Migration 0112** (grant-carry): `UPDATE role_permissions SET permission_code = 'commission_summary.view' WHERE
     permission_code = 'billing.commission_summary.view'` — every role that holds it (MANAGER, BACKEND_USER; SA via
     `grants_all`) keeps it under the new code, no INSERT/DELETE, no window where access is lost. Forward-only,
     idempotent, re-run-safe (a second run matches zero old rows).
   - Reference sites: the 4 billing-module routes for the commission endpoints, the `CommissionSummaryPage` inline
     check, and the `Layout.tsx` nav guard switch to `PERMISSIONS.COMMISSION_SUMMARY_VIEW` (TypeScript enforces total
     coverage of the constant rename).
   - **`billing.view` is untouched** — every Pipeline/MIS/mobile money-gate keeps working unchanged. Commission Rates
     stays on `masterdata.manage`.

4. **Billing is redesigned as a flat, filterable per-line list (owner c, brief refined on seeing the page 2026-07-03)
   — no new DB.** The owner rejected pre-aggregated breakdown panels and per-case rollup in favour of a
   Salesforce/Twenty-style list view: the redesigned `/billing` is ONE flat `DataGrid` — **one row per COMPLETED
   billable task**, every detail as a column (Case · Client · Product · Verification Unit · Assignee · Rate Type · TAT
   Band · Location [pincode/area] · Units · Bill · Completed), with search + a client filter + a completed-date filter
   + column filters + export + a Salesforce-style **row-click through to the case**. **No accordion, no breakdown
   panels** — the user slices the data with the filters they already have. Served by a NEW flat read-query
   `GET /api/v2/billing/lines` (COMPLETED-only, reusing `RATE_LATERAL` + the resolved-location join); it **replaces**
   the old per-case `/billing/cases`, `/billing/cases/:id/tasks` and `/billing/breakdown` endpoints (web-only,
   mobile-unaffected — removed, not kept). Stays **export-only / derived** (owner 2026-06-25). Honours
   `DATAGRID_STANDARD` + `UI_STANDARDS` (the one DataGrid, frozen tokens). No invoice numbers, no persisted totals,
   no billing tables.

## Impact (surface to change)

- **DB:** migration `0112` (one `UPDATE` on `role_permissions`). **No schema/table change** — billing stays derived.
- **API (`apps/api`):** Slice 1 dropped commission from the billing surface + renamed the 4 commission routes'
  `authorize(PERMISSIONS.COMMISSION_SUMMARY_VIEW)`. Slice 2 replaces the per-case `listCases`/`caseTasks`/`breakdown`
  (repository/service/controller/routes) with a single flat `listLines` + `GET /billing/lines` (+ `/lines/export`).
  **`modules/tasks` and `modules/mis` are NOT touched** (they gate on `billing.view`).
- **Access (`packages/access`):** `permissions.ts` constant rename + META group + `ROLE_PERMISSIONS` mirror; the
  roles-parity test re-baselines to the new code.
- **SDK (`packages/sdk`):** `billing.ts` — slice 1 removed commission fields; slice 2 replaces the per-case/breakdown
  DTOs with one flat `BillingLineRow`, and `client.ts` `billing.cases/caseTasks/breakdown` → `billing.lines/linesExport`.
  Commission-summary DTOs/methods/URLs unchanged. Regenerate `openapi.json`.
- **Web (`apps/web`):** `BillingPage.tsx` — slice 1 removed commission + relabel + Commission link; slice 2 rewrites it
  as the single flat `/billing/lines` DataGrid (no accordion, no panels, row-click to case). `App.tsx` (route
  `/commission-summary`, inline perm check); `Layout.tsx` (relabel Billing, point the Commission nav item, new perm).
- **Mobile:** none (not a consumer; `/api/v2` unchanged for it).
- **Tests:** billing/tasks/mis/access `__tests__` (assert no commission on the billing surface; assert Pipeline/MIS
  money still gated by `billing.view`; assert the renamed perm resolves and grants carry); Playwright billing +
  commission + nav specs.

## Alternatives considered

- **Re-home the commission API URLs to `/api/v2/commission/*`** (with a deprecated `/billing/commission-*` alias).
  Rejected for now: no consumer benefits (mobile doesn't use them; the web route is already decoupled from the API
  path), and it's pure additive churn + a permanent alias to maintain. The web-facing separation is fully achieved by
  the route/nav/perm rename. Can be done later, additively, if ever needed.
- **Keep `billing.commission_summary.view` as-is** (move only route + nav, no migration). Rejected by the owner — the
  perm staying under `billing.` defeats the separation; the rename is a mechanical grant-carrying `UPDATE`.
- **Rename `billing.view` too / split the money-gate perm.** Rejected: `billing.view` is the platform money-gate for
  Pipeline/MIS/mobile; renaming or splitting it risks silently exposing or hiding ₹ amounts on those surfaces for zero
  separation benefit. Left exactly as-is.
- **A stored invoice/billing model** (invoice numbers, status, persisted totals; new tables). Rejected by the owner for
  this scope — Billing stays export-only/derived (owner 2026-06-25). A real billing engine is a separate, larger ADR.
- **One big atomic slice** (separate + redesign together). Rejected: the structural separation is the urgent,
  low-risk, independently-shippable change; the redesign is a reviewable follow-on. Two slices, each gated.

## Migration (0112)

`db/v2/migrations/0112_commission_summary_perm_rename.sql` — single idempotent `UPDATE` renaming the permission code in
`role_permissions` from `billing.commission_summary.view` to `commission_summary.view`, inside a transaction, with the
standard lock-timeout preamble. Grant-carry ⇒ **no role loses access** (no INSERT/DELETE). Re-run-safe. Applied to
`crm2_dev` + `crm2_test`/`acs_v2_test` during the build; applied to **prod on ship, after explicit owner OK** (the
push→main auto-deploy runs `migrate.sh`). Code mirror + parity test land in the same commit so the parity gate stays
green.

## Rollback

- **Perm rename:** re-run the inverse `UPDATE` (new code → old) + revert the `@crm2/access` change; grant-carry means
  no access is ever dropped in either direction.
- **Page/route/nav:** pure code revert (no data migration to undo).
- **Redesign (slice 2):** code revert to the billing-only page from slice 1.

## Sign-off required

Owner (done 2026-07-03, §3.5 a–d) + CTO (build gate). Each slice ships only at green `pnpm verify` + green API
integration tests (`:5433`, `LC_ALL=C`) + green Playwright e2e + an RBAC re-audit proving no money-gate regression on
Pipeline/MIS/mobile and no role loses access + browser verification across the billing/commission RBAC roles. Push to
prod (and the prod DB migration) only on explicit owner OK.
