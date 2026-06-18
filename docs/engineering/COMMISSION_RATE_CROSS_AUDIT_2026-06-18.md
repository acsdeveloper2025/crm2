# Commission ↔ Rate Management Cross-Audit (2026-06-18)

> **Status: AUDIT-ONLY. No production code changed.** This is the source-of-truth for the
> "commission per pincode/area + remove the pipeline commission leak" work. Read before planning.
> Governed by **ADR-0036** (billing/commission model — the frozen decision being challenged) and
> **ADR-0018** (flat rate model). Adding a location dimension to commission **supersedes ADR-0036**
> and requires a superseding ADR + CTO + domain-owner sign-off (`docs/governance/LONG_TERM_PROTECTION.md`).
>
> Method: 5 parallel read-only auditors (areas A–E), synthesized here. Every claim is cited to
> `file:line`. Findings logged in `docs/COMPLIANCE_GAPS_REGISTRY.md` (§ G).

## TL;DR

1. **Commission is location-less by design** (ADR-0036), keyed `(user_id, rate_type, client_id, time)`.
   The prior snapshot is verified **unchanged** — no location/pincode/area column anywhere
   (`db/v2/migrations/0058_commission_rates.sql:18-49`).
2. **The geography substrate already exists and works** — for *rates*, not commission. `locations`
   (=one `(pincode,area)` pair), `case_tasks.area_id/pincode_id`, `cases.area_id/pincode_id`, and a
   6-key location cascade in `RATE_LATERAL` (`apps/api/src/platform/billing/laterals.ts:20-31`,
   ADR-0018). Commission has none of this.
3. **THE CRUX:** commission *already* varies by location **transitively, through `rate_type`** —
   because `COMMISSION_LATERAL` keys on the *location-resolved* `rt.rate_type`. The real gap:
   **two completed tasks with the same `rate_type` in different pincodes/areas earn the same
   commission today** — that difference is unrepresentable. Whether the owner needs the *amount* to
   differ, or only the *reporting* to break down by location, is the single decision that drives the
   whole rebuild. **Must be asked.**
4. **The pipeline "Commissionable" leak is FE-surface only.** The server already nulls
   `bill_amount`/`commission_amount` and ignores `commissionable=1` for non-`billing.view` actors
   (proven by test). Removing it is a clean ~6-edit change in one file, zero backend/security change.
5. **RBAC is sound.** Commission config = `masterdata.manage` = SUPER_ADMIN-only. `billing.view` =
   MANAGER + BACKEND_USER + SUPER_ADMIN. No role accidentally sees amounts. A location dimension
   needs **no new permission** (the scope-dimension registry already supports it).
6. **NEW DEFECT found (location-independent, high-impact): `case_tasks.bill_count` is silently
   ignored by the billing rollup.** A task assigned `bill_count = 3` still contributes
   `bill_amount × 1` and counts as 1. Needs owner confirmation of intent before the rebuild
   (it changes both "count" and "amount").

---

## A. Commission model integrity

- **Granularity:** resolved **per-task**, keyed on the task's assignee (`ct.assigned_to`), aggregated
  **per-case** for the rollup. **Never stored** — `billAmount`/`commissionAmount` are derived at read
  time (`packages/sdk/src/tasks.ts:36-39`; no migration adds a commission column).
- **`commission_rates` key** (`db/v2/migrations/0058_commission_rates.sql:18-49`):
  `(user_id uuid, rate_type varchar(60), client_id integer NULL)` + `amount`, `currency`, `is_active`,
  `effective_from/to`, `version` (OCC). No-overlap EXCLUDE verbatim:
  ```sql
  EXCLUDE USING gist (
    user_id WITH =, rate_type WITH =, (COALESCE(client_id, -1)) WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
  ) WHERE (is_active);
  ```
  Resolve index: `(user_id, rate_type, client_id) WHERE is_active`. **No location term.**
- **`resolveAmount(userId, rateType, clientId)`** (`apps/api/src/modules/commissionRates/repository.ts:194-205`):
  most-specific-client-wins (`ORDER BY client_id DESC NULLS LAST LIMIT 1`) + `now()`-temporal. No
  location param. (Single-row display helper; the read-models inline the lateral instead.)
