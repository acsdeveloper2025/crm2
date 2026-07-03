# Kickoff prompt — Separate Billing ⟂ Commission + redesign the Billing page (CRM2)

> Paste the block below as the first message of a **new session**. Modelled on the keyboard-nav / uppercase kickoffs
> (`docs/plans/2026-07-03-keyboard-navigation-audit-kickoff-prompt.md`). Unlike those (pure build-only compliance),
> **this one touches FROZEN decisions** — the billing/commission data-model, RBAC permissions, routes, nav, and a UI
> **redesign**. Per `docs/governance/LONG_TERM_PROTECTION.md` a frozen change needs a **superseding ADR (0086) + CTO +
> domain-owner sign-off** and (for perms/schema) **migration 0112**. So this session is **DISCUSS → ADR → build**, not
> a free build: resolve the OPEN DECISIONS (§3.5) with the owner FIRST, write ADR-0086, then implement slice-by-slice.

---

You are the CTO + multi-agent team for CRM2 (ACS verification CRM, live on crm.allcheckservices.com). Mission this
session: **cleanly separate Billing from Commission, and redesign the Billing page.** Concretely (owner's words):
(1) the `/billing` page today is **"Billing & Commission"** — it shows client billing AND per-executive commission
mixed together; **remove the commission content, leave Billing only**; (2) the Commission summary page currently lives
at the **sub-route `/billing/commission-summary`** — **promote it to its own top-level page + nav**; (3) give Billing and
Commission **dedicated, separated RBAC** (perms + nav gating + route guards + API gating); (4) **redesign the Billing
page properly** — DB (if needed) + API + SDK + FE/UI. This is a **structural refactor + redesign of a frozen area** —
write **ADR-0086** and get owner sign-off on the OPEN DECISIONS before touching code. No guessing; verify every claim
against the code and reproduce in the browser.

## 0 — Rules (from CLAUDE.md, override defaults)
cave-mode (minimal tokens); surgical root-cause changes, reuse-never-reinvent, match existing style; **test-first**,
a phase is done only when **`pnpm verify` is green** (typecheck→lint→format→no-suppressions→boundaries→test→build) +
CTO gate — and because RBAC/scope is exercised by API integration tests + the a11y/e2e Playwright job that `pnpm verify`
does NOT run, a slice is only done when the **API tests are green (needs the `:5433` test DB, `LC_ALL=C`)** and the
relevant **Playwright e2e** is green too. **Ask before push/deploy/live-DB writes** (push→main auto-deploys to prod);
commits author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, **no AI trailer**, never `--no-verify`,
secret-sweep before push. No `any`/suppressions/`console.*`; centralized `@crm2/logger`; raw SQL only in
repositories + migrations; **FE→API via `@crm2/sdk` only**; **`/api/v2` is versioned + additive-only — NEVER break
mobile** (`crm-mobile-native`, separate repo). **Next ADR = 0086, next mig = 0112.** A **superseding ADR + Impact +
Alternatives + Migration + CTO** is required before changing any frozen decision (`docs/ARCHITECTURE_GOVERNANCE.md`).

## 1 — Pre-flight reads (in order)
CLAUDE.md → PROJECT_INDEX.md → CRM2_MASTER_MEMORY.md §8 (live status) → SESSION_KICKOFF.md. Billing/commission SoT:
**ADR-0046** (billing read-model), **ADR-0047** (earned-at freeze), **ADR-0081** (commission periodic export, mig 0107),
**ADR-0050** (rate types), plus `docs/RBAC_*`/`docs/governance/` for the permission model and `docs/DATAGRID_STANDARD.md`
+ `docs/UI_STANDARDS.md` for the page/UI contract the redesign must honour. Memory: MEMORY.md + the 5 rule files +
`project_commission_periodic_export_2026_07_01.md` (ADR-0081 — the commission-summary read-model + `billing.commission_summary.view`),
`project_billing_scope_export_only_2026_06_25.md` (billing/commission = **export-only**, owner 2026-06-25),
`project_commission_rebuild_2026_06_18.md`, `project_rbac_scope_audit_2026_06_25.md` (RBAC/scope patterns),
`project_frontend_console_audit_2026_07_02.md` (reuse its local-stack + login trick verbatim), and
`feedback_sql_live_db_apply.md` (DB triple-write invariant — migrations run on dev/test/prod).

## 2 — Ground truth (the current structure — map it, VERIFY before changing)

**The problem in one line:** ONE billing module + ONE `/billing` page carry BOTH concerns; the commission summary hangs
off billing as a sub-route; the commission perm is real but namespaced under `billing.`.

- **Web pages / routes** (`apps/web/src/App.tsx`):
  - `/billing` → `features/billing/BillingPage.tsx` (**363 lines, ADR-0046**), perm **`billing.view`**, nav label
    **"Billing & Commission"** (`Layout.tsx:45`). **Renders BOTH**: per-case client billing AND per-executive commission —
    `commissionAmount` line totals + a **"Commission" DataGrid column** (`id:'commissionTotal'`, ~:297) + the ADR-0046 §6
    **breakdown panels** (bill/commission grouped by pincode/area). **← the commission content to REMOVE.**
  - `/billing/commission-summary` → `features/commissionSummary/CommissionSummaryPage.tsx` (**610 lines, ADR-0081**),
    perm **`billing.commission_summary.view`**, nav **"Commission Summary"** (`Layout.tsx:46`). The periodic commission
    read-model (per field-user × period × opt client/product). **← the page to PROMOTE to a top-level route.**
  - `/admin/commission-rates` (+ `/new`, `/:id`) → `features/commissionRates/` (`CommissionRatesPage`,
    `CommissionRateRecordPage`), perm **`masterdata.manage`**, nav "Commission Rates" (`Layout.tsx:60`). Rate *management*
    — already separate/admin; likely OUT of core scope, but decide if it joins a "Commission" nav group (§3.5).
- **API** — a **single `billing` module** `apps/api/src/modules/billing/` (`routes.ts`·`service.ts`·`repository.ts`·
  `controller.ts`·`__tests__`) serving **both** concerns under `/api/v2/billing/*`:
  - `billing.view`: `GET /billing/cases`, `/billing/cases/:id/tasks`, `/billing/breakdown` (+ export).
  - `billing.commission_summary.view` (**dedicated, independent of `billing.view`** — see `routes.ts:22`):
    `GET /billing/commission-summary`, `/billing/commission-detail` (+ export).
  - **Billing is a DERIVED read-model** (SQL laterals, ADR-0046/0047 earned-at freeze; `RATE_LATERAL`/`COMMISSION_LATERAL`
    in `platform/billing/laterals.ts`) — **there is NO stored billing/invoice table.** (Decides §3.5 whether the redesign
    needs new DB.)
- **SDK** (`packages/sdk/src/billing.ts` + `client.ts` `billing` namespace): `cases`/`breakdown`/`commissionSummary`/
  `commissionDetail` + their `*Export`. FE talks to the API only through this.
- **RBAC perms** (SQL-seeded in `db/v2/migrations/`): **`billing.view`** — `0059_billing_view_perm.sql` (MANAGER +
  BACKEND_USER + SA); **`billing.commission_summary.view`** — `0107_commission_summary_permission.sql` (ADR-0081).
  Route/nav guards read these in `App.tsx` (`RequirePerm`) + `Layout.tsx` (nav) + the API route middleware.
- **⚠️ Cross-cutting money-gating — the trap:** **`billing.view` gates the ₹ amounts platform-wide**, not just on
  `/billing`: the Pipeline/Tasks read-model (`modules/tasks/{controller,service,repository}.ts`) and **MIS**
  (`modules/mis/repository.ts`) include the bill/commission money laterals **only for `billing.view` holders**. So any
  perm rename/split MUST preserve these gates (and the mobile-facing tasks read-model) — re-audit them (a naive
  `billing.view`→`commission.*` rename would silently expose or hide money on Pipeline/MIS/mobile).

## 3 — The four workstreams (build AFTER §3.5 is owner-signed + ADR-0086 written)
1. **Decouple commission from the Billing page** — remove the commission column + commission line-totals + the
   commission breakdown panels from `BillingPage.tsx` (and the billing SDK/service shape if commission fields should stop
   flowing to that surface); relabel nav `Layout.tsx:45` "Billing & Commission" → **"Billing"** and the page `<h1>`/subtitle.
   Keep the API additive/mobile-safe (prefer *stop selecting* commission on the billing surface over deleting endpoints).
2. **Promote the Commission page** — move `CommissionSummaryPage` from the `/billing/commission-summary` sub-route to a
   **top-level route** (name = §3.5-a), add its own nav entry, update the guard. Optionally re-home the API from
   `/api/v2/billing/commission-*` to `/api/v2/commission/*` **additively** (keep the old path as a deprecated alias if
   anything—incl. mobile—hits it; `/api/v2` is additive-only). Move the web feature folder if the route name changes.
3. **Dedicated RBAC (mig 0112)** — separate perms + nav gating + route guards + API gating for Billing vs Commission.
   The commission perm is *already* dedicated; decide (§3.5-b) whether to **rename it out of the `billing.` namespace**
   (`commission.view` / `commission_summary.view`) with a migration that adds the new perm + grants + optionally retires
   the old, **grandfathering existing role grants** so no user loses access. Re-audit the `billing.view` money-gates
   (Pipeline/MIS/tasks/mobile) so the split changes nothing there. RBAC scope tests updated (`modules/access`, billing,
   tasks, mis `__tests__`).
4. **Redesign the Billing page (DB? + API + SDK + FE/UI)** — the "proper" Billing page per the §3.5-c design brief.
   Honour `DATAGRID_STANDARD` + `UI_STANDARDS` (the ONE DataGrid, tokens frozen). If it stays a derived read-model → API/SDK
   shape + UI only (no mig). If the owner wants stored invoices/billing artifacts → that's a **larger scope** (new tables
   = mig 0112, new module) and must be explicit in ADR-0086.

