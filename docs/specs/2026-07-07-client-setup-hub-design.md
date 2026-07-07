# Client Setup hub + onboarding workbook — design (2026-07-07)

**Status:** PROPOSED — awaiting owner + CTO sign-off before any feature code.
**ADR:** ADR-0092 (to be written after sign-off) · **Audit:**
[ADMIN_MASTERDATA_UX_AUDIT.md](../audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md)
(§5 governance boundaries · §6 UX-1/UX-2/UX-8) · **Plan:**
[2026-07-07-admin-masterdata-ux-simplification-plan.md](../plans/2026-07-07-admin-masterdata-ux-simplification-plan.md)
(Batch 3 commissions this spec) · **Migration:** none expected (next mig stays 0117).
Reuses (frozen — build only): the one Universal `DataGrid`
([apps/web/src/components/ui/data-grid/DataGrid.tsx](../../apps/web/src/components/ui/data-grid/DataGrid.tsx)) ·
the shared `ImportButton`/`ImportModal`
([apps/web/src/components/import/ImportModal.tsx](../../apps/web/src/components/import/ImportModal.tsx)) ·
`MasterDataCrud` · the per-module `ImportSpec` engine
([apps/api/src/platform/import/index.ts](../../apps/api/src/platform/import/index.ts)) ·
existing `/options` + `/available` pickers · `@crm2/sdk` contracts.

> **This spec adds two things and makes a small, named set of additive changes to existing surfaces.**
> The hub is a new *route* that renders the existing pages inside a stepper shell; the workbook is a new
> *import mode* that fans one file out to the existing per-module `ImportSpec`s. It is **not** zero-touch:
> it threads an additive `clientId?`/`returnTo`/sheet-selector seam through a handful of existing pages
> and the import engine (all enumerated in §3.2 and §4.3/S2/S5) and adds **one named delta** to the CPV
> unit `ImportSpec` (§4.1, item below). Every such change is behaviour-identical when the new prop/param
> is absent. Everything else is a reference into code that already ships.

---

## 1 — Problem + goals

Onboarding **1 client · 2 products · 3 units · 1 pincode · 2 field users** today costs **~27 page
visits / ~35 form submissions across 6 admin pages** (audit §1), in a dependency order the UI never
states:

```
Clients ─┐
Products ┼→ CPV link → CPV units ──→ (scopes unit pickers everywhere, ADR-0074)
Rate Types ─→ Rate Type Assignments ─→ (gates Rate form's type picker, ADR-0067)
                                   └→ Rates (billing amounts, ADR-0071 Universal)
Users ────────────────────────────────→ Commission Rates (ADR-0050, un-gated picker)
```

Failures surface **downstream** as an empty or mislabeled picker (e.g. the Rate form's type picker is
empty because no rate-type assignment exists for the combo). The spreadsheet path is no better: 6
separate imports in the right order (two uploads on the CPV page alone), and Rate Types has no import.

**Goals** (both share the existing endpoints + existing forms — no duplicate form logic):

1. **G1 — Client Setup hub** `/admin/client-setup`: pick a client, then walk an ordered stepper
   (Products → CPV units → Rate types per combo → Rates → Commission rates) that **embeds the existing
   record pages / grids / pickers**, with a per-step **completeness checklist** so the invisible
   dependency order becomes a visible, self-checking progress bar. Target: 1 page, ~5 logical steps,
   no memorised order.