- **`COMMISSION_LATERAL`** (`apps/api/src/platform/billing/laterals.ts:35-42`): keys on
  `cmr.user_id = ct.assigned_to`, `cmr.rate_type = rt.rate_type` (the rate-resolved type), client.
  `ORDER BY cmr.client_id DESC NULLS LAST`. **No location term** (contrast the 6-key ladder in
  `RATE_LATERAL` directly above it).
- **Rollup** (`apps/api/src/modules/billing/repository.ts:77-89`): `count(*)` of `COMPLETED` tasks,
  `COALESCE(SUM(rt.bill_amount),0)`, `COALESCE(SUM(com.commission_amount),0)`, grouped by case.
  Both laterals are `LIMIT 1` → 1:1 join → SUMs exact. Status filter `ct.status='COMPLETED'` is forced.
- **Dead/inert location fields for commission: none.** The location plumbing that exists is fully
  live on the **rates** side only.
- **"Half-built" verdict:** commission is *complete for its current (location-less) design*. It is
  "half-built" only relative to the unbuilt goal. To make the amount vary by location you'd touch:
  schema (`0058` + EXCLUDE + index), `COMMISSION_LATERAL`, `resolveAmount`, SDK
  (`packages/sdk/src/commissionRates.ts`), repo write paths + import, and the admin UI.

## B. Rate ↔ commission coherence (the crux)