## 3.5 — OPEN DECISIONS — resolve with the owner BEFORE building (put the answers in ADR-0086)
- **(a) Commission route + nav.** New top-level path — `/commission-summary`? `/commission`? A **"Commission"** nav
  group that also pulls in Commission Rates (`/admin/commission-rates`)? Recommend `/commission-summary` (keeps the
  ADR-0081 semantics) with a "Commission" nav section.
- **(b) Permission strategy.** Keep `billing.commission_summary.view` (just move the route/nav), or **rename** to
  `commission.view`/`commission_summary.view` for a clean namespace split? If renamed: additive migration + grant-carry
  so no role loses access, and update every read site. What happens to Commission Rates' `masterdata.manage` — unchanged,
  or its own `commission.rates.manage`? Recommend: rename to `commission_summary.view`, grandfather grants, leave rates
  on `masterdata.manage` for now.
- **(c) Billing redesign brief.** What should the "proper" Billing page BE — an invoice-style per-client statement? a
  summary dashboard + drill-down? which columns/filters/actions/exports? **Does it need stored billing/invoice DB, or
  stay a derived read-model?** (Today it's derived — export-only per owner 2026-06-25.) This is the biggest unknown —
  get a concrete brief (or a sketch) before building; a stored-invoice model is a much larger, separate scope.
- **(d) Exactly what leaves the Billing page.** All ADR-0046 commission bits (column + line totals + breakdown panels)?
  Keep a link from Billing → Commission? Does the billing **export** stop carrying commission amounts (it currently does)?
- **(e) Mobile.** Confirm whether `crm-mobile-native` consumes any `/api/v2/billing/*` (billing is web-facing/export-only,
  but the tasks money read-model is shared) — the plan must be mobile-safe (additive, no removed endpoints/behaviour).

## 4 — Method (BUILD_METHOD)
(A) **Discovery/audit first** — parallel reader agents: (1) `BillingPage.tsx` — enumerate every commission element to
remove + what "billing-only" leaves; (2) the `billing` API module + `platform/billing/laterals.ts` — the billing vs
commission query split + the `billing.view`/`commission_summary.view` gates; (3) the RBAC surface — every read site of
`billing.view` + `billing.commission_summary.view` across api/web/sdk (grep both perms) + the money-gates in tasks/MIS +
the mig seeds (`0059`,`0107`); (4) `CommissionSummaryPage` + its route/guard/nav; (5) mobile contract check
(`docs/`/sdk) for any billing/commission consumption. Each returns a map + the exact change-sites (`file:line`),
read-only. (B) You synthesize → write **ADR-0086** (Impact/Alternatives/Migration/rollback) → get owner sign-off on §3.5.
(C) Build slice-by-slice (decouple → promote → RBAC mig 0112 → redesign), each: `pnpm verify` green + API tests green
(`:5433`, `LC_ALL=C`) + Playwright e2e green + **RBAC re-audit** (prove no money-gate regression on Pipeline/MIS/mobile,
no role loses access) + **browser-verify** the actual pages/roles (perform the action, confirm persisted —
`feedback_browser_verify_perform_actions`). Keep shared-config/interdependent edits inline; spawn specialists for parallel
independent work.

## 5 — Tooling / local stack (reuse the console-audit memory verbatim)
colima + docker compose (or the **native brew Postgres**: dev `:54329` `crm2_dev`, test `:5433` — the API integration
DB is `acs_v2_test` on `:5433`, `createdb` if missing, `LC_ALL=C`); API bg `pnpm --filter @crm2/api dev` (:4000,
`apps/api/.env`); web via Claude Preview `web` (:5273 → `/api` proxy 4000). Login: in-page `fetch POST /api/v2/auth/login`
→ tokens under `j.tokens` → seed `localStorage` `acs.accessToken`/`acs.jti`/`acs.sessionStartedAt` → reload. admin/admin123;
other roles (MANAGER/BACKEND_USER/TEAM_LEADER/FIELD_AGENT for the billing/commission RBAC matrix) via admin
`POST /users/:id/generate-temp-password {deliver:'view'}`. Migrations apply via `db/v2/migrations/` + the tracked runner
(`migrate.sh`, `schema_migrations`).

## 6 — Deliverables + gate
- **ADR-0086** (billing⟂commission separation + billing redesign) with owner sign-off on §3.5; **migration 0112**
  (perms + any billing schema) applied dev+test (and, on ship, prod — ask first).
- Slices shipped: (1) billing-only page + relabel; (2) commission page promoted to its own route + nav; (3) dedicated
  RBAC with a proven-clean re-audit; (4) redesigned Billing page. Each `pnpm verify` green + API/e2e green + RBAC-matrix
  browser-verified across roles + **mobile un-broken** (`pnpm contract:mobile` / additive `/api/v2`).
- Register the work in `docs/COMPLIANCE_GAPS_REGISTRY.md` (§BILLING-COMMISSION-SPLIT-2026-…); update `CRM2_MASTER_MEMORY.md`
  §8 + the Claude memory each slice. **Ask before pushing; never write the prod DB without explicit OK.**

Start by stating the current phase (`CRM2_MASTER_MEMORY.md` §8 + `git log --oneline -20`), then **read ADR-0046/0047/0081
+ the §2 ground-truth files**, then spawn the §4-A reader agents to map the exact change-sites — and **surface §3.5 to the
owner and write ADR-0086 BEFORE any code change** (this is a frozen-area structural refactor + redesign, not a free build).
```
```
```
```
```