2. **G2 — Onboarding workbook import**: one multi-sheet XLSX (`Products | CPV | RateTypeAssignments |
   Rates | CommissionRates`) processed **sheet-by-sheet in dependency order** through the existing
   per-module `ImportSpec`s, with **cross-sheet code resolution** (a product created by sheet 1
   resolves in sheet 2's preview), one combined preview→confirm screen, and a template pre-filled with
   the client's code.
3. **G3 — UX-8 decision**: give the owner a decision matrix on server-side enforcement of rate-type
   availability + CPV linkage (today UX-gated only; the 0012 DB trigger was dropped in 0013 and nothing
   replaced it — verified below), and a defended recommendation.

**Non-goal restated up front:** this is not a rewrite. If a step's existing page is good, the hub shows
that page unchanged.

## 2 — Non-goals (explicit)

- **No change to any existing page's pattern.** ClientsPage, ProductsPage, CpvPage, RateTypesPage,
  RateTypeAssignmentsPage/RecordPage, RateManagementPage/RateRecordPage, CommissionRatesPage/RecordPage
  keep their routes, inline-grid-vs-record-page split (ADR-0051), OCC (ADR-0019), and copy. The hub
  **reuses** them; it does not fork them.
- **No new resolution semantics.** Universal = NULL storage rendered as the word "Universal"
  (ADR-0069/0071/0074) · billing-by-location / commission-by-exact-key / most-specific-wins
  (ADR-0050/0071) · effective-from/USABLE model (ADR-0017) are all untouched. The workbook resolves
  codes→ids using the **same** per-module `resolve` functions the single-sheet imports already use.
- **No `service_zone_rules` / eligibility-trigger revival.** UX-8 option (b) is a *service-layer 400*,
  never a resurrected DB trigger (the 0012 trigger stays dropped).
- **No new package, no new DataGrid, no new import engine, no new picker.** Tokens-only styling. No mig.
- **Mobile untouched.** No hub/workbook endpoint is consumed by `crm-mobile-native`; all new endpoints
  are additive on `/api/v2` and keep it that way.
- **Not a bulk *case* importer** (ADR-0059, adjacent, separate). Master-data config only.

---

## 3 — Hub design

### 3.1 Route + RBAC

| Concern | Decision |
|---|---|
| Route | `GET /admin/client-setup` (+ `?clientId=<id>&step=<n>` deep-link state), declared in [apps/web/src/App.tsx](../../apps/web/src/App.tsx) beside the other `/admin/*` routes |
| View gate | `<RequirePerm perm="page.masterdata">` — the exact guard component ([App.tsx:53](../../apps/web/src/App.tsx)) every `/admin/*` route already uses. A viewer (read-only) can open the hub and see checklist state **for Steps 1–3**; the Step-4 (Commission) count is `masterdata.manage`-gated (SUPER_ADMIN-only comp data — [commissionRates/routes.ts:15](../../apps/api/src/modules/commissionRates/routes.ts)), so for a viewer it shows the neutral "—" and **fires no request** (see §3.3). |
| Write gate | Each embedded write action already self-gates on `masterdata.manage` via `useAuth().has(...)` — the hub adds **no** new perm. The Commission step inherits its existing SUPER_ADMIN-only `masterdata.manage` page-level gate (CommissionRatesPage early-returns "no access"); for a non-SA admin the hub renders that step as a **locked/skipped** card, not an error. |
| Nav | One item "Client Setup" in the **Administration** group ([Layout.tsx](../../apps/web/src/components/Layout.tsx) `ADMINISTRATION` array), `perm: 'page.masterdata'`, placed **first** in the group as the guided entry point; the 6 existing per-page items stay (power users keep direct access). |

No new permission is minted. This is a pure composition of already-gated surfaces.

### 3.2 Stepper states + embedded-component strategy

The hub is a thin shell: a **client picker** (top) + a **stepper** (5 steps) + a **step body** that
mounts the existing component for the active step, scoped to the chosen client. The client picker is
the existing `SearchableSelect` fed by `GET /api/v2/clients/options`.

| # | Step | Embedded component (exact file) | How it's scoped to the client | Reuse note |
|---|------|--------------------------------|-------------------------------|------------|
| 0 | *(pick client)* | `SearchableSelect` ([components/ui/SearchableSelect.tsx](../../apps/web/src/components/ui/SearchableSelect.tsx)) + "＋ New client". **ADR-0051:** clients' only sanctioned create is the inline-grid `+ Add` row — no add/edit modal (the guard test scans `features/clients` + `MasterDataCrud`). So "＋ New client" is a **link-out to `/admin/clients`** carrying the `?returnTo=` hub param, **not** an inline create form. | — | Products/clients are global master-data; the hub is a *lens*, so the client is chosen once and carried in URL state. |
| 1 | Products & CPV links | `CpvPage` ([features/cpv/CpvPage.tsx](../../apps/web/src/features/cpv/CpvPage.tsx)) | Hub passes the controlled `clientId?` prop; S2 wires it into CpvPage's `DataGrid` `filters` (today `CpvPage.tsx:93` holds `clientId` as create-form state only, no grid filter) and hides its internal picker (see mechanic below) — behaviour-identical when the prop is absent | Products themselves are created on `ProductsPage`; the hub links to it (with `?returnTo=`). The **CPV link + unit enablement** both live in `CpvPage` (its `UnitManager` expanded-row sub-component), so one embed covers "products for this client" + "CPV units". |
| 2 | Rate types per combo | `RateTypeAssignmentsPage` ([features/rateTypeAssignments/RateTypeAssignmentsPage.tsx](../../apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx)) filtered `clientId` + a "＋ Assign" that routes to `RateTypeAssignmentRecordPage` (`/admin/rate-type-assignments/new`) | The list already accepts `?clientId=` (service.ts:75); the record page's client picker is pre-selected via a URL param the hub appends | The global Rate-Types *catalog* (`RateTypesPage`) is a link-out, not embedded — it's global and rarely edited during onboarding (audit §1: usually 0 submissions). |
| 3 | Rates | `RateManagementPage` ([features/rateManagement/RateManagementPage.tsx](../../apps/web/src/features/rateManagement/RateManagementPage.tsx)) filtered `clientId` + "＋ Rate" → `RateRecordPage` (`/admin/rates/new`) | `RateManagementPage` already holds a `clientId` filter state (RateManagementPage.tsx:54, passed as `filters={{ clientId }}`); `RateRecordPage` reads client/product state and calls `/rate-types/available` + `/cpv-units/available` (RateRecordPage.tsx:135,154) | Full cascading create form embedded **as-is** — no new form logic. |
| 4 | Commission rates | `CommissionRatesPage` ([features/commissionRates/CommissionRatesPage.tsx](../../apps/web/src/features/commissionRates/CommissionRatesPage.tsx)) filtered `clientId` + "＋ Commission" → `CommissionRateRecordPage` | List accepts `?clientId=` + `?userId=` (service.ts:95-96) | SA-only page → step shows locked card for non-SA (see 3.1). |

**Embedding mechanic (no iframes, no duplication):** each existing page is already a self-contained
React component that reads its own data via the `api()`/`@crm2/sdk` wrapper and renders its own
`DataGrid`/forms. The hub mounts the component directly and passes the hub's client down via **one
additive optional prop** (`clientId?: string`). This prop is **CONTROLLED**: when present the page (a)
**wires it into the `DataGrid` `filters` prop** (`DataGrid.tsx:114-115` already supports `filters`; the
CpvPage / RTA / Commission lists' APIs already accept `clientId`, but those pages don't currently pass a
client filter to their grid — CpvPage's `clientId` at `CpvPage.tsx:93` is create-form state only), and
(b) **hides (or renders read-only) its own internal client picker** and treats the prop as the single
source. When the prop is **absent** the page is behaviour-identical to today (internal picker, no client
filter). This is a **small but real change to CpvPage, RateTypeAssignmentsPage, RateManagementPage and
CommissionRatesPage** — not byte-identical standalone code — owned by S2. "＋ Create" buttons within a
step navigate to the existing `/new` record routes with a `?clientId=<id>` query (pre-select) **plus an
additive `?returnTo=/admin/client-setup?clientId=<id>&step=<n>`** query that the four record pages honor
on save/cancel instead of their hard-coded `navigate('/admin/…')` (e.g. `RateRecordPage.tsx:191,423`
today navigates away, ejecting the admin from the hub) — so a "＋ Create" round-trips back into the hub.
Both params are absent on the standalone route → today's behaviour.

> **Rejected alternative:** lifting each form into a shared "embeddable" variant. That duplicates form
> logic and violates the reuse constraint. The optional-prop + URL-param seam is the smallest change
> that keeps ONE implementation of every form.

**Stepper state machine** (per step, derived from the checklist in 3.3):

- `blocked` — a hard prerequisite is unmet (e.g. Step 3 Rates before any CPV unit exists). The step is
  visible but its body shows "Complete [prior step] first" + a jump link. Only Step 1 is never blocked.
- `incomplete` — reachable, ≥1 checklist item still zero (amber dot).
- `complete` — all *required* checklist items > 0 (green check). Steps stay editable after completion.
  **Honesty ceiling (v1):** `complete` = *something exists*, **not** per-combo coverage — a client with 1
  rate across 6 (product×unit) combos still renders Step 3 green, so the checklist catches "nothing set
  up" but not "partially set up". Kept as count>0 for v1 (ponytail); a per-combo coverage matrix is the
  named upgrade path if the owner wants it.
- `skipped` — Step 4 for a non-SA admin (locked card, neutral).

Steps are **navigable out of order** (a stepper, not a wizard that traps you) — the dependency order is
*surfaced* by blocked/incomplete state, not *enforced* by forcing linear progress. This matches the
governance line "UX-suggested, not system-enforced pipeline" (audit §3) and keeps the power-user escape
hatch.

### 3.3 Completeness checklist — data source (DECISION)

Per step the hub shows a checklist of counts scoped to the selected client:

| Step | Checklist items (counts) | Source (exact — verified against the real mounts, [app.ts:123-128](../../apps/api/src/http/app.ts)) |
|---|---|---|
| 1 | CPV links · CPV units | **links** = `GET /api/v2/client-products?clientId=` `totalCount` (there is **no** `/api/v2/cpv` route — the mounts are `/client-products` and `/cpv-units`). **units** = **sum** the `unitCount` field already on each client-product link row ([sdk/cpv.ts:30](../../packages/sdk/src/cpv.ts), `ClientProductView.unitCount`) across that client's link page — because `GET /api/v2/cpv-units` filters by `clientProductId` only ([cpv.ts:82-85](../../packages/sdk/src/cpv.ts)), **not** `clientId`, so it cannot count units per client directly. To sum `unitCount` in one page, request the client-products list with a **large `pageSize` (e.g. 500)**; realistic per-client link counts are small. |
| 2 | Rate-type assignments | `GET /api/v2/rate-type-assignments?clientId=` `totalCount` (service.ts:75) |
| 3 | Rates | `GET /api/v2/rates?clientId=` `totalCount` (service.ts:91) |
| 4 | Commission rates | `GET /api/v2/commission-rates?clientId=` `totalCount` (service.ts:96) — **only mounted when `useAuth().has('masterdata.manage')`** (the list is `MASTERDATA_MANAGE`-gated, [commissionRates/routes.ts:15](../../apps/api/src/modules/commissionRates/routes.ts)); for callers without it the chip shows "—" and **no request is fired** (avoids the FE-console-audit 403-storm). |

**Steps 1–3 lists filter by `clientId` and return a `Paginated<T>` envelope whose `totalCount` is the
count we need** ([packages/sdk/src/pagination.ts:24-27](../../packages/sdk/src/pagination.ts)); Step 1's
**links** are the CPV-link `totalCount` and its **units** are the summed `unitCount` from the same page
(one call). So a checklist read = **3–4 tiny GETs** (Step 1 links+units in one, Steps 2–3 with
`pageSize=1`) on hub load / after each mutation — Step 4's commission GET fires **only** for
`masterdata.manage` callers.

**Decision: client-side counts, NO new aggregator — for v1.**

- *Defence:* the data already exists behind zero new code; 5 parallel `totalCount` reads with
  `pageSize=1` is cheap (each is an indexed `COUNT(*)` the list already runs), fires only on
  client-select and after a step mutation, and TanStack-Query caches + invalidates them with the same
  `queryKey` roots the embedded pages already use — so a create inside a step auto-refreshes its
  checklist for free. No endpoint, no openapi regen, no contract test, no mobile surface.
- *When to add the aggregator:* if the 5-call fan-out proves chatty (e.g. we later want counts for a
  **list of clients** on a dashboard, which would be 5×N calls), introduce **one** additive
  `GET /api/v2/clients/:id/setup-status` returning
  `{ cpvLinks, cpvUnits, rateTypeAssignments, rates, commissionRates }` (a single query with 5
  `COUNT(*)` sub-selects), gated `page.masterdata`, sibling to the existing `GET /clients/:id`
  (routes.ts:26). **RBAC rule (record now so it isn't lost at build):** the `commissionRates` field
  crosses the module's SA-only comp-data boundary, so this aggregator MUST **omit `commissionRates` for
  callers lacking `masterdata.manage`** (return it only when the caller has manage) — otherwise a
  `page.masterdata` viewer learns comp-config existence per client. It stays a pure read, additive, no
  mobile consumer. **ponytail:** don't build it until the single-client fan-out measurably hurts — the
  counts are one `totalCount` away today.

### 3.4 Empty / error / responsive states

- **No client selected:** the stepper renders disabled with a single prompt "Pick or create a client to
  begin." (the primary action). Deep-link with an unknown `clientId` → same empty state + a toast.
- **A step's list load fails:** the embedded `DataGrid` already renders its own standard
  loading/empty/error states (DATAGRID_STANDARD); the checklist chip for that step shows "—" (unknown),
  never a fabricated zero.
- **Step body errors** propagate through the embedded component's existing error handling — the hub
  adds no new error surface.
- **Responsive** (per [RESPONSIVE_DESIGN_STANDARD.md](../RESPONSIVE_DESIGN_STANDARD.md), FROZEN):
  designed mobile-up (320px base). The stepper is a **horizontal rail on `lg+`** and collapses to a
  **vertical accordion / `Select` step-switcher on `<lg`** (never a wide desktop-only strip). The step
  body is the embedded page, which already owns its own responsive table strategy (full DataGrid `lg+`
  → condensed `md` → card list `<md`). Checklist chips wrap (`flex flex-wrap`). Main region keeps
  `min-w-0` so a wide embedded grid scrolls inside its card, not the page. Playwright responsive spec
  asserts no horizontal overflow (nav + primary action reachable) at the standard's CI band
  **320/768/1024/1440** (320px is the hard floor); 375 stays a manual/device check only, as the standard
  itself does.

---

## 4 — Onboarding workbook import

### 4.1 Sheet schemas (columns verbatim from each module's existing `ImportSpec`)

One `.xlsx` with **5 named sheets**. Four sheets' columns are **exactly** the corresponding module's
existing import template columns (read verbatim from each `import.ts`) and feed that module's unchanged
`resolve`. The **CPV sheet is the one exception**: it carries a **named additive delta** to the CPV-unit
`ImportSpec` so that Universal (NULL-unit) CPV — the most common ADR-0074 onboarding shape — is
expressible (item below). Everything else is the existing per-sheet templates concatenated into one
file.

| Sheet (tab name) | Columns (header row, verbatim) | Source `ImportSpec` |
|---|---|---|
| **Products** | `Code` · `Name` · `Effective From` | `masterDataImportSpec('products', …)` via `MASTER_IMPORT_COLUMNS` ([modules/shared/masterDataImport.ts:11-15](../../apps/api/src/modules/shared/masterDataImport.ts)) |
| **CPV** | `Client Code` · `Product Code` · `Unit Code` · `Effective From` | `CPV_IMPORT_COLUMNS` — the CPV **unit** spec ([modules/cpv/import.ts:103-108](../../apps/api/src/modules/cpv/import.ts)), **plus the workbook-only Universal delta** (see below): a blank `Unit Code` = Universal (NULL). The link is created implicitly by the unit `resolve` requiring a usable client-product link — see 4.3. |
| **RateTypeAssignments** | `Client Code` · `Product Code` · `Unit Code` · `Rate Type Code` | `RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS` ([modules/rateTypeAssignments/import.ts:24-29](../../apps/api/src/modules/rateTypeAssignments/import.ts)); blank Product/Unit = Universal (NULL). |
| **Rates** | `Client Code` · `Product Code` · `Unit Code` · `Pincode` · `Area` · `Rate Type` · `Amount` · `Currency` · `Effective From` | `RATE_IMPORT_COLUMNS` ([modules/rates/import.ts:29-39](../../apps/api/src/modules/rates/import.ts)) |
| **CommissionRates** | `Username` · `Rate Type` · `Client Code` · `Location Pincode` · `Area` · `Product Code` · `Unit Code` · `TAT Band` · `Amount` · `Currency` · `Effective From` | `COMMISSION_RATE_IMPORT_COLUMNS` ([modules/commissionRates/import.ts:39-52](../../apps/api/src/modules/commissionRates/import.ts)) |

**Named change — CPV-unit ImportSpec Universal delta (workbook-only).** The existing CPV-unit spec
**requires** `unitCode` (`CpvUnitImportFileSchema.unitCode = z.string().min(1)`, column `required:true`
— [cpv/import.ts:98,106](../../apps/api/src/modules/cpv/import.ts)), so a blank cell is a *row error* and
the workbook **as-is cannot express Universal CPV**. This spec therefore owns a small additive delta,
**mirroring the RTA pattern** ([rateTypeAssignments/import.ts:18-19,99-100](../../apps/api/src/modules/rateTypeAssignments/import.ts)):
a **workbook variant** of `buildCpvUnitSpec` makes `unitCode` optional (`z.string().optional()`, column
not `required`), treats blank / `'UNIVERSAL'` as `verificationUnitId = null` (the create-input already
accepts NULL — `CreateCpvUnitSchema.verificationUnitId` is `nullish()`, [sdk/cpv.ts:68](../../packages/sdk/src/cpv.ts)),
and only looks up `unitMap` when a concrete code is present. This is a **named change with its own test
obligation** (S5), **not** a "columns verbatim / resolve unchanged" claim for this sheet. The standalone
single-sheet CPV import keeps its strict `required` spec unchanged (mobile/other consumers untouched).

**Runner invariants (workbook-strict, new surface — no back-compat obligation):**

- **CLIENT_MISMATCH** — the endpoint is `/clients/:id/onboarding-import`, but every sheet's `Client Code`
  cell is what the reused `resolve`s actually trust ([cpv/import.ts:60-66](../../apps/api/src/modules/cpv/import.ts),
  [rateTypeAssignments/import.ts:70-72](../../apps/api/src/modules/rateTypeAssignments/import.ts)). Any row
  whose `Client Code` ≠ the target client's code is a **row error** (`CLIENT_MISMATCH "row is for client
  X, this import is for client Y"`) in **both preview and confirm** — this makes the `/clients/:id` URL
  scoping real instead of decorative (a stale template downloaded for client B can't silently configure
  client A).
- **Unknown rate type on the CommissionRates sheet** — an unknown/typo'd `Rate Type` (`fieldRateType`)
  resolves to a **NULL `rate_type_id`** silently by design in the reused commission import
  ([commissionRates/import.ts:25](../../apps/api/src/modules/commissionRates/import.ts)). The workbook-strict
  guard extends the §5(b) catalog-existence check to this sheet: a `fieldRateType` **not in the active
  `rate_types` catalog** = row error at preview and confirm (**catalog-existence check only** — ADR-0050's
  un-gated commission-picker semantics for *assigned-vs-unassigned* combos stay untouched; this rejects
  typos, not un-assigned combos).

**Products vs CPV links.** There is no standalone "client-products link" sheet: onboarding a client's
product == enabling ≥1 CPV unit (or a Universal unit) for that (client, product), which the **CPV
sheet's `resolve` already requires a usable link for** (cpv/import.ts:159-167 errors "no usable
client-product link"). To let the workbook *create* the link, the CPV-sheet phase runs the existing
`clientProductService.create` (idempotent, 409-per-row) for each distinct (client, product) in the
sheet **before** the unit `resolve`, then enables units — i.e. the CPV sheet drives the `CP_TEMPLATE_SPEC`
link create + the `buildCpvUnitSpec` unit create in sequence, both existing paths. (Standalone CPV page
keeps its two-upload UX; the workbook just orders them.) Because the CPV phase drives **two** write
paths, it writes **two `import_log` rows** — one per resource (`client_products` for the link creates,
`client_product_verification_units` for the unit creates) with split counts — parity with what the
standalone two-upload flow records (§4.3).

Rate Types **catalog** is intentionally **not** a workbook sheet: it's global, 19 rows today, and its
import is being added separately (Batch 1 Task 1). The workbook *assigns* existing rate types (the
RateTypeAssignments sheet) but does not create catalog entries — onboarding uses the shared catalog.

### 4.2 Processing order

Sheets are processed **strictly in dependency order**, each sheet fully resolved+confirmed before the
next reads:

```
1. Products            (global create; no cross-sheet dep)
2. CPV                 (needs Products; creates client-product links + enables units)
3. RateTypeAssignments (needs Products + Units)
4. Rates               (needs Products + Units + Locations [pre-existing] + assignments-for-picker parity; see UX-8)
5. CommissionRates     (needs Users + Locations [both pre-existing] + Products + Units)
```

This is the same order the audit's dependency graph mandates — the workbook encodes it so the admin
never has to. **Pre-existing dependencies (not created by the workbook):** the Rates and CommissionRates
sheets resolve a `Pincode`+`Area` against `locations` ([commissionRates/import.ts:130](../../apps/api/src/modules/commissionRates/import.ts)
errors "no usable location") and CommissionRates resolves a `Username` against `users` — there is **no**
Locations or Users sheet, so both must exist before onboarding (same treatment as Users). The template's
sample-row guidance calls this out so the admin seeds locations/users first.

### 4.3 Cross-sheet code resolution — two-phase preview

The hard part: **sheet 2's preview must resolve a product code that only sheet 1 will create.** The
per-module `resolve` closures preload their code→id maps once per build (e.g. cpv/import.ts:133 loads
`clientService.options()` etc.) — those maps reflect the **DB as of build time**, so a product typed in
sheet 1 but not yet committed is invisible to sheet 2's map.

**Design: per-entity pending *projections* + two-phase preview.** A single flat "set of codes" is
**insufficient** — the CPV-unit `resolve` doesn't check a code, it checks a **composite (client,product)
link** via an id-keyed `linkMap` (`${clientId}:${productId}` → link id, [cpv/import.ts:143,159-167](../../apps/api/src/modules/cpv/import.ts)),
and those links are created by the **same CPV sheet's** phase-1, not by an earlier sheet. So the overlay
is defined as **three per-entity projections**, computed from *valid* rows and matched at **code level**
(the id-keyed `linkMap` can't serve pending entries — pending links have no id yet, so the runner needs
code-level matching):

- **pending CODES** — distinct product `Code`s from the Products sheet's valid rows (resolves a CPV /
  RTA / Rates / Commission product-code miss).
- **pending link PAIRS** — distinct `(clientCode, productCode)` pairs projected from the **CPV sheet's
  own** valid rows (its phase-1 `clientProductService.create` will make these links). A CPV-unit row's
  "no usable client-product link" miss is retried against this **same-sheet** projection (phase-1 → phase-2),
  not only against sheets 1..N-1.
- **pending assignment TUPLES** — distinct `(clientCode, productCode, unitCode, rateTypeCode)` tuples
  from the RateTypeAssignments sheet's valid rows, used by the Rates sheet's §5(b) workbook-strict
  "assignment-for-combo" check.

- **Preview (no writes):** run sheets 1→5. For each sheet, run the module's normal `validateRows` +
  `resolve`. A miss is retried against the **matching projection** for its entity (code / pair / tuple).
  A hit → the row is "resolves via Sheet k (pending)" = valid-pending; a miss → the module's existing row
  error verbatim ("unknown product code X" / "no usable client-product link"). The combined preview
  reports, per sheet: total / valid / valid-pending / error rows + the flat per-row error list (the
  engine's existing `ImportRowError[]` shape, prefixed with the sheet name).
- **Confirm (writes, in order):** run sheets 1→5 for real, **rebuilding each sheet's spec *after* the
  prior sheet committed** — so sheet 2's `resolve` maps now include sheet 1's freshly-created products
  from the actual DB (no overlay needed at confirm; the overlay is a *preview-only* projection). Each
  sheet uses the **unchanged** `runImportConfirm` (partial import: a bad row is reported, never blocks
  siblings; per-row 409s surface as today). A sheet that produces zero committable rows does not abort
  the run; its dependents simply resolve what exists.

> The overlay is **projection, not mutation** — it never fakes an id, only answers "will this code/pair/
> tuple exist by the time this sheet runs?" so the preview is honest.
>
> **Honesty bound (not an absolute guarantee).** A valid-pending row is valid **conditional on its
> prerequisite row both committing AND being USABLE at the dependent sheet's confirm time.** The reused
> `options()`/`linkOptionsForImport` maps are **USABLE-only** (active AND `effectiveFrom <= now()` —
> [cpv/import.ts:44-46,127-130](../../apps/api/src/modules/cpv/import.ts)), so a Products or CPV row with
> a **future `Effective From`** commits but is **not yet usable**, and a later sheet referencing it will
> row-error at confirm. **Preview rule:** a row whose `Effective From` is in the future **and** is
> referenced by a later sheet gets a **warning / row error** in preview (it cannot resolve at confirm).
> Beyond that documented case, any confirm-time miss (e.g. a per-row unique-code 409 on the prerequisite)
> surfaces as an **ordinary per-sheet row error** at confirm — the flow degrades to partial import, it
> does not silently mis-write.

**Engine seams (named additive changes — not "reuse unchanged").** `parseImportFile`/`countImportRows`
hard-read `worksheets[0]` ([format.ts:92,173](../../apps/api/src/platform/import/format.ts)), so a 5-sheet
buffer would run every module's spec against the **Products** sheet. The runner therefore needs, all
additive:
- an **optional sheet selector** threaded through `parseImportFile` → `runImportPreview`/`runImportConfirm`
  opts (default = sheet 0 → existing single-sheet callers unchanged);
- a **`buildWorkbookTemplate(specs[])`** variant of `buildImportTemplate` (one sheet per spec, §4.5);
- the **`ImportModal` xlsx-only + 5-panel** extension (§4.4).
These are costed in S4/S5, not free.

**Partial-failure semantics.** Same contract as every existing import: preview → per-row errors →
confirm → partial import (valid rows persist, failures are reported). Cross-sheet: if sheet 1 has 3 bad
product rows, sheet 2 rows depending on those 3 codes become row errors in sheet 2 (unknown code) —
reported, not fatal. The confirm result is a **per-sheet** `ImportConfirmResult` array (each with
`totalRows / successRows / failedRows / errors`), aggregated into one screen. One `import_log` row per
**resource** (reusing `importLogRepository.record`, `spec.resource` per resource) — the audit trail
stays per-resource; the CPV sheet writes **two** rows (`client_products` + `client_product_verification_units`),
so a 5-sheet workbook produces **6** `import_log` rows, not 5.

### 4.4 Combined preview → confirm screen

One dialog (the existing `ImportModal` flow, extended to render 5 stacked per-sheet result panels
instead of one). Stages unchanged: Template → Upload → Preview → Confirm → Result. Preview shows a
per-sheet summary (✓ N valid · ⧗ M pending-from-earlier-sheet · ✗ K errors) with the row-error table
per sheet; Confirm is enabled when ≥1 row across the workbook is committable; Result shows the
per-sheet counts. `ImportModal` already accepts `.csv` and `.xlsx` (ImportModal.tsx:190) — the workbook
is XLSX-only (multi-sheet needs the workbook container; CSV is single-sheet by nature), so the workbook
importer's file input is `.xlsx` only.

### 4.5 Template generation

`GET /api/v2/clients/:id/onboarding-template` (perm `masterdata.manage`, sibling to the existing
per-module `import-template` routes) returns a 5-sheet XLSX built by `buildImportTemplate` per sheet
(the existing template builder, format.ts:185) — bold header row + one sample row each — **pre-filled
with the selected client's code** in every `Client Code` column so the admin only fills products/units/
amounts. Same `writeExport`/`writeTemplate` streaming path; no in-memory workbook bloat concern (a
5-sheet template is tiny; the streaming `WorkbookWriter` don't-regress rule `9a29cdb` applies to large
*exports*, not this template).

### 4.6 API surface (exact new endpoints + perms)

All additive, under the existing `clients` router so they read naturally as "this client's onboarding":

| Method + path | Perm | Body / query | Returns |
|---|---|---|---|
| `GET /api/v2/clients/:id/onboarding-template` | `masterdata.manage` | — | 5-sheet XLSX, client code pre-filled |
| `POST /api/v2/clients/:id/onboarding-import?mode=preview` | `masterdata.manage` | raw `.xlsx` bytes (like existing imports: `raw({ type: () => true, limit: '10mb' })`, `x-filename` header) | `{ sheets: { name, totalRows, validRows, pendingRows, errorRows, errors[] }[] }` |
| `POST /api/v2/clients/:id/onboarding-import?mode=confirm` | `masterdata.manage` | raw `.xlsx` bytes | `{ sheets: ImportConfirmResult[] }` |
| *(optional, §3.3)* `GET /api/v2/clients/:id/setup-status` | `page.masterdata` | — | `{ cpvLinks, cpvUnits, rateTypeAssignments, rates, commissionRates }` — only if the client-side fan-out proves chatty |

`?mode=` validated by the existing `resolveImportMode` (import/index.ts:68). Import gated
`masterdata.manage` (creates master data — same authority as `POST /`, per the clients routes comment).
Regenerate `apps/api/openapi.json` (contract test enforces). No SDK client-class change beyond additive
methods + the new result types.

### 4.7 Size caps

The shared engine already caps rows (import/index.ts): **`IMPORT_JOB_THRESHOLD` = 10 000** (env-default,
[packages/config/src/index.ts:95](../../packages/config/src/index.ts)) is the sync ceiling — at/above it
`assertImportable` throws `IMPORT_TOO_LARGE` (413 "split the file"); **`IMPORT_JOB_MAX_ROWS` = 200 000**
(config/src/index.ts:97) is the hard ceiling even for the background tier. The onboarding workbook is an
**interactive, synchronous** flow (no background job — the whole point is a single preview→confirm the
admin watches), so it enforces the sync 413 cap **both per sheet AND per workbook**: each sheet is
bounded by `assertImportable(rowCount)` (default max = `importThreshold()` = 10 000), **and the TOTAL
rows across all sheets are capped at the same `importThreshold()` (10 000) with the same 413 "split the
file"**. Without the total cap, five near-cap sheets = ~50 000 sequential row-writes inside one
synchronous HTTP request, which can outlive `server.requestTimeout` (120 s) and give the admin a network
error mid-write; the total cap keeps the whole confirm inside one request budget. Realistic onboarding is
dozens–hundreds of rows, far under either cap. (An admin with a genuinely huge catalog uses the existing
per-module background-tier imports one at a time — the workbook is the *onboarding* ergonomic, not the
bulk-migration tool.)

---

## 5 — UX-8 decision matrix

**Fact (verified):** rate-type availability for a (client, product, unit) combo and the (client,
product) CPV linkage are **UX-gated only**. The 0012 eligibility trigger + `rate_type_eligibility`
table were **dropped in 0013**
([db/v2/migrations/0013_rate_management_flatten.sql](../../db/v2/migrations/0013_rate_management_flatten.sql))
and nothing server-side replaced them: there is no FK from `rates` to `client_products`, and an unknown
`clientRateType` code resolves to a **NULL** `rate_type_id` silently on the repo path (audit §3). So a
direct-API or import create can make an operationally-dead row (a rate for an unlinked product, or a
rate whose type resolves to NULL). The picker prevents it in the UI; the server does not.

| Option | What it does | Admin impact | API-consumer impact | Mobile risk | Effort | Recommendation |
|---|---|---|---|---|---|---|
| **(a) Keep UX-gate + document** | No server change; document that availability is picker-enforced only; the hub's checklist + UX-3/4 messages (Batch 1) make gaps visible | Status quo; careful UI admin unaffected; the hub already surfaces missing assignments as an incomplete step | **None** — no accepted input changes; additive-only rule trivially satisfied | **None** | ~0 (docs only) | **✅ for existing `/api/v2` create + import endpoints** — tightening them is a behaviour change on surfaces mobile/other consumers may (now or later) hit; the additive-only rule protects them. The picker + hub already cover the human path. |
| **(b) Enforce 400 `RATE_TYPE_NOT_ASSIGNED`** | Service-layer guard: on create/import, for a **concrete** (non-Universal) combo lacking a matching rate-type assignment (and/or a rate for an unlinked (client,product)), return `400 RATE_TYPE_NOT_ASSIGNED` (+ a sibling `400 CPV_LINK_MISSING`). **No DB trigger** — a `SELECT`-backed service check, so the 0012 trigger stays dropped. | Strong safety net; a fat-fingered workbook can't create dead rows | **Behaviour change** on the create endpoint — a payload that succeeds today (dead row) would 400. On *existing* endpoints this can break a consumer that relied on the loose accept | Low-but-nonzero on existing endpoints (mobile doesn't create rates, but the additive-only rule is about not silently changing accepted inputs) | M | **✅ for the NEW workbook-import surface only** — it has no back-compat contract (brand-new endpoint), so it can be strict from day one and refuse dead rows at preview (a `RATE_TYPE_NOT_ASSIGNED` row error, resolved via the pending overlay if the assignment is in the same workbook's RateTypeAssignments sheet). |
| **(c) Warn-only response field** | Create/import still succeeds but the response carries `warnings: ['RATE_TYPE_NOT_ASSIGNED']` (additive, non-breaking) | Soft signal; admin may ignore it | Additive field — non-breaking, but easy to miss | None | S | Fallback if the owner wants signal without refusal on the workbook; weaker than (b) because the dead row still lands. |

**Recommendation (defended): (b) for the NEW workbook import surface, (a) for the existing API create +
per-module import endpoints.**

- *Why (b) on the workbook:* it is a new endpoint with **no existing consumer** and no back-compat
  obligation, so making it strict costs nothing in compatibility and buys the most value — a workbook is
  exactly where a bulk mistake creates many dead rows at once, and preview-time refusal (with the
  cross-sheet overlay resolving same-workbook assignments) catches it before confirm. The strictness
  lives at the workbook runner, not in the shared per-module `resolve`, so the single-sheet imports are
  untouched.
- *Why (a) on the existing endpoints:* option (b) there **tightens accepted inputs on `/api/v2`** — a
  behaviour change the additive-only rule exists to prevent. Mobile doesn't create rates today, but the
  rule protects *any* consumer (and future ones) from a silent contract narrowing; the human UI is
  already picker-gated and the Batch-1 UX-3/4 messages + the hub checklist make gaps visible without a
  server-side refusal. If the owner later wants server enforcement everywhere, that's its own
  superseding ADR + consumer re-audit — out of scope here.
- *Honest trade-off:* this leaves **both** the direct-API create path **and the per-module single-sheet
  import endpoints** able to make a dead row (the audit's operational-deadness risk persists for non-UI
  callers) — and note §4.7 explicitly routes genuinely-huge catalogs *to those per-module imports*, so
  the spec's own escape hatch bypasses the workbook's strict guard. We accept that for back-compat; the
  workbook (the new bulk path most likely to fat-finger at scale) is the one we harden. Recorded as a
  residual in the registry naming **all three loose surfaces** (direct API, per-module imports, §4.7
  fallback); option (c) additive warnings on the per-module imports is the future tightening if the owner
  wants signal without a breaking change.

---

## 6 — Alternatives considered

- **Wizard-as-modal** (a linear dialog that traps the admin through steps): rejected — it can't embed
  the full record pages/grids (they need real estate + their own routes for deep-links and OCC dialogs),
  forces linear order (kills the power-user escape hatch), and duplicates form chrome. The **full-page
  stepper embedding the real pages** keeps one implementation of every form and lets the admin jump
  around.
- **Per-page checklists only** (add a "setup progress" banner to each existing page, no hub): cheaper,
  but doesn't collapse the ~27-visit journey — the admin still page-hops in an order they must know. The
  hub is the lever the audit named (UX-1); per-page banners are a strictly weaker subset the hub
  subsumes.
- **CSV-zip instead of a workbook** (5 CSVs zipped): rejected — a zip needs a new unzip dependency and a
  new multi-file upload UX, whereas a multi-sheet XLSX is one native container the existing ExcelJS
  reader already opens (it just reads `worksheets[0]` today — reading N sheets is the same library).
  No new package, one file, native to Excel users.
- **One giant denormalised sheet** (every column of every entity on one tab): rejected — it can't
  express the different column sets / Universal-blank semantics per entity, and its `resolve` would be a
  bespoke monolith instead of the 5 existing per-module `resolve`s. Five sheets = five unchanged specs.
- **A new shared sequenced-resolve service the hub *and* workbook both call** (the plan floats "design
  both around the same backend path"): partially adopted — they share the **cross-sheet overlay +
  ordered-confirm** runner, but the hub's live create path is just the existing record-page endpoints
  (no shared service needed for the interactive path). We don't build a unifying abstraction the hub
  doesn't use. **ponytail:** the workbook runner is the only genuinely new backend logic; the hub is
  composition.

---

## 7 — Open questions for the owner (each with a default)

1. **UX-8 choice** — accept the recommendation "(b) workbook-strict, (a) endpoints-unchanged"?
   **Default: yes** (as defended in §5).
2. **Setup-status endpoint** — ship client-side counts only for v1, add
   `GET /clients/:id/setup-status` only if it proves chatty? **Default: yes, client-side only** (§3.3).
3. **Rate-Types catalog in the workbook** — keep it out (assign-only, catalog stays a global page)?
   **Default: keep out** — global 19-row catalog, its own import lands in Batch 1.
4. **Commission step for non-SA admins** — render as a locked/skipped card (vs hide the step entirely)?
   **Default: locked card** (visible so the admin knows it exists and who to ask).
5. **Hub nav placement** — first in the Administration group as the guided entry, keeping all 6
   per-page items? **Default: yes** (guided + power-user paths coexist).

---

## 8 — Rough build slices (each ends `pnpm verify` GREEN + browser-verify + commit; owner OK before push)

| Slice | Scope | Est. |
|---|---|---|
| **S0 — ADR + sign-off** | Write ADR-0092 (references this spec + audit; states what it does NOT change: resolution semantics, Universal storage, existing form patterns, no mig); 3-lens adversarial review (CTO/Design/Security); owner picks §7. **Gate before any code.** | 0.5 session |
| **S1 — Hub shell + client picker + routing/nav** | `/admin/client-setup` route (`RequirePerm page.masterdata`) in App.tsx, nav item in Layout.tsx, client `SearchableSelect`, "＋ New client" link-out to `/admin/clients` w/ `?returnTo=` (ADR-0051 guard test), empty state, stepper skeleton (states, URL `?clientId&step`). Responsive spec at **320/768/1024/1440**. | 0.5 |
| **S2 — Steps embed existing pages** | Mount CpvPage / RTA / RateManagement / CommissionRates per step with the **controlled** `clientId?` prop — **real changes to those 4 pages:** wire `clientId` into each `DataGrid` `filters` (not present today) + hide the internal client picker when the prop is set; add the additive `?clientId` **and** `?returnTo=` params to the 4 record pages' save/cancel nav (replace hard-coded `navigate('/admin/…')`). No new *form* logic, but not byte-identical standalone code. | 1 |
| **S3 — Completeness checklist** | Per-step count reads via existing list endpoints (Step 1 = client-products `totalCount` + summed `unitCount`; Steps 2–3 `pageSize=1`; **Step 4 fired only when `has('masterdata.manage')`, else "—", no request**) + TanStack cache/invalidate on the shared queryKeys; step state derivation (blocked/incomplete/complete/skipped). | 0.5 |
| **S4 — Workbook template** | `GET /clients/:id/onboarding-template` via **`buildWorkbookTemplate(specs[])`** (5-sheet builder, client-code pre-fill; new-seam vs single-sheet `buildImportTemplate`) + FE download button; openapi regen; template round-trips (headers == per-module templates + the CPV Universal delta). | 0.5 |
| **S5 — Workbook import** | The cross-sheet runner (per-entity pending projections — codes/pairs/tuples — preview + ordered rebuild-and-confirm) reusing each module's `runImportPreview`/`runImportConfirm` **plus the named engine seams** (optional sheet-selector through `parseImportFile`, the CPV-unit Universal-delta spec, ImportModal xlsx-only/5-panel); `POST /clients/:id/onboarding-import?mode=`; UX-8 (b) workbook-strict guard + `CLIENT_MISMATCH` + unknown-rate-type-on-Commission guards at the runner; **two `import_log` rows for the CPV phase**; total+per-sheet 413; openapi regen. Tests: cross-sheet code resolve, same-sheet CPV pair projection, RTA-tuple → Rates §5(b) resolve, future-`Effective From` preview warning, `CLIENT_MISMATCH`, unknown-Commission-rate-type row error, partial failure per sheet, per-sheet **and** total 413, formula-guard, `RATE_TYPE_NOT_ASSIGNED` resolved via same-workbook assignment sheet. | 1.5–2 |
| **S6 — e2e + docs** | Playwright: onboard a full client via the hub end-to-end (each step persists) + via the workbook (one file → all resources created); browser-verify on crm2_dev; docs (PROJECT_INDEX link, CRM2_MASTER_MEMORY §8, registry §ADMIN-MASTERDATA-UX-2026-07-07 UX-1/UX-2/UX-8 → FIXED, Claude memory). | 1 |

**Total ≈ 5–6 sessions after S0 sign-off.** This estimate **supersedes** the plan's Batch-3 "~2–3
sessions after owner sign-off" line — that line covered the *core* hub+workbook only, whereas this
re-costed total also carries S6 e2e/docs, the responsive hardening, and the folded engine-seam + CPV-delta
+ runner-invariant work (items surfaced by the adversarial review). Batch 3 benefits from Batch 1 T1
(rate-types import) and Batch 2 T10 (CSV MIME) landing first, but does not depend on them.

---

## Revision 1 (2026-07-08) — post-adversarial-review

Folded the confirmed defects from the 3-lens review (CTO/arch · Design/governance · Security/RBAC, all
SHIP_WITH_FIXES). One line per change:

1. **CPV Universal delta** — §4.1: the CPV-unit `ImportSpec` **requires** `unitCode` (cpv/import.ts:98,106),
   so blank≠Universal. Now a **named additive workbook-only delta** (optional `unitCode`, blank/`'UNIVERSAL'`
   → `null`, mirroring RTA import.ts:18-19,99-100; create-input already `nullish()`), with its own S5 test
   obligation — dropped the "columns verbatim / resolve unchanged" claim for that sheet.
2. **Overlay = per-entity projections** — §4.3: replaced the flat "pending code set" with **pending CODES
   (Products) / link PAIRS (CPV sheet's own rows, same-sheet phase-1→2) / assignment TUPLES (RTA→Rates
   §5b)**, noting the id-keyed `linkMap` can't serve pending pairs (code-level matching needed).
3. **Preview-honesty softened** — §4.3: valid-pending is now **conditional on the prerequisite committing
   AND being USABLE at confirm**; added a preview rule (future `Effective From` referenced downstream ⇒
   warning/row error) and documented that other confirm-time misses surface as ordinary per-sheet row errors.
4. **Checklist endpoints corrected** — §3.3: no `GET /api/v2/cpv` (mounts = `/client-products` + `/cpv-units`,
   app.ts:123-124); Step-1 links = `client-products?clientId=` `totalCount`, units = summed `unitCount`
   (sdk/cpv.ts:30) with a stated large `pageSize`; removed the false "every endpoint accepts `?clientId=`".
5. **Commission 403-storm** — §3.1/§3.3: Step-4 count fires **only** when `has('masterdata.manage')` (list is
   `MASTERDATA_MANAGE`-gated, routes.ts:15); locked card shows "—", no request; amended the viewer claim +
   recorded the aggregator's `commissionRates`-omit-for-non-manage rule.
6. **Embed strategy = real changes** — §3.2/S2: `clientId?` defined **CONTROLLED** (page wires it into
   `DataGrid` `filters` + hides internal picker); added the additive `?returnTo=` param the 4 record pages
   honor on save/cancel (RateRecordPage.tsx:191,423 ejects today); "behavior-identical when props absent".
7. **Engine seams named** — §4.3/S4/S5: optional sheet-selector through `parseImportFile`→`runImportPreview/Confirm`
   (format.ts:92,173 hard-reads `worksheets[0]`), `buildWorkbookTemplate(specs[])`, ImportModal 5-panel/xlsx
   extension — re-costed the slices.
8. **CLIENT_MISMATCH invariant** — §4.1: any row whose `Client Code` ≠ the `/clients/:id` target = row error
   in preview AND confirm.
9. **Unknown Commission rate type** — §4.1: unknown `fieldRateType` (not in active catalog) = row error
   (catalog-existence only; import.ts:25 silent-NULL closed; ADR-0050 un-gated semantics untouched).
10. **Total workbook cap** — §4.7: cap TOTAL rows across sheets at `importThreshold()` (10k) with 413, not
    just per-sheet (avoids ~50k writes outliving the 120s request timeout).
11. **CPV phase audit parity** — §4.1/§4.3: two `import_log` rows for the CPV phase (`client_products` +
    `client_product_verification_units`), split counts → 6 rows for a 5-sheet workbook.
12. **Estimate honesty + cheap LOWs** — §8: total re-cost to **~5–6 sessions**, stated to **supersede** the
    plan's "~2–3 sessions". Also folded: locations pre-existing (§4.2 deps + template guidance); Playwright
    band **320**/768/1024/1440 (375 manual-only, §3.4); Step-0 "＋ New client" = link-out to `/admin/clients`
    w/ `?returnTo=` per ADR-0051 (§3.2); "complete = something exists, not per-combo coverage" honesty line +
    upgrade path (§3.2); residual names the per-module import endpoints + §4.7 fallback (§5).

**Not folded:** the 3 REFUTED items (rejected by the review — no action). No material LOW was skipped;
all 8 were folded.