- **Schema correction (important):** the prompt's `service_zone_rules` mapping is **dead**. It was
  created in `0012_rate_management.sql:44-60` then **dropped** by `0013_rate_management_flatten.sql:39-41`
  (the owner's "flatten" directive, ADR-0018). The live `rates` row carries
  `(client_id, product_id, verification_unit_id, location_id, rate_type[free-text varchar(60)], amount)`
  directly — no SZR indirection, no `rate_type_id` FK. `rate_types` (`0014`) is only a dropdown lookup.
- **`RATE_LATERAL` precedence** (`laterals.ts:20-31`), verbatim ORDER BY:
  `task.area > task.pincode > case.area > case.pincode > location-less default (location_id IS NULL) > any`.
  Keys: `ct.area_id/pincode_id` (`0039_visit_type_pool.sql:29-30`), `cs.area_id/pincode_id`
  (`0031_cases_location.sql:7-8`). `locations` = one `(pincode,area)` pair, `UNIQUE(pincode,area)`.
- **The chain that makes commission location-aware *transitively*:**
  ```
  ct.area_id/pincode_id → RATE_LATERAL ladder → picks rates row → rt.rate_type  (location-determined)
    → COMMISSION_LATERAL: cmr.rate_type = rt.rate_type → com.commission_amount   (inherits location only via rate_type)
  ```
  So commission **already differs by location whenever the location changes the resolved `rate_type`**
  AND the agent holds distinct commission rows per `rate_type`.
- **The gap, precisely:** two completed tasks in **different** pincodes/areas that resolve to the
  **same** `rate_type` get the **same** commission today — provably (neither the lateral nor the
  table reference any location column). Location granularity for commission is exactly as fine as the
  operator's `rate_type` partition, and no finer.
- **Three candidate rebuild models:**
  - **(i) Amount-varies:** add `location_id` to `commission_rates` + mirror `RATE_LATERAL`'s 6-key
    cascade in `COMMISSION_LATERAL` (+ `resolveAmount`, SDK, UI, EXCLUDE/index). Highest cost;
    **supersedes ADR-0036**; doubles operator data-entry (a rate row *and* a commission row per location).
  - **(ii) Reporting-only:** no schema/lateral change to commission; add `pincode/area` (or the
    resolved-rate `location_id`) to the SELECT/GROUP BY of the billing read-model
    (`apps/api/src/modules/billing/repository.ts`) + a "by pincode/area" grouping in the Billing UI.
    Lowest cost; **no ADR supersession** (commission amounts unchanged). Delivers "counts and amounts
    per pincode/area" as a breakdown.
  - **(iii) Hybrid:** ship (ii) now (visible breakdown, zero schema risk); add (i) only if the owner
    confirms they need a *different amount* for the *same `rate_type`* across locations.
- **Code-reading recommendation:** the phrase "generate correct **counts and amounts per
  pincode/area**" reads as **reporting language** → most likely **(ii)/(iii)**. The whole rate stack
  is already location-specific and commission already varies by location via `rate_type`; the thing
  that is genuinely **absent** is the per-location rollup. But this is the owner's call — see the
  disambiguating question in Decisions §1.

## C. The pipeline "Commissionable" leak

- **FE surface** (`apps/web/src/features/pipeline/PipelinePage.tsx`): `Commissionable` bucket (line
  52); `billAmount`/`commissionAmount` columns inside a `canViewBilling` conditional spread (lines
  176-191); the pill is filtered out for non-holders (`BUCKETS.filter((b)=>canViewBilling||!b.comm)`,
  line 235); `commissionable` URL state (71, 77, 79) → stats query + grid `filters` (line 273). The
  gating permission is **`billing.view`**.
- **Server is already safe (proven):** `/tasks` + `/tasks/stats` are `case.view`-gated
  (`apps/api/src/modules/tasks/routes.ts:12,16`); the controller computes `canViewBilling`
  (`controller.ts:17-19`); the service ignores `commissionable` and withholds `billing:true` for
  non-holders (`service.ts:127-129`); the repository selects
  `NULL::float8 AS bill_amount, NULL::float8 AS commission_amount` and neutralizes the filter
  (`repository.ts:81-82,140-157`). Test proof: a `FIELD_AGENT` gets null amounts + `commissionable=0`
  (`apps/api/src/modules/tasks/__tests__/tasks.api.test.ts:734-767`).
- **Verdict:** purely a **FE-surface** concern (financial comp data shown in an operational queue),
  **not a server hole**. Removal is a UX/scope decision.
- **Removal scope (FE-only, ~6 edits, all in `PipelinePage.tsx`):** drop the bucket (52), the
  amount-column block (176-191), the `commissionable` URL/select handling (71, 77, 79), the
  active-bucket ternary (238-240), and the `filters.commissionable` (273). `canViewBilling` (66-67)
  and the local `money` helper (29) then become dead **in this file** and can go (not shared — Billing
  and Commission-Rates pages compute their own). **Do not remove** the SDK fields
  (`TaskView.billAmount/commissionAmount`, additive contract) or the gated server capability.
- **Other surfaces enumerated:**
  - **Billing & Commission page** (`apps/web/src/features/billing/BillingPage.tsx`, route + all
    endpoints `billing.view`-gated) — the **legitimate** money home. Keep.
  - **Commission Rates admin** (`apps/web/src/features/commissionRates/CommissionRatesPage.tsx`,
    `masterdata.manage`) — rate *config*, not earned amounts. Separate; keep.
  - **MIS Layout designer** has `RATE_AMOUNT`/`COMMISSION_AMOUNT` as **bindable column types**
    (`packages/sdk/src/reportLayouts.ts:36-37`) — **catalog only, no generation endpoint exists**.
    No runtime leak today; **flag** the future BILLING_MIS generation slice to enforce `billing.view`.
  - **Confirmed clean:** `CaseDetailPage.tsx`, `CasesPage.tsx`, `packages/sdk/src/caseReports.ts`,
    all dashboards/analytics.

## D. RBAC

- 6 roles (`packages/access/src/permissions.ts:5-12`, `0033_roles.sql:48-55`): SUPER_ADMIN, MANAGER,
  TEAM_LEADER, BACKEND_USER, FIELD_AGENT, KYC_VERIFIER. No ADMIN/BANK_USER.
- **Commission config** (`apps/api/src/modules/commissionRates/routes.ts:15-28`): every endpoint
  (list/export/import/create/revise/activate/deactivate) gates `masterdata.manage`, which **no role
  holds explicitly** → **SUPER_ADMIN-only via `grants_all`**. (Note: `page.masterdata`, held by
  MANAGER/TL/BACKEND_USER, does **not** grant this.) Matches ADR-0036 §3.
- **`billing.view`** (`0059_billing_view_perm.sql:10-13`): MANAGER + BACKEND_USER (+ SA via
  grants_all). These three are the only roles that ever see ₹ amounts.
- **No accidental exposure:** roles with `case.view` but not `billing.view` (TEAM_LEADER, FIELD_AGENT,
  KYC_VERIFIER) get server-nulled amounts everywhere (fail-safe). The `billable` boolean is exposed
  to all but is status-derived, not money.
- **Scope seam** (`apps/api/src/platform/scope/`): role-attribute-driven (ALL / SUBTREE / DIRECT_TEAM
  / SELF). Scope controls *which rows*; `billing.view` controls *whether ₹ columns populate* —
  orthogonal. Billing repo applies scope as defence-in-depth (`billing/repository.ts:12-18,67-68,93-99`).
- **For the rebuild:** a location dimension on commission needs **no new permission** (added to the
  scope-dimension registry, wired per role). For an amount-free commissionable **count**: gate any
  *agent-keyed* count on `billing.view` (it leaks comp-data existence); only an aggregate,
  agent-agnostic, amount-free count could use `case.view` (precedent: the `billable` boolean). Do not
  mint a new permission key without a superseding ADR (frozen RBAC).

## E. Count/amount correctness — worked example (the acceptance test)

**Setup (hypothetical, representative):** client C, product P, unit VU; two `locations` L1, L2; rates
`R-L1(loc L1, LOCAL, ₹350)`, `R-L2(loc L2, LOCAL, ₹500)` both active; agent U assigned to both tasks;
**one location-less** commission rate `CR-1(U, LOCAL, client NULL, ₹50)`. Case CASE-1 with two
**COMPLETED** tasks: `T1(area=pincode=L1)`, `T2(area=pincode=L2)`.

- **RATE_LATERAL:** T1 → key-1 task-area match → `LOCAL`/₹350; T2 → key-1 → `LOCAL`/₹500.
- **COMMISSION_LATERAL:** both tasks resolve `rate_type=LOCAL` → both match CR-1 → **both ₹50**
  *regardless of L1≠L2* (no location operand in the lateral — the proof).
- **Rollup today:** `completedTaskCount=2`, `billTotal=₹850`, `commissionTotal=₹100`. Per-task lines:
  T1 (₹350/₹50), T2 (₹500/**₹50** — identical commission despite a different location).
- **If commission had a location cascade** (CR-L1(L1,₹50), CR-L2(L2,₹90)): `commissionTotal=₹140`;
  T2 commission = ₹90.

**Acceptance discriminator (the §E proof for "done"):**
> Given the setup above, does **T2's commission differ from T1's when only their location differs?**
> Today: **no** (both ₹50, total ₹100). Done (if amount-varies is chosen): **yes** (₹90, total ₹140).

**Location-independent defects found in the current rollup:**
1. **`case_tasks.bill_count` is silently ignored** (`0011_task_assignment.sql:11`, default 1, editable
   per-task in the SDK). The rollup never reads it — a `bill_count=3` task contributes `bill_amount×1`
   and counts as 1 (`apps/api/src/modules/billing/repository.ts` + `platform/billing/laterals.ts`
   have zero `bill_count` references). If `bill_count` is a billable-units multiplier (name + per-task
   editability imply so), `bill_total` should be `SUM(rt.bill_amount * ct.bill_count)` and the count
   may also need to weight by it. **Highest-impact amount defect after the location gap. Needs owner
   confirmation of intent.**
2. **No currency normalization** — `SUM` adds `amount` across whatever `currency` rows carry
   (`rates.currency`/`commission_rates.currency` exist but are never filtered/grouped). Harmless while
   all-INR; latent.
3. **`float8` cast on `numeric` money** before `SUM` (`laterals.ts:21,36`) — sub-cent drift risk on
   large fractional sums. Minor.

**Verified correct:** the `COMPLETED`-only status filter (consistent across rollup + per-task lines),
`count(DISTINCT cs.id)` for the page total vs `count(*)` per group, and `COALESCE(...,0)`.

---

## Governance gate

- **Model (i) — adding `location_id` to `commission_rates` — supersedes ADR-0036** (which states
  commission is resolved against assignee + rate_type + client, *no location*). It requires, in order:
  audit (this doc) → owner decisions locked → **superseding ADR (next number: ADR-0046)** with
  Impact / Alternatives / Migration + CTO + domain-owner sign-off → brainstorm → spec → plan → build.
- **Model (ii) — reporting/grouping only — does NOT supersede ADR-0036** (commission amounts
  unchanged; only the billing read-model gains a grouping dimension). It can proceed under the normal
  build method once the owner confirms the requirement. *(The `bill_count` fix, if confirmed a bug, is
  a correctness fix to the existing ADR-0036 derivation, not a supersession.)*
- Migrations are additive-only; the next number is **0076**. Mobile/`/api/v2` are additive-only and
  must not break (the billing/commission read-model is web-only today; verify no mobile consumer).

## Decisions to lock with the owner (do not invent)

1. **What does "commission per pincode/area" mean?** (a) the *amount* must vary by location for the
   *same* rate type [→ model (i), ADR-0046]; (b) per-rate-type is correct, only the *breakdown* by
   pincode/area is missing [→ model (ii)]; (c) start with the breakdown, add amount-varies later
   [→ model (iii)]. **This drives everything.**
2. **`bill_count`:** is it meant to multiply bill/commission and the count? (Likely yes → fix the
   rollup.) Or is it vestigial/always-1? This affects both "count" and "amount" regardless of (1).
3. **Cascade precedence (only if model i/iii):** mirror the rate's
   `task.area > task.pincode > case.area > case.pincode > location-less default`? And how does the
   location key rank against the existing client key (location-first vs client-first)?
4. **Count semantics:** count of what, grouped how — per pincode? per area? per agent per area?
5. **Commissionable tab:** remove from the pipeline entirely (recommended), and confine
   commissionable counts/amounts to the `billing.view` Billing page? Any operational need for an
   amount-free commissionable *count* for non-billing users?
6. **Migration / backfill (only if model i):** existing `commission_rates` rows become the
   location-less default; `location_id` joins the no-overlap EXCLUDE + resolve index as
   `COALESCE(location_id,-1)`; preserve effective-dating + OCC.

## Decisions LOCKED (2026-06-18, owner)

- **D1 — Commission model = (i) amount-varies, fully DECOUPLED from the client.** Commission resolves
  from the field executive's OWN (pincode, area) mapping, independent of the client's `rate_type` (a
  location that is OGL for the client can be LOCAL for the executive). The current
  `cmr.rate_type = rt.rate_type` coupling in `COMMISSION_LATERAL` is **removed**. → **supersedes
  ADR-0036; needs ADR-0046.**
- **D2 — Commission dimensions:** base key = executive + (pincode/area), with optional overrides for
  **client + product/verification-unit + TAT band** over a location-less/global default;
  effective-dated + OCC + no-overlap preserved (mirror `rates`). Each executive holds rows only for
  the **5–20 pincodes** they actually cover (not 157k). The executive's LOCAL/OGL label is a
  descriptive classification on the row, decoupled from the client side.
- **D3 — `bill_count` is a billable-units multiplier; the current rollup is a BUG → FIX** (G-2):
  `SUM(rt.bill_amount * ct.bill_count)` and weight count/commission accordingly.
- **D4 — Pipeline "Commissionable" tab REMOVED entirely** (G-3); commission/bill counts + amounts
  live only in the redesigned, `billing.view`-gated **Billing & Commission** page (to be designed).
- **D5 — TAT dimension requires a TAT band system that does NOT exist yet** (G-7). ADR-0044 is
  **Proposed/unbuilt**; only a priority enum (`LOW/MED/HIGH/URGENT`) + an open-task "out of TAT"
  breach flag (ADR-0032, 12/24/48/72h from `created_at`) exist. Commission must vary by the band the
  executive **ACTUALLY completed in** (elapsed `completed_at − assigned_at`, bucketed
  4/6/8/12/24/48h). ADR-0044 currently declares commission TAT-independent → must be **amended**.
  The raw timestamps exist (`assigned_at`, `started_at`, `completed_at`, server-side), but no
  elapsed-band classifier or assign/complete/band read-model exists.
- **D6 — SEQUENCE (owner choice): build the TAT band system FIRST, then the full commission rebuild
  (location + client + product/VU + TAT) together.** Immediate next phase = TAT design
  (accept/amend ADR-0044 + elapsed-band measurement + the assign/complete/band table), **then**
  ADR-0046 + the commission rebuild.

**Still to confirm (proposed defaults, lock at ADR time):** cascade precedence mirrors `RATE_LATERAL`
(`task.area > task.pincode > case.area > case.pincode > default`); existing `commission_rates` rows
become the location-less default on migration; `location_id`/dimensions join the no-overlap EXCLUDE +
resolve index as `COALESCE(...,-1)`. **TAT specifics LOCKED 2026-06-18:** scope = **full ADR-0044** (assign a target TAT per task AND
measure the completed-in band); completion clock = **server-receipt `now()`** (offline overstatement
accepted, revisit later). CTO defaults (sign-off at ADR): clock start = `assigned_at`; wall-clock
elapsed; per-task clock reset (revisit/recheck = new task); enum→TAT backfill URGENT→4h/HIGH→8h/
MEDIUM→24h/LOW→48h; band set 4/6/8/12/24/48h global+configurable. Commission consumes the
**completed-in** band → ADR-0044's "Commission unaffected" line is amended.

## Definition of done (carried from the kickoff)

- This audit doc under `docs/` + linked from `PROJECT_INDEX.md`; every finding in
  `COMPLIANCE_GAPS_REGISTRY.md` (§ G).
- Owner decisions locked; superseding ADR-0046 approved **iff** model (i)/(iii) chosen.
- Commission rebuilt per the chosen model (DB → `laterals.ts` → API → SDK → web), effective-dated +
  OCC + no-overlap preserved; `bill_count` resolved.
- Counts + amounts provably correct on the §E multi-pincode example.
- Pipeline commissionable surface removed; server null-guards confirmed; money confined to Billing.
- `pnpm verify` GREEN + live browser-verify GREEN; mobile `/api/v2` unbroken.

---

### File:line index (verification map)
- Laterals: `apps/api/src/platform/billing/laterals.ts:20-31` (RATE), `:35-42` (COMMISSION)
- Rollup: `apps/api/src/modules/billing/repository.ts:48,71-89,106-121`
- Commission resolver/module: `apps/api/src/modules/commissionRates/repository.ts:194-205`, `routes.ts:15-28`
- Schema: `0058_commission_rates.sql:18-49` (commission, no location); `0013_rate_management_flatten.sql:14-43` (flat rates); `0012_rate_management.sql:44-60` (dead SZR); `0004_locations.sql:9-22`; `0039_visit_type_pool.sql:29-30`; `0031_cases_location.sql:7-8`; `0011_task_assignment.sql:11` (`bill_count`)
- Pipeline FE: `apps/web/src/features/pipeline/PipelinePage.tsx:52,66-67,176-191,235,273`
- Tasks server null-guard: `apps/api/src/modules/tasks/{routes.ts:12,16,controller.ts:17-19,service.ts:127-129,repository.ts:81-82,140-157}`; test `__tests__/tasks.api.test.ts:734-767`
- RBAC: `packages/access/src/permissions.ts:5-12,87-128`; `0033_roles.sql:48-55`; `0059_billing_view_perm.sql:10-13`; scope `apps/api/src/platform/scope/`
- Duplicated rate cascade (keep in sync): `apps/api/src/modules/cases/repository.ts:139-149`
- Governing ADRs: `docs/adr/ADR-0036-billing-commission-model.md`, `docs/adr/ADR-0018-rate-management-flat-one-table-model.md`
