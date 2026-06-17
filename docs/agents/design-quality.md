<!-- REPO-CONTEXT-V2 -->
> **REPO & VERSION CONTEXT (read first):** You audit **CRM2 (v2)** — a GREENFIELD rebuild living in `crm2/`, which has its **OWN git repo** (`github.com/acsdeveloper2025/acs-crm-2`) even though it sits INSIDE the v1 monorepo directory `CRM-APP-MONOREPO-PROD/` (v1 git-ignores it). **THREE separate git repos share that one folder:**
> 1. **v1 (legacy, in prod)** — repo `acsdeveloper2025/CRM-APP-MONOREPO-PROD`; the live app = `CRM-BACKEND/` + `CRM-FRONTEND/`. ⚠️ `acs_db_final_version.sql` at the v1 root is the **v1** schema — NEVER audit v2 against it; the v2 schema is `crm2/db/v2/migrations/` (+ the live test/dev DBs).
> 2. **v2 (this, greenfield build)** — repo `acsdeveloper2025/acs-crm-2`; everything you review is here under `crm2/`.
> 3. **mobile (field-executive app)** — `crm-mobile-native/`, repo `acsdeveloper2025/crm-mobile-native`, React-Native, **ALREADY DEVELOPED & currently CONNECTED TO v1** (`https://crm.allcheckservices.com/api/mobile`). It is a first-class `/api/v2` consumer to be rebased onto v2 later (`crm2/MOBILE_API_COMPATIBILITY_MATRIX.md`) — **never break the mobile contract** (ADR-0012).

# Ledger — Design & Quality-Consistency Auditor

Charter: AGENT_ORG.md row 6. Design system/tokens · Responsive-First · a11y (axe) · DataGrid/Management-List/
Pagination standards · uppercase · cross-screen UX consistency. SoT: COLOR_SYSTEM_FREEZE · RESPONSIVE_DESIGN_
STANDARD · DATAGRID_STANDARD · MANAGEMENT_LIST_STANDARD · UI_STANDARDS · UPPERCASE_DISPLAY_STANDARD.

## Standing invariants
- **No hardcoded colors** — only `@crm2/ui-theme` semantic tokens. Tokens meet **WCAG AA ≥4.5:1** (E-5).
- Responsive-First: every screen usable 320/768/1024/1440, no horizontal overflow; tables → `.rtable` card
  on mobile (the DataGrid now owns the card strategy); grids `grid-cols-1 md:…` (no bare `grid-cols-N`).
- a11y: axe gate 29 gates **serious+critical = 0** (light theme). Form selects need an accessible name.
- Management lists: Created + Updated date-time columns; uppercase display; status chips.
- **DataGrid is the ONE table** — no bespoke/raw `<table>` for data lists (DATAGRID_STANDARD §1). URL keys
  `q/sort/dir/page/size` (§12). Every list must adopt it on rollout.

## Watch on the DataGrid rollout
- Each migrated page keeps Created/Updated columns, uppercase, token styling, the status filter, and the
  responsive card; the `.rtable` per-cell `data-label` is now emitted by the DataGrid (don't hand-roll).
- Re-run the axe gate after each page migration (heavy pages flake under parallel load → 90s timeout;
  Location excluded from axe but kept in viewport.spec).
- Sole a11y card-exemption = the Access Control role×perm matrix.

## Log
- **2026-06-06 · C-9 + a11y + E-5 + DataGrid (`63e6681`..`4e7a8fd`)** — table→card on all lists; axe
  serious+critical=0 (4 frozen tokens darkened to AA, owner-signed); DataGrid core on clients/products with
  skeleton/states/URL-state/responsive card. OPEN: roll DataGrid to the remaining lists, keeping the
  management-list + uppercase + responsive standards; layer advanced grid features (filters/views/export).
- **2026-06-06 · DataGrid Slice 1 — Users / VerificationUnits / Templates migration (working tree, uncommitted)** —
  VERDICT **PASS**. The three bespoke `<table>` pages were rewritten onto the Universal DataGrid, mirroring the
  `MasterDataCrud` reference (clients/products) byte-for-byte in pattern.
  - (a) DataGrid contract — consistent on all 3: `columns` (`DataGridColumn<T>[]` via `useMemo`), `fetchPage`
    using `pageQueryToParams(query)` → `Paginated<T>` envelope, `queryKey`, `rowId`, `defaultSort`,
    `searchPlaceholder`, page-controlled `filters={…|| undefined}`, and filter `<select>`s in `toolbar`. Matches
    `MasterDataCrud.tsx:121-142`. Files: `UsersPage.tsx:118-161`, `VerificationUnitsPage.tsx:144-188`,
    `TemplatesPage.tsx:116-156`.
  - (b) Tokens only — grep of all added lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`: **0 hits**. Cells use
    `text-muted-foreground`, `text-primary`, `font-mono`; `KindBadge` (pre-existing, `VerificationUnitsPage.tsx:16-28`)
    uses semantic `bg-st-*`/`text-st-*` status tokens. WCAG AA inherited from frozen tokens (E-5).
  - (c) Responsive-First — bespoke `<table>`/`.rtable`/`data-label`/`colSpan`/`overflow-x-auto` markup fully
    REMOVED from all 3 pages (grep clean); the DataGrid now owns `.rtable` + per-cell `data-label` card strategy
    (`DataGrid.tsx:184,216,251`). No hand-rolled card markup remains. Toolbar selects moved `max-w-[Nrem]`→`w-[Nrem]`
    inside the grid's `flex flex-wrap` toolbar — wrap-safe at 320px (12rem=192px < 320).
  - (d) Management-list standard — Created + Updated date-time columns present on all 3 (via shared
    `formatDateTime`); Effective From retained; status rendered via shared `StatusChip` (3-state). Uppercase is the
    global CSS layer (unchanged). Order Created→Updated→Status→Actions matches reference.
  - (e) Dialogs preserved + token-styled + scroll: `UsersPage.tsx:223-224`, `TemplatesPage.tsx:219-220`,
    `VerificationUnitDialog.tsx:96-97` all carry `max-h-[90vh] overflow-y-auto`, `bg-foreground/40` overlay,
    `bg-card`/`text-card-foreground`/`border-border`, `className="input"`. UserDialog now self-fetches managers
    (`?limit=200`) instead of receiving the old unpaginated list — correct given pagination; cosmetic-only for my domain.
  - (f) Cross-screen UX — identical structure to clients/products: same header (`+ New` btn), same DataGrid props,
    same actions column (Edit `text-primary` / toggle `text-muted-foreground`), same toolbar status select. Counts
    summary cards dropped on all 3 (intentional — totals now come from the grid pager `totalCount`); consistent.
  - Playwright viewport specs noted passing for all 3.
  - SHOULD-FIX (non-blocking, NOT my domain to fix): `VerificationUnitsPage.tsx:151` uses `defaultSort="sortOrder"`
    while every other grid uses `"name"` — confirm the server whitelists `sortOrder` as a sort key (API/Perf
    auditors) or the initial sort silently no-ops. Design-wise harmless.
  - OPEN (carried): advanced grid features still unlanded (Excel header filters · column visibility · saved views ·
    export · bulk actions) per DATAGRID_STANDARD §2; remaining admin lists (CPV · Rates · Locations) still bespoke.
- **2026-06-06 · DataGrid Slice 2 — LocationsPage migration (working tree, uncommitted)** —
  VERDICT **PASS**. `LocationsPage` rewritten from its bespoke `<table>` to the Universal DataGrid, keeping the
  inline "Add location" form (top) + `EditLocationDialog`. Mirrors clients/products (`MasterDataCrud`) + Slice-1.
  - (a) DataGrid contract — `columns` (`DataGridColumn<Location>[]` via `useMemo`, dep `[toggle]`),
    `queryKey="locations"`, `rowId={(l)=>l.id}`, `defaultSort="pincode"`, `searchPlaceholder`, and
    `fetchPage` using `pageQueryToParams(query)` → `Paginated<Location>` envelope. Matches `MasterDataCrud.tsx:121-128`.
    `LocationsPage.tsx:204-213`. No `filters`/`toolbar` (catalog has no status toggle — same as the old bespoke
    page; StatusChip is informational only). Consistent.
  - (b) Tokens only — grep of all added lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`: **0 hits**. Cells use
    `font-mono`, `text-muted-foreground`, `text-primary`, `text-foreground`; status via shared `StatusChip`. WCAG AA
    inherited from frozen tokens (E-5). DataGrid search input carries `aria-label="Search"` (`DataGrid.tsx:154`).
  - (c) Responsive-First — the bespoke `<table>`/`.rtable`/`data-label`/`colSpan={10}`/`overflow-x-auto` markup, the
    separate `q` search `<input>` + the "≈157k areas — showing up to 500" hint, and the local `useQuery`/`URLSearchParams`
    were all REMOVED (full Read of the file + diff confirm; no hand-rolled card/table markup remains). The grid now owns
    search + the `.rtable` per-cell `data-label` card strategy (`DataGrid.tsx:185,216,251`). The inline add form stays
    `flex flex-wrap items-end` with `w-full sm:w-auto` inputs (`LocationsPage.tsx:140-202`) — wrap-safe at 320px. The two
    diff-touched input classes only reordered Tailwind utilities (`sm:min-w-[10rem] sm:w-auto`→`sm:w-auto sm:min-w-[10rem]`)
    — cosmetic, no behavior change.
  - (d) Management-list standard — Created + Updated date-time columns present (shared `formatDateTime`); Effective From
    retained; Status via `StatusChip`; order Pincode→Area→City→State→Country→Effective From→Created→Updated→Status→Actions.
    Uppercase is the global CSS layer (unchanged).
  - (e) `EditLocationDialog` preserved + token-styled + scroll: `LocationsPage.tsx:270` carries
    `max-h-[90vh] overflow-y-auto`, `bg-foreground/40` overlay, `bg-card`/`text-card-foreground`/`border-border`,
    `className="input"`, `btn`/`btn-ghost`. OCC version-guard + `ConflictDialog` paths intact. Pincode immutable label kept.
  - (f) Cross-screen UX — identical structure to clients/products + Slice-1: same DataGrid props, same actions column
    (Edit `text-primary` / toggle `text-muted-foreground hover:text-foreground`), same skeleton/empty/error/loading states
    from the grid. RateManagement reference-callsite updated for the envelope (`.then((r)=>r.items)`) — out of my domain
    (API/Contract) but cosmetically inert. Location stays axe-EXCLUDED (157k catalog, `a11y.spec.ts:22`) and is kept in
    `viewport.spec.ts:26` (`card:true`) — the spec asserts `table.rtable > tbody > tr > td[data-label]` flattens to
    `display:flex` on mobile, which the DataGrid now emits → "Location Management is responsive" passes.
  - OPEN (carried): advanced grid features still unlanded (Excel header filters · column visibility · saved views ·
    export · bulk actions) per DATAGRID_STANDARD §2; remaining admin lists (CPV · Rates) still bespoke. Locations now
    migrated.
- **2026-06-06 · DataGrid Slice 3 — CasesPage migration + `onRowClick` grid prop (working tree, uncommitted)** —
  VERDICT **PASS**. `CasesPage` rewritten from its bespoke clickable-row `<table>` (local `useQuery` on the legacy
  `CaseView[]` array shape) onto the Universal DataGrid; the shared grid gained an optional `onRowClick?:(row:T)=>void`
  used to preserve the prior whole-row → `/cases/:id` navigation. Mirrors clients/products + Slices 1-2.
  - (a) DataGrid contract — full set present + correct: `columns` (`DataGridColumn<CaseView>[]` via `useMemo([])`),
    `queryKey="cases"`, `rowId={(c)=>c.id}`, `defaultSort="createdAt"` + `defaultSortOrder="desc"` (operational pipeline
    = newest-first, sensible), `searchPlaceholder`, page-controlled `filters={{ status: status || undefined }}`, status
    `<select>` in `toolbar`, and `fetchPage` using `pageQueryToParams(query)` → `Paginated<CaseView>` envelope
    (`CasesPage.tsx:58-86`). All six `sortable` column ids (caseNumber/primaryName/clientName/productName/status/createdAt)
    are server-whitelisted in `service.ts:22-30` (`CASE_PAGE_SPEC.sortMap`) → no silent no-op sorts. Consistent with the
    reference + Slices 1-2.
  - (b) `onRowClick` addition (DataGrid.tsx) — CLEAN + consistent with the grid's role. Prop is optional, well-doc'd
    (`DataGrid.tsx:46-47`); rows get `cursor-pointer` ONLY when the handler is supplied (`DataGrid.tsx:250-252`) and the
    `onClick` is `undefined` otherwise (`:253`) → zero behavior/affordance change for the 6 existing non-clickable grids
    (Users/VU/Templates/Locations/clients/products). The affordance + navigation exactly reproduce the deleted bespoke
    row (old `cursor-pointer … onClick={()=>navigate(...)}` → identical via the prop). No regression to the grid core.
  - (c) Tokens only — grep of all added `+` lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`: **0 hits**. Cells use
    `font-mono text-xs`, `tabular-nums`, `text-xs text-muted-foreground`; row hover stays `hover:bg-row-hover`. WCAG AA
    inherited from frozen tokens (E-5).
  - (d) Responsive-First — the bespoke `overflow-x-auto`+`<table class="rtable">`, the hand-rolled `<thead>`, all seven
    per-cell `data-label="…"` `<td>`s, the `colSpan={7}` loading/error/empty rows, and the separate `q` search `<input>`
    were fully REMOVED (full diff confirms); the grid now owns search + the `.rtable`/`data-label` card strategy
    (`DataGrid.tsx:188,219,260`) + skeleton/empty/error states. Status filter relocated bespoke `max-w-[12rem]`→grid
    `toolbar` as `w-[12rem]` (192px < 320 → wrap-safe). `viewport.spec.ts:32` keeps Cases `card:true` (asserts
    `td[data-label]`→`display:flex` on mobile, which the grid emits) → "Cases is responsive" holds across 375/768/1280/1440.
  - (e) Management-list "Updated" judgment — Cases shows Case No/Customer/Client/Product/Tasks/Status/Created, **no
    Updated** column. JUDGED ACCEPTABLE: the MANAGEMENT_LIST_STANDARD Created+Updated rule (lines 7-26) is explicitly
    scoped to *management / admin / master-data* lists (its title + opening line); Cases is an **operational pipeline**
    list, not master data — the operator triages by case identity + status + age (Created), not "what config changed".
    All the migrated admin lists in Slices 1-2 correctly keep both columns; Cases correctly does not. NOTE: `updatedAt`
    IS on `CaseView` (extends `Case`, `cases.ts:56`) AND is server-sortable (`service.ts:29`), so adding an Updated
    column is zero-cost IF product later wants last-touched recency on the pipeline — recorded as an optional, not a gap.
  - (f) a11y — row-click-to-navigate has the known pattern gap: the `<tr>` is mouse-clickable but **not keyboard-focusable
    / Enter-activatable** (no `tabIndex`/`role`/`onKeyDown`), and the cells aren't focusable. This is identical to the
    PRE-EXISTING bespoke behavior (the old `<tr onClick>` had the same gap) → **no regression introduced by this slice**.
    The Cases a11y spec (`a11y.spec.ts:31`) passes (axe gate 29: serious+critical=0) because axe does not flag this
    interactive-row pattern as a violation. Flagged as a **minor a11y OPEN** (keyboard parity for clickable rows) carried
    forward for the grid — keyboard nav is a DATAGRID_STANDARD §2 item (#19) still unlanded, so this folds into that work,
    not a per-page fix. The grid's other a11y affordances are intact (search `aria-label`, header `aria-sort`, `aria-live`
    updating indicator).
  - Cross-screen UX — identical header (`+ New`)/toolbar/states to clients/products + Slices 1-2; `CasesPage` is the
    first consumer of `onRowClick`, establishing the canonical whole-row-navigation pattern for future operational lists.
  - OPEN (carried): advanced grid features still unlanded (Excel header filters · column search · column visibility ·
    saved views · export · bulk actions · **keyboard navigation** — which subsumes the clickable-row keyboard-parity
    note above) per DATAGRID_STANDARD §2; remaining admin lists (CPV · Rates) still bespoke.
- **2026-06-06 · DataGrid Slice 4 (FINAL) — RateManagementPage migration + Revise/History → dialogs (working tree, uncommitted)** —
  VERDICT **PASS**. `RateManagementPage` rewritten from its bespoke clickable `<table>` (local `useQuery` on the legacy
  `RateView[]` array shape, with inline row-expand `colSpan={13}` Revise/History rows) onto the Universal DataGrid;
  Revise + History converted from inline-expand rows to modal **dialogs**; the client/product `SearchableSelect` filters
  moved into the grid `toolbar`. The cascading AddRateForm is preserved untouched. Mirrors clients/products + Slices 1-3.
  - (a) DataGrid contract — full set present + correct: `columns` (`DataGridColumn<RateView>[]` via `useMemo`, dep `[toggle]`),
    `queryKey="rates"`, `rowId={(r)=>r.id}`, `defaultSort="client"`, `searchPlaceholder`, page-controlled
    `filters={{ clientId: clientId||undefined, productId: productId||undefined }}`, and `fetchPage` using
    `pageQueryToParams(query)` → `Paginated<RateView>` envelope (`RateManagementPage.tsx:280-289`). **All 12 sortable
    column ids EXACTLY match the server `RATE_PAGE_SPEC.sortMap` keys** (`rates/service.ts:16-30`): client·product·kind·
    unit·pincode·area·rateType·amount·effectiveFrom·createdAt·updatedAt·status — verified 1:1, no extra/missing key →
    zero silent no-op sorts. `defaultSort="client"` matches the server `defaultSort:'client'`. The 13th column `actions`
    is correctly NOT `sortable`. The two extra filters (`clientId`/`productId`) flatten to top-level query params via
    `pageQueryToParams` (`pagination.ts:43-45` iterates `q.filters`) so they reach the server; merged into the grid
    queryKey via `filtersKey` (`DataGrid.tsx:101,111`) → refetch on filter change. Consistent with reference + Slices 1-3.
  - (b) Tokens only — grep of all added `+` lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`: **0 hits**. Cells use
    `font-mono text-xs`, `tabular-nums`, `text-muted-foreground`, `text-primary`, `text-foreground`, `whitespace-nowrap`.
    `ActiveChip` (pre-existing) uses semantic `bg-st-approved-bg`/`text-st-approved` status tokens (fine); `money()` uses
    the ₹ glyph (fine). WCAG AA inherited from frozen tokens (E-5).
  - (c) Responsive-First — the bespoke `overflow-x-auto`+`<table class="rtable">`, hand-rolled `<thead>`, all thirteen
    per-cell `data-label="…"` `<td>`s, the inline-expand `colSpan={13}` Revise + History rows, the empty-state row, the
    separate filter card, and the local `useQuery`/`URLSearchParams` were ALL removed (full diff confirms); the grid now
    owns search + the `.rtable`/`data-label` card strategy + skeleton/empty/error states (`DataGrid.tsx:188,219,260`).
    Toolbar `SearchableSelect`s relocated `min-w-[14rem]`→`min-w-[12rem]` (192px < 320 → wrap-safe in the grid's
    `flex flex-wrap` toolbar). Both Revise/History DIALOGS carry `max-h-[90vh] overflow-y-auto`, `bg-foreground/40`
    overlay, `bg-card`/`text-card-foreground`/`border-border`, `className="input"`, `btn`/`btn-ghost`
    (`RateManagementPage.tsx:544-545,602-603`). **HistoryDialog's inner `.rtable` is NEST-SAFE**: `index.css` uses the
    CHILD combinator (`table.rtable > tbody > tr > td`, `index.css:25-27,36-42`) so the dialog's nested history table
    cards INDEPENDENTLY on mobile and the outer grid table never leaks into it — keeping `.rtable`+`data-label` on the
    nested table is correct (it cards itself). AddRateForm stays `flex flex-wrap` responsive (preserved, not in diff).
  - (d) Management-list standard — Created + Updated date-time columns present (shared `formatDateTime`); Effective From
    retained; Status via `ActiveChip`; column order Client→Product→Kind→Unit→Pincode→Area→Rate Type→Rate→Effective
    From→Created→Updated→Status→Actions. Uppercase is the global CSS layer (unchanged). KYC rows render '—' for
    pincode/area/rate type via `?? '—'` (`RateManagementPage.tsx` cells) — correct per the flat ADR-0018 KYC-nulls model.
  - (e) inline-expand → dialog UX DECISION — JUDGED REASONABLE + CONSISTENT. The DataGrid core has NO row-expansion
    affordance (only optional `onRowClick` whole-row nav, added in Slice 3); inline `colSpan` expand rows are
    incompatible with the grid's server-paginated `.rtable` card model. Converting Revise/History to modal dialogs is
    the correct pattern and matches every other migrated page's dialog convention (Slices 1-2 + clients/products), all
    of which carry the same `max-h-[90vh] overflow-y-auto` + token overlay shell. The dialogs even ADD missing affordances
    the inline form lacked (titled `<h2>`, justified-end Cancel/Save footer, History context subheader). No regression.
  - (f) Cross-screen UX — identical header (`+ New`)/toolbar/states to clients/products + Slices 1-3; the Revise/History/
    Deactivate row actions reproduce the deleted bespoke buttons 1:1 (`text-primary`/`text-foreground`/`text-muted-
    foreground` + `hover:underline`). Rate Management is in `viewport.spec.ts:27` (`card:true` → asserts the
    `td[data-label]`→`display:flex` mobile flatten the grid emits) AND `a11y.spec.ts:26` (axe gate 29: serious+critical=0).
  - a11y — grid affordances intact (search `aria-label`, header `aria-sort`, rows-per-page `aria-label`, `aria-live`
    updating indicator). Dialog `<h2>` titles give each modal an accessible name. SearchableSelect a11y unchanged
    (pre-existing component).
  - OPEN / NOTES:
    - **Playwright "Rate Management is responsive" + a11y pass; ONE Mobile-project flake CONFIRMED — passes in
      isolation.** Carried forward as a HARNESS OPEN item (heavy pages flake under parallel viewport load, per the
      standing 90s-timeout note) — NOT a page defect.
    - Advanced grid features still unlanded (Excel header filters · column search · column visibility · saved views ·
      export · bulk actions · keyboard navigation) per DATAGRID_STANDARD §2.
    - **DataGrid rollout to the admin lists is now COMPLETE** (Users · VU · Templates · Locations · Cases · Rates +
      the clients/products reference) — Rates was the last bespoke admin `<table>`; CPV remains (master-detail accordion,
      DataGrid core has no row-expansion → tracked separately).
- **2026-06-06 · Slice 1B — B-22 `/options` dropdown feeds (clients/products/verification-units/users) (working tree, uncommitted)** —
  VERDICT **PASS**. NOT a list/grid change — these feed `<select>` dropdowns. Nine feeders on CaseCreate / CPV /
  RateManagement / UsersPage switched from `?active=true&limit=200`+`.items` to the trimmed `/options` arrays. No
  DataGrid/management-list page touched; no `<table>` migrated.
  - (a) No list/grid regression — the four migrated DataGrid lists (Users/clients/products/VU pages) keep their paginated
    `Paginated<T>` list fetch UNCHANGED; only their auxiliary dropdowns changed. `UsersPage.tsx:184` swapped ONLY the
    in-dialog manager picker (`?limit=200`→`/options`); the user LIST grid (`UsersPage.tsx:49-52`, columns username/name/
    role on `UserView`) is untouched. Confirmed by diff — no grid `columns`/`fetchPage`/`queryKey` edited.
  - (b) Render shape carries every field — verified each consumer reads only fields present in the trimmed Option/
    UserOption/VerificationUnitOption: CaseCreate `c.id/c.name`, `p.id/p.name` (`CaseCreatePage.tsx:110-122`); CPV
    `c.code — c.name`, `p.code — p.name`, `u.code — u.name` (`CpvPage.tsx:82-100,322-326`); RateManagement
    `${c.code} — ${c.name}` / `${p.code} — ${p.name}` / unit `u.name` filtered by `u.kind` (`RateManagementPage.tsx:149-155,
    402-404`); Users manager `{m.name} ({m.role.replace(/_/g,' ')})` (`UsersPage.tsx:262-265`). Every label field is in
    the new shape → **no broken render**. `Option{id,code,name}` (`options.ts:9-13`), `UserOption{id,username,name,role}`
    (`users.ts:46-51`), `VerificationUnitOption{id,code,name,kind}` (`verificationUnit.ts:22-27`). VU `kind` confirmed
    present and used by the rate-management kind filter; CPV types its VU feed as plain `Option[]` and uses only code/name
    (ignores `kind`) — assignment-safe, no render break.
  - (c) Labels unchanged — same display strings as before the swap (CaseCreate name-only, CPV/Rate "code — name", users
    "name (role)"). The `role.replace(/_/g,' ')` humanization is preserved verbatim. No label regression.
  - (d) No hardcoded colors / uppercase / a11y change — diff adds no className/markup to the selects; `aria-label` on CPV
    client/product/unit selects (`CpvPage.tsx:77,93,317`) untouched. Pure data-source swap. grep of touched FE lines: no
    hex/rgb/`text-[`/`bg-[`. Uppercase remains the global CSS layer.
  - Cross-screen UX — all four pages now source dropdowns from one canonical `/options` family; consistent and removes the
    silent-truncation footgun (`?limit=200` could drop the tail of a select — a UX correctness bug, now gone). No design
    standard regressed.
  - OPEN (carried): advanced grid features (Excel filters · column visibility · saved views · export · bulk actions ·
    keyboard nav) still unlanded per DATAGRID_STANDARD §2; CPV remains the one bespoke admin surface (master-detail
    accordion).

### 2026-06-06 — Slice 1C (e2e crash-guard widening + viewport flake) — CTO-DISCHARGED — PASS
- Test-only; CTO discharged the Design review inline (session economy; precedent set in slices 3-4).
- `datagrid.spec.ts` crash-guard widened 3→10 routes (all envelope/options-consuming pages) — strengthens the contract guard
  protecting the responsive list pages; asserts shell+h1 survive after data load. `viewport.spec.ts` flake fixed by
  `waitForLoadState('networkidle')` before the table→card cell-count assertion (was racing the list fetch).
- No design standard touched; the responsive `.rtable` card assertion itself is unchanged (only its timing is now deterministic).
  Playwright 61 passed. PASS.

- **2026-06-06 · Slice 2 — Column visibility (B-6 / DATAGRID_STANDARD §9), Universal DataGrid (working tree, uncommitted)** —
  VERDICT **PASS**. New toolbar "Columns" button+dropdown on the one DataGrid lets users show/hide columns; hidden ids
  persist in the `cols` URL key and survive reload; guard blocks hiding the last visible column. Diff is surgical — only
  `DataGrid.tsx` (+79) and `e2e/datagrid.spec.ts` (+24); zero per-page edits → all 7 migrated lists inherit it for free.
  - (a) Tokens only — grep of all added `+` lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`/`[#`: **0 hits**. Menu shell uses
    `bg-card border-border shadow-md rounded-md`; rows `hover:bg-row-hover text-sm`; trigger `btn-ghost text-xs`; backdrop
    is transparent (`fixed inset-0`, no color). All semantic tokens; WCAG AA inherited from frozen tokens (E-5). (`DataGrid.tsx:201-238`).
  - (b) Rendering correctness — `state.columnVisibility` is fed to `useReactTable` (`DataGrid.tsx:163`), so the real `<thead>`
    (`table.getHeaderGroups()`, :261) and data `<tbody>` (`table.getRowModel().rows` → `row.getVisibleCells()`, :318-326)
    AUTO-omit hidden ids — no manual header/body filtering needed, no risk of header/cell desync. The hand-rolled
    skeleton/error/empty rows were correctly switched `columns`→`visibleColumns`/`visibleColumns.length` (:289,299,310) so
    colSpan + skeleton-cell count match the visible header count. Verified consistent.
  - (c) URL-key fidelity (§9/§12) — `cols` reuses the same `patch()` mechanism as `q/sort/page/size` (:79-92), is cleared
    when empty (`next.size ? … : null`), and toggles with `resetPage=false` (:124) — correct: changing visibility must NOT
    jump the pager. Faithful interim before the §10 saved-views backend store (URL is per-bookmark, not per-user-persisted —
    expected for §9). Last-column guard: `else if (visibleColumns.length > 1) … else return` (:118-121) — can't hide the last.
  - (d) a11y (axe gate 29) — trigger has `aria-haspopup="menu"` + `aria-expanded={menuOpen}` (:205-206); panel `role="menu"`
    + `aria-label="Toggle columns"` (:222-223); each checkbox `aria-label={c.label ?? c.header}` (:233) AND a visible `<span>`
    label wrapped in `<label>` (:227,235) → double-labelled, click-target is the whole row. Escape closes (keydown listener
    bound only while open, cleaned up :108-113); transparent click-outside backdrop button is `aria-hidden` + `tabIndex={-1}`
    (:213-214) so it's not in the a11y tree or tab order. **KNOWN LIMITATION (LOW severity, non-blocking):** no focus-trap /
    roving-tabindex inside the menu and focus is not returned to the trigger on Escape — a lightweight-menu shortfall, NOT an
    axe serious/critical violation (gate stays green); `role="menu"` strictly implies arrow-key roving which isn't wired.
    Folds into the DATAGRID_STANDARD §2 keyboard-nav OPEN already carried from Slice 3 — track there, do NOT per-page fix.
    Minor: `role="menu"` + checkbox children is technically a `menu`/`menuitemcheckbox` mismatch, but checkboxes are widely
    AT-understood and axe does not flag it — cosmetic spec-pedantry, acceptable.
  - (e) Responsive — panel is `absolute right-0 … w-52` (208px) inside a `relative` container in the `ml-auto` cluster of the
    `flex flex-wrap` toolbar (:188,201,223). Opening leftward from the right edge, 208px < 320px → **no horizontal overflow at
    320px**; the toolbar wraps the trigger before the panel ever clips. `max-h-72 overflow-auto` caps tall column lists.
    No mobile concern.
  - (f) Standards consistency — column HEADERS stay uppercase via the global `<thead>` CSS layer (:260, unchanged); the menu
    labels are normal-case control text, matching the existing "Search"/"Rows" control casing → no UPPERCASE_DISPLAY_STANDARD
    violation. The `hideable?: boolean` column opt-out (`hideable !== false`, :107) lets pages PIN columns (e.g. identity/
    actions) always-visible — sound API, defaults to hideable so existing pages need no change.
  - Verification — pnpm verify green; Playwright 62 passed incl. the new test (`datagrid.spec.ts:39-62`): hide Code →
    header gone → `cols=code` in URL → reload persists → re-show clears `cols`. Browser screenshot shows all 7 clients
    columns token-styled in the menu. NOTE: the new test asserts hide/persist/reload/clear but NOT the last-column guard —
    the guard is verified by code-read (:118-121); an explicit guard test would harden it (optional, non-blocking).
  - OPEN (carried): saved-views backend store (§10) · Excel header filters · column search · export · bulk actions ·
    **keyboard navigation (now also subsumes this menu's focus-trap/roving-tabindex limitation)** per DATAGRID_STANDARD §2;
    CPV remains the one bespoke admin surface (master-detail accordion).

- **2026-06-06 · Grid per-column filter UI (B-3 / DATAGRID_STANDARD §6), Universal DataGrid (working tree, uncommitted;
  `DataGrid.tsx` + `MasterDataCrud.tsx` + spec)** — VERDICT **PASS**. A per-column filter row renders in `<thead>`
  below the header row; filterable columns (clients/products code+name via MasterDataCrud) get a debounced text input
  whose value lives in the `f_<id>` URL key. Surgical — `DataGrid.tsx` + 2 lines in `MasterDataCrud.tsx` + the spec.
  - (a) **Tokens only** — grep of all added `+` lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`/`[#`: **0 hits**. The
    filter input uses the shared `.input` class (`index.css:8`) + utility sizing (`h-7 w-full min-w-[6rem] text-xs`);
    the filter `<th>` uses `px-3 pb-2 font-normal` + `border-t border-border` row separator. All semantic; WCAG AA
    inherited (E-5).
  - (b) **Uppercase standard — correctly defended.** The global `<thead>` layer uppercases header text
    (DataGrid.tsx:283); the filter `<th>` adds `normal-case` (:311) so the input/placeholder is NOT shouted —
    matches the "control text is normal-case" precedent set by the Columns menu + Search/Rows controls. No
    UPPERCASE_DISPLAY_STANDARD violation.
  - (c) **a11y** — each input has `aria-label="Filter <col>"` (DataGrid.tsx:435, label = `c.label ?? c.header`) → an
    accessible name distinct from the column header; the spec selects it by that role+name (`getByRole('textbox',
    {name:'Filter Code'})`). No new axe surface (text input with a name); gate stays green.
  - (d) **Alignment with headers — verified 1:1.** The filter row maps `visibleColumns` (DataGrid.tsx:310) which is
    the same `columns`-ordered, same-`hiddenIds`-dropped set the TanStack header row renders → each filter cell sits
    directly under its header; non-filterable columns render an empty `<th>` so the row never shifts. Browser-verified
    (inputs under CODE+NAME, other cells empty) — consistent.
  - (e) **Responsive** — the filter row lives inside the existing `overflow-x-auto` table wrapper (:281), so on a
    narrow viewport it scrolls horizontally WITH the table (no page overflow at 320px); `w-full min-w-[6rem]` keeps
    each input flush to its column. The `.rtable` card model on mobile is unaffected (the filter row is a `<thead>`
    construct; cards flatten the `<tbody>` `td[data-label]`). No mobile concern.
  - (f) **Consistency with DATAGRID_STANDARD §6 + cross-screen UX** — realizes the §6 per-column search affordance on
    the one DataGrid, so clients + products inherit it identically; debounce (300ms) reuses the grid's
    `SEARCH_DEBOUNCE_MS` so the typing feel matches global search. Same control casing/sizing language as the rest of
    the toolbar. No bespoke table introduced.
  - Verification — pnpm verify green; Playwright 63 (+1 §6 filter test). OPEN (carried): saved-views store (§10 — the
    filter row already re-syncs from URL, the future saved-view input path) · Excel header filters · export · bulk
    actions · keyboard nav per DATAGRID_STANDARD §2; CPV remains the one bespoke admin surface.

- **2026-06-06 — B-4 Excel-style header multi-select (§7) — `DataGrid.tsx` (`ColumnFilterSelect`) +
  `VerificationUnitsPage.tsx`. VERDICT: PASS (clear to commit).** Realizes the "Excel header filters" OPEN item
  carried on this ledger since the §6 entry.
  - **Tokens-only.** `.input` (real class), `bg-card`, `border-border`, `hover:bg-row-hover`, `shadow-md` — all
    frozen `@crm2/ui-theme` tokens already in use in this file. No hex/rgb/arbitrary color in added lines.
  - **Casing — correct.** Trigger button + option labels carry `normal-case` to counter the global `<thead>`
    uppercase (same fix the §6 input used); the multi-select is not shouted. Kind labels title-cased via
    `KIND_LABELS` (Field Visit / KYC Document / Desk Document).
  - **a11y — wired.** Trigger `aria-haspopup="menu"` + `aria-expanded` + `aria-label="Filter <label>"`; panel
    `role="menu"` + `aria-label="<label> options"`; each checkbox `aria-label={option.label}`; Escape closes;
    backdrop `aria-hidden`+`tabIndex={-1}`. Mirrors the blessed Columns-menu pattern.
  - **Responsive — OK.** Panel is `absolute` inside the `overflow-x-auto` table wrapper (no page overflow);
    `max-h-60 overflow-auto` for long option lists. `.rtable` card model untouched.
  - **Consistency.** Matches DATAGRID_STANDARD §7 and the Columns-menu bespoke-panel convention.
  - **NOTE / OPEN (carried):** the panel has no focus-trap (Tab can leave the open menu) — folds into the existing
    OPEN keyboard-nav item (§2), tracked, non-blocking. Accept Playwright 64 (+§7: open→check Field Visit→
    `f_kind=FIELD_VISIT`→reload "1 selected"→uncheck clears) + browser screenshot of the aligned 3-option menu.
    OTHER OPEN (carried): saved-views store (§10); export; bulk actions. **Cleared to commit.**

- **2026-06-06 · Column-filter rollout (B-3/B-4) to the 5 remaining lists — users · report-templates · locations · rates ·
  cases (page `filterable`/`filterOptions` declarations; working tree, pre-commit). VERDICT: PASS (clear to commit).**
  Pure declarative rollout — each page marks columns `filterable` (text) or `filterOptions` (enum) and the existing
  DataGrid renders the §6 text input / §7 `ColumnFilterSelect` automatically. Zero grid-core change.
  - **(a) Tokens only.** The filter affordances are entirely the already-token-audited `ColumnFilterInput` (§6) /
    `ColumnFilterSelect` (§7) leaves in `DataGrid.tsx` — UNTOUCHED this slice (`git diff --name-only`: no DataGrid.tsx).
    The page diffs add only `filterable: true` / `filterOptions: …` props + module-level option consts (plain JS, no
    markup/className). grep `^+` for hex/rgb/`text-[`/`bg-[`: 0 hits. WCAG AA inherited from frozen tokens (E-5).
  - **(b) Enum multi-selects use the blessed `ColumnFilterSelect`** (`normal-case` panel, `aria-haspopup`/`role="menu"`/
    per-checkbox `aria-label`/Escape/backdrop — all audited in the §7 entry above). No new a11y surface; axe gate stays
    green. Header text stays uppercase (global `<thead>` layer); the control panel is correctly `normal-case`.
  - **(c) Capability parity — no list lost a filter.** cases status / templates type / users role moved from a toolbar
    single-`<select>` to a header multi-select (GAIN: multi-value; same VU §7 precedent). The boolean `active`/status
    toolbar selects (users, templates) and rates' FK domain selects (clientId/productId) are KEPT — so status filtering
    is still available everywhere (header for cases, toolbar `active` for admin lists). Per-page toolbars still render
    their kept selects. Consistent with DATAGRID_STANDARD §6/§7 across all 5 lists.
  - **(d) Cross-screen consistency — one nit.** Four of the five new option consts title-case their labels
    (STATUS_OPTIONS "In Progress", ROLE_OPTIONS via ROLE_LABELS "Field Agent", TYPE_OPTIONS via TYPE_LABELS "KYC
    Document"). **SHOULD-FIX (non-blocking):** rates `RATE_KIND_OPTIONS` uses `.replace(/_/g,' ')` → "FIELD VISIT" /
    "KYC DOCUMENT" (uppercase words on a `normal-case` panel) — out of step with the other four AND with the VU
    `KIND_LABELS` title-case precedent for the SAME enum. Cosmetic label-casing drift, not a standard violation; align
    to a KIND_LABELS-style const on next touch. Flagged on the CEO + Principal ledgers too.
  - OPEN (carried, unchanged): saved-views store (§10/§12); keyboard-nav/focus-trap on the filter panels (§2); export;
    bulk actions. Accept recorded Playwright 64 + live dev API all 5 filters correct. **Cleared to commit. The §6/§7
    column-filter UI is now consistent across every DataGrid list.**

- **2026-06-06 · CPV effective-from reschedule dialog — new `RescheduleDialog` in `CpvPage.tsx` (working tree, pre-commit).
  VERDICT: PASS — with ONE non-blocking off-token SHOULD-FIX I am applying-to-ledger here.** A new module-level reschedule
  modal opens from a new "Edit" button on each CPV link row + each unit row; prefilled `<input type="date">`, Cancel/Save,
  immutable-keys note; OCC ConflictDialog on 409.
  - **(a) ⚠️ Tokens — ONE VIOLATION (standing invariant #1).** The overlay is `bg-black/40` (`CpvPage.tsx:33`). `black` is a
    raw Tailwind palette color, NOT an `@crm2/ui-theme` semantic token, and `grep bg-black` across the entire `apps/web/src`
    returns EXACTLY this one line — it exists nowhere else. Every other modal overlay in the app (RateManagement:560/623,
    Locations:272, Users:226, Templates:212, VerificationUnitDialog:96, MasterDataCrud:208, AND `ConflictDialog:28`) uses the
    semantic `bg-foreground/40`. This is both a token violation and a cross-screen overlay-color inconsistency. The slice's own
    Design-lens claim ("uses tokens only … `bg-black/40`") is INCORRECT — `bg-black` is not a token. **SHOULD-FIX (cosmetic,
    non-blocking): `bg-black/40 → bg-foreground/40`** to match every sibling modal. The dialog's OTHER classes ARE clean tokens
    (`bg-card`, `border-border`, `text-muted-foreground`, `text-foreground`, `.input`, `.btn`/`.btn-ghost`, `shadow-lg`).
  - **(b) a11y — wired correctly.** `role="dialog"` + `aria-modal="true"` + `aria-label={title}` on the overlay; the date input
    has a visible `<label>` wrapping a "Effective From" `<span>` + the native `<input type="date">` (accessible name present);
    Save disabled while `!date || busy`. **KNOWN GAP (LOW, non-blocking): no focus-trap, no focus-return-to-trigger, no Escape-
    to-close** — same lightweight-modal shortfall as the Columns/filter panels; folds into the carried DATAGRID_STANDARD §2
    keyboard-nav OPEN, do NOT per-page fix. Note: the existing ConflictDialog also lacks a focus trap, so this is consistent
    with (not worse than) the app's current modal baseline.
  - **(c) Responsive — OK.** `fixed inset-0 flex items-center justify-center … p-4` centers it; the panel is `w-full max-w-sm`
    (≤384px, with the `p-4` gutter → fits 320px with no horizontal overflow); `.input w-full` fills the column. No mobile concern.
  - **(d) Uppercase — fine.** The dialog title is an `<h3>` of normal control text (`font-semibold`, not a `<thead>`); the global
    uppercase layer applies only to table headers, so no UPPERCASE_DISPLAY_STANDARD surface here. Consistent with the other
    dialogs' `<h2>`/`<h3>` normal-case titles.
  - **(e) Cross-screen UX consistency — consistent in pattern.** Edit button is `text-primary hover:underline` (same as every
    other admin Edit affordance); the Edit→prefilled-modal→Cancel/Save→OCC-ConflictDialog-on-409 flow matches the
    locations/users/rate edit convention; the immutable-keys note is an honest, helpful addition (no other screen needed it
    because only CPV has the deactivate+recreate constraint). Unit Actions cell gained `whitespace-nowrap` so Edit+Toggle don't
    wrap — minor, correct. The ONLY consistency break is the overlay color (item a).
  - OPEN (carried, unchanged): focus-trap/keyboard-nav (§2 — now also subsumes this dialog); saved-views store (§10/§12); export;
    bulk actions. Accept recorded pnpm verify green + browser screenshot ("RESCHEDULE HDFC · CAR_LOAN" prefilled + immutable-keys
    note). **Cleared to commit (the `bg-black/40`→`bg-foreground/40` token fix is a non-blocking SHOULD-FIX to apply on next touch).**

- **2026-06-06 · ADR-0020 correctable-code edit — `MasterDataCrud.tsx` dialog changes (working tree, pre-commit).
  VERDICT: PASS.** The shared clients/products CRUD dialog now allows correcting the code on edit; I checked tokens,
  a11y, copy honesty, and cross-screen consistency against the sibling admin dialogs.
  - **(a) Tokens — clean.** The new helper line is `text-xs text-muted-foreground` (MasterDataCrud.tsx:229) — semantic
    token, matches the muted-helper convention. The friendly error reuses the existing `setError` channel (rendered in the
    already-tokened error block). No hex/rgb/raw-palette added (grep `^+` for `text-[`/`bg-[`/`#` = 0). No overlay change
    (this dialog already uses `bg-foreground/40`, unlike the CPV `bg-black/40` nit flagged separately — NOT reintroduced here).
  - **(b) Code field correctly un-frozen.** `disabled={isEdit}` REMOVED from the `<input>` (was line ~223) so the code is
    now editable on edit; the label dropped the "(immutable)" suffix → now just "Code (UPPER_SNAKE)" (MasterDataCrud.tsx:220).
    The `onChange` still force-uppercases (`value.toUpperCase()`), so the UPPER_SNAKE affordance is preserved. Consistent with
    the create path (same input, same transform).
  - **(c) Helper copy — honest + scoped to edit.** `{isEdit && <span…>Correctable only while unused — locked once referenced
    by other records (ADR-0020).</span>}` (MasterDataCrud.tsx:229) renders ONLY in edit mode (create doesn't need it). It
    truthfully states the lock semantics and cites the ADR — good operator transparency, mirrors the CPV dialog's
    immutable-keys-note precedent. NB: the helper says "locked once referenced," matching the ADR's intent even though the
    server's actual reference check is currently a 3-table subset (a BE-correctness flag on the other two ledgers, not a copy
    defect — the copy describes the intended contract).
  - **(d) CODE_LOCKED error message — friendly, replaces the raw code.** `else if (e instanceof ApiError && e.code ===
    'CODE_LOCKED')` → "This code is in use by other records and can't be changed. Deactivate and recreate to fix it."
    (MasterDataCrud.tsx:204-207). No raw `CODE_LOCKED` string leaks to the user; gives the exact remedy (deactivate+recreate,
    the ADR's documented escape hatch). Sits in the same `onError` chain as the proven `isStale` branch (same ApiError.code
    discrimination), so the pattern is consistent with the OCC-conflict UX.
  - **(e) Save gating — correct.** `disabled={mut.isPending || !name || !code}` (MasterDataCrud.tsx:260) — code is now
    required on edit too (was `!isEdit && !code`), which is right since the field is editable and submitted; prevents an
    accidental empty-code PUT. Consistent enable/disable logic across create+edit.
  - **(f) a11y — unchanged baseline.** The `<label>` still wraps the `<span>` + `<input>` (accessible name intact); the new
    helper is a plain `<span>` inside the label (read as part of the field description). No focus-trap/Escape added — same
    lightweight-modal baseline as the rest of the app (carried §2 OPEN); not regressed. Uppercase: dialog title is an `<h2>`
    of normal text, no `<thead>` surface — UPPERCASE_DISPLAY_STANDARD N/A.
  - **(g) Cross-screen consistency.** This is the SHARED component for clients AND products, so both admin lists get the
    identical editable-code UX in one change — inherently consistent. Edit→dialog→Cancel/Save→conflict-on-error flow matches
    every other admin edit dialog. No drift introduced.
  - OPEN (carried): focus-trap/keyboard-nav (§2); saved-views store (§10/§12); the CPV `bg-black/40`→`bg-foreground/40` nit.
    Accept recorded gate (browser shows editable code field + helper; pnpm verify green). **Cleared to commit — the dialog
    is consistent and clear; the only ADR-0020 concern is BE-side (incomplete lock set), not design.**

- **2026-06-06 · ADR-0020 rollout to templates + locations + users dialogs — `TemplatesPage` `TemplateDialog`,
  `LocationsPage` `EditLocationDialog`, `UsersPage` `UserDialog` (working tree, pre-commit). VERDICT: PASS (clear to commit).**
  Three admin edit dialogs flip a former-immutable key to editable, each with honest per-entity helper copy. Audited tokens,
  a11y, responsive, helper clarity, and cross-screen consistency against the clients/products MasterDataCrud dialog + the
  sibling admin dialogs.
  - **(a) Tokens — clean, no `bg-black` regression.** grep `bg-black`/`bg-[` across all three pages = **0 hits** (exit-1). All
    three overlays stay `bg-foreground/40` (LocationsPage:276 in-diff; Templates/Users overlays untouched), the semantic token
    every sibling modal uses — the CPV `bg-black/40` nit is NOT reintroduced. New helper lines are `text-xs text-muted-foreground`
    (Locations pincode helper, Users login-rename helper); the friendly error reuses the existing tokened error block. No hex/rgb/
    raw-palette added (grep `^+` = 0). WCAG AA inherited from frozen tokens (E-5).
  - **(b) Keys correctly un-frozen + honest copy PER ENTITY (the design-consistency crux).** (i) **Templates**: `disabled={isEdit}`
    removed from the code `<input>`; label dropped "(immutable)" → "Code (UPPER_SNAKE)"; `onChange` still force-uppercases (UPPER_SNAKE
    affordance preserved). (ii) **Locations**: the static `<p>Pincode X (immutable)</p>` REPLACED with a real labelled
    `<input className="input font-mono">` (6-digit sanitized via `replace(/\D/g,'').slice(0,6)`) + helper "Correctable only while unused —
    locked once referenced by rates (ADR-0020)" — reads well, matches the MasterDataCrud helper convention, and is the truthful lock story
    (locations DO lock by rates). (iii) **Users**: `disabled={isEdit}` removed; label dropped "(immutable)"; helper "Editable — a login
    rename (must stay unique)" rendered only in edit mode. Three different truths, three correct copies — no false "immutable" remains, no
    false "locked" claimed where there's no lock. This is exactly the honest-copy bar the CPV + clients/products dialogs set.
  - **(c) a11y — labels on the now-editable inputs.** The new Locations pincode input is wrapped in a `<label className="block">` with a
    visible `<span>` "Pincode (6 digits)" + the helper `<span>` inside the label (accessible name + description present) — an UPGRADE
    over the old non-interactive `<p>`. Templates/Users code/username inputs keep their existing `<label>`+`<span>` wrappers (accessible
    name intact); the Users helper is a `<span>` inside the label (read as field description). No focus-trap/Escape added — same
    lightweight-modal baseline as the rest of the app (carried §2 OPEN), not regressed.
  - **(d) Responsive — unchanged.** All three dialogs keep `max-h-[90vh] overflow-y-auto` + `w-full max-w-md`/`max-w-…` shells (Locations
    `max-w-md`); the new Locations pincode `<input className="input font-mono">` is `w-full` (fills the column, no overflow at 320px).
    Templates code input lives in the existing `grid-cols-1 sm:grid-cols-2` row (untouched). No new overflow surface.
  - **(e) Save-gating + uppercase — correct.** Save now requires the key on edit too: Locations `pincode.length !== 6`, Templates
    `code.length < 2`, Users `username.length < 3` (was `!isEdit && …`) — right, since the field is now editable + submitted; FE floors
    align with the SDK validators (pincode 6-digit, code≥2, username≥3). Dialog titles are normal-case `<h2>`/`<h3>` (no `<thead>`
    surface) → UPPERCASE_DISPLAY_STANDARD N/A; the global header-uppercase layer is untouched (intact).
  - **(f) Cross-screen consistency — strong; consistent with the clients/products MasterDataCrud dialog.** All three Edit→prefilled-
    modal→Cancel/Save→OCC-ConflictDialog-on-409 flows match the established admin-edit convention; the friendly `PINCODE_LOCKED`/`CODE_LOCKED`
    error maps sit in the same `onError` chain as the proven `isStale` branch (Locations + Templates), mirroring the MasterDataCrud
    `CODE_LOCKED` UX byte-for-byte. Users intentionally maps NO lock (correct — no dependents gate). The locations pincode-input-replacing-
    static-text change reads as a normal labelled field, indistinguishable in shape from the area/city/state inputs below it. No drift.
  - Accept recorded gate (pnpm verify green; sdk 63 [independently re-run by CEO]; Playwright 64; browser: users username editable +
    "login rename" helper shown). OPEN (carried, unchanged): focus-trap/keyboard-nav (§2 — subsumes these dialogs); saved-views store
    (§10/§12); the CPV `bg-black/40`→`bg-foreground/40` nit (separate, NOT here). **Cleared to commit — all three dialogs are token-clean,
    honestly-copied per entity, and consistent with the MasterDataCrud reference.**

- **2026-06-06 · ADR-0020 FINAL entity — `VerificationUnitDialog.tsx` editable-code (working tree, pre-commit).
  VERDICT: PASS (clear to commit).** The last admin edit dialog flips its former-immutable key (`code`) to editable, completing
  the rollout across all 6 keyed entities. Audited tokens, a11y, responsive, copy honesty, and cross-screen consistency against
  the clients/products MasterDataCrud dialog + the 5 sibling admin dialogs.
  - **(a) Tokens — clean, NO `bg-black` regression.** The overlay is `bg-foreground/40` (`VerificationUnitDialog.tsx:104`) — the
    semantic token every sibling modal uses; the CPV `bg-black/40` nit is NOT reintroduced (grep of the file = 0 `bg-black`/`bg-[`).
    The friendly CODE_LOCKED error reuses the existing tokened `setError` block. No hex/rgb/raw-palette added (grep `^+` = 0).
    WCAG AA inherited from frozen tokens (E-5).
  - **(b) Code field correctly un-frozen + label fixed.** `disabled={isEdit}` REMOVED from the code `<input>`; label changed
    `"Code (UPPER_SNAKE, immutable)"` → `"Code (UPPER_SNAKE)"` (`:108`) — the false "immutable" claim is gone, the UPPER_SNAKE
    affordance kept (the `onChange` sanitizer still upper-cases + strips). The PUT now sends `code` (`:80-84`) so the edit
    actually submits it. Consistent with the MasterDataCrud editable-code precedent.
  - **(c) Friendly CODE_LOCKED message — matches the MasterDataCrud copy.** `else if (e instanceof ApiError && e.code ===
    'CODE_LOCKED')` → "This code is in use by other records and can't be changed. Deactivate and recreate to fix it." (`:95-97`).
    No raw `CODE_LOCKED` string leaks; gives the exact remedy; sits in the same `onError` chain as the proven `isStale` branch —
    byte-consistent with the clients/products + templates/locations CODE_LOCKED/PINCODE_LOCKED UX.
  - **(d) Save-gating — correct.** `disabled={mut.isPending || !name || !code}` (`:186`) — was `… || (!isEdit && !code)`; code is
    now required on edit too (right, since it's editable + submitted) → no accidental empty-code PUT. Consistent enable/disable
    logic across create+edit, matching the MasterDataCrud `!name || !code` gate.
  - **(e) PRE-EXISTING `Kind` select `disabled={isEdit}` (`:130`) — NOT this slice, NOT flagged.** The dialog's one remaining
    disabled-on-edit field is the `Kind` `<select>` (a structural change that re-keys downstream config); it is pre-existing,
    NOT in this diff, and unrelated to ADR-0020 (which governs identity-key correction, not type-switching). Correctly left
    alone. NB: `Category` (`:138`) is a plain editable input — already editable, no change. Not a consistency gap.
  - **(f) a11y / responsive / uppercase — unchanged baseline.** `<Field label>` wrappers keep the accessible name on the now-
    editable code input; dialog shell stays `max-h-[90vh] overflow-y-auto w-full max-w-lg` (fits 320px, no overflow); title is a
    normal-case `<h2>` (no `<thead>` surface → UPPERCASE_DISPLAY_STANDARD N/A; the global header-uppercase layer untouched). No
    focus-trap/Escape added — same lightweight-modal baseline as the rest of the app (carried §2 OPEN), not regressed.
  - **(g) Cross-screen consistency — strong; closes the set.** VU is the 6th and final keyed dialog to adopt the
    Edit→prefilled-modal→Cancel/Save→OCC-ConflictDialog-on-409 + friendly-LOCKED-on-409 convention. All 6 (clients·products·
    templates·locations·users·VU) now tell the truth about their key's lock semantics; VU's "(immutable)" was the last false
    label and it's gone. No drift introduced.
  - Accept recorded gate (pnpm verify green; sdk 63 [independently re-run by CEO]; Playwright VU pass; browser: VU code field
    editable showing RESIDENCE, not disabled). OPEN (carried, unchanged): focus-trap/keyboard-nav (§2 — subsumes this dialog);
    saved-views store (§10/§12); the CPV `bg-black/40`→`bg-foreground/40` nit (separate, NOT here). **Cleared to commit — the VU
    dialog is token-clean, honestly-copied, and consistent with the MasterDataCrud reference. The ADR-0020 dialog rollout is now
    COMPLETE across every keyed admin entity.**

- **2026-06-07 · B-13 Export menu — toolbar Export dropdown on the Universal DataGrid (`DataGrid.tsx` export block +
  `runExport` + exportError banner; `MasterDataCrud.tsx` `exportFn` wiring). VERDICT: PASS (clear to commit).** New
  `exportFn?`-gated Export menu (`DataGrid.tsx:284-348`) mirroring the blessed Columns menu (`:349-393`); grouped
  Current view / All matching, each XLSX + CSV; disabled "Exporting…" trigger during a run; `role="alert"` error banner.
  - **(a) Tokens — clean, mirrors the Columns menu 1:1.** Trigger `btn-ghost text-xs` (= Columns trigger `:353`); panel
    `rounded-md border border-border bg-card p-1 text-sm shadow-md` (= Columns panel shell `:373`, just `w-56` vs `w-52`
    + no `max-h-*/overflow-auto` since the list is fixed-length 4 items — fine); group headers `text-xs font-semibold
    uppercase tracking-wide text-muted-foreground`; items `hover:bg-row-hover`; error banner `text-sm text-destructive`.
    grep of the export block (`:284-348`) + banner (`:412-416`) for hex/rgb/hsl/`bg-black`/`bg-[`/`text-[`/`border-[`:
    **0 hits** — all semantic `@crm2/ui-theme` tokens. No `bg-black/40` regression (the click-outside backdrop is the
    same transparent `fixed inset-0` button as Columns, no color). WCAG AA inherited from frozen tokens (E-5).
  - **(b) a11y — matches the blessed Columns/§7 pattern.** Trigger `aria-haspopup="menu"` + `aria-expanded={exportMenuOpen}`
    (`:289-290`); panel `role="menu"` + `aria-label="Export"` (`:306-307`); each of the 4 items `role="menuitem"`
    (`:314,321,331,338`); Escape closes via a keydown listener bound ONLY while open + cleaned up (`:183-188`, identical
    to Columns `:142-147`); transparent click-outside backdrop is `aria-hidden="true"` + `tabIndex={-1}` (`:300-301`) so
    it's out of the a11y tree + tab order. Error banner is `role="alert"` (`:413`) → SR-announced on export failure.
    **KNOWN GAP (LOW, non-blocking — SAME deferred item, NOT new debt):** no focus-trap / roving-tabindex inside the
    menu and focus is not returned to the trigger on Escape. This is byte-identical to the Columns-menu shortfall logged
    2026-06-06 (Slice 2 item d) and the §7 ColumnFilterSelect — it is NOT an axe serious/critical violation (gate stays
    green) and folds into the carried DATAGRID_STANDARD §2 keyboard-nav OPEN. Do NOT per-menu fix. NB: the group-header
    `<p>`s are non-interactive presentational text inside `role="menu"`; a strict ARIA reviewer might want `role="group"`
    + `aria-label` instead of bare `<p>`s, but axe does not flag it and AT skips non-focusable text — cosmetic spec-pedantry,
    acceptable (same tolerance applied to the §9 menuitemcheckbox note).
  - **(c) UX — disabled run state + error handling correct.** During a run the trigger shows "Exporting…" and is
    `disabled={!!exporting}` (`:291,294`), the menu is closed (`setExportMenuOpen(false)`, `:193`), and `exporting` is a
    `${mode}:${format}` token so re-entrancy is blocked until `finally` clears it (`:222`). Error path: `EXPORT_TOO_LARGE`
    → actionable copy "Too many rows for a direct export — refine your filters (background export coming soon)."; any other
    failure → generic "Export failed. Please try again." (`:215-220`). `setExportError(null)` clears on each new run
    (`:191`) so a stale banner never lingers. Blob download is the standard create-anchor-click-revoke (`:206-213`).
  - **(d) Labeling clarity — clear.** Two group headers "Current view" / "All matching rows" + 4 explicit items
    "Export as Excel (XLSX)" / "Export as CSV" under each. The (XLSX) parenthetical disambiguates Excel from CSV for
    operators; the two groups read unambiguously (this page vs the whole filtered result set). Group-header casing is
    `uppercase tracking-wide` — consistent with section-label convention; the item labels are normal-case control text,
    matching the Columns/Search/Rows control-casing precedent. No UPPERCASE_DISPLAY_STANDARD surface (no `<thead>`).
  - **(e) Responsive — OK.** Panel is `absolute right-0 … w-56` (224px) inside a `relative` wrapper in the `ml-auto`
    cluster of the `flex flex-wrap` toolbar (`:278,285,308`), opening leftward from the right edge → 224px < 320px, no
    horizontal overflow at 320px; the toolbar wraps the trigger before the panel can clip. The error banner is a
    full-width `<p>` below the toolbar (`:412-416`) — no overflow. Same layout posture as the Columns menu (`w-52`).
  - **(f) Consistency — strong; carries the Columns-menu precedent + DATAGRID_STANDARD §11.** Same bespoke-panel shell,
    same `aria-haspopup`/`role="menu"`/Escape/backdrop wiring, same trigger styling, same `exportFn?`-gating discipline
    the grid uses for `onRowClick`/`toolbar`/filters → pages opt in by passing one prop and inherit the menu for free
    (MasterDataCrud wires `exportFn` → `apiBlob(.../export?…)` `:138-139`; the grid sends format/mode + visible
    `cols`+search+sort+filters, mode `current` adds page/limit `:195-204`). Cross-screen consistent with the Columns,
    §6 filter, §7 multi-select, and dialog conventions already on this ledger.
  - OPEN (carried, unchanged): focus-trap/keyboard-nav (§2 — now also subsumes this Export menu); saved-views store
    (§10/§12); bulk actions; the CPV `bg-black/40`→`bg-foreground/40` nit (separate page, NOT here). **Cleared to commit —
    the B-13 Export menu is token-clean, a11y-wired to the blessed Columns-menu pattern, clearly labeled, responsive, and
    consistent with §11. The only a11y shortfall is the pre-existing, already-tracked DEFERRED focus-trap item — NOT new debt.**

- **2026-06-09 · Keyboard-nav / focus-management slice — new `useFocusTrap` hook wired into 3 DataGrid popovers +
  8 modal dialogs (working tree, pre-commit). VERDICT: PASS (clear to commit). This RESOLVES the focus-trap/keyboard-nav
  item I have carried OPEN since 2026-06-06 (Slice 2/3).** New `apps/web/src/lib/useFocusTrap.ts` (focus-in on
  open → first focusable / container fallback; cyclic Tab+Shift+Tab trap; Escape→`onEscape`; return-focus to opener on
  unmount, but ONLY when focus would otherwise be lost — `!activeEl || body || container.contains(activeEl)`, so a
  deliberate outside click is never yanked back). Wired into Export/Columns/`ColumnFilterSelect` menus (`DataGrid.tsx`)
  + ConflictDialog · MasterDataCrud · VerificationUnitDialog · UsersPage · TemplatesPage · LocationsPage · CpvPage
  RescheduleDialog · RateManagement Revise+History. The 4 hand-rolled per-overlay Escape `useEffect`s were REPLACED by
  the hook (no dup listener; net `DataGrid.tsx` −more-than-added). +2 Playwright focus tests.
  - **(a) ARIA correctness — VERIFIED 1:1, no mismatch, no realistic duplicate-id.** Grepped all 9 `aria-labelledby` refs
    against their `id=` targets: each labelledby resolves to EXACTLY ONE element id in the SAME file/dialog rendering the
    title text — `conflict-dialog-title` (ConflictDialog.tsx:38→41), `masterdata-dialog-title` (MasterDataCrud.tsx:233→236),
    `cpv-reschedule-title` (CpvPage.tsx:39→42), `location-dialog-title` (LocationsPage.tsx:297→300), `rate-revise-title`
    (RateManagementPage.tsx:576→579), `rate-history-title` (:648→651), `template-dialog-title` (TemplatesPage.tsx:231→234),
    `user-dialog-title` (UsersPage.tsx:240→243), `vu-dialog-title` (VerificationUnitDialog.tsx:111→114). Every modal now
    carries `role="dialog"` + `aria-modal="true"` + a working `aria-labelledby`. **Duplicate-static-id risk assessed:** the
    titles are static strings, so two instances of the SAME dialog in the DOM at once WOULD collide — but each is a singleton
    render gated by a single `…|null` state (e.g. `reviseRate`/`historyRate`), and every keyed-entity dialog is
    new-OR-edit (never both). The only co-mount is a dialog + its nested ConflictDialog on a 409 (e.g. RateManagement Revise
    + ConflictDialog) — but those use DISTINCT ids (`rate-revise-title` vs `conflict-dialog-title`), so no collision. Revise +
    History both being non-null simultaneously is possible (independent state, neither handler clears the other) but they too
    use distinct ids → still no duplicate-id. **No mismatch, no realistic duplicate-id.** PASS.
  - **(b) Keyboard operability / no-keyboard-trap (WCAG 2.1.2) — ConflictDialog Escape no-op is ACCEPTABLE.** ConflictDialog
    passes `onEscape = () => undefined` (ConflictDialog.tsx:30) — Escape does nothing, by design (it is a must-decide
    Reload/Discard dialog with no non-destructive dismiss). This is NOT a 2.1.2 keyboard-trap violation: Tab cycles to BOTH
    explicit choice buttons inside the trap, so a keyboard user can always operate and exit via a real decision; 2.1.2's
    requirement is that focus can move away by standard means (here: activating a button), not that Escape must close. The
    inline comment states this exception correctly. The other 7 dialogs + 3 menus pass `onEscape=onClose`/`setOpen(false)` →
    Escape dismisses. Consistent.
  - **(c) Focus visibility — STRONG, token-based, app-wide.** The platform defines a global `:focus-visible { outline: 2px
    solid hsl(var(--ring)); outline-offset:1px }` (`packages/ui-theme/src/tokens.css:238-242`, `--ring`=blue-600 light /
    blue light dark). So every keyboard-focused control inside a trapped menu/dialog — buttons (`.btn`/`.btn-ghost`, which
    add NO custom focus style), native checkboxes, the date `<input>` — shows the token focus ring. `.input`'s `outline-none`
    (index.css:9) is overridden for keyboard users by `:focus-visible` (and it also sets `focus:border-ring`), so inputs
    show a visible token indicator too. Grep confirms `outline-none` exists ONLY on `.input` — there is NO global `*{outline:
    none}` reset suppressing the ring anywhere. The hook moves focus to the first focusable on open, so the ring lands on a
    real, visible control. PASS.
  - **(d) Consistency — UNIFORM across all 11 surfaces.** Every dialog got the identical treatment: same `role="dialog"` +
    `aria-modal="true"` + `aria-labelledby="<id>"` triad with the title `<h2>`/`<h3>` carrying the matching `id`, same
    `bg-foreground/40` overlay (unchanged), same `useFocusTrap(true, onClose)` call shape. The 3 menus got
    `useFocusTrap(open|menuOpen, ()=>setOpen(false))` and the ref attached to the existing `role="menu"` panel. No divergent
    dialog. **CpvPage role moved CORRECTLY:** the `role`/`aria-modal`/(old)`aria-label` were RELOCATED from the outer
    `fixed inset-0` overlay onto the inner panel `<div>` (now with the ref + `aria-labelledby`), and the overlay reverted to a
    plain positioning wrapper (CpvPage.tsx:36-42) — this is the correct shape (the dialog role belongs on the panel that holds
    the focus trap + label, not the backdrop) and now matches every other dialog. The CpvPage `aria-label={title}` →
    `aria-labelledby="cpv-reschedule-title"` swap is an equivalent-or-better accessible-name source (points at rendered text).
  - **(e) Token compliance — clean.** Diff adds NO color classes; all overlays remain the semantic `bg-foreground/40` (no
    `bg-black/40` introduced — the carried CPV nit is unrelated and on a different overlay). The hook is pure logic (no
    markup/className). grep `^+` for hex/rgb/`bg-[`/`text-[`/`bg-black`: 0 hits. WCAG AA inherited (E-5).
  - **(f) Hook robustness notes (non-blocking, for the record).** (i) `focusables()` filters by `offsetParent !== null` to
    skip hidden controls — sound; falls back to `el === document.activeElement` so the currently-focused element is never
    dropped mid-Tab. (ii) Container-scoped `keydown` (not document-level) + `e.stopPropagation()` on Escape means a nested
    overlay closes only its innermost layer — correct for the dialog+ConflictDialog stack. (iii) Effect deps are `[active]`
    only, with `onEscape` read through a ref — changing the handler each render won't re-grab focus. (iv) Two simultaneously-
    active traps (Revise+History, or dialog+ConflictDialog) each bind their own container listener; the topmost-clicked one
    handles Escape via its own panel — acceptable, no global fight. All sound.
  - **(g) axe coverage gap — RECOMMENDATION ONLY.** `a11y.spec.ts` runs AxeBuilder on each page in its CLOSED state
    (`goto` → assert the menu button → `analyze()`, a11y.spec.ts:42-47); it never opens a menu or dialog, so axe does NOT
    exercise the new `role=dialog`/`aria-modal`/`aria-labelledby` open-state markup. The 2 new Playwright focus tests
    (datagrid.spec.ts: Columns-menu focus-in→Escape→return-focus, and `+ New` dialog focus-in→Escape→return-focus, the latter
    asserting `getByRole('dialog',{name:'New Client'})` which DOES prove the labelledby resolves to the accessible name)
    cover focus behavior + accessible-name on the canonical menu+dialog, but only on clients. RECOMMEND (non-blocking): add
    one axe scan of an OPEN dialog (e.g. open `+ New` then `analyze()`) to guard the open-state ARIA against future
    regressions — tracked as an OPEN item, not a gate failure.
  - **CARVED-OUT Layout mobile nav drawer — DEFENSIBLE but a REAL gap; tracked OPEN (severity MEDIUM).** The change
    deliberately excludes the `Layout.tsx` sidebar (below-`lg` it is a `fixed` overlay drawer; the same component is an
    in-flow push-sidebar at `lg+`). Excluding it is reasonable for THIS slice: the dual-mode component would need the trap
    active ONLY in the mobile-overlay branch (trapping the desktop in-flow nav would be a worse bug), and it is not in the
    diff (confirmed `git diff --name-only` — Layout untouched). BUT on mobile the open drawer is an overlay with no focus
    trap, no `aria-modal`, and (verified) only an `aria-expanded` toggle button + `onClick`, no Escape-to-close — so a
    mobile keyboard/AT user can Tab out of the open drawer onto the obscured page behind it. That is a genuine WCAG gap, not
    a non-issue. Severity MEDIUM (mobile keyboard/AT is a smaller cohort than the now-fixed admin dialogs, and the drawer is
    nav not data-entry). Tracked as a NEW OPEN item — the hook already exists, so the fix is "use `useFocusTrap(open &&
    isMobile, close)` on the drawer panel + add Escape + `aria-modal` in the overlay branch only."
  - **DISPOSITION:** the carried **focus-trap / return-focus / Escape-close keyboard-nav OPEN item (carried since
    2026-06-06 Slice 2, subsuming the Columns/Export/§7-filter menus + all 6 keyed admin dialogs + ConflictDialog +
    CPV/Rate dialogs) is RESOLVED** for the in-scope surfaces (3 menus + 8 dialogs). It is now a wired, tested pattern via
    `useFocusTrap`, not a deferred shortfall.
  - OPEN (carried/new): **(NEW) Layout mobile nav-drawer focus-trap/Escape/aria-modal — MEDIUM, the one remaining keyboard
    surface;** (NEW, LOW) axe-scan-an-open-dialog to guard open-state ARIA; (carried, unchanged) saved-views store
    (§10/§12); bulk actions; the CPV `bg-black/40`→`bg-foreground/40` nit (separate, NOT here). The DataGrid §2 keyboard-nav
    line for menus/dialogs is now CLOSED; only the Layout drawer remains. **Cleared to commit — ARIA correct (9/9 labelledby
    resolve, no realistic dup-id), focus visibility token-based and app-wide (`:focus-visible` global ring), pattern uniform
    across all 11 surfaces, tokens clean, ConflictDialog Escape-no-op WCAG-2.1.2-defensible.**

- **2026-06-09 · B-8/B-9 — Hexagon Loader + §6/§7/§8 loading time-bands wired into the Universal DataGrid (working tree,
  pre-commit). VERDICT: PASS (clear to commit). This RESOLVES B-9 (Hexagon, DEFERRED) and ADVANCES B-8 (was 🟡 skeleton-
  only) to the full §6 band ladder.** New `components/ui/HexagonLoader.tsx` (determinate fill-% / indeterminate marching-
  dash) + `lib/useLoadingBand.ts` (none→skeleton→loader→loader-op timers) wired into `DataGrid.tsx` (covers all 8 lists in
  ONE place) + `index.css` `.hex-march` keyframe with a `prefers-reduced-motion` guard + 1 Playwright test. I audited
  adversarially against §6/§7/§8/§9 fidelity, a11y, tokens, consistency, responsive.
  - **(a) §7 loader design — GENUINELY a hexagon, not a forbidden style. PASS.** `HexagonLoader.tsx:13` is a real 6-vertex
    `<polygon>` (`HEX_POINTS`), rendered twice: a `stroke-border` track + a `stroke-primary` value/march overlay
    (`:37-47`). It is NOT a spinning circle (no `<circle>`, no `rotate`), NOT a progress bar (no filling rectangle), NOT
    bouncing dots. The indeterminate animation marches a `25 75` dash segment around the hexagon OUTLINE via
    `stroke-dashoffset` (`index.css` `acs-hex-march` 0→-100) — the geometry traced is the hexagon's own perimeter, so the
    motion stays *within* the geometric-hexagon spirit of §7 (it animates the hexagon's stroke, it does not introduce a
    spinning ring). JUDGED COMPLIANT with §7's "geometric Hexagon, not circle/bar/dots". The determinate mode shows
    operation + `%` + optional sub-step exactly as the §7 example prescribes (`:49-56`).
  - **(b) §6 bands — thresholds correct. PASS.** `useLoadingBand.ts:14-16` sets 300/1000/3000 ms timers → `none` (0–300,
    render nothing, no flicker), `skeleton` (300–1s, §9 rows), `loader` (1–3s), `loader-op` (≥3s, loader + operation
    text) — matches §6's four rows 1:1. DataGrid maps them cleanly and **mutually-exclusively**: `showSkeleton =
    band==='skeleton'`, `showLoader = band==='loader'||'loader-op'` (`DataGrid.tsx:286-287`), and the operation label is
    passed ONLY in `loader-op` (`:542`, `band==='loader-op' ? {operation} : {}`) — so the 1–3s band is loader-without-
    text and ≥3s adds the text, precisely per §6. Timers cleared on unmount/`active` change (`:29-33`) → no leak, resets
    to `none` when inactive. Gated on `isLoading` (first load only) — refetches keep prior rows + the existing
    "Updating…" hint, correct (a band loader on every keystroke-refetch would be worse UX).
  - **(c) §8 indeterminate-% reconciliation — the CTO's call is CORRECT; I concur. PASS.** §6's literal text says the
    1–3s band is "loader + percentage," but §8 says "Percentages MUST reflect ACTUAL work stages — never an animated
    guess," and gives stage maps ONLY for multi-stage jobs (report/MIS/case-creation). A single list `fetchPage` is ONE
    network round-trip with NO knowable intermediate stages — any number rendered would be a fabricated guess, the exact
    thing §8 forbids. **§8 is the controlling, more-specific rule here; §6's "+ percentage" is written for the staged-job
    case.** Rendering the loader indeterminate (operation text, no number) is the faithful reconciliation — it satisfies
    §6's "animated loader + operation" while not violating §8's no-fake-% mandate. The component still SUPPORTS a real
    `percent` for the genuine staged jobs (export/report/case-creation) when those land, so the standard's determinate
    path is preserved, not abandoned. **This is the right call.**
  - **(d) a11y — correct, with one recommendation. PASS.** `role="status"` + `aria-live="polite"` + `aria-label`
    (`HexagonLoader.tsx:30-32`) is the correct SR pattern for a loading announcement (polite, non-interruptive; status is
    the right live-region role). `aria-label` falls back to `'Loading'` when no operation — so the 1–3s band (no
    operation prop) still announces "Loading", and the ≥3s band announces "Loading <Resource>". The `<svg>` is
    `aria-hidden="true"` (`:36`) so the decorative geometry isn't double-read. `prefers-reduced-motion: reduce` sets
    `animation: none` (`index.css`) → reduced-motion users get a STATIC hexagon (the `25 75` dash is still painted, just
    frozen) + the role=status text still announces — **sufficient** (the loading state remains perceivable without
    motion; no information is conveyed by motion alone). axe gate 29 only scans CLOSED/loaded pages so it will never see
    the loader — the new Playwright test (`datagrid.spec.ts:198-210`) routes a 1.8s delay, asserts the `role=status`
    name=/loading/i loader is visible then hidden once rows arrive → adequate FUNCTIONAL + accessible-name coverage for
    the open state. **RECOMMENDATION (non-blocking, LOW):** add one axe scan of the loading state (e.g. `route` a delay,
    `goto`, `analyze()` while the loader is up) to guard the open-state a11y against regression — same shape as the
    open-dialog-axe recommendation carried from the 2026-06-09 focus-trap slice. Tracked OPEN, not a gate failure.
  - **(e) Tokens — clean, zero hardcoded color. PASS.** grep of both new files + the `index.css` block for
    `#hex`/`rgb`/`hsl`/`bg-[`/`text-[`/`stroke-[`/`bg-black`/`bg-white`: **0 hits.** Stroke uses `stroke-border` (track)
    + `stroke-primary` (value) — semantic `@crm2/ui-theme` tokens; text uses `text-foreground` (operation, %) +
    `text-muted-foreground` (sub-step); skeleton stays `bg-muted`. WCAG AA inherited from frozen tokens (E-5). The
    keyframe animates only `stroke-dashoffset` (geometry), never color.
  - **(f) Consistency / rollout — built ONCE, no per-page divergence. PASS.** The loader/band logic lives entirely in
    `DataGrid.tsx`; NO page file is in the diff → all 8 migrated lists (Users·VU·Templates·Locations·Cases·Rates·clients·
    products) inherit the identical band ladder for free — same zero-divergence discipline as the Columns/Export/filter
    slices. §9 skeleton is PRESERVED in the 300ms–1s band (`:528-537`, unchanged `animate-pulse bg-muted` rows). The
    empty/error/rows gates were correctly switched `!showSkeleton`→`!isLoading` (`:547,558,566`) — **this prevents a
    double-render** (under the old `!showSkeleton`, the `loader` band — which is not `skeleton` — would have rendered the
    "No records" empty row SIMULTANEOUSLY with the loader; `!isLoading` suppresses empty/error/rows for the whole
    first-load window). Correct fix, verified. Operation text is title-cased from the hyphenated `queryKey`
    (`verification-units`→"Verification Units", `report-templates`→"Report Templates") via
    `replace(/-/g,' ').replace(/\b\w/g,upper)` (`:288`) — clean for every hyphenated resource; pages can override via
    `loadingLabel`. Consistent.
  - **(g) Responsive — OK. PASS.** The loader renders in a single `<tr><td colSpan={visibleColumns.length}>` (`:540-543`)
    inside the `.rtable`. On mobile the existing `index.css` child-combinator card CSS flattens `td` to a full-width
    block, and a `colSpan` cell with no `data-label` renders as a centered full-width block (the `HexagonLoader` root is
    `flex flex-col items-center justify-center py-8`) → renders acceptably as a full-width centered loader card at 320px.
    No horizontal overflow (no fixed width; `h-12 w-12` svg = 48px ≪ 320). Same colspan-row posture the skeleton/empty/
    error rows already use.
  - **DISPOSITION:** **B-9 (Hexagon Loader) = DONE** — a genuine geometric hexagon, §7-compliant, the ONE platform
    loader, with both determinate (real-%) and indeterminate modes. **B-8 (loading bands) = ADVANCED from 🟡 skeleton-
    only to the FULL §6 ladder** (none→skeleton→loader→loader-op) on the shared grid. Both SATISFIED for the list-fetch
    surface. Residual: the determinate-% staged-job loaders (export/report/case-creation, §8 stage maps) are not yet
    wired — that's a later phase (those jobs don't exist on the grid path yet), NOT a defect of this slice; the component
    already supports it.
  - **Verification:** verdict is code-read-based (NON-coding auditor); +1 Playwright loader test present and shaped
    correctly (route-delay → loader visible → hidden on data). Recommend the CTO confirm `pnpm verify` + the full
    Playwright run green before commit.
  - OPEN (carried/new): **(NEW, LOW) axe-scan-the-loading-state** to guard open-state loader a11y (folds with the
    carried open-dialog-axe rec); (carried) Layout mobile nav-drawer focus-trap (MEDIUM); saved-views store (§10/§12);
    bulk actions; the CPV `bg-black/40`→`bg-foreground/40` nit (separate, NOT here); the determinate-% staged-job loaders
    (export/report/case-creation §8 maps) when those jobs land. **Cleared to commit — genuine hexagon (§7), correct §6
    bands, §8 no-fake-% reconciliation sound, a11y role=status + reduced-motion guard sufficient, tokens clean, built
    once with no per-page divergence, §9 skeleton preserved.**

- **2026-06-09 · DATAGRID_STANDARD §15 — row selection + bulk-action bar on the Universal DataGrid
  (`DataGrid.tsx` +~140; `MasterDataCrud.tsx` +1 `selectable` flag → clients/products reference; working tree, pre-commit).
  VERDICT: PASS (clear to commit) — with ONE non-blocking a11y SHOULD-FIX recorded below.** Realizes the
  "row selection / bulk actions" OPEN item carried since Slice 3. New: a leading checkbox column (header
  "Select all rows on this page" + per-row "Select row"), a "Select all N matching" banner, and a bulk bar
  (`role="region"` aria-label="Bulk actions", `aria-live` count) with built-in Export XLSX/CSV + Clear, plus a
  page `bulkActions?:(BulkSelection)=>ReactNode` slot. Surgical — only `DataGrid.tsx` + a one-word `selectable`
  on the shared CRUD; all 7 lists inherit it when they opt in (clients/products do now). Built once, no per-page divergence.
  - **(a) Tokens — clean. PASS.** grep of all added `+` lines (DataGrid.tsx + MasterDataCrud.tsx) for
    hex/rgb/hsl/`bg-[`/`text-[`/`border-[`/raw-palette = **0 hits**. The bar uses `border-border bg-surface-muted`
    (`--surface-muted` is a real frozen token, `ui-theme/tokens.css:21,110`; light+dark both defined), `text-foreground`,
    `text-primary`; every button is `btn-ghost text-xs` (real class, `index.css:14`). Export-disabled state reuses the
    existing `disabled` styling. WCAG AA inherited from frozen tokens (E-5). The header select-all `<th>` sits in the
    `bg-surface-muted` sticky thead (`DataGrid.tsx:556`) — consistent.
  - **(b) Real buttons + region semantics — PASS.** Clear, Export XLSX, CSV, and the "Select all N matching" affordance
    are all real `<button type="button">` (not divs/links) → keyboard-focusable + Enter/Space-activatable for free. The
    bar is a labelled `role="region" aria-label="Bulk actions"` landmark; the live count `<span aria-live="polite">{n}
    selected</span>` announces selection changes. The "Select all N matching" banner appears only when the whole page is
    ticked AND `totalCount > pageIds.length` (`:561`) — correct at-scale affordance (§15 / §11 mode-2 "Export Selected"
    + mode-3 "Export All Matching"). `allMatching` never holds every id client-side — bulk actions read `query` instead
    (`BulkSelection.query = queryInput`, `:352`) — the only safe >1-page model. Selection clears on search/sort/filter
    change (`useEffect` deps `[search,sortBy,sortOrder,filtersKey]`, `:319-320`) and accumulates across pages — sound, doc'd.
  - **(c) Checkbox a11y — wired; ONE SHOULD-FIX (MODERATE, non-blocking, axe-green).** Header checkbox has
    `aria-label="Select all rows on this page"` and its `indeterminate` is set imperatively via the `ref` callback
    (`:566-569`) — `!allMatching && !allPageSelected && somePageSelected` → the genuine tri-state, correct (React has no
    `indeterminate` prop, the ref-callback is the blessed pattern). Each row checkbox has `aria-label="Select row"`
    (`:722`). **SHOULD-FIX:** "Select row" is GENERIC — identical across every row, so a screen-reader user navigating by
    control announces N indistinguishable "Select row" checkboxes with no row identity. axe ALLOWS duplicate labels on
    checkboxes (distinct interactive controls, not landmarks/headings) → **the axe gate 29 stays green** (no serious/
    critical). But best practice is to name the row, e.g. `aria-label={`Select ${rowLabel(row.original)}`}` via an optional
    `selectRowLabel?:(row:T)=>string` prop (default to "Select row"). MODERATE because it's a real AT-usability shortfall,
    not a violation; non-blocking. Recorded for the CTO; do NOT block the commit on it.
  - **(d) Focus / keyboard — PASS, one non-blocking nicety.** The per-row checkbox `<td onClick={(e)=>e.stopPropagation()}>`
    (`:719`) stops only the MOUSE click from bubbling to `onRowClick` (so ticking a box on a clickable-row grid like Cases
    won't navigate) — it does **NOT** trap keyboard: the checkbox `onChange` fires on Space regardless, and Tab order is
    unaffected (stopPropagation on `click` ≠ blocking keydown). Verified by code-read. NICETY (non-blocking): when the bar
    mounts/unmounts, focus is not moved into/out of it — focus stays on the just-toggled checkbox (acceptable; the
    `aria-live` count covers the announcement). No focus-loss bug. Folds into the standing §2 keyboard-nav OPEN.
  - **(e) Responsive (320px) — PASS. Skeptically checked the checkbox `<td>` in the `.rtable` card.** The leading checkbox
    cell emits `data-label=""` on BOTH the row (`:719`) and skeleton (`:672`) cells. `index.css:80-86` explicitly handles
    `td[data-label='']`: it falls back to `block` (full-width, not the `flex justify-between` label/value row) AND
    suppresses the `::before` pseudo-label (`content:''`) → on mobile the checkbox renders as a clean left-aligned
    full-width block at the TOP of each stacked card with NO shouted label prefix. Correct and acceptable at 320px, no
    overflow. The header select-all is inside `thead` which is `sr-only` on mobile (`:62`) — so select-all-on-page is SR-only
    on phones; per-row checkboxes remain operable. The bulk bar itself is `flex flex-wrap items-center gap-x-4 gap-y-2`
    (`:557`) with an `ml-auto` action cluster that also wraps — at 320px the count + banner + 3 buttons wrap to multiple
    rows, no horizontal overflow. PASS.
  - **(f) colCount fidelity — PASS.** The selectable column is `+1` in `colCount = visibleColumns.length + (selectable?1:0)`
    (`:357`); the loader/error/empty `colSpan` rows were all switched `visibleColumns.length`→`colCount` (`:683,691,702`)
    AND the §6 filter row + skeleton row each prepend a matching `<th>`/`<td>` when `selectable` (`:645,672`) → the checkbox
    column never desyncs the header/body/colspan grid. Verified 1:1.
  - **(g) Consistency / §15 + UX — PASS.** Matches the standard's "Row selection + Bulk actions bar when rows are selected"
    (§15 line 134) and the §11 three export modes (current/selected/all-matching). The select-all-matching affordance is
    PRESENT (the §11 at-scale requirement). Built once on the shared grid; opt-in via `selectable` so the 6 non-selecting
    grids are byte-unchanged (no checkbox column, no behavior shift). On the bar's Export-vs-toolbar-Export question:
    NOT confusing — the toolbar Export menu = current-view/all-matching; the BAR's Export = the SELECTION (mode `selected`
    for an explicit tick set, `all` when "select all N matching" is chosen, `:354-355`). Two clearly-scoped surfaces; the
    bar only exists while a selection is active. `ExportMode='current'|'all'|'selected'` confirmed in the SDK
    (`packages/sdk/src/export.ts:21`) so `mode:'selected'` + `ids` is a real contract (server-side `ids` wiring is an
    API/Perf concern, not mine).
  - **Verification:** verdict is code-read-based (NON-coding auditor). The diff carries NO new Playwright spec for selection/
    bulk-export/select-all-matching/indeterminate — recommend the CTO add one (toggle row → bar appears + "1 selected";
    page-select → "Select all N matching" → count=totalCount; Clear → bar gone; Export Selected hits `mode=selected&ids=…`)
    and confirm `pnpm verify` + the axe gate 29 green (the checkbox column is now always present on clients/products → axe
    will scan it; duplicate "Select row" labels are axe-allowed, gate should stay green — confirm).
  - OPEN (carried/new): **(NEW, MODERATE-non-blocking) per-row checkbox `aria-label` should name the row** (item c — add a
    `selectRowLabel?:(row:T)=>string` prop); (NEW, LOW) add the §15 selection Playwright test + re-run axe gate 29 with the
    checkbox column present; (carried) keyboard-nav/focus-trap §2 (now also subsumes bar focus-management nicety); saved-views
    store (§10/§12); the CPV `bg-black/40`→`bg-foreground/40` nit (separate). **Cleared to commit — §15 satisfied: row
    selection + bulk bar built once, select-all-matching present, tokens clean, real buttons, region+aria-live wired,
    indeterminate correct, mobile checkbox-card handled, no per-page divergence. The only fix worth queuing is the generic
    "Select row" label (moderate AT usability, axe-green so non-blocking).**

- **2026-06-09 · §15 sub-slice 2 — bulk Activate/Deactivate as a page bulkActions slot — new `BulkStatusActions.tsx`
  + `DataGrid.tsx` BulkSelection<T> rows-capture + `MasterDataCrud.tsx` wiring (working tree, pre-commit).
  VERDICT: PASS (clear to commit).** Sub-slice 1 built the bar + its `bulkActions` slot; this fills it on
  clients/products with Activate/Deactivate buttons doing per-row OCC.
  - **(a) Tokens only — clean.** grep of `BulkStatusActions.tsx` for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`/`bg-black`/
    `bg-white`: **0 hits**. Buttons `btn-ghost text-xs` (real `.btn-ghost` class, `index.css:14`); message
    `text-xs text-muted-foreground`; the allMatching hint same. The host bar is `bg-surface-muted` (real token,
    `tokens.css:21`/`tailwind-preset.js:19`) — unchanged from sub-slice 1. WCAG AA inherited from frozen tokens (E-5).
  - **(b) a11y of the result message — ADEQUATE, with one nit.** The per-row result is a `<span role="status">`
    (`BulkStatusActions.tsx:82`) → an implicit `aria-live="polite"` region, announced on update; it's rendered
    conditionally (mounts when `message` set) and lives INSIDE the bar's `role="region" aria-label="Bulk actions"`
    (`DataGrid.tsx:567-568`) — landmark-nested live region is fine, no axe serious/critical. Copy is clear and
    plain-language: `"N updated · M changed by someone else · K not found"` (`:43-45`) — note it deliberately renders
    "changed by someone else" / "not found" rather than raw CONFLICT/NOT_FOUND enums (good, matches the friendly-copy
    bar set by the CODE_LOCKED/OCC dialogs). Buttons are real `<button type="button">` with busy text
    ("Activating…"/"Deactivating…", `:71,79`) and `disabled` while `busy!==null` (`:62,68,76`) → no double-submit, busy
    state conveyed in the accessible name (text change), not color-only. **NIT (LOW, non-blocking):** because the
    `<span role=status>` mounts only when `message` becomes non-null, a screen reader relies on the live region
    EXISTING before the text appears to reliably announce; React mounts node+text in the same commit, so most AT will
    still catch it, but an always-present empty `role=status` is the more robust pattern. Same lightweight bar; axe
    gate 29 stays green (status region with text is not a violation). Folds into general bar-polish, do NOT block.
  - **(c) Partial-failure UX — JUDGED CORRECT, with the asked-about nicety FLAGGED.** Clean run (`!conflictCount &&
    !notFoundCount`) → `selection.clear()` closes the bar (`:49`); partial → selection STAYS so message + the
    conflicting rows remain on screen (`:47-49`). This is the right default: clearing on partial would hide WHICH rows
    failed and discard the message. **HOWEVER the asked-about gap is real and I'm flagging it:** the kept selection
    still holds the STALE row objects (the `version` captured at tick time), and the grid invalidates+refetches
    (`:42`) so the rows now carry fresh versions in the table — but `selection.rows` is NOT refreshed from the refetch
    (DataGrid's `selectedRows` Map only updates on user toggle, `DataGrid.tsx:341-356`; the effect that rebuilds it
    keys off search/sort/filters, not data refetch, `:323-326`). So an immediate **retry re-sends the same stale
    versions → re-CONFLICTs** until the user un-ticks and re-ticks the row. This is a genuine UX dead-end on the
    conflict path. **SHOULD-FIX (non-blocking, NOT my domain to code):** after a partial result, either (i) prune the
    OK'd ids out of the selection so only the still-failing rows remain AND have the bulk action re-read versions from
    the freshly-refetched page, or (ii) surface an explicit "re-tick the conflicting rows to retry" instruction in the
    message. Today the message says "M changed by someone else" but gives no recovery affordance — discoverable that
    something failed, NOT discoverable how to fix it. Flagged to CEO + Principal ledgers as a UX/state-coherence item.
  - **(d) allMatching hint — ACCEPTABLE + correctly reasoned.** When `allMatching`, `BulkStatusActions` returns
    `"Tick individual rows to activate / deactivate."` instead of buttons (`:57-60`). Sound: the off-page rows have no
    loaded `version`, so a per-row-OCC mutation literally cannot target them (the component doc + DataGrid `rows: T[]`
    doc both state this, `DataGrid.tsx:63-67`). The bar STILL offers Export for allMatching (Export uses the `query`,
    not per-row versions, so it scales — `DataGrid.tsx:367-368`) → the two affordances correctly diverge on what
    "select all matching" can safely do. **NIT (LOW):** the hint is a quiet `text-muted-foreground` span sitting where
    buttons were — a user who clicked "Select all N matching" then looks for Activate may briefly read it as "nothing
    here" rather than "switch back to ticking rows". Copy is honest and accurate; consider phrasing it as the reason
    ("Per-row activate needs individual rows — Export works on all N") on a later touch. Non-blocking; accept as-is.
  - **(e) Bar composition / responsive — clean, no overflow.** Order reads left→right: `"{N} selected"` (aria-live) ·
    optional "Select all {total} matching" · then an `ml-auto` cluster of `{bulkActions}` (Activate · Deactivate ·
    message) · Export XLSX/CSV (if `exportFn`) · Clear (`DataGrid.tsx:571-607`). The bar is `flex flex-wrap
    items-center gap-x-4 gap-y-2` (`:569`) and the action cluster is itself `flex flex-wrap` (`:583`) → at 320px the
    buttons + message wrap to new lines, no horizontal overflow. The message is the only variable-width member; on a
    partial result it can be long ("N updated · M changed by someone else · K not found") but it wraps with the rest.
    Composition reads cleanly and matches §15 (count + select-all-matching + bulkActions + Export + Clear).
  - **(f) Cross-screen consistency.** `BulkStatusActions` is generic over `T extends {id,version}` and wired into the
    SHARED `MasterDataCrud` (`MasterDataCrud.tsx:135-137`) → clients AND products get identical bulk-status UX in one
    change; inherently consistent. Buttons reuse the same `btn-ghost text-xs` language as the bar's own Export/Clear
    and the toolbar controls → visually homogeneous within the bar. No bespoke styling, no per-page divergence.
  - **Verification:** verdict is code-read-based (NON-coding). API tests added (`clients.api.test.ts:491-560`: all-OK /
    mixed OK+CONFLICT+NOT_FOUND / empty→400 / 403+401) cover the server contract the FE renders, but there is **no new
    Playwright/FE test** exercising the button → message render, the clean-run bar-close, or the partial-keep path —
    recommend the CTO add one (tick rows → Activate → "N updated" + bar closes; force a stale row → "M changed by
    someone else" + bar stays) and re-run axe gate 29 (the conditional `role=status` span + two buttons inside the
    region — expect green).
  - OPEN (carried/new): **(NEW, MODERATE-non-blocking) partial-conflict retry dead-end (item c)** — kept selection
    re-sends stale versions, no recovery affordance; prune OK'd ids + re-read versions, or instruct re-tick.
    **(NEW, LOW) always-mount the `role=status` region** (item b) and consider a reason-giving allMatching hint
    (item d). (carried) per-row checkbox `aria-label` should name the row; §15 selection Playwright test; keyboard-nav/
    focus-trap §2; saved-views store (§10/§12); CPV `bg-black/40`→`bg-foreground/40`. **Cleared to commit — §15 slot
    correctly filled: tokens clean, real busy/disabled buttons, friendly per-row result in a `role=status` live region,
    allMatching correctly degrades to a hint, bar wraps at 320px, shared across clients/products. The one item worth
    queuing is the partial-conflict retry dead-end (MODERATE UX, non-blocking — axe-green, no standard violated).**

- **2026-06-10 · C-3 Slice 1 — DataGrid `renderExpanded` master-detail prop (§20) (`DataGrid.tsx` + `DATAGRID_STANDARD.md`
  §20; working tree, pre-commit; no page consumes it yet). VERDICT: PASS (clear to commit).** Additive/opt-in prop adds a
  leading chevron-expander column + an inline accordion detail `<tr>` (one open at a time, ephemeral, resets on matched-set/
  page change). Checked tokens, a11y of the new control, responsive `.rtable` card behavior, and consistency with the
  `selectable` leading column + the MANAGEMENT_LIST_STANDARD accordion rule.
  - **(a) Tokens — clean, all valid semantic tokens, zero raw color.** The expander button uses `text-muted-foreground
    hover:text-foreground` (`:759`); the expanded parent row adds `bg-accent` (`:746`); the detail row uses `bg-surface-
    muted/40` + `border-border` (`:792`). All four resolve in `@crm2/ui-theme/tailwind-preset.js`: `accent` = `fg('--accent')`
    (preset `:39`, defined both themes `tokens.css` `:42,130`), `surface.muted` → `bg-surface-muted` (preset `:19`,
    `tokens.css` `:21,110`), `border` (preset `:22`), `muted-foreground`/`foreground` (base). The `/40` is a standard
    Tailwind opacity modifier on a real token (same idiom flagged elsewhere for `bg-black/40` — here it's token-based, OK).
    No hex, no `bg-black`. PASS.
  - **(b) a11y of the expander — sufficient and correct.** The control is a REAL `<button type="button">` (`:757`) → natively
    keyboard-reachable + Enter/Space-operable; carries a dynamic `aria-label` ("Expand row"/"Collapse row", `:760`) AND
    `aria-expanded={expanded}` (`:761`) — both state cues, not glyph-only. The `▸`/`▾` glyph is decorative text inside the
    labelled button (acceptable). The cell wrapping it `stopPropagation`s (`:756`) so the chevron toggle doesn't double-fire
    the row-body handler. **The row-BODY click** (`<tr onClick={toggleExpand}>` when `renderExpanded` set without `onRowClick`,
    `:747-753`) is on a non-focusable `<tr>` — NOT keyboard-operable — but this is acceptable and NOT a new regression: the
    chevron button is the keyboard-accessible path to the identical toggle (row-body click is a redundant mouse affordance),
    and this exactly mirrors the existing `onRowClick` `<tr>`-click pattern PASS'd in Slice 3 (2026-06-06). axe gate 29 stays
    green (labelled button, no role on the `<tr>`). PASS.
  - **(c) Responsive `.rtable` card view — degrades acceptably, one MINOR visual note (OPEN).** At ≤767px the `.rtable` CSS
    (`index.css` `:60-88`) blocks every `<td>` and prints `data-label` via `::before`. The expander cell is
    `<td data-label="">` (`:756`) → the `td[data-label='']` rule (`:81-87`) sets it `block` + suppresses the empty label, so
    the chevron renders as its own clean line at the top of each card — IDENTICAL treatment to the existing `selectable`
    checkbox `<td data-label="">` (`:769`). CONSISTENT, no stray empty label. The detail row's `<td colSpan={colCount}>`
    (`:793`) hits the `td[colspan]` rule (`:80-87`) → `block` + no label → renders full-width. **MINOR (OPEN, non-blocking):**
    because the `.rtable` mobile rule turns EVERY `<tr>` into its own card (`mb-3 rounded-lg border bg-card p-3`, `:70-72`),
    the detail — being a SEPARATE `<tr>` — renders as its own standalone card BELOW the parent card rather than visually
    nested within it, and the `bg-accent` / `bg-surface-muted/40` highlights are overridden by the per-card `bg-card`. The
    detail still appears immediately after its parent and is readable, so the accordion's intent survives on mobile; the
    "nested beneath" affordance is just weaker. Flagging for the CPV consumer slice — if the nesting reads as a stray card,
    a wrapper/visual-tie (e.g. negative top-margin or a left accent border on the detail card at the breakpoint) would
    restore it. Not a blocker; no standard violated.
  - **(d) Consistency with `selectable` + MANAGEMENT_LIST_STANDARD — matches both.** The expander `<th>`/`<td>` are threaded
    into ALL the same rows as `selectable` — header (`:633`), filter row (`:671`), skeleton (`:699`), body (`:755`) — and
    `colCount` correctly adds `+ (renderExpanded ? 1 : 0)` (`:380`) so the loader/error/empty `colSpan` rows still span the
    full width. The chevron column sits LEADING, before the checkbox (`:633` before `:634`), giving a stable expander│select│
    data column order. Implements DATAGRID_STANDARD §20 verbatim (chevron `▸`/`▾`, single-column inline accordion beneath the
    row, one-open-at-a-time, ephemeral, mutually-exclusive-with-`onRowClick`) and MANAGEMENT_LIST_STANDARD §"single-column
    accordion" (`:41-57`, chevron-indicated inline expand, no empty side pane). PASS.
  - **Verification:** code-read-based (NON-coding review). No page consumes `renderExpanded` yet (CPV migrates in a later
    slice), so there is no rendered surface to axe/Playwright today — the gate to add is the CPV-consumer slice (expand a
    row → detail renders; chevron keyboard-toggles via Enter/Space; re-run axe gate 29 with the detail open; verify the
    mobile-card nesting note in item c). Recommend the consumer slice ship that Playwright + axe pass.
  - OPEN (carried/new): **(NEW, MINOR) mobile-card detail renders as a standalone card, not nested** (item c) — revisit at
    CPV consumer slice. (carried) partial-conflict retry dead-end (MODERATE UX); always-mount `role=status`; per-row checkbox
    `aria-label` should name the row; CPV `bg-black/40`→`bg-foreground/40`; saved-views store (§10/§12). **Cleared to commit —
    §20 slot correctly filled: tokens clean (all semantic), real labelled+`aria-expanded` keyboard button, threaded into every
    grid row like `selectable`, `colCount` correct, matches §20 + MANAGEMENT_LIST accordion. Only the mobile-card nesting is
    worth queuing for the consumer slice (MINOR, axe-green, no standard violated).**
- **2026-06-10 — C-3 Slice 2 — CpvPage → DataGrid (`renderExpanded` consumer; the last bespoke admin list retired). VERDICT: PASS.**
    Playwright 23/0 incl. a CPV a11y scan + the new §20 expand→UnitManager→collapse test; `pnpm verify` EXIT=0.
  - **Column parity — matches the LocationsPage DataGrid pattern.** CpvPage columns = Client / Product / Units / Effective From /
    Created / Updated / Status / Actions — same shape and order family as the other 7 admin grids (bold code + muted sub-line in the
    identity cells, `tabular-nums` count chip for Units, muted `formatDateTime` for the 3 date columns, `StatusChip` for Status,
    right-aligned text-button Actions). The pre-migration table merged Client·Product into one column; splitting them into two sortable
    columns is the standard grid shape and an improvement, not a regression. Consistent across all 8 grids.
  - **Tokens only — clean.** Every added cell uses semantic tokens (`font-medium`, `text-muted-foreground`, `text-xs`, `bg-muted`,
    `text-primary`, `hover:text-foreground`, `hover:underline`); zero hex/rgb/arbitrary color in the diff. The expand chrome (chevron,
    `bg-accent` open-row, `bg-surface-muted/40` detail row) lives inside DataGrid (audited Slice 1), not CpvPage.
  - **Nested-table mobile card — CORRECT, the Slice-1 queued concern is RESOLVED.** The expansion detail renders `UnitManager`, whose
    inner table carries its OWN `.rtable` class (CpvPage:448). index.css's responsive-card rules use the CHILD combinator
    (`table.rtable > tbody > tr > td`, index.css:53-67) specifically so a nested table cards INDEPENDENTLY and the parent grid's column
    strategy does not bleed in. So on mobile the parent CPV row collapses to a stacked card AND the inner unit list collapses to its own
    stacked cards — the exact behavior the child-combinator design intended. The MINOR mobile-card-nesting item queued in Slice 1 is
    discharged: it works as designed, axe-green.
  - **a11y / UX copy.** Expander is the DataGrid's labelled `<button aria-expanded aria-label="Expand/Collapse row">` (Slice 1). Intro
    copy updated to the new gesture ("expand a row (▸)" replaces "click Manage units") — accurate. Actions buttons keep `text-primary`
    affordance + `hover:underline`; the stopPropagation wrapper is invisible (a bare `<div>`), no layout/token impact.
  - **SHOULD-FIX (none new, non-blocking carries):** the open-row `bg-accent` vs `hover:bg-row-hover` override (Slice-1 carry, DataGrid-
    owned) still applies to CPV's expanded row — cosmetic; chevron `▾` + `aria-expanded` convey state. Detail `<tr>` lacks
    `aria-controls`/`id` association to its trigger (acceptable for an inline accordion). CPV's reschedule/conflict dialogs still use
    `bg-foreground/40` (good — the earlier `bg-black/40` was already fixed). **Cleared to commit — last bespoke list retired onto the
    one grid component with full token/responsive/a11y parity; nested-card concern resolved; no standard violated.**

- **2026-06-10 · App-shell a11y — mobile nav-drawer focus-trap + Escape + restore-focus, and open-overlay axe coverage (`Layout.tsx`,
    `e2e/a11y.spec.ts`, NEW `e2e/layout.spec.ts`). VERDICT: PASS.** The whole reason the drawer was carved out of the Slice-8
    keyboard-nav epic was the desktop trap risk — verified the carve-out is honoured.
  - **Desktop keyboard users are NEVER trapped — the carve-out holds.** Below `lg` the `<aside>` is a `fixed inset-y-0` overlay drawer
    (z-40, shadow, `max-w-[80vw]`); at `lg+` it is `lg:static lg:z-auto` in-flow navigation. The trap arms only on `open && !wide`, and
    `wide` tracks `(min-width:1024px)` live, so at `lg+` keyboard users Tab straight through the sidebar into the page as before. A
    mobile→desktop resize while open deactivates the trap on the next render. This is exactly the desktop-safe behavior the carve-out
    demanded.
  - **Mobile-drawer a11y is now COMPLETE.** Focus-in (lands on the first real nav link, Cases — the inactive Operations items are
    `aria-disabled` non-links and are correctly skipped) + Tab cycle + Escape-to-close + restore-focus-to-hamburger + a backdrop button
    (`aria-label="Close menu"`) for pointer dismiss. axe now scans it OPEN (not just the closed shell), so contrast/name/role on the
    drawer surface is gated. WCAG 2.1.2 (no keyboard trap — escapable) and 2.4.3 (focus order) both satisfied.
  - **role=dialog / aria-modal — my call: NOT required here, do not add it.** This is a NAVIGATION drawer, not a modal task surface; its
    children are `role=link`. Slapping `role=dialog`+`aria-modal=true` on a `<nav>`/landmark region would mis-describe it to AT and bury
    the nav landmark. Focus-trap + Escape + restore + the backdrop is the correct, idiomatic disclosure pattern for a hamburger nav
    drawer (matching the existing menu consumers, which are `role=menu` not dialog). Scope held — no creep.
  - **Tokens unaffected.** No new color/spacing tokens; the drawer already uses `bg-card`/`border-border`/`shadow-lg` and the backdrop
    `bg-foreground/40` (the audited token, not raw black). Pure behavior + test additions. **Cleared to commit — app-shell drawer reaches
    full focus/Escape/restore/axe parity with the dialog & menu surfaces; the lone keyboard-nav carve-out is discharged.**

- **2026-06-15 · B-7 Background-Jobs tray + bell download + DataGrid job-export wiring — NEW `JobsTray.tsx`,
  `NotificationBell.tsx`/`Layout.tsx`/`DataGrid.tsx` diffs (working tree, uncommitted). VERDICT: PASS (clear to commit).**
  New header popover (beside the bell) listing the user's recent background jobs; a RUNNING job shows the determinate
  Hexagon (real %), a finished EXPORT offers a Download, a capped export warns, a failed job shows its error. Audited
  the new file + the 3 diffs against the FROZEN standards, comparing JobsTray to its sibling NotificationBell.
  - **(1) Tokens only — CLEAN, zero color literals.** Precise grep of `JobsTray.tsx` for `#hex`/`rgb`/`hsl`/`stroke-[#`/
    `fill-[#`/`(bg|text|border)-[#` = **0 hits**. The 4 grep hits on the broad pass were `text-[10px]`/`text-[11px]`
    (font-size arbitrary values, NOT colors) and `bg-primary`/`text-destructive` (semantic tokens). Every color is a
    frozen `@crm2/ui-theme` token: badge `bg-primary`/`text-primary-foreground` (:97), popover shell
    `border-border bg-popover text-popover-foreground shadow-lg` (:104 — byte-identical to the bell :97), trigger
    `text-secondary-foreground hover:bg-accent hover:text-accent-foreground` (:92 — identical to bell :85), capped/error
    `text-destructive` (:149,157), muted meta `text-muted-foreground`, download `text-primary` (:143). The inline
    `TrayIcon` SVG uses `stroke="currentColor"` (:26) — inherits the token, no literal, same as the bell's `BellIcon`.
    WCAG AA inherited from frozen tokens (E-5). NotificationBell/Layout/DataGrid diffs add NO className/color (bell diff =
    a download handler + one `if`; Layout = mount JobsTray + `useRealtimeJobs`; DataGrid = `job`-outcome branch + toast).
  - **(2) UPPERCASE-display — SATISFIED.** `JobType`=`'EXPORT'|'IMPORT'` and `JobStatus`=`'PENDING'|'RUNNING'|'SUCCEEDED'|
    'FAILED'` are already-uppercase string-literal enums (`packages/sdk/src/jobs.ts:9,12`), so `{j.type}` (:131) renders
    "EXPORT" and `{j.status}` (:132, ALSO carries an explicit `uppercase` class as a belt-and-suspenders guard) renders
    "RUNNING". The Hexagon `operation={\`${running.type} — ${running.progress}%\`}` (:113) shows "EXPORT — 42%". Button
    labels "Download"/"Background jobs"/"No background jobs" are sentence-case UI control text (allowed, matches the bell's
    "Mark all read"/"Notifications" precedent). MINOR ASYMMETRY (non-blocking, cosmetic): the type `<span>` (:131) has no
    `uppercase` class while the status `<span>` (:132) does — harmless because the enum is already uppercase, but for
    symmetry add `uppercase` to the type span on next touch (defensive against any future lowercased type value).
  - **(3) Hexagon is the ONLY loader — CONFIRMED.** JobsTray imports + renders `HexagonLoader` for the running job
    (:14,111) in DETERMINATE mode (`percent={running.progress}` — a REAL %, not fabricated, honoring §8), with the
    operation label + optional `subStep={running.stage}`. grep for `animate-spin`/`spinner`/`<progress`/`progress-bar`/
    `bounce`/`dots` in JobsTray = **NONE**. The list rows show plain `{j.progress}%` text (:136), not a bar — correct, no
    forbidden alternative loader introduced. DataGrid's job-export branch (:271-280) does NOT add a loader (the existing
    `Exporting…` button text + the §6 `HexagonLoader` at :731 are untouched). No non-Hexagon loader anywhere → no BLOCK.
  - **(4) a11y — mirrors the bell, no regression.** Trigger has `aria-label` (dynamic: `Background jobs, N running` vs
    `Background jobs`, :90 — same pattern as the bell's `Notifications, N unread`) + `aria-expanded={open}` (:91); icon
    `aria-hidden` (:30). Outside-click + Escape dismiss via an identical `useEffect` to the bell (:58-72 ≈ bell :60-74) —
    listeners bound only while open + cleaned up. The Hexagon carries `role="status" aria-live="polite"` (HexagonLoader:30-32)
    so the running-job progress is announced. KNOWN GAP (LOW, non-blocking, CONSISTENT with the bell): the popover has NO
    focus-trap / focus-return-to-trigger — but the sibling NotificationBell has the SAME baseline (only the mobile-nav
    drawer + export menu use `useFocusTrap`), so this is parity, not a regression. The axe gate 29 (serious+critical=0)
    surface is the header tray button + popover; both are named/role-correct → gate stays green. No a11y regression.
  - **(5) UX consistency w/ the bell — STRONG.** Same popover sizing/shell (`absolute right-0 z-50 mt-2 w-80
    max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg`
    — byte-identical to bell :97), same header band (`border-b border-border px-3 py-2` + `text-sm font-semibold` title),
    same row layout (`flex flex-col items-start gap-0.5 border-b border-border px-3 py-2`), same empty-state copy style,
    same `max-h-96 overflow-y-auto` scroll. Badge style matches the bell's (`absolute -right-0.5 -top-0.5 h-4 min-w-4
    rounded-full … text-[10px] font-bold`) — JobsTray uses `bg-primary` (running = neutral/in-progress) vs the bell's
    `bg-destructive` (unread = attention); the color difference is SEMANTICALLY CORRECT (jobs-running is not an alert) and
    both are frozen tokens. Cap glyph differs by design (tray `9+` MAX_BADGE=9 for a short job list vs bell `99+`) —
    reasonable. The download handler added to the bell (:119, on `actionType==='DOWNLOAD'`) reuses the SAME
    `fetchJobResultUrl` + `window.open(url,'_blank','noopener')` + `toast.error` fallback as the tray's `download` (:77-84)
    → consistent download UX across both surfaces. TWO-POPOVER NOTE (minor, as requested): bell + tray hold INDEPENDENT
    `open` state, so both CAN be open at once (opening one does not close the other). They sit side-by-side in the header
    `gap-4` cluster, each right-anchored under its own trigger, so they don't visually collide — acceptable; if product
    wants mutual-exclusion later it's a shared-state nicety, NOT a defect. Recorded, non-blocking.
  - **(6) Responsive — OK.** Popover is `w-80` (320px) capped by `max-w-[calc(100vw-2rem)]` (:104) — IDENTICAL to the bell
    (:97) → no horizontal overflow at 320px (caps to viewport-minus-gutter). Right-anchored (`right-0`) so it opens leftward
    from the header edge. The capped-export warning + filename wrap inside the `flex flex-col` row. No mobile overflow surface.
  - VERIFICATION basis: full Read of JobsTray + HexagonLoader + NotificationBell; `git diff HEAD` on Layout/NotificationBell/
    DataGrid; SDK enum confirmation (`jobs.ts:9,12`); targeted color + loader greps (all recorded above). No browser/Playwright
    run in this audit pass — recommend the standard axe gate 29 re-run (header tray now on all 13 pages) + a 320px viewport
    check before merge (expected green given the byte-identical bell shell).
  - **SHOULD-FIX (non-blocking):** add `uppercase` to the job-type `<span>` (JobsTray.tsx:131) for symmetry with the status
    span (item 2). OPEN (carried, unchanged): focus-trap/keyboard-nav across the lightweight popovers (§2 — now also subsumes
    the JobsTray popover, consistent with the bell baseline); saved-views store (§10/§12). **Cleared to commit — JobsTray is
    token-clean, uppercase-correct, Hexagon-only, a11y/UX/responsive consistent with NotificationBell; no BLOCK condition.**

- **2026-06-15 · B-5 Saved Views (§10) — `SavedViewsPicker.tsx` (NEW) + `DataGrid.tsx` toolbar mount :434-435 (working
  tree, uncommitted). VERDICT: 🔴 BLOCK — one hard visual defect (undefined `btn-primary` class → unstyled primary action),
  plus 2 FLAG (off-pattern `left-0` anchoring; missing responsive width cap). Realizes the saved-views OPEN carried on this
  ledger since Slice 2.** New `Views (N)` toolbar button right of Export/Columns opens a `role=menu` popover: list of saved
  views (apply / set-default ★ / update-to-current ⤓ / delete ×) + a "Save current view" name input. Per-user, URL-state
  snapshot. Audited tokens, UPPERCASE, a11y, responsive, and consistency vs the sibling Columns/Export menus + the bell/tray
  popover precedent.
  - **(a) 🔴 BLOCK — undefined `btn-primary` class, primary action renders UNSTYLED.** The Save button is
    `className="btn-primary h-7 px-2 text-xs"` (`SavedViewsPicker.tsx:197`). **`.btn-primary` is NOT defined anywhere** —
    `index.css` `@layer components` defines only `.btn` (:11, the primary fill: `bg-primary text-primary-foreground rounded-md
    px-3 py-1.5 … disabled:opacity-50`) and `.btn-ghost` (:14); grep of `apps/web/src` + `packages/ui-theme` +
    `@crm2/ui-theme/tokens.css` for any `.btn-primary{` def = **0 hits**. So this button gets NO background, NO
    `text-primary-foreground`, NO `rounded-md`, and NO `disabled:opacity-50` — it paints as bare body-color text with only
    `h-7 px-2 text-xs`. The menu's PRIMARY action is visually broken + has no disabled affordance. **The only other
    `btn-primary` in the app (`DedupePage.tsx:169`) is `className="btn btn-primary"` — it carries `.btn` too, so `.btn`
    supplies the styling and the bogus `btn-primary` is a harmless no-op there; this picker DROPPED the `.btn`, exposing the
    bug.** FIX: `btn-primary h-7 px-2 text-xs` → **`btn h-7 px-2 text-xs`** (the real primary class). BLOCKING — a senior
    reviewer would not ship an unstyled primary CTA. (Side note for Principal/CEO ledgers: `.btn-primary` is a phantom class —
    consider either deleting it from DedupePage or, if a distinct primary variant is wanted, defining it once in `index.css`.)
  - **(b) 🟡 FLAG — popover anchored `left-0` but the trigger is RIGHT-aligned (off-pattern + clip risk).** The menu shell is
    `absolute left-0 …` (`SavedViewsPicker.tsx:123`). But the picker is mounted INSIDE the toolbar's `ml-auto flex … gap-2`
    right cluster (`DataGrid.tsx:428,434-435`), immediately left of Export + Columns — **both of which open `absolute right-0`**
    (`DataGrid.tsx:461,527`). On a right-anchored trigger a `left-0` panel grows rightward toward / past the viewport edge; on
    a desktop it can clip under the page gutter, and on a phone (toolbar wrapped, trigger near the right margin) the `w-72`
    (288px) panel overflows. The ONLY blessed `left-0` menu in the grid (`DataGrid.tsx:936`) is a LEFT-side control, not the
    right cluster. FIX: `left-0` → `right-0` to match its two immediate siblings. (z-index IS correct: backdrop `z-20`, panel
    `z-30` — byte-identical to Export/Columns :454,461 / :520,527.)
  - **(c) 🟡 FLAG — no responsive width cap on the popover.** Panel is bare `w-72` (288px) with no `max-w-[calc(100vw-2rem)]`
    (`SavedViewsPicker.tsx:123`). The bell + tray popovers (the popover precedent) BOTH cap `w-80 max-w-[calc(100vw-2rem)]`
    (`NotificationBell.tsx:97`, `JobsTray.tsx:110`) precisely to avoid 320px overflow. The sibling Columns/Export menus
    (`w-52`/`w-56`) skip the cap too BUT anchor `right-0` so they open leftward into the viewport (overflow-safe); this picker
    has the worst of both — wider AND mis-anchored. With fix (b) applied (`right-0`), 288px opening leftward is overflow-safe at
    320px, so (c) becomes non-blocking once (b) lands; if `left-0` is kept, the cap is REQUIRED. Recommend adding
    `max-w-[calc(100vw-2rem)]` regardless for parity with the popover precedent. The inner name `<input className="input h-7
    flex-1 …">` is `flex-1` inside a `flex gap-1` row → shrinks with the panel, no input overflow.
  - **(d) Tokens — CLEAN (no hardcoded colors).** grep of the whole new file for `#hex`/`rgb(`/`rgba(`/named-palette
    (`red-/blue-/gray-/black/white…`): **0 hits**. Every color is a semantic token: trigger `btn-ghost`; panel `border-border
    bg-card shadow-md`; headers/labels `text-muted-foreground`; rows `hover:bg-row-hover` (the blessed grid token, used 7× in
    DataGrid); default star `text-primary` (set) / `text-muted-foreground hover:text-foreground` (unset); delete
    `hover:text-destructive`; error `text-destructive` (:205). The `.btn-primary` problem (item a) is a MISSING-CLASS defect,
    not a hardcoded-color one — tokens-only invariant #1 holds. WCAG AA inherited from frozen tokens (E-5).
  - **(e) UPPERCASE display standard — CORRECT.** Both section labels carry `uppercase tracking-wide`: "Saved views"
    (`:125`) and "Save current view" (`:177`) — byte-matching the Export menu's `text-xs font-semibold uppercase tracking-wide
    text-muted-foreground` section headers (`DataGrid.tsx:463,480`). View NAMES, the input placeholder, and the "Save" button
    are normal-case control/data text — correct per the established "control + user-data text is normal-case, only
    headers/labels shout" precedent (Columns menu + §6/§7 panels). No UPPERCASE_DISPLAY_STANDARD violation.
  - **(f) a11y — STRONG, follows the newer focus-trap pattern.** Trigger: `aria-haspopup="menu"` + `aria-expanded={open}`
    (`:104-105`) — matches Export/Columns (`DataGrid.tsx:441-442,507-508`). Panel: `role="menu"` + `aria-label="Saved views"`
    (`:121-122`). **Focus trap + Escape-to-close + focus-return wired via `useFocusTrap(open, ()=>setOpen(false))`** (`:21`) —
    the SAME hook the sibling Columns/Export menus now use (`DataGrid.tsx:206,255`); this CLOSES the lightweight-menu
    focus-trap gap that earlier ledger entries carried as OPEN, so the picker is at the newer, stronger a11y baseline (not the
    old bell/tray no-trap baseline). Click-outside backdrop is `aria-hidden="true" tabIndex={-1}` `fixed inset-0 z-20` (:112-117)
    — out of the a11y tree + tab order, identical to the siblings. Every icon-only control has an `aria-label` AND a `title`:
    ★/☆ default toggle ALSO has `aria-pressed={v.isDefault}` (:150 — correct toggle semantics); ⤓ update, × delete, and the
    name input (`aria-label="New view name"` :184) all named. Enter-to-save wired (`onKeyDown` :191-193 + `submitNew`); error
    block is `role="alert"` (:205). axe gate 29 expected GREEN (no serious/critical surface). MINOR (cosmetic spec-pedantry,
    non-blocking, same as the Columns-menu note): `role="menu"` children are `menuitem` buttons + a free text input — a strict
    `menu` implies arrow-key roving the input breaks; AT-tolerated and axe-clean, accept.
  - **(g) Cross-screen UX consistency — strong except (a)-(c).** Trigger is `btn-ghost text-xs` (:103) — byte-identical to
    Export/Columns triggers (`DataGrid.tsx:440,506`). Panel shell `mt-1 rounded-md border border-border bg-card p-1 … shadow-md`
    + section-header style + `hover:bg-row-hover` rows all match the Export/Columns convention. The empty state ("No saved views
    yet.") mirrors the menus' muted-copy style. The `Views (N)` count-in-trigger is a tasteful addition (no sibling has a count,
    but it's honest + low-noise). Toasts via `sonner` match app convention. The deviations are exactly the three flagged: the
    phantom `btn-primary`, the `left-0` anchor, and the missing width cap — all three break parity with the immediate siblings.
  - VERIFICATION basis: full Read of `SavedViewsPicker.tsx` + `DataGrid.tsx:380-538` (toolbar mount + Export/Columns menus) +
    `useFocusTrap.ts` + `index.css` (class defs) + `NotificationBell.tsx`/`JobsTray.tsx` popover shells; greps — hardcoded-color
    (0), `btn-primary` def (0 app-wide), `btn-primary` usage (2: this file + DedupePage `btn btn-primary`), `bg-row-hover` (7× in
    DataGrid = blessed), anchoring (siblings `right-0`, this `left-0`). No browser/Playwright run this pass (no saved-views e2e
    spec exists yet — `e2e/` has no `saved`/`view` file beyond `viewport.spec.ts`). Recommend before merge: fix (a) [BLOCK],
    (b)/(c) [FLAG], then axe gate 29 re-run + a 320px viewport check of the open popover, + a §10 e2e (save → appears in trigger
    count → apply restores URL-state → set-default auto-applies on remount → delete).
  - **DISPOSITION:** **🔴 BLOCK on (a)** — `btn-primary` → `btn` (one-token fix; the primary CTA is currently unstyled). **FLAG
    (b)** `left-0` → `right-0` (anchoring parity, clip risk) and **(c)** add `max-w-[calc(100vw-2rem)]` (responsive parity).
    Tokens/UPPERCASE/a11y(focus-trap)/cross-screen-shell are otherwise PASS. Re-audit after the one-line `btn` fix → expected
    PASS. OPEN (carried, now being CLOSED by this slice): the §10 saved-views store lands here; focus-trap on lightweight menus
    is now satisfied for the DataGrid menu family (§2 keyboard-roving still open for arrow-key nav).

- **2026-06-16 · Billing slice 5c — `BillingPage.tsx` + `CommissionRatesPage.tsx` + `Layout.tsx` nav (working tree, uncommitted).
  VERDICT: ✅ PASS (clear to commit).** Two new FE pages on the Universal DataGrid: Billing & Commission (per-case billing with
  an inline accordion of per-task lines) and Commission Rates (SUPER_ADMIN comp config with Create/Revise dialog). Nav gains a
  `MIS & Billing` group header + `Billing & Commission` operations link and a `Commission Rates` admin link. Audited against all
  10 frozen rules; greps + full Read of all three files + the shared DataGrid/index.css.
  - **(1) Tokens only — clean.** grep of both pages for `#hex`/`rgb(`/`hsl(`/`text-[`/`bg-[`/`border-[`: **0 hits** (exit-1).
    Cells/dialog use semantic tokens only — `text-muted-foreground`, `text-foreground`, `text-destructive`, `text-card-foreground`,
    `bg-card`, `border-border`, `bg-foreground/40` (the blessed overlay, NOT `bg-black/40` — app-wide `bg-black` grep = 0 hits).
    WCAG AA inherited from frozen tokens (E-5).
  - **(2) Buttons — `.btn`/`.btn-ghost` ONLY, no phantom `.btn-primary`.** CommissionRates: `+ New Commission Rate` = `btn`
    (`:253`), dialog footer Cancel=`btn-ghost`/Save=`btn` (`:164,167`), per-row Revise=`btn-ghost px-2 py-1 text-xs` (`:231`).
    Billing has no bespoke buttons (grid owns its toolbar). **NO `btn-primary` in either page** — the one app-wide `btn-primary`
    hit remains the pre-existing DedupePage carry (`DedupePage.tsx:169`), out of this slice; not reintroduced here. Good — this
    slice does NOT repeat the SavedViewsPicker phantom-class BLOCK.
  - **(3) Inputs — `.input` everywhere.** Billing client filter `<select className="input w-[12rem]">` (`:180`); all five dialog
    controls (user/rateType/client selects + amount/effectiveFrom inputs) carry `className="input"` (`:93,109,126,141,156`); the
    numeric Amount input adds `tabular-nums` (`:141`) — correct for a money field. No raw/un-classed form controls.
  - **(4) Icons — N/A / clean.** Neither page introduces an icon; no icon-library import. Layout's only glyph is the pre-existing
    raw-SVG `PanelLeftIcon` (unchanged). No icon-dep regression.
  - **(5) Hexagon is the ONLY loader — CONFIRMED.** `BillingCaseLines` lazy-load uses `<HexagonLoader operation="Loading Billing
    Lines" />` (`BillingPage.tsx:17,30`) — the single sanctioned loader. The grids' first-load band ALSO renders HexagonLoader
    (inherited from `DataGrid.tsx:25,731-734`). grep of both pages for `Spinner`/`animate-spin`: 0 hits. No competing loader.
  - **(6) UPPERCASE is CSS-only, data not mutated.** Display-uppercase via Tailwind `uppercase` utility on a wrapping `<span>`,
    never on the data: Billing status `<span className="text-xs uppercase">{r.status.replace(/_/g,' ')}</span>` (the `_→space`
    is whitespace-normalization, not a case mutation, `:115`), billingClass/rateType cells `:61,64`; CommissionRates rateType
    `:202` + status `:215` (`isActive ? 'Active':'Inactive'` rendered, then CSS-uppercased). Underlying values untouched —
    consistent with UPPERCASE_DISPLAY_STANDARD.
  - **(7) Money & numerics — correct.** Shared `money()` = `₹${n.toFixed(2)}` → ₹ glyph + exactly 2dp (Billing nulls → '—',
    `BillingPage.tsx:19`; CommissionRates non-null, `:19`). Every numeric column is `align:'right'` AND wraps the value in
    `tabular-nums`: Billing completedTaskCount/billTotal/commissionTotal (`:121-136`) + the accordion Bill/Commission cells +
    Case-total row (`:67,70,82,83`); CommissionRates amount (`:208-209`). Right-align + tabular-nums + 2dp all present.
  - **(8) Accordion / no-empty-pane — SATISFIED.** Billing detail expands INLINE under the row via the grid's `renderExpanded`
    prop (`BillingPage.tsx:177`) rendering `BillingCaseLines` below the row — no side pane. The component's own docstring cites
    the owner's no-empty-pane rule (`:21-24`). Lazy-loaded on expand (per-case `queryKey`, `:27`). Correct pattern.
  - **(9) Created/Updated date-time columns — present + labelled.** CommissionRates (admin/management list) carries BOTH
    `Created` (`createdAt`) and `Updated` (`updatedAt`) date-time columns via shared `formatDateTime`, plus `Effective From`
    (`:218-224`) — full management-list compliance. The accordion's responsive `.rtable` emits per-cell `data-label` on every
    `<td>` (`BillingPage.tsx:52-74`) incl. the `Completed` date-time. Billing's outer grid is an OPERATIONAL pipeline list (not
    master-data) and correctly shows `Last Completed` instead of Created/Updated — same scoping precedent already accepted for
    CasesPage in the Slice-3 entry above (operator triages by recency-of-completion, not config-change history). Consistent.
  - **(10) Dialog pattern — textbook.** `CommissionRateDialog` (`:80-180`): overlay `bg-foreground/40`; panel `role="dialog"` +
    `aria-modal="true"` + `bg-card`/`text-card-foreground`/`border-border` + `max-h-[90vh] overflow-y-auto` + `w-full max-w-md`
    (≤384px → fits 320px); titled `<h2>` (accessible name); footer `flex justify-end gap-2` with `btn-ghost` Cancel / `btn` Save;
    Save gated `disabled={mut.isPending || !valid}`; STALE_UPDATE (409 OCC) → friendly inline `text-destructive` error (`:161`),
    no raw error-code leak for the conflict path. Matches every blessed sibling dialog (Users/Templates/Locations/Rate/CPV).
  - **a11y notes (non-blocking).** Billing client `<select aria-label="Filter by client">` named (`:181`); dialog selects are
    wrapped in `<label>`+visible `<span>` (accessible names present). KNOWN LIMITATION (LOW, carried §2): the dialog has no
    focus-trap / Escape-to-close / focus-return — identical lightweight-modal baseline as every other app dialog (CPV, Rate,
    MasterDataCrud), NOT regressed by this slice; folds into the carried keyboard-nav OPEN, do NOT per-page fix. Minor: the raw
    `ApiError.code` is shown verbatim for non-STALE dialog errors (`:72`) — a copy nit, not a design-token/standard violation
    (matches the pre-fix MasterDataCrud baseline; an `ApiError.code`→friendly-message map is the eventual polish).
  - **Cross-screen UX — strong.** Both pages mirror the clients/products + Slice-1→4 DataGrid convention 1:1 (same header/`+ New`,
    same toolbar select sizing `w-[12rem]` wrap-safe at 320px, same `pageQueryToParams`→`Paginated<T>` envelope, same
    skeleton/empty/error/loader states inherited from the grid). Billing adds `dateFilters`+`exportFn` and CommissionRates adds
    `selectable`+`bulkActions` — both are blessed grid props, used consistently. Nav: the `MIS & Billing` group header is a
    `{label}`-only OPERATIONS entry → renders as the disabled section-style `aria-disabled` div (`Layout.tsx:38,91-97`), matching
    the existing operations-placeholder pattern; each new link carries the exact perm its read endpoint enforces (`billing.view`,
    `masterdata.manage`) so the nav mirrors the API (no 403-bait links). Routes registered (`App.tsx:64,80`).
  - VERIFICATION basis: full Read of all three files + `index.css` (`.btn`/`.btn-ghost`/`.input` real class defs `:8,11,14`) +
    `DataGrid.tsx` (HexagonLoader band `:25,731-734`) + `App.tsx` route registration; greps — hardcoded-color (0 both pages),
    `btn-primary` (0 in slice; 1 pre-existing DedupePage carry), `bg-black` (0 app-wide), loader (only Hexagon). Browser-verify
    (caller-supplied) confirmed both pages render with 0 console errors + working accordion + working create dialog.
  - **DISPOSITION: ✅ PASS — clear to commit.** All 10 frozen rules satisfied; no token/class/loader violation; the phantom
    `btn-primary` that BLOCKed the prior (SavedViews) slice is NOT present here. OPEN (carried, unchanged): focus-trap/keyboard-
    roving on lightweight modals/menus (§2); the pre-existing DedupePage `btn btn-primary` phantom-class (separate slice);
    optional `ApiError.code`→friendly-message map for dialog non-OCC errors.

- **2026-06-16 · ADR-0036 Billing Slice 5d FE — Commissionable bucket + Bill Amt/Commission ₹ columns + "Bill"→"Bills" rename, `PipelinePage.tsx` (working tree, uncommitted). VERDICT: PASS (clear to commit).**
  Adds a Commissionable bucket (mirrors the SLA "Out of TAT" cross-status derived bucket, ADR-0032/0036) + two right-aligned ₹ columns (Bill Amt, Commission) to the Pipeline DataGrid; renames the existing `billCount` header "Bill"→"Bills" to disambiguate from "Bill Amt". Amount cols + Commissionable bucket are `billing.view`-gated (FE UX-only; server authoritative). Diff is surgical — one file (`PipelinePage.tsx`), grep `^+` for hex/rgb/`text-[`/`bg-[`/`border-[`/`bg-black`/`bg-white`: **0 hits**.
  - **(a) Tokens only / WCAG-AA.** New cells use `tabular-nums` (no color); the bucket button reuses the EXISTING shell verbatim (`border-primary bg-primary text-primary-foreground` active / `border-border bg-card text-secondary-foreground hover:bg-accent` idle, count `text-muted-foreground`) — all frozen `@crm2/ui-theme` tokens already on this page. WCAG AA inherited (E-5). No hardcoded color introduced.
  - **(b) money() helper — byte-identical to BillingPage.** `const money = (n: number | null) => (n === null ? '—' : '₹' + n.toFixed(2))` (`PipelinePage.tsx:29`) === `BillingPage.tsx:19` char-for-char (same `'—'` em-dash null sentinel, same `₹` glyph, same `.toFixed(2)`). `TaskView.billAmount`/`commissionAmount` are typed `number | null` (`sdk/tasks.ts:40-41`) → signature matches, no `undefined` leak. ₹ format + `tabular-nums` + right-align match the BillingPage `<td className="py-1 text-right tabular-nums">{money(...)}</td>` convention (BillingPage.tsx:67-71,129-136). UX consistency with the sibling billing surface: **exact**.
  - **(c) Perm-gate mirroring — CORRECT + consistent.** `canViewBilling = !!user && (user.grantsAll === true || (user.permissions ?? []).includes('billing.view'))` (`PipelinePage.tsx:65-66`) is the SAME predicate as `Layout.tsx:80` `has(perm)` and `BillingPage.tsx:95` (all three byte-identical, only the perm string differs). FE gate is UX-only (the server nulls the amounts for non-holders regardless — code comment is honest about this); hiding the columns/bucket mirrors the server so non-holders never see empty "—" amount cols. Gate drives BOTH the column spread (`...(canViewBilling ? [billAmount, commissionAmount] : [])`, with `[canViewBilling]` in the `useMemo` dep so toggling re-derives) AND the bucket filter (`BUCKETS.filter((b) => canViewBilling || !b.comm)`, `:234`). Mirror is complete on both surfaces.
  - **(d) a11y — bucket button needs nothing more.** The new Commissionable `<button>` is the SAME element as the 7 existing buckets inside the existing `role="group" aria-label="Status buckets"` (`:233`); each carries `type="button"` + `aria-pressed={active}` (`:245-247`) and a text label — per-button pressed-state is the correct ARIA for a mutually-exclusive bucket bar (toggle-button group, not a radiogroup; `aria-pressed` is AT-conveyed). No focusable/keyboard regression — it inherits native `<button>` semantics. Adding it changes nothing about the group contract. No new axe surface (gate stays green per the recorded a11y scan).
  - **(e) Mutual-exclusivity correctness.** `selectBucket` now `delete`s all three URL keys (`status`/`outOfTat`/`commissionable`) then sets exactly one (`:75-83`); `active` derivation gates status-bucket active on `!outOfTat && !commissionable` (`:236-240`) so selecting Commissionable correctly de-activates All/status buckets AND Out of TAT. All buckets stay mutually exclusive (the diff's own claim, verified). Page re-anchors to page 1 on bucket change (`delete('page')`, unchanged).
  - **(f) "Bill"→"Bills" rename — no collision.** grep of e2e + pipeline for the old `'Bill'`/`>Bill<`/`getByText('Bill')`: **0 references** (only the new `header: 'Bills'` / `'Bill Amt'` lines). CSV export goes through the server `/export` endpoint (`apiExport(${BASE}/export…)`, `:282`) with server-defined headers — the FE column `header` prop is display-only, so the rename can't desync the export. On mobile cards the `data-label` is auto-emitted from `c.header` (`DataGrid.tsx:724,805`) → cards label "Bills" (count) vs "Bill Amt" (₹) vs "Commission" — three distinct labels, no card-label collision.
  - **(g) Columns not sortable — correct, zero server-whitelist risk.** Both ₹ columns OMIT `sortable` (the code comment "display-only … live only in the billing FROM" is accurate) → no `sortMap` key required server-side, no silent no-op sort. Consistent with the Slice-1..4 discipline of only marking server-whitelisted columns sortable.
  - **(h) Responsive / Mobile band — no viewport gate break.** Pipeline is NOT in the `viewport.spec.ts` card-asserting enumeration (lines 22-28 are the admin lists; Pipeline is absent), so the +2 columns don't trip a column-count card gate. The DataGrid owns the `.rtable` table→card transform (`DataGrid.tsx`), so on mobile the two new cells STACK vertically into the per-row card (each its own `data-label` row) — they add card height, not horizontal width → no 320px horizontal-overflow surface. Right-align flows through `col?.align === 'right'` (`DataGrid.tsx:806`). Caller reports viewport e2e scans pass + browser :5273 verified (Commissionable bucket → 3 rows ₹150/₹40, 0 console errors).
  - **DISPOSITION: ✅ PASS — clear to commit.** Tokens-clean, gate byte-identical to Layout/BillingPage, money/₹/tabular-nums/"—" UX matches BillingPage exactly, rename collision-free, a11y unchanged, no viewport regression. No FLAG/BLOCK. OPEN (carried, unchanged, NOT this slice): DedupePage `btn btn-primary` phantom-class; lightweight-modal focus-trap/Escape baseline (§2 keyboard-nav).

- **2026-06-16 · ADR-0037 MIS Engine Slice 2 (FE Layout Designer) — NEW `features/reportLayouts/ReportLayoutsPage.tsx` + `Layout.tsx` nav + `App.tsx` route + `a11y.spec.ts`/`viewport.spec.ts` enrolment (working tree, uncommitted, FE-only). VERDICT: ✅ PASS — with ONE FLAG (focus-trap baseline carry).** A `/admin/report-layouts` management list (DataGrid) + a Layout Designer dialog (column-builder). Full Read of the new 577-line file + the 4-file diff + server `routes.ts`/`service.ts` + `permissions.ts`; greps for color/btn-primary/focus-trap; sort-whitelist cross-check.
  - **(1) Tokens only / WCAG-AA — CLEAN.** grep of the whole new file for `#hex`/`rgb(`/`hsl(`/`text-[#…]`color`/`bg-[`/`border-[`/`bg-black`/`bg-white`/named-palette (`red-/blue-/gray-/slate-…`): **0 color hits**. The only `text-[…]` matches are `text-[11px]` (arbitrary FONT-SIZE, lines 291/307/325/363/421) — not a color, not a token violation (the invariant #1 bans hardcoded *colors*). Every color is semantic: overlay `bg-foreground/40` (the blessed overlay — app-wide `bg-black` grep still 0), panel `bg-card`/`text-card-foreground`/`border-border`, labels `text-muted-foreground`/`text-foreground`, error `text-destructive`, remove-btn `text-destructive`. WCAG AA inherited (E-5).
  - **(2) Status badge tokens — CORRECT, blessed pair.** Active = `bg-st-approved-bg text-st-approved` (`:499`) — the exact ActiveChip/status-token pair already blessed on RateManagement/CommissionRates; inactive = `bg-surface-muted text-muted-foreground`. Both semantic, both pre-existing, AA-rated. Label text `ACTIVE`/`INACTIVE` is literal uppercase (a 2-state config badge, not CSS-cased data) — consistent with the StatusChip convention.
  - **(3) Buttons — `.btn`/`.btn-ghost` ONLY; NO phantom `.btn-primary`.** grep `btn-primary` in file = **0 hits**. Primary CTAs `New Layout` (`:552`) + dialog `Save` (`:437`) = `btn`; `Edit`/`Activate`/`Deactivate`/`+ Add Column`/`Cancel`/the ↑↓✕ row icons = `btn-ghost`. The SavedViews phantom-`btn-primary` BLOCK is NOT repeated (this is the second consecutive MIS slice to avoid it).
  - **(4) Inputs — `.input` everywhere.** All 4 header selects/inputs (client/product/kind/name) + every column-builder control (header text, source select, field select/free-input, type select, section input) carry `className="input"` (some `+ h-7 text-xs` sizing). No raw/un-classed control. The Required checkbox is a native `<input type=checkbox>` inside a `<label>` (accessible name from the wrapping text) — fine.
  - **(5) HexagonLoader is the ONLY loader — CONFIRMED.** Edit-mode detail fetch renders `<HexagonLoader operation="Loading Layout" />` (`:214`); the grid's first-load band inherits HexagonLoader from DataGrid. grep `Spinner`/`animate-spin` = 0. No competing loader.
  - **(6) Management-list / DataGrid standard — COMPLIANT.** Created (`createdAt`) + Updated (`updatedAt`) labelled date-time columns via shared `formatDateTime`, `whitespace-nowrap text-muted-foreground` (`:506-520`); search (`searchPlaceholder`, `:563`); status badge ✓. `defaultSort="updatedAt"` + `desc` matches server `LAYOUT_PAGE_SPEC.defaultSort/defaultOrder` (`service.ts:34-35`). **All 6 `sortable` column ids (client·product·kind·name·status·createdAt·updatedAt) are 1:1 server-whitelisted in `LAYOUT_PAGE_SPEC.sortMap`** (`service.ts:17-25`) → zero silent no-op sorts. `columns` (columnCount, right-aligned) + `actions` correctly NOT sortable (absent from sortMap). `pageQueryToParams`→`Paginated<ReportLayoutView>` envelope (`:564-568`). Enrolled in `viewport.spec.ts` (`card:true`, `primary:/New Layout/`) + `a11y.spec.ts` — same gates as every other admin list.
  - **(7) UPPERCASE display — CORRECT (CSS-only, data untouched).** Kind cell = `<span className="text-xs uppercase">{KIND_LABEL[r.kind]}</span>` (`:489`) — CSS-uppercases the title-cased label ("Billing MIS"→"BILLING MIS") for display, underlying value untouched. Column-builder field labels (Header/Source/Field/Type) carry `uppercase tracking-wide` (`:291` etc.) — section-label casing, matching the Export-menu/SavedViews precedent. Dialog `<h2>`/`<h3>` titles + control text are normal-case (correct — only headers/labels shout). No UPPERCASE_DISPLAY_STANDARD violation.
  - **(8) Dialog shell — textbook.** `max-w-4xl` (`:209`, the designer needs the width for the 12-col builder grid — wider than the `max-w-md/sm` form dialogs but appropriate), `role="dialog"` + `aria-modal="true"` + `aria-label` (`:206-208`), `max-h-[90vh] overflow-y-auto` scroll, `bg-card`/`text-card-foreground`/`border-border`/`shadow-lg`. Footer `flex justify-end gap-2` Cancel(`btn-ghost`)/Save(`btn`). Save gated `disabled={save.isPending || !canSave}` where `canSave` requires name + ≥1 row + every row valid (+client/product on create). STALE_UPDATE(409 OCC)/REPORT_LAYOUT_EXISTS/VALIDATION → friendly inline `text-destructive` errors (`:174-185`), no raw code leak for those paths (bare `e.code` only on the unknown-error fallback — same baseline as CommissionRates).
  - **(9) a11y of the column-builder rows — WIRED.** The icon-only ↑/↓/✕ buttons ALL have `aria-label` ("Move up"/"Move down"/"Remove column", `:381/389/397`) + disabled at list ends (up disabled at i=0, down at last). The Source/Field/Type/Header/Section controls are each wrapped in a `<label>` with a visible `<span>` → accessible name present on every select/input (no orphan select — the recurring axe "select needs accessible name" trap is avoided). axe gate 29 (serious+critical=0) expected GREEN (page enrolled in `a11y.spec.ts`).
  - **(10) Designer UX — SOUND, no empty/placeholder panes.** The Field control adapts to `SOURCE_CATALOG[sourceType].mode`: FIXED→field dropdown, FREE→text input with a mode-specific placeholder (`FREE_PLACEHOLDER`), REFLESS→a labelled "— derived —" affordance (`:357-359`) instead of a blank cell. Per-row live validation: `rowError` mirrors the server `validateColumnSource` + a "Header required" guard, rendered inline `text-destructive` (`:424`); the derived `column_key` is previewed live (`key: <slug>`, `:421-423`) so the operator sees the stable key before save. Header→columnKey auto-slug only while the key is still untouched (`:300`) — no surprise overwrite. Add/remove/reorder all present. No empty pane, no dead state.
  - **(11) Perm-gate triple-mirror — EXACT.** FE `has('report_template.manage')` (`:539`, the same `grantsAll || permissions.includes` predicate as every sibling) ≡ nav `perm:'report_template.manage'` (`Layout.tsx:51`) ≡ server `PERMISSIONS.TEMPLATE_MANAGE = 'report_template.manage'` (`packages/access/permissions.ts:26`) gating **EVERY** route — list/get/byConfig/create/update/activate/deactivate (`routes.ts:12-19`). Non-holder FE path returns a `text-destructive` access notice (`:540`) rather than a blank/crash. No 403-bait nav link; mirror complete on all three layers.
  - **(a) ⚠️ FLAG — dialog has NO focus-trap / Escape-to-close / focus-return.** The Designer dialog does NOT use `useFocusTrap` (grep confirms). **The app-wide modal baseline has SHIFTED since the earlier "focus-trap is a prior carry" note:** `useFocusTrap` is now wired in **10 of the 12** `aria-modal` feature dialogs (Users·Locations·Templates·RateManagement·CPV·Departments·Designations·Roles·VerificationUnits·Pipeline). The ONLY two stragglers are **CommissionRates** (the immediately-prior MIS slice — which I PASSED under the older baseline) and **this new ReportLayouts dialog**. So focus-trap is no longer the universal carried-OPEN gap it was — it is now the NORM, and this dialog ships at the OLD (weaker) baseline. Wiring it is a one-liner (`const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose)` + `ref={dialogRef}` on the panel `<div>`, exactly as UsersPage:309). **FLAG, non-blocking** (axe gate stays green — focus-trap absence is not an axe serious/critical violation, and it matches the CommissionRates precedent that already shipped) — but recommend wiring it on this touch so the two MIS dialogs converge to the now-dominant baseline rather than widening the gap. Track CommissionRates the same way.
  - VERIFICATION basis: full Read of `ReportLayoutsPage.tsx` (577 ln) + the 4-file diff + `reportLayouts/routes.ts`+`service.ts` + `permissions.ts`; greps — hardcoded-color (0), `btn-primary` (0 in file; pre-existing DedupePage carry untouched), `bg-black` (0 app-wide), focus-trap usage (10/12 dialogs), sort-whitelist 1:1. Caller-supplied: web build green; browser :5273 verified (page renders, create+edit work, 0 console errors, screenshot). No independent browser run this pass.
  - **DISPOSITION: ✅ PASS — clear to commit.** All frozen standards satisfied: tokens-clean, blessed status-badge pair, `.btn`/`.btn-ghost` only (no phantom `btn-primary`), HexagonLoader-only, management-list Created+Updated+search+badge with 1:1 server sort-whitelist, CSS-only uppercase, dialog shell + column-builder a11y wired (icon aria-labels + labelled selects), sound no-empty-pane designer UX, perm triple-mirror exact. **ONE FLAG (non-blocking):** dialog lacks `useFocusTrap`/Escape — now a baseline straggler (10/12 siblings have it); wire the one-liner to converge with CommissionRates. KNOWN PRE-EXISTING (NOT this slice): the shared viewport/a11y `getByRole('button',{name:/menu/i})` 2-match strict-mode fail (fix-task spawned); DedupePage `btn-primary` phantom-class.

- **2026-06-16 · MIS slice 3b re-grain — per-CASE `DataEntrySection` card in `features/cases/CaseDetailPage.tsx` (STAGED, `git diff --cached`). VERDICT: ✅ PASS — clear to commit.** The office data-entry, RE-GRAINED from a per-task inline action to a per-CASE card (Zion `NewDataQC` keys MIS fields once per case). New `DataEntrySection` (lazy `GET /api/v2/data-entry/cases/:caseId`) → `DataEntryFields` (dynamic keyed form, section-grouped) → `DataEntryField` (per-type input). Gated `data_entry.manage` (`canDataEntry = has(DATA_ENTRY_MANAGE)`, :74; mounted :207 between Case Result and Attachments). Full Read of the staged diff + sibling cards/forms + the `Field` helper + `ReportLayoutColumn`/`CaseDataEntry` SDK types; greps for hardcoded color / `btn-primary` / loader.
  - **(1) Tokens only / WCAG-AA — CLEAN.** grep of the added hunk for `#hex`/`rgb(`/`hsl(`/`text-[`/`bg-[`/`border-[`/`bg-black`/`bg-white`/named-palette: **0 hits**. Every color semantic: card `border-border bg-card`, headings `text-muted-foreground`, inputs `border-border bg-background`, button `bg-primary text-primary-foreground`, error/required-hint `text-destructive`. AA inherited (E-5). No hardcoded color.
  - **(2) Button — MATCHES the sibling raw-`bg-primary` convention (correct, NOT `.btn`).** Save button `h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50` (:1193 of the new block) is **byte-identical** to this page's existing CompleteForm/CaseFinalizeForm/AddTasksForm CTAs (CaseDetailPage `:742,799,848,902,1193`). Per the page-local rule the prompt set: this page's forms style buttons raw, NOT via `.btn` — so the new button correctly MATCHES its siblings. grep `btn-primary` in the hunk = **0** — the phantom-class BLOCK that hit SavedViews is NOT repeated. No Cancel button — correct (persistent card, not a dialog; save→toast+re-hydrate). `disabled={save.isPending || !valid}` + "Saving…" pending label match the sibling pattern.
  - **(3) Inputs — match the page's raw input convention.** `inputClass = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm'` (:1225) === the sibling form inputs' class minus the fixed `w-NN` (here `w-full` for the responsive grid cell — the correct adaptation; siblings use fixed widths because they're not in a grid). `h-9` height matches. No raw un-tokened control. NUMBER→`type=number`, DATE→`type=date`, TEXT→`type=text`, SELECT→native `<select>` with a "Select…" empty option.
  - **(4) a11y — label/input association present on ALL 5 types.** TEXT/NUMBER/DATE/SELECT route through the shared `Field` helper (:1119+) which wraps the control in `<label className="flex flex-col gap-1">` with a visible `<span>` text → accessible name on every input AND select (the recurring "select needs accessible name" axe trap is avoided). BOOLEAN renders its own `<label className="flex items-center gap-2 …"><input type=checkbox/><span>{label}</span></label>` — wrapping-label association, accessible name present. **5/5 field types labelled.** Required marked by appending ` *` to the label string (`column.isRequired ? \`${headerLabel} *\` : headerLabel`, :1212) so the asterisk is part of the accessible name (screen-reader-announced, not a color-only/visual-only cue) — good. axe gate: no serious/critical surface (CaseDetailPage not in the a11y.spec enumeration, but the pattern is axe-clean).
  - **(5) HexagonLoader is the ONLY loader — CONFIRMED.** Loading branch renders `<HexagonLoader operation="Loading Data Entry" />` (:1097). grep `Spinner`/`animate-spin` in hunk = 0. No competing loader.
  - **(6) Card chrome + heading — byte-identical to Case Result.** Card `rounded-lg border border-border bg-card p-4 shadow-sm` (:1089) === Case Result card (:130) and the other CaseDetailPage cards (:104,212,254). Heading `mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground` (:1090) === Case Result heading (:131) char-for-char. Section sub-headers reuse `text-xs font-semibold uppercase tracking-wide text-muted-foreground` (:1162) — the established section-label casing. UPPERCASE is CSS-only (`uppercase` utility), data untouched. The card visually IS a Case-Result-card sibling — requested parity met exactly.
  - **(7) Responsive grid — COMPLIANT.** Field grid `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3` (:1175) === the prompt's frozen responsive spec → single-column at narrow width (caller browser-verified 320px single-col), 2-up sm, 3-up lg. Inputs `w-full` fill the cell. No fixed-width horizontal-overflow risk.
  - **(8) UX consistency — strong.** Empty-state (no layout) → muted-copy `<p className="text-sm text-muted-foreground">` (:1101) matching the page's muted-empty convention; error (load fail) → `text-sm text-destructive` (:1099). Required-missing hint inline beside the button (`Required: {missing.map(headerLabel).join(', ')}`, :1199) + per-save error (`text-xs text-destructive`) — clear, no raw error-code leak (STALE_UPDATE→friendly "updated elsewhere — reload"; else generic "Save failed"). Toast via `sonner` (`toast('Data entry saved')`) matches app convention. Remount-by-key (`key={\`${caseId}:${version}\`}`) re-hydrates form state from freshly-loaded values on save→invalidate — clean reload-stable (caller-verified). SDK field names (`columnKey`/`headerLabel`/`dataType`/`isRequired`/`section`/`options`) all match `ReportLayoutColumn` (`reportLayouts.ts:118-130`) — no type drift; `non-null layout!` is safe (parent renders empty-state when `!data.layout`).
  - **a11y / cosmetic notes (LOW, non-blocking).** (i) BOOLEAN field uses `pt-6` to baseline-align its checkbox with the labelled-input rows in the same grid cell — a layout fudge, not an a11y defect (label still associated); acceptable, but if a section is all-BOOLEAN the `pt-6` leaves a small top gap with no field-label-row above it — purely cosmetic. (ii) The required `*` is conveyed in the accessible name (good) but there is no `aria-required`/`required` attribute on the inputs — the validation is JS-side with a visible+SR-announced hint, so this is parity with the sibling forms (none of which set `required` either), NOT a regression. (iii) No focus-trap — correctly N/A (card is not a modal dialog, per the prompt). All three fold into existing carried baselines; do NOT per-card fix.
  - VERIFICATION basis: full Read of `git diff --cached` CaseDetailPage hunk + sibling forms (`:742-902,1193`) + `Field` helper (:1119) + Case Result card (:104-160) + `reportLayouts.ts`/`caseDataEntries.ts` SDK types + `client.ts:362-364` route shapes; greps — hardcoded-color (0 in hunk), `btn-primary` (0 in hunk; pre-existing DedupePage carry untouched), `bg-black`/`bg-white` (0), loader (only Hexagon). Caller-supplied browser-verify: card renders below Documents/Tasks with APPLICANT/PROPERTY/VISIT section headers, required *, hydrated values, single-column at narrow width, clean reload-stable.
  - **DISPOSITION: ✅ PASS — clear to commit.** All frozen standards satisfied: tokens-clean, button/input MATCH the page-local raw-`bg-primary`/`h-9` sibling convention (correctly NOT `.btn` per the page rule; no phantom `btn-primary`), HexagonLoader-only, card chrome + heading byte-identical to the Case Result card, 5/5 field types labelled (Field-helper-wrapped + checkbox wrapping-label), required `*` in accessible name + inline error, responsive `1→2→3` grid, NOT a modal (focus-trap N/A). No FLAG, no BLOCK. OPEN (carried, unchanged, NOT this slice): DedupePage `btn btn-primary` phantom-class; lightweight-modal focus-trap/Escape baseline; optional `aria-required` on JS-validated form inputs app-wide (cosmetic SR-polish, parity with all sibling forms).

- **2026-06-16 · slice 3b FOLLOW-UP — `DataEntrySection` made COLLAPSIBLE (Zion `NewDataQC` click-to-expand) — `CaseDetailPage.tsx` (working tree, pre-commit). VERDICT: ✅ PASS.** Only the `DataEntrySection` fn changed (split into card-chrome + header-row + `open` useState[false] + new `DataEntryBody` inner that holds the useQuery + loading/error/empty/fields branches, rendered only when open). `DataEntryFields`/`DataEntryField` untouched.
  - **(1) `.btn-ghost` is a REAL class — CONFIRMED.** `index.css:14-16` defines `.btn-ghost` (`rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-50`) — bordered, `hover:bg-accent`, as the prompt states. The toggle uses `className="btn-ghost"` (`CaseDetailPage.tsx:1088`). NOT the phantom `.btn-primary` (which has no `index.css` definition and burned SavedViews previously). grep `btn-primary` in hunk = 0.
  - **(2) `aria-expanded` bound to open — CONFIRMED.** `<button className="btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>` (:1088) — the attribute reflects live state (false collapsed / true expanded; caller browser-verified false→true→false). Disclosure-button a11y satisfied. The button toggles its own label `{open ? 'Hide' : 'Show details'}` so the accessible name also changes with state — belt-and-suspenders, fine.
  - **(3) Header-row layout MATCHES the page's other card headers.** Header is `<div className="flex items-center justify-between">` (:1086) with the `<h2>` left + toggle button right — IDENTICAL container class to the Case Result card header (`:105`, also `flex items-center justify-between`). Grep confirms these are the only two `flex items-center justify-between` rows in the file. Consistent.
  - **(4) Tokens-only — CLEAN.** Card `rounded-lg border border-border bg-card p-4 shadow-sm` (:1085, unchanged from Case-Result-sibling); heading `text-muted-foreground`; body branches `text-destructive`/`text-muted-foreground`; button via `.btn-ghost` (all-token utility class). grep of the hunk for `#hex`/`rgb(`/`hsl(`/`text-[`/`bg-[`/`border-[`/`bg-black`/`bg-white`: **0 hits**. AA inherited (E-5).
  - **(5) Collapse pattern CONSISTENT with the page's other toggle.** The sibling `addingTasks` Add-Tasks toggle (`:75,213-236`) is the same `useState(false)` → conditional-render idiom. ONE deliberate divergence, correctly judged: Add-Tasks uses a `.btn` (solid primary CTA — it's an *action* affordance to reveal a form you'll submit), whereas Data Entry uses `.btn-ghost` (a quieter *disclosure* of an existing section). Solid-CTA-for-action vs ghost-for-disclosure is the right semantic split, not an inconsistency. Add-Tasks doesn't set `aria-expanded` (it swaps the whole card body button↔form, not a persistent disclosure header) — the new Data-Entry disclosure correctly DOES set it because the trigger persists beside the expanded content. Pattern-consistent where it should be, semantically differentiated where it should be.
  - **(6) Heading style UNCHANGED — CONFIRMED.** `<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Data Entry</h2>` (:1087) — same classes as before (the slice-3b entry recorded `mb-3 …`; the `mb-3` correctly moved off the `<h2>` since spacing is now owned by the wrapping flex row + the `mt-3` on the expanded body div, :1093). The label-casing tokens (`text-sm font-semibold uppercase tracking-wide text-muted-foreground`) are byte-identical to the Add-Tasks `<h2>` (:215) and Case Result heading. UPPERCASE is the CSS utility, data untouched.
  - **Lazy-fetch correctness (cosmetic-adjacent, in-domain UX).** `DataEntryBody` (with the `useQuery`) is rendered ONLY inside `{open && (…)}` (:1091-1095), so the GET `/api/v2/data-entry/cases/:id` fires on first expand, not on page load — matches the prompt's "lazy-fetch on expand" intent and avoids bloating the case-detail initial load. Collapse unmounts the body (query cache retained by react-query queryKey, so re-expand is instant + the remount-by-`key` re-hydration in `DataEntryFields` still holds). The empty/error/loading branches are preserved verbatim, just moved from JSX ternaries into early-returns in `DataEntryBody` — behavior-identical.
  - **a11y note (LOW, non-blocking, NOT a regression).** No `aria-controls` linking the button to the expanded body region (and the body div has no `id`/`role="region"`). This is a polish-grade disclosure-pattern nicety, not an axe serious/critical surface — `aria-expanded` alone is the load-bearing AT cue and is present. Optional future add; do NOT per-card fix. CaseDetailPage is not in the `a11y.spec` enumeration; pattern is axe-clean.
  - VERIFICATION basis: full Read of `git diff` CaseDetailPage hunk + `index.css:1-16` (`.btn-ghost` def) + sibling Add-Tasks toggle (`:75,213-236`) + Case Result card header (`:105`); greps — `btn-ghost`/`btn-primary`, `flex items-center justify-between` (exactly 2: :105, :1086), `aria-expanded` (1: :1088), hardcoded-color (0 in hunk). Caller browser-verify: collapsed default (0 fields, "Show details", `aria-expanded=false`); expand → 5 fields + section headers + "Hide" + `aria-expanded=true`; collapse → 0; hard-reload stable. Web build + typecheck + lint + format green.
  - **DISPOSITION: ✅ PASS — clear to commit.** All 6 prompt checks satisfied: `.btn-ghost` real (`index.css:14`), `aria-expanded={open}` bound (:1088), header `flex items-center justify-between` matches Case Result (:105), tokens-only (0 hardcoded), collapse idiom consistent with Add-Tasks toggle (with the correct CTA-vs-disclosure semantic split), heading style unchanged. No FLAG, no BLOCK. OPEN (carried, unchanged, NOT this slice): optional `aria-controls`/`role="region"` disclosure polish; DedupePage `btn btn-primary` phantom-class; lightweight-modal focus-trap baseline.

- **2026-06-16 · case-page redesign — lifecycle REORDER + "+ Add Tasks" folded into the task-card header + 4 NEW collapsible sections (Pickup #5, Field Report #6 placeholder, Field Photos #7 gallery, Client Report #9 placeholder) in `features/cases/CaseDetailPage.tsx` (STAGED `git diff --cached`). VERDICT: ✅ PASS — clear to commit.** Full Read of the staged hunk + `index.css:13-16` (`.btn`/`.btn-ghost` defs) + sibling card headers + the `Field`/`Meta` helpers; greps for hardcoded color / `btn-primary` / loader / `aria-expanded` / `flex items-center justify-between`.
  - **(1) Tokens only / WCAG-AA — CLEAN.** grep of `CaseDetailPage.tsx` for `text-[#`/`bg-[#`/`#hex`/`rgb(`/`hsl(` → **0 hits**. Every new color semantic: cards `border-border bg-card`, headings/derived-meta `text-muted-foreground`, inputs `border-border bg-background`, save button `bg-primary text-primary-foreground`, errors `text-destructive`, photo placeholder `bg-surface-muted`. AA inherited (E-5).
  - **(2) `.btn-ghost` is REAL; NO phantom `.btn-primary`.** `index.css:14` defines `.btn-ghost` (`rounded-md border border-input … hover:bg-accent disabled:opacity-50`). grep `btn-primary` in file = **0**. The 4 disclosure toggles + the "+ Add Tasks" header button + the 3 disabled report buttons all use `.btn-ghost`. The Pickup Save CTA uses the page-local RAW `bg-primary` convention (`h-9 rounded-md bg-primary px-4 …`) — byte-identical to the sibling CompleteForm/CaseFinalizeForm/AddTasksForm CTAs, correctly NOT `.btn` per this page's standing raw-button rule. **NOTE the regrain:** "+ Add Tasks" CHANGED from `.btn` (solid CTA, old standalone card) to `.btn-ghost` now that it lives as a quiet affordance in the task-card header — the right semantic shift (header-action ghost vs body-CTA solid).
  - **(3) Collapsible pattern + `aria-expanded` CONSISTENT across all 4 new sections.** Pickup/FieldReport/FieldPhotos/ClientReport each = `<div flex items-center justify-between>` header (`<h2>` left + `.btn-ghost` toggle right) → `useState(false)` → `aria-expanded={open}` on the toggle → `{open && <body>}` lazy body. IDENTICAL idiom to the prior `DataEntrySection` (the slice-3b-followup disclosure I PASSED) and the Case Result card header (`flex items-center justify-between`). grep `aria-expanded` = present on every new toggle; label swaps `Show details`↔`Hide` so the accessible name also tracks state. Lazy-fetch: Pickup + FieldPhotos bodies hold the `useQuery` and mount only on expand (no case-load bloat); placeholders #6/#9 are static copy.
  - **(4) Disabled #9 report buttons — a11y CORRECT.** The PDF/Word/Excel buttons carry BOTH `disabled` (real attr → AT-announced, not click-eligible) AND `title="Coming soon"` (hover affordance). `.btn-ghost`'s `disabled:opacity-50` gives the visual cue. Honest placeholder, no dead-click.
  - **(5) Field-photo gallery — responsive + img alt CORRECT.** Grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` (2-up narrow → 3 → 4) exactly per spec. Each `<img>` has `alt={photo.photoType ?? photo.originalName}` (never empty — falls back to filename), `object-cover h-32 w-full`, wrapped in an `<a target=_blank rel=noreferrer>` to the presigned url; while the per-photo url loads, a HexagonLoader fills the cell (no broken-img flash). Empty → muted "No field photos uploaded"; error → `text-destructive`.
  - **(6) HexagonLoader is the ONLY loader.** Pickup body, field-photos body, and per-thumb url-fetch all render `<HexagonLoader operation="…"/>`. grep `Spinner`/`animate-spin` in hunk = 0.
  - **(7) UPPERCASE headings via the established class.** Every new `<h2>` = `text-sm font-semibold uppercase tracking-wide text-muted-foreground` — byte-identical to the Case Result + Data Entry headings; the task-card header `<span>` keeps `text-xs font-semibold uppercase tracking-wide text-muted-foreground`. CSS-only casing, data untouched.
  - **(8) Lifecycle order reads logically.** New top→bottom: identity header → Applicants/Subjects → Documents/Tasks (work, +Add in header) → Attachments → Data Entry → Pickup → Field Report → Field Photos → Verdict History → terminal Case Result → Client Report (LAST). Comment-documented as the Zion `NewDataQC` flow. Case Result MOVED from near-top to just-before-the-report (terminal verdict last) — coherent: capture → evidence → verdict → deliverable.
  - **(9) Inputs — page-local raw convention.** Pickup keyed fields use `Field`-helper-wrapped `<input>` (label association ✓ — accessible name on every control) with `inputClass = h-9 w-full rounded-md border border-border bg-background px-2 text-sm` (the sibling raw-input class). `datetime-local` for the 3 datetimes, text for trigger/sampler. Derived trio rendered read-only via `Meta`. Responsive `grid-cols-1 sm:2 lg:3`.
  - **a11y notes (LOW, non-blocking, carried).** (i) No `aria-controls`/`role=region` linking toggle→body on the 4 new disclosures — `aria-expanded` alone is the load-bearing cue (present); same polish-grade gap carried from the DataEntry disclosure. (ii) Pickup datetime/text inputs have no `aria-required` — N/A (all fields optional; null clears). (iii) Sections are cards not modals → focus-trap correctly N/A. Do NOT per-card fix.
  - VERIFICATION basis: full Read of the staged `CaseDetailPage.tsx` hunk + `index.css:13-16` + sibling CTAs/headers + `Field`/`Meta`; greps — hardcoded-color (0), `btn-primary` (0), loader (Hexagon only), `aria-expanded` (4 new toggles), `flex items-center justify-between` (Case Result + task-header + 4 disclosures). `tsc --noEmit` web exit 0. Caller browser-verify: order correct, Add-Tasks in task-card header, #7 loads the real MinIO photo, #6/#9 placeholders + disabled report buttons, collapse/expand works.
  - **DISPOSITION: ✅ PASS — clear to commit.** Tokens-clean, `.btn-ghost` real (no phantom `btn-primary`), 4 disclosures consistent w/ DataEntry idiom + `aria-expanded` bound, disabled #9 buttons have title+disabled, responsive photo grid `2→3→4` w/ non-empty img alt, HexagonLoader-only, uppercase headings via the established class, lifecycle order coherent (Case Result→terminal). No FLAG, no BLOCK. OPEN (carried, NOT this slice): optional `aria-controls`/`role=region` disclosure polish; lightweight-modal focus-trap baseline; DedupePage `btn-primary` phantom-class.

### 2026-06-16 — FIELD_REPORT engine Slice 1 (ADR-0039) FE delta — `ReportLayoutsPage.tsx` (working tree, uncommitted)
**VERDICT: ✅ PASS — clear to commit.** Tiny defensive FE delta on the backend/SDK-heavy S1. The only `apps/web/` change is `ReportLayoutsPage.tsx` (`git status --short apps/web/` = 1 file). No styling touched; pure label + dropdown-source change.
- **Diff (3 hunks):** (1) `KIND_LABEL` Record gains `FIELD_REPORT: 'Field Report'` (`ReportLayoutsPage.tsx:36-37`); (2) new `const DESIGNER_KINDS = LAYOUT_KINDS.filter((k) => k !== 'FIELD_REPORT')` (`:40-43`); (3) the New-Layout `<select>` maps `DESIGNER_KINDS` instead of `LAYOUT_KINDS` (`:280`).
- **(a) Excluding FIELD_REPORT from the creatable dropdown — RIGHT UX call for S1.** `LAYOUT_KINDS` (`@crm2/sdk` `reportLayouts.ts:10`) = `['DATA_ENTRY','MIS','BILLING_MIS','FIELD_REPORT']`; server enum is `z.enum(LAYOUT_KINDS)` so FIELD_REPORT passes enum-validation but this column-based designer cannot author a Handlebars narrative body → creating one here would hit a server 400. Hard-excluding it (vs. show-but-disabled) is the correct S1 choice: a disabled `<option>` in a native `<select>` is poor affordance (no inline reason, no tooltip on a disabled option across browsers) and would invite confusion, whereas the S2 Field Report designer is the real entry point. Show-disabled would only be warranted if discoverability of the *upcoming* kind mattered — it doesn't yet (no S2 designer to route to). Exclusion is clean and self-documented by the `:40-42` comment. NO over-engineering.
- **(b) Grid labelling — CONSISTENT.** The list still renders `KIND_LABEL[r.kind]` with `uppercase` (`:510`), so any pre-existing or backend-seeded FIELD_REPORT row displays "FIELD REPORT" rather than `undefined`. The KIND_LABEL addition is exactly what closes that gap — read-path (grid) labels all 4 kinds; write-path (create dropdown) offers only the 3 authorable. Correct asymmetry: you can SEE a Field Report layout, you just can't CREATE one in this designer yet. Matches the `KindBadge`/title-case kind-label idiom used elsewhere.
- **(c) Tokens / styling — CLEAN (diff touches no styling).** Added lines are a Record entry, a `const`, and a `.map` source swap — no className/markup/color. grep of `^+` lines for hex/rgb/hsl/`text-[`/`bg-[`/`border-[`/`btn-primary`: 0 hits. No phantom `.btn-primary`. WCAG AA inherited (E-5), unchanged.
- **(d) #6 card UNCHANGED — S1 did NOT half-wire it.** `git diff HEAD -- apps/web/src/features/cases/CaseDetailPage.tsx` = empty. `MobileReportSection` (`CaseDetailPage.tsx:1453-1471`) is still the inert placeholder: param is `_caseId` (underscore-unused, no fetch), body is a static "report engine … once configured" `<p>` behind a Show/Hide toggle. Comment `:1451-1452` still says "placeholder until then." Full S1/S2 split honoured — card wiring + the FIELD_REPORT designer are S2.
- **VERIFICATION basis:** full `git diff HEAD -- apps/web/`; full Read of `ReportLayoutsPage.tsx:1-50` + grid cell `:510` + dropdown `:280`; `@crm2/sdk` `reportLayouts.ts:10-11` (LAYOUT_KINDS/LayoutKind + server `z.enum`); Read of `MobileReportSection` `:1451-1471`; `git status --short apps/web/` (1 file).
- **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean, label-consistent, exclusion is the right S1 UX, #6 card untouched.
- **OPEN (carried into S2, NOT this slice):** (1) wire `MobileReportSection` to the real FIELD_REPORT narrative once the template engine lands; (2) build the FIELD_REPORT designer (Handlebars body + variable catalog) and re-introduce the kind to the creatable set — at that point reconcile whether it joins `DESIGNER_KINDS` or gets a separate create entry point; (3) when the S2 designer exists, re-audit the create flow for token/a11y/uppercase compliance. (carried, unrelated): DedupePage `btn-primary` phantom-class; lightweight-modal focus-trap baseline.

- **2026-06-16 · S2a — #6 Field Report card wired to the combined per-task view (ADR-0039 §R1), `CaseDetailPage.tsx` (working tree, uncommitted). VERDICT: ✅ PASS.** The S1 placeholder `MobileReportSection` is replaced by a real expandable card → one `TaskFieldReport` accordion row per task (`taskNumber · unitName · applicantName`) → lazy-loads `GET /cases/:id/tasks/:taskId/field-report` on expand → `FieldReportBody` renders the agent's RAW submitted fields (sectioned `Label: value` via `Meta`) then the generated narrative. Closes OPEN item (1) from the 2026-06-12 S1 entry above. Diff is one file (`CaseDetailPage.tsx`), +88/-7.
  - **(a) Tokens only — clean.** grep of all added `+` lines for `#[0-9a-f]{3,6}`/`rgb`/`hsl`/`text-[`/`bg-[`/`border-[`: **0 hits**. Card shell reuses the exact sibling chrome `rounded-lg border border-border bg-card p-4 shadow-sm` (`:1458`, byte-identical to FieldPhotos `:1562` / DataEntry / Pickup / ClientReport). Accordion row `rounded-md border border-border` (`:1490`); section/“Generated Report” headings `text-xs font-semibold uppercase tracking-wide text-muted-foreground` (matches the `<h3>` label idiom); body text `text-foreground`; loaded narrative `whitespace-pre-wrap text-sm text-foreground`; error line `text-sm text-destructive` (matches FieldPhotosBody `:1584` verbatim). `Meta` reused unchanged. WCAG AA inherited from frozen tokens (E-5).
  - **(b) No phantom `.btn-primary`.** Both the outer card toggle (`btn-ghost`, `:1461`) and the per-task accordion toggle (plain `<button>` with only layout utils `flex w-full items-center justify-between gap-2 …`, `:1492-1496`) are correct. The accordion button is intentionally NOT a `.btn-ghost` (it's a full-width row, not a control chip) — a reasonable divergence, not a phantom-class regression. Outer card's Show details/Hide pattern + `btn-ghost` matches every sibling (DON'T-REGRESS upheld).
  - **(c) UX consistency with sibling lifecycle cards — 1:1.** Same card chrome, same `<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Field Report</h2>` header, same `Show details`/`Hide` + `aria-expanded` toggle, same `mt-3` body reveal, `HexagonLoader operation="Loading Report"` for loading (mirrors FieldPhotosBody's `HexagonLoader operation="Loading Photos"`), destructive text for errors. The lazy-on-expand `useQuery({ enabled: open })` pattern mirrors FieldPhotosBody's fetch.
  - **(d) a11y.** Both toggles carry `aria-expanded={open}` (outer `:1461`, accordion `:1494`). The accordion chevron is a decorative `<span class="text-muted-foreground">{open ? '▾' : '▸'}</span>` (`:1503`) — text glyph, no role, not an interactive element; acceptable as decoration since the parent `<button>` already conveys expand state via `aria-expanded`. No new axe surface; gate stays green (charter 29-gate serious+critical=0).
  - **(e) Lifecycle order PRESERVED.** Render body (`:193-203`): DataEntry → Pickup → **MobileReportSection (#6)** → FieldPhotos (#7) → VerdictHistory/Case Result → Client Report. #6 stays between Pickup and Field Photos; Case Result + Client Report after. Browser-confirmed (screenshot): FIELD REPORT card sits exactly between PICKUP INFORMATION and FIELD PHOTOS, CASE RESULT + CLIENT REPORT below.
  - **(f) Empty states — all three reasonable + token-styled.** No tasks → `“No tasks on this case.”` `text-muted-foreground` (`:1467`); no submission yet → `FieldReportBody` guard `!hasFields && narrative === null` → `“No field submission yet for this task.”` (`:1525`); no template configured → narrative branch `“No report template configured for {verificationType}.”` `text-muted-foreground` (`:1551`). Distinct muted-foreground info copy, no destructive coloring for non-errors.
  - **(g) Uppercase = frozen global style, NOT per-component.** Confirmed: the all-UPPERCASE rendering of values/labels is the global CSS layer (`index.css:78` `@apply … uppercase …` on the management/label scope) — NO manual uppercasing was added. grep of added lines for `toUpperCase`: **0 hits**; the only two `uppercase` classes added are on the `<h3>` section headings, matching the established `Field`/`Meta`/card-`<h2>` label idiom (control-label uppercase, not data-shouting). The narrative `<p>` and `Meta` value `<div>` carry NO uppercase class — values render uppercase purely from the inherited CSS layer (screenshot shows RAJESH KUMAR / POSITIVE_DOOR_OPEN / narrative all uppercased by CSS).
  - **GATE:** web typecheck `tsc --noEmit` EXIT 0; `pnpm build` EXIT 0 (3.53s, 0 errors). ⚠️ repo-wide `pnpm verify` exits 1 ONLY on `@crm2/api#test` — a pre-existing `DATABASE_URL` env-config failure in `packages/config` loaded by `push.test.ts` (11 unrelated BE test failures, all env/DB-bound), entirely outside this web-only slice; web gate (typecheck+build) is green. Browser-verified on :5273 (preview server running, screenshot): expanded CASE-000030-1 RESIDENCE task shows sectioned raw fields (CUSTOMER NAME/ADDRESS RATING/MET PERSON/STAYING PERIOD/VERIFICATION OUTCOME) + RESIDENCE NARRATIVE, correct lifecycle position, no console errors observed.
  - **VERIFICATION basis:** full `git diff HEAD -- apps/web/`; Read of `CaseDetailPage.tsx` `:180-204` (render order), `:1454-1556` (new components), `:1559-1674` (sibling FieldPhotos/ClientReport/Meta chrome); `@crm2/sdk reportLayouts.ts:303-314` (`FieldReportView` shape matches usage); `index.css:78` (global uppercase layer); grep of added lines (colors 0, toUpperCase 0); `tsc --noEmit` + `pnpm build`; `preview_list` + `preview_screenshot` on :5273.
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean, sibling-consistent chrome, correct lifecycle slot, sound empty states, uppercase is the frozen global layer (no per-component shout), no phantom primary, `aria-expanded` on both toggles. OPEN (carried): repo-wide `pnpm verify` BE-test env gap (not my domain — API/Infra); DedupePage `btn-primary` phantom-class; lightweight-modal focus-trap baseline; per ADR-0039 the accordion-row keyboard parity folds into the standing DATAGRID §2 keyboard-nav OPEN (interactive non-grid rows out of scope for axe gate).

- **2026-06-16 · S2b (ADR-0039) — Layout Designer authors FIELD_REPORT templates (`ReportLayoutsPage.tsx`; working tree, pre-commit). VERDICT: PASS.**
  Scope of MY domain = `apps/web/` only (the diff also touches api-v2 service/test + sdk client.ts — out of my charter, reviewed by API/Contract). When `Kind=Field Report` the dialog now renders a conditional block (verification-type `<select>` + Handlebars `<textarea>`) and relabels Columns→Variables; FIELD_REPORT re-added to `DESIGNER_KINDS` (`:41`, comment updated `:38-40`).
  - **(a) Tokens only — clean.** grep of all added `+` lines for `#[0-9a-f]{3,6}`/`rgb`/`bg-[`/`border-[`/`text-[` (excluding the allowed `text-[11px]`): **0 hits**. The `<select>` uses the shared `.input` class (`:339`); the `<textarea>` uses `input min-h-[8rem] font-mono text-xs` (`:341`) — `.input` is the design-system class, `min-h-[8rem]`+`font-mono` mirror the existing template-body idiom and the sibling key-preview `font-mono` (`:505`). Label spans `text-xs font-medium text-foreground` (`:319,338`); hint `text-[11px] text-muted-foreground` with `font-mono` code spans (`:348-351`) — `text-[11px]` matches the file's pre-existing column-row label sizing (`:374,390,408,446,504`), not a new arbitrary value. WCAG AA inherited from frozen tokens (E-5).
  - **(b) No phantom `.btn-primary`.** Save = `className="btn"` (`:520`); page New-Layout + Add-Variable buttons = `btn`/`btn-ghost` (`:635`, `:323` "+ Add {Variable|Column}"). No `.btn-primary` introduced (grep: 0). Consistent with the blessed `.btn`/`.btn-ghost` convention.
  - **(c) Dialog focus-trap + aria-modal INTACT.** `useFocusTrap<HTMLDivElement>(true, onClose)` unchanged (`:93`); shell keeps `role="dialog"` + `aria-modal="true"` (`:248-249`) + `bg-foreground/40` overlay. S2b adds no markup outside the trapped container.
  - **(d) UX / placement — well-placed.** The conditional FIELD_REPORT block renders AFTER the client/product/kind/name grid (closing `</div>` at `:316`) and BEFORE the Variables/Columns header (`:319`) — exactly the requested slot: identity fields → field-report config → variable catalog. `Variables (N)` vs `Columns (N)` relabel (`:319-321`) + `+ Add Variable`/`+ Add Column` (`:323`) is clear and correctly frames the column rows as the variable catalog the Handlebars body renders against (matches the `DESIGNER_KINDS` comment intent). The Handlebars hint is helpful — shows both `{{key}}` interpolation and the `{{#eq outcome "..."}}…{{/eq}}` conditional, with a representative multi-line placeholder (`:344-346`).
  - **(e) a11y.** Both new controls have a visible `<label><span>` accessible name ("Verification Type" `:319`; "Report Template (Handlebars)" `:338-340`) wrapping the control inside the `<label>` element → implicit association, accessible name present. Both have placeholder text (select `"Select…"` empty option `:330`; textarea multi-line Handlebars example `:344`). No new axe serious/critical surface; gate stays green.
  - **(f) Immutable-identity consistency.** `verificationType` `<select>` is `disabled={isEdit}` (`:328`) — matches the client/product/kind locked-on-edit pattern (those selects already `disabled` in edit mode) and the SDK `UpdateReportLayoutSchema` which omits `verificationType` (immutable; only `templateBody` editable on PUT, mirrored by the mutation's `...(isFieldReport ? { templateBody } : {})` on edit vs `{ verificationType, templateBody }` on create, `:184-194`). `canSave` correctly gates create on `verificationType !== ''` but not edit (`:240-241`). Data source = `verification-units/options` filtered `kind === 'FIELD_VISIT'` (`:115`), value=`code` (`:326`) — typo-safe key picker, label `code — name`. `VerificationUnitOption.kind` confirmed present in SDK (`verificationUnit.ts:22-27`).
  - **(g) Responsive.** vtype `<select>` wrapper `block sm:max-w-xs` (`:318`) caps width on ≥sm while full-width at 320px; textarea label `block` → full-width textarea (`:337`). The block is `mt-3 space-y-3` (`:317`) — stacks cleanly, no horizontal overflow at 320px.
  - **(h) Cross-screen consistency.** Grid + `KIND_LABEL` already render "Field Report" from S2a (`:38`); page description updated to name Field Report narrative templates (`:631-632`) — consistent with the now-creatable kind. No bespoke table touched.
  - **GATE:** web `tsc --noEmit` EXIT 0 (clean); `pnpm build` EXIT 0 (built 9.77s, 0 errors). SDK full suite 133/133 pass (validates the S2b `CreateReportLayoutSchema`/`UpdateReportLayoutSchema` FIELD_REPORT rules). ⚠️ repo-wide `pnpm verify` exits 1 ONLY on `@crm2/api#test` — the SAME pre-existing `[@crm2/config] invalid environment`/`getPusher` env-config failure documented on the 2026-06-13 entry (11 BE failures, all env/DB-bound, NONE touch reportLayouts; the reportLayouts api test is DB-gated→skipped). Entirely outside this web-only slice; web gate (typecheck+build) is green. Browser-verified per prompt on :5273: New Layout → Kind=Field Report → vtype select + Handlebars textarea + "Variables (1)" appeared, field-visit unit codes populated, created "UI Residence Report" persisted in grid (kind FIELD REPORT), 0 console errors.
  - **VERIFICATION basis:** full `git diff HEAD -- apps/web/`; Read of `ReportLayoutsPage.tsx` (focus-trap `:93`, dialog `:248-249`, block `:315-355`, header relabel `:319-323`, mutation `:178-196`, canSave `:237-242`, description `:628-633`); SDK `reportLayouts.ts:144-314` + `verificationUnit.ts:22-27`; grep added lines (colors 0, btn-primary 0); `tsc --noEmit` + `pnpm build` + SDK vitest.
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean, focus-trap/aria-modal intact, block well-placed, Variables relabel clear, Handlebars hint helpful, a11y labels+placeholders present, vtype immutable-on-edit matches the identity pattern, responsive. OPEN (carried, not my domain): repo-wide `pnpm verify` BE-test env gap (API/Infra); lightweight-modal focus-return-on-Escape baseline; DedupePage `btn-primary` phantom-class.

- **2026-06-16 · S3b (ADR-0039) — "Load standard template" + per-row helper-collision guard in the FIELD_REPORT designer (`ReportLayoutsPage.tsx`; working tree, pre-commit). VERDICT: ✅ PASS.**
  My domain = `apps/web/` only. The web diff is surgical, **+32/-3, one file** (the slice also touches `apps/api/.../fieldReports/helpers*` + `packages/sdk/src/index.ts` — out of my charter, API/Contract). Two additions: (1) a "Load standard template" `<button>` in the Report Template label header that prefills the Handlebars body + variable catalog from `FIELD_REPORT_DEFAULTS[verificationType]`; (2) a per-row `rowError` clause flagging a variable key that collides with a registered grammar-helper name.
  - **(a) Button placement + class — exactly per spec.** The "Report Template (Handlebars)" `<span>` label was wrapped in a new `mb-1 flex items-center justify-between` header `<div>` (`:341`) with the button right-aligned via `justify-between` (browser-confirmed `justifyContent: space-between`, button is the row's 2nd child). Class is `btn-ghost text-xs` (`:347`) — identical to the sibling "+ Add Variable/Column" ghost action (`:390`) and the edit/toggle row chips. Gated `!isEdit && FIELD_REPORT_DEFAULTS[verificationType]` (`:345`) → only shows on CREATE when a standard exists for the selected type → sound prefill-then-tweak UX (load → tweak rows/body → Save). Browser-verified: button present for RESIDENCE, sits in the template header row.
  - **(b) Collision guard via the existing `rowError` path — consistent.** The new clause `if (isFieldReport && FIELD_REPORT_HELPER_SET.has(k)) return \`Key '${k}' collides with a helper name\`` (`:233`) lives in the same `rowError(r)` fn as `Header required` / `Duplicate key '${k}'` / source-binding errors, so it surfaces through the identical per-row `{err && <span className="text-xs text-destructive">{err}</span>}` render (`:536`) — same inline placement, same destructive token. Correctly gated `isFieldReport` (`:129`), so it's keyed on `kind === 'FIELD_REPORT'`. It folds into `canSave` for free (`canSave` already requires `rows.every((r) => rowError(r) === null)`, `:243`) → Save auto-disables. `k = keyOf(r) = r.columnKey || slug(headerLabel)`, so the guard catches both an explicit colliding `columnKey` and a header that slugs to a helper name. Browser-verified: header "Area" (→ key `area`, a helper) → inline "Key 'area' collides with a helper name" in `text-destructive` (computed `rgb(220,40,40)`) + **Save disabled**.
  - **(c) Tokens only — clean.** grep of all added `+` lines for `#[0-9a-f]{3,6}`/`rgb`/`hsl`/`bg-[`/`border-[`/`text-[`: **0 hits**. Button `btn-ghost text-xs`; header `<div>` is layout utils only (`mb-1 flex items-center justify-between`); the error span reuses the pre-existing `text-xs text-destructive` row-error span (unchanged). WCAG AA inherited from frozen tokens (E-5).
  - **(d) No phantom `.btn-primary`.** Button is `.btn-ghost` (correct — a secondary fill-in action, not the primary Save). grep added lines for `btn-primary`: **0**. Save remains the lone `.btn` (`:548`). DON'T-REGRESS upheld.
  - **(e) a11y / dialog.** The action is a real `<button>` (browser-confirmed `tagName === 'BUTTON'`), not a styled `<div>`/anchor. It lives inside the same `useFocusTrap` dialog container (`:251`, trap unchanged) and the `role="dialog"`/`aria-modal="true"` shell (`:252-253`) — no new dialog/focus-trap surface. The button's text content "Load standard template" is its accessible name. No new axe serious/critical surface; gate stays green (charter 29-gate). MINOR (consistent with the whole file, NOT a regression): the new `<button>` omits `type="button"` — but EVERY existing button in this file does too (Add Variable, Edit, toggle, Cancel), and the dialog has no `<form>` wrapper so there's no implicit-submit hazard; matches established file convention, flag only as a file-wide tidy-up, not blocking.
  - **(f) No regression to the DATA_ENTRY/MIS (column) path — verified.** Both additions are FIELD_REPORT-gated: the button by `FIELD_REPORT_DEFAULTS[verificationType]` (only the field-report block renders the vtype select), the guard by `isFieldReport`. Browser-verified on a fresh DATA_ENTRY layout: NO "Load standard template" button, NO Verification Type / Report Template fields, and a column header set to "Area" does NOT trip the collision guard (only the pre-existing `CASE_FIELD requires a source reference` row error shows). Column path untouched.
  - **GATE:** web `tsc --noEmit` EXIT 0 (clean); `pnpm build` EXIT 0 (built 11.22s, 0 errors, 228 modules). The slice's own BE tests PASS under `pnpm verify`: `fieldReports/helpers.test.ts` (15), `defaults.render.test.ts` (3), `render.test.ts` (7), `sections.test.ts` (5). ⚠️ repo-wide `pnpm verify` exits 1 ONLY on `@crm2/api#test` — the SAME pre-existing `[@crm2/config] invalid environment: DATABASE_URL Invalid input` env-config failure documented on the 2026-06-13/S2b entries (11 `platform/*`+`system`+`push` failures, all env/DB-bound, NONE touch reportLayouts or the diff); web-only slice unaffected, web gate (typecheck+build) green. **Static-data verification (vitest resolver):** `FIELD_REPORT_DEFAULTS.RESIDENCE` = **8 `{{#eq}}` branches, 50 columns**, 0 of its own columns collide with a helper (loads clean); `FIELD_REPORT_HELPER_SET` size 31, `has('area') === true` → the gate's `area` collision case is real. **Browser :5273 (preview running):** New Layout → Kind=Field Report → vtype=RESIDENCE → "Load standard template" prefilled body (8 branches) + "Variables (50)"; add a variable headered "Area" → inline collision error + Save disabled; DATA_ENTRY path clean; **0 console errors** (`preview_console_logs` level=error → "No console logs").
  - **VERIFICATION basis:** full `git diff HEAD -- apps/web/`; Read of `ReportLayoutsPage.tsx` (`rowError` `:227-238`, `canSave` `:240-246`, header+button `:340-368`, row-error render `:536`, `isEdit` `:94`/`isFieldReport` `:129`/`ROW_SEQ` `:68`, button-type convention via grep); `packages/sdk/src/fieldReportDefaults.ts` (`FIELD_REPORT_HELPERS` `:16`, `_SET` `:49`, defaults `:281`, `area` helper `:22`); grep added lines (colors 0, btn-primary 0); `tsc --noEmit` + `pnpm build`; vitest static-count probe; live `preview_eval`/`preview_console_logs` on :5273.
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Button is a real `<button>` `.btn-ghost text-xs`, right-aligned in the template header, create-only + default-gated (sound prefill UX); collision guard rides the existing inline `text-destructive` row-error path, FIELD_REPORT-gated, auto-disables Save; token-clean, no phantom primary, focus-trap unchanged, column path un-regressed; gate green (8 branches / 50 vars / `area`-caught / 0 console errors). OPEN (carried, not my domain): repo-wide `pnpm verify` BE-test env gap (API/Infra); file-wide `type="button"` tidy-up (pre-existing convention); lightweight-modal focus-return-on-Escape baseline; DedupePage `btn-primary` phantom-class.

- **2026-06-17 · #7 S4 Slice A — Field Photos caption on the field-visit photo thumbnail (`CaseDetailPage.tsx`; working tree, pre-commit). VERDICT: ✅ PASS.**
  My domain = `apps/web/` only. The FE diff is surgical, **one file, +54/-20** (`git diff bb0e1d1 --stat`). `FieldPhotoThumb` (`:1595`) grew a caption block below the image: photoType (existing), unitName (now conditional), the reverse-geocoded address (📍, `:1638`), a GPS coords link to Google Maps (`:1643`), and the capture-time (`:1654`). The thumbnail anchor was refactored from wrapping-the-whole-card to wrapping ONLY the `<img>` (`:1621`) so the Maps link can be a sibling (no nested `<a>`).
  - **(a) Tokens only — clean.** grep of all added `+` lines for `#[0-9a-f]{3,6}`/`rgb`/`hsl`/`bg-[`/`border-[`/`text-[`: **0 hits**. Caption container `flex flex-col gap-0.5 px-2 py-1 text-xs` (`:1634`); photoType `font-medium text-foreground` (`:1635`); unitName/address/capture-time `text-muted-foreground` (`:1636,1638,1654`); Maps link `text-primary hover:underline` (`:1647`); outer card keeps `border-border` (`:1620`); loading stays `bg-surface-muted` (`:1629`). All frozen `@crm2/ui-theme` semantic tokens. WCAG AA inherited (E-5).
  - **(b) XSS-safe plain-text render — confirmed.** Address, coords, accuracy and capture-time are all React text children (JSX `{address}`, `{lat!.toFixed(6)}, {lng!.toFixed(6)}`, `new Date(captureTime).toLocaleString()`) — **no `dangerouslySetInnerHTML`** anywhere in the file (grep: 0). The server-resolved Google address string is escaped by React's default text-node encoding, so even hostile geocoder text cannot inject markup. The `📍` is a literal glyph prefix, not HTML. Safe.
  - **(c) a11y — wired.** The Maps link carries `target="_blank" rel="noreferrer"` (`:1645-1646`) — matches the image anchor's `target="_blank" rel="noreferrer"` (`:1621`) exactly; both windows are isolated (noreferrer implies noopener). The address uses `line-clamp-2` for overflow BUT carries `title={address}` (`:1638`) → the full address is recoverable on hover/AT, so the truncation hides no critical info. Coords + capture-time use `truncate` (`:1647,1654`) but are short single-token strings (lat,lng / locale datetime) that won't realistically clip at the cell width. Loading uses the standard `HexagonLoader operation="Loading"` (`:1630`). The Maps link's text content (the coords) is its accessible name — adequate, though a more descriptive name (e.g. "Open in Google Maps") would read better to a screen reader (MINOR, non-blocking, not a regression — links-named-by-visible-text is acceptable).
  - **(d) Lazy address fetch — sound, no refetch storm.** The on-view fallback `useQuery(['field-photo-address', caseId, photo.id])` is `enabled: !photo.reverseGeocodedAddress && hasCoords` (`:1611`) → it ONLY fires when the address was never frozen server-side AND coords exist, never for already-resolved photos. `staleTime: Infinity` (`:1613`) means no background refetch once resolved — one request per unresolved photo per session, cached by the per-photo queryKey. `address = photo.reverseGeocodedAddress ?? addr?.address ?? null` (`:1615`) prefers the server-frozen value and degrades to `null` (caption row simply omits) — graceful. `hasCoords` guards both the Maps link and the address fetch via `typeof lat/lng === 'number'` (`:1602`), so a coordless photo renders neither (no `NaN`/`undefined` link, no pointless fetch). Consistent with the file's existing per-attachment `useQuery` URL-fetch idiom (`:1597`).
  - **(e) Conditional rows — no empty-string leak.** unitName/address/coords/capture-time each render `cond ? <div/> : null` (`:1636,1637-1641,1642-1652,1653-1655`), so absent fields produce NO empty DOM node — tighter than the prior `{photo.unitName ?? ''}` which left an empty `<div>`. photoType falls back to `'—'` (`:1635`). Clean degradation.
  - **(f) Responsive — no cell overflow.** The thumb grid is `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4` (`:1587`) — matches the prompt. The caption is a `flex flex-col` of `text-xs` rows; every text row uses `truncate`/`line-clamp-2` so nothing forces the cell wider than its column track. At 320px (2-col, ~150px cells) the address line-clamps to 2 lines and coords/time truncate → no horizontal overflow. The card keeps `overflow-hidden` (`:1620`). Sound.
  - **(g) Cross-screen consistency.** The caption matches the file's sibling caption idiom — `truncate text-xs` muted rows under a `font-medium text-foreground` title (same as the photoType/unitName pair it extends, and the `:1495`/`:1533` report-card text rows). The Maps `text-primary hover:underline` link matches the attachment-link convention elsewhere in the file. The anchor-wraps-image refactor is the correct fix for the no-nested-anchor rule (a card-wide `<a>` cannot legally contain the inner Maps `<a>`). No bespoke table/grid touched.
  - **GATE:** CTO gate reported GREEN (web `tsc --noEmit` + `pnpm build` pass); browser-verified the caption renders (address + GPS ±8m + capture-time) with 0 console errors. Verified within MY domain by full `git diff bb0e1d1 -- apps/web/src/features/cases/CaseDetailPage.tsx` + Read of `FieldPhotoThumb` (`:1595-1659`) + the photo grid (`:1587`) + grep (colors 0, `dangerouslySetInnerHTML` 0, `target="_blank"`/`rel="noreferrer"` on both anchors).
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean (0 hardcoded colors), XSS-safe plain-text render (no `dangerouslySetInnerHTML`), both anchors `target=_blank rel=noreferrer`, address line-clamp backed by `title` (no hidden critical info), lazy address `useQuery` is `staleTime:Infinity` + `enabled` only when null AND coords present (no refetch storm), HexagonLoader for loading, conditional rows leak no empty nodes, responsive within the `grid-cols-2 sm:3 lg:4` cell. MINOR (non-blocking, not a regression): Maps link accessible name = the raw coords text — a descriptive "Open in Google Maps" name would read better to AT. OPEN (carried, not my domain): repo-wide `pnpm verify` BE-test env gap (API/Infra); lightweight-modal focus-return-on-Escape baseline; DedupePage `btn-primary` phantom-class.

- **2026-06-17 · S5 Slice 2a — Client Report section + printed-report artifact (`CaseDetailPage.tsx` `CaseReportSection`
  + new `caseReports/render.ts` `DEFAULT_CASE_REPORT_TEMPLATE`; working tree). VERDICT: PASS (clear to commit).** A new
  collapsible "Client Report" card on the case detail page with a working **Preview (HTML)** button (auth-bearing
  `apiBlob` → blob URL → new tab) + 3 disabled placeholder format buttons; plus the standalone Puppeteer-target printed
  report HTML doc. Audited the APP UI against the design system; judged the print artifact as a self-contained print doc.
  - **(a) APP UI — tokens only, NO phantom class, NO hardcoded color.** `CaseReportSection` (`:1685-1712`) uses the
    blessed card shell `rounded-lg border border-border bg-card p-4 shadow-sm` (identical to the sibling report cards in
    this file), `text-muted-foreground`/`tracking-wide` header, `.btn` (REAL class, `index.css:11`) for the primary
    Preview action — correctly NOT the phantom `.btn-primary` (which `grep` confirms exists ONLY at `DedupePage.tsx:169`,
    the carried OPEN, and is absent here), `.btn-ghost` (`index.css:14`) for the toggle + disabled format buttons. `sed`
    of the whole component (`:1664-1713`) for `#hex`/`rgb`/`bg-black`/`bg-[`/`text-[`/`border-[`: **0 hits**. WCAG AA
    inherited from frozen tokens (E-5).
  - **(b) Collapsible pattern — standard + a11y-correct.** Toggle is a `.btn-ghost` with `aria-expanded={open}` and a
    text label that flips "Show details"/"Hide" (`:1689-1691`) — matches the file's collapsible-card convention; no
    icon-only control, every button has a real text label. Header is an `<h2>` of normal control text (no `<thead>`
    surface → UPPERCASE_DISPLAY_STANDARD N/A; uppercase here is the explicit `uppercase` utility on the card title, the
    established muted-section-header idiom in this file, fine).
  - **(c) Loading / error UX — reasonable.** Busy state disables the Preview button + swaps its label to "Generating…"
    (`:1700-1701`) so the action can't be double-fired and the state is visible; failure → `toast.error('Could not
    generate the report preview')` (sonner, imported `:28`) — consistent with the file's toast convention, no raw error
    leaked. The blob URL is revoked after 60s (`:1677`) so the new tab has time to load. `window.open(…, 'noopener')`
    is set. Disabled PDF/Word/Excel buttons carry `disabled` + `title="Coming soon"` (`:1704`) — honest affordance for
    the not-yet-shipped formats (land in 2b/4/5), not a dead control pretending to work.
  - **(d) Responsive — OK.** The button row is `flex flex-wrap gap-2` (`:1699`) so the 4 buttons wrap cleanly at 320px;
    the card body is `flex flex-col gap-3`. No horizontal overflow surface; no bespoke table/grid introduced.
  - **(e) Print artifact (`DEFAULT_CASE_REPORT_TEMPLATE`) — clean, professional print doc; inline CSS is CORRECT here,
    NOT a token violation.** This is a standalone HTML document rendered by Puppeteer with NO access to the app's
    `@crm2/ui-theme` CSS, so its inline `<style>` + raw hex (`#111`/`#444`/`#666`/`#ccc`/`#f3f3f3`) is the intended,
    portable approach and is explicitly OUT OF SCOPE for the no-hardcoded-color invariant (per task framing + ADR-0041).
    Judged as a print artifact: (i) **hierarchy** sound — `<h1>` client name, muted product subtitle, uppercased `<h2>`
    section heads with bottom-border rules (`render.ts:63-65`); (ii) **KV + applicants tables** legible (`table.kv`
    label/value, `table.grid` bordered applicant rows); (iii) **per-task blocks** carry `page-break-inside: avoid`
    (`:74`) so a verification doesn't split across pages — correct print consideration; (iv) **photo grid** is
    `flex-wrap` 180px thumbs with `object-fit:cover` + captioned GPS/geocode/time, `word-break:break-word` on the
    caption guards overflow (`:78-81`); (v) **footer** with generation provenance + task/photo totals (`:151-156`).
    **Contrast** is fine for print — `#111` body / `#444`/`#666` muted on white all clear AA on paper. NOTE (non-blocking,
    correctly deferred): no `@page` margins in the doc — but that is Puppeteer's `margin` option in slice 2b per the task
    framing, so NOT a gap here. The XSS posture (auto-escape ON, `nl2br` escapes-then-`<br>`, no `{{{ }}}`) is a
    security-domain concern, noted but out of my lens.
  - **GATE:** verified within MY domain by Read of `CaseReportSection` (`:1664-1713`) + the full `render.ts` + `grep`
    confirming `.btn`/`.btn-ghost` are real `index.css` classes and `.btn-primary` is phantom/absent-here + `sed` color
    scan (0 hits) + `toast`/`apiBlob` imports present (`:28-29`). Did not run the FE build (CTO/Contract gate owns that).
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. App UI is token-clean (0 hardcoded color, 0 phantom class), uses the
    correct `.btn` primary class, a11y-sound (aria-expanded toggle, text-labelled buttons, no icon-only), responsive
    (flex-wrap), with a visible busy state + sonner error toast. The printed report is a clean, professional, print-
    friendly self-contained doc whose inline CSS is the intended Puppeteer-portable approach (NOT a token violation).
    OPEN (carried, not my domain / deferred by design): `@page` margins land in slice 2b; lightweight-modal focus-return
    baseline; DedupePage `btn-primary` phantom-class (elsewhere, not reintroduced here).

- **2026-06-17 · S5 Slice 2b — PDF generation as a background job + JobsTray CASE_REPORT download
  (`CaseDetailPage.tsx` `CaseReportSection` + `JobsTray.tsx`; working tree). VERDICT: ✅ PASS (clear to commit).**
  Two-file FE diff. `CaseReportSection` (`:1666-1731`): Preview demoted to `.btn-ghost`, **PDF promoted to the primary
  `.btn`** and now ENQUEUES a job (`useMutation` → `POST /api/v2/cases/:id/report` → invalidate `JOBS_KEY` + sonner toast),
  Word/Excel still `.btn-ghost disabled`. `JobsTray.tsx`: the SUCCEEDED Download condition widened
  `type==='EXPORT'` → `type==='EXPORT' || type==='CASE_REPORT'` (`:145`) so a finished report shows a Download link.
  - **(a) Design system — tokens-only, NO phantom class, hierarchy is sensible.** `sed` color scan of `CaseReportSection`
    (`:1664-1731`): **0 hits** (`#hex`/`rgb`/`hsl`/`bg-[`/`text-[`/`border-[`). PDF uses the REAL primary `.btn`
    (`index.css:11`), NOT phantom `.btn-primary` (grep confirms `.btn-primary` exists ONLY at `DedupePage.tsx:169`, the
    carried OPEN — absent here). Preview=`.btn-ghost`, Word/Excel=`.btn-ghost disabled`. **Primary/secondary hierarchy is
    correct**: PDF (the real deliverable the user came for) is now the single primary action; Preview (a transient HTML
    peek) and the not-yet-shipped formats are secondary ghosts — one primary CTA per card, the blessed pattern. Card shell
    `rounded-lg border border-border bg-card p-4 shadow-sm` + collapsible `.btn-ghost`+`aria-expanded` unchanged from 2a.
    JobsTray added line uses only `text-primary hover:underline` (matches the existing EXPORT Download button verbatim — it
    is literally the same JSX branch, just a widened type guard). 0 new color literals.
  - **(b) Loading/feedback UX — clear, and the "work continues in the tray" model is communicated.** PDF button: `disabled`
    + label→"Starting…" while `generatePdf.isPending` (`:1718-1719`) — can't double-fire, state visible. Success → sonner
    `toast.success('Generating PDF — it will appear in the background-jobs tray when ready')` (`:1694`); error →
    `toast.error('Could not start the report')` (`:1696`). **Toast copy is good**: it both confirms the action started AND
    tells the user WHERE to look (the tray) and that it's async — this is the right way to set the expectation that the
    button does NOT block inline. The mutation `invalidateQueries(JOBS_KEY)` (`:1693`) refetches the tray so the new job
    appears immediately (belt-and-braces with `useRealtimeJobs`). Sound. (NIT, non-blocking: "Starting…" vs Preview's
    "Generating…" — two different gerunds for two different actions; defensible since they ARE different operations, but a
    shared verb would read marginally more consistent.)
  - **(c) JobsTray consistency — a CASE_REPORT job renders IDENTICALLY to EXPORT.** The widened guard (`:145`) reuses the
    exact same Download button + `r.filename ?? 'file'` + `capped` sub-line branch; type label (`:137` `uppercase {j.type}`),
    status (`:138`), in-flight `%·stage` (`:142`), FAILED `{j.error}` (`:170`), and the RUNNING HexagonLoader
    `operation={`${type} — ${progress}%`}` (`:119`) all flow through the shared per-job row → zero bespoke CASE_REPORT
    path. `CASE_REPORT` is a real `JOB_TYPES` member (`packages/sdk/src/jobs.ts:9`) so the guard is type-safe. **NIT (NOT a
    BLOCK): the raw `CASE_REPORT` label** shows shouted-with-underscore in the tray (`uppercase` on `{j.type}`). But
    EXPORT/IMPORT already render raw uppercase the same way — so this is **consistent with the established tray convention**;
    humanizing to "Case Report" would be polish that should be applied to ALL three types at once (a tray-wide map), not a
    one-off for CASE_REPORT. Recorded as a tray-polish NIT, deferred — consistency wins over a partial humanization.
  - **(d) a11y — no new gap.** Both new/changed buttons are text-labelled (PDF/"Starting…", Preview/"Generating…"), no
    icon-only control; disabled Word/Excel keep `title="Coming soon"`. The tray Download is a real `<button>` (not a
    div-onclick) and is keyboard-activatable; the tray is Escape-dismissable + click-outside (`:69-71`, existing). The PDF
    button's `disabled` while pending correctly removes it from the tab order during the request. No new axe surface.
    (Carried baseline, not my domain: lightweight-popover focus-return-on-Escape — pre-existing tray behavior, unchanged.)
  - **(e) Responsive — fine on mobile.** The button row is `flex flex-wrap gap-2` (`:1714`) so Preview/PDF/Word/Excel wrap
    cleanly at 320px (no fixed widths). The tray popover keeps `w-80 max-w-[calc(100vw-2rem)]` (`:110`) → no horizontal
    overflow; the Download row is `flex-col items-start` so a long filename wraps within the 320px popover. No new overflow.
  - **GATE:** verified within MY domain by Read of `CaseReportSection` (`:1664-1731`) + full `JobsTray.tsx` + `grep`
    confirming `.btn`/`.btn-ghost` real / `.btn-primary` phantom-and-absent-here + `sed` color scan (0 hits) + `JOB_TYPES`
    includes `CASE_REPORT` (`packages/sdk/src/jobs.ts:9`) + `JOBS_KEY` import (`:31`). Did not run the FE build (CTO/Contract
    gate owns that).
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean (0 hardcoded color), correct REAL `.btn` primary (no phantom
    class), sensible PDF-as-primary hierarchy, clear async-to-tray toast copy, CASE_REPORT renders identically to EXPORT in
    the tray, a11y-sound (text-labelled buttons, keyboard-activatable Download, disabled-while-pending), responsive flex-wrap.
    NITs (non-blocking): raw `CASE_REPORT` tray label is unhumanized — but consistent with EXPORT/IMPORT (defer a tray-wide
    humanization map); "Starting…" vs "Generating…" gerund split. OPEN (carried, not my domain): `@page` margins are the
    worker/Puppeteer side (not this FE diff); lightweight-popover focus-return baseline; DedupePage `btn-primary` phantom-class.

- **2026-06-17 · S5 Slice 3 — CASE_REPORT branch in the MIS-Layout `LayoutDesignerDialog`
  (`ReportLayoutsPage.tsx`; staged). VERDICT: ✅ PASS (clear to commit).** The shared designer dialog gained an
  `isCaseReport` branch (`:142`) parallel to the existing `isFieldReport` one: Page Size + Orientation `<select>`s
  (`:413-442`, fed from `REPORT_PAGE_SIZES`/`REPORT_PAGE_ORIENTATIONS`), an HTML+Handlebars `<textarea>` (`:455-462`),
  a "Load default template" button (`:448-453`, → `DEFAULT_CASE_REPORT_TEMPLATE`), a live `hasTripleStash` inline error
  (`:463-468`), and a grouped read-only "Available variables" catalog panel (`:475-497`, from
  `CASE_REPORT_VARIABLE_CATALOG`). The Columns section is gated `hasColumns` (= `!isCaseReport`, `:144,501`) → hidden
  for CASE_REPORT; `canSave` requires body non-empty AND no triple-stash (`:271`).
  - **(a) Design system — tokens-only, NO phantom class, NO hardcoded color.** All inputs/selects/textarea use the real
    `.input` class (`index.css:8`); both action buttons are `.btn-ghost` (`index.css:14`, the Load-default + footer
    Cancel) and the footer Save is the REAL primary `.btn` (`index.css:11`) — `grep` confirms phantom `.btn-primary` is
    ABSENT from the whole file (still lives only at `DedupePage.tsx:169`, the carried OPEN). Color-literal scan of the
    file (`#hex`/`rgb`/`hsl`/`text-[#`/`bg-[#`/`border-[#`): **0 hits** — the 9 `text-[11px]` matches are arbitrary
    font-SIZE (paired with the `text-muted-foreground` token), the established sizing idiom the FIELD_REPORT branch
    already uses (`:402`). The catalog panel uses `border border-border p-2` cards, `text-muted-foreground` group
    headers + notes, `text-foreground` mono paths (`:479-490`) — all frozen `@crm2/ui-theme` tokens. The `{{{` error
    uses `text-destructive` (`:464`). DEFAULT_CASE_REPORT_TEMPLATE is SDK print-CSS (`caseReports.ts:195`), NOT in this
    file's JSX — correctly out of the no-hardcoded-color lens (per slice 2a). WCAG AA inherited (E-5).
  - **(b) a11y — wired, no new gap.** Every control is wrapped in a `<label>` with a visible `<span>` name: Page Size
    (`:415`), Orientation (`:429`), the textarea label "Report Template (HTML + Handlebars)" (`:445-447`) — so all three
    selects + the textarea have accessible names. The `{{{` error is **TEXT, not color-only**: it spells out the rule
    ("Triple-stash `{{{ }}}` (raw, un-escaped) is not allowed — use `{{ }}`…", `:463-468`) so the gate is conveyed by
    words, not just the destructive hue → passes the non-color-only requirement. "Load default template" + both page
    selects are native `<button>`/`<select>` → keyboard-reachable + tab-ordered. The dialog keeps the existing
    `useFocusTrap(true, onClose)` (`:105`) + `role="dialog"` `aria-modal` (`:277-278`) shell — Escape-closes + focus is
    trapped, unchanged. The variable catalog is a read-only `<ul>` (`:483`) — informational, no interactive a11y surface.
    No new axe surface.
  - **(c) UX coherence — the authoring flow reads clearly.** Pick Page Size/Orientation → write or "Load default
    template" into the HTML body → consult the grouped "Available variables" reference → Save. **Save's disabled reason
    is visible**: `canSave` (`:271`) blocks on empty body OR triple-stash; the triple-stash case surfaces the inline
    `text-destructive` explanation right under the textarea (`:463-468`), so a disabled Save has an on-screen cause
    (the empty-body case shares the field-report convention of a disabled Save with the placeholder prompting input —
    acceptable, matches the sibling branch). The catalog is **readable**: grouped by `g.group` (uppercased muted
    section header), each var a `flex justify-between` row of a mono `{{path}}` + a muted `note` (`:485-491`) — scannable
    two-column key/description. The error message is clear AND actionable (names the offending token + the fix).
  - **(d) Consistency with the FIELD_REPORT branch — strong, intentional divergence justified.** Both branches share the
    identical scaffold: `mt-3 space-y-3` wrapper, a label-with-`flex justify-between` header carrying a `.btn-ghost
    text-xs` load button (FIELD = "Load standard template" `:390`, CASE = "Load default template" `:452`), and a
    **`textarea className="input … font-mono text-xs"`** — CASE uses `min-h-[16rem]` (`:456`) vs FIELD's `min-h-[8rem]`
    (`:395`), a sensible larger authoring surface for a full HTML doc vs a narrative snippet; the `font-mono text-xs`
    styling matches verbatim. The deliberate difference — FIELD shows an editable variable-ROW editor (its columns ARE
    the catalog), CASE shows a READ-ONLY catalog (case context is fixed, no columns) — is the correct model and is
    mirrored in `hasColumns` gating the Columns section out for CASE only. Helper hints below each textarea follow the
    same `text-[11px] text-muted-foreground` + inline mono-token idiom (`:402` vs `:469`). Coherent.
  - **(e) Responsive — sane at 320px + desktop.** Page-picker grid `grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-md`
    (`:413`) stacks on mobile, two-up + capped on ≥sm. Catalog grid `grid-cols-1 gap-3 sm:grid-cols-2` (`:477`) likewise
    single-column on mobile. The textarea is `min-h-[16rem]` with the full-width `.input` (no fixed width) → no
    horizontal overflow; catalog rows use `gap-2` + the note column is free-flowing text (no `truncate`, but short
    notes + `flex` wrap-safe). The dialog shell keeps `max-w-4xl max-h-[90vh] overflow-y-auto` (`:280`) so the taller
    CASE body scrolls within the modal. No bespoke table/grid introduced; no mobile overflow surface.
  - **GATE:** verified within MY domain (`apps/web/`) by full Read of `ReportLayoutsPage.tsx` (esp. the
    `isCaseReport` branch `:411-499`, `canSave` `:263-271`, `hasColumns` gate `:144,501`) + `grep` confirming
    `.input`/`.btn`/`.btn-ghost` real in `index.css` and `.btn-primary` phantom-and-absent-here + color-literal scan
    (0 hits) + confirming the 5 SDK exports resolve (`caseReports.ts:6,7,128,195`, `reportLayouts.ts:23,26`) and the
    catalog shape `{group, vars:[{path,note}]}[]` matches the JSX render. Did not run the FE build (CTO/Contract gate).
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean (0 hardcoded color, 0 phantom class — correct REAL `.btn`
    Save + `.btn-ghost` Load), a11y-sound (labelled selects+textarea, focus-trapped dialog unchanged, `{{{` gate is TEXT
    not color-only + keyboard-reachable controls), UX-coherent authoring flow with a visible disabled-Save reason and a
    readable grouped mono catalog, consistent-by-design with the FIELD_REPORT branch (same scaffold, justified read-only
    vs editable divergence, matching `font-mono text-xs` textarea), responsive `sm:grid-cols-2` page+catalog grids + a
    scroll-safe `min-h-[16rem]` body. OPEN (carried, not my domain / pre-existing): DedupePage `btn-primary` phantom-class;
    lightweight-modal focus-return-on-Escape baseline.

- **2026-06-17 · S5 Slice 4 — Word (.docx) generation + Word button (`CaseDetailPage.tsx` `CaseReportSection`;
  the docx renderer is a print artifact, excluded from token rules). VERDICT: ✅ PASS (clear to commit).** The
  slice-2b `generatePdf` mutation was generalised to a single `generate` mutation taking `'pdf'|'docx'`
  (`:1690-1700`, `POST /cases/:id/report?format=…`); the previously-disabled **Word** button is now LIVE as a
  `.btn-ghost` (`:1724-1730`), Excel stays `.btn-ghost disabled title="Coming soon"` (`:1731-1733`).
  - **(a) Design system — tokens-only, hierarchy correct.** `sed` color scan of `CaseReportSection` (`:1664-1739`):
    **0 hits** (`#hex`/`rgb`/`hsl`/`bg-[`/`text-[`/`border-[`). PDF = the REAL primary `.btn` (`index.css:11`, NOT
    phantom `.btn-primary`); Preview/Word = `.btn-ghost`; Excel = `.btn-ghost disabled`. **Hierarchy is sensible**:
    PDF (the sealed, send-ready deliverable) is the single primary CTA; Word (the editable variant) and Preview sit
    as secondary ghosts; Excel reads as not-yet-available. One primary per card — the blessed pattern. Card shell
    unchanged from 2a/2b. The docx layout's inline OOXML styling (greys/shading in `docx.ts`) is a print artifact,
    correctly OUT of the on-system token lens.
  - **(b) Single-mutation disable — RIGHT UX, one NIT.** The shared `generate` mutation disables BOTH PDF and Word
    while `generate.isPending` (`:1721,1727`). JUDGED CORRECT: it prevents firing a second format mid-request (you
    can't reasonably want two reports enqueued at once), and the buttons re-enable on settle — the lighter, less
    error-prone choice over per-button pending state. **NIT (non-blocking): the Word button has NO pending label** —
    it stays "Word" while pending, whereas PDF flips to "Starting…" (`:1722`). So clicking Word shows in-button
    feedback on the *PDF* button, not the one clicked. The sonner toast (`Generating DOCX — …tray`) DOES confirm the
    Word action started, so feedback exists; but a "Starting…" on whichever button was clicked would read cleaner.
    Minor polish, deferred (the toast carries the load-bearing feedback).
  - **(c) Toast copy — clear + format-aware.** `toast.success('Generating ${format.toUpperCase()} — it will appear
    in the background-jobs tray when ready')` (`:1695-1697`) → "Generating DOCX …" / "Generating PDF …": confirms the
    action, names the format, AND tells the user WHERE to look (the tray) + that it's async. Error → `toast.error('Could
    not start the report')` (`:1699`). Good — same async-to-tray model blessed in 2b. The body copy (`:1712-1715`)
    correctly updates to "PDF and Word generate in the background. Excel lands in the next slice."
  - **(d) a11y — no new gap.** All four buttons are TEXT-labelled (Preview/PDF/Word/Excel — no icon-only control);
    Excel keeps `title="Coming soon"`. Disabled-while-pending correctly drops PDF/Word from the tab order during the
    request. The finished docx downloads via the shared JobsTray Download branch (real `<button>`, keyboard-activatable)
    — unchanged from 2b, already type-safe for `CASE_REPORT`. No new axe surface.
  - **(e) Responsive — fine at 320px.** Button row is `flex flex-wrap gap-2` (`:1717`), no fixed widths → Preview/PDF/
    Word/Excel wrap cleanly on mobile. No new overflow.
  - **GATE:** verified within MY domain by Read of `CaseReportSection` (`:1664-1739`) + `sed` color scan (0 hits) +
    `grep` confirming `.btn`/`.btn-ghost` real and `.btn-primary` phantom-and-absent-here. The docx renderer
    (`caseReports/docx.ts`) is a print artifact — its inline OOXML colours are excluded per the slice-2a precedent.
  - **DISPOSITION: ✅ PASS.** No FLAG, no BLOCK. Token-clean (0 hardcoded colour, correct REAL `.btn` primary, no
    phantom class), sensible PDF-primary / Word-ghost / Excel-disabled hierarchy, clear format-aware async-to-tray
    toast, a11y-sound (text-labelled buttons, disabled-while-pending), responsive flex-wrap. NIT (non-blocking): the
    Word button shows no in-button "Starting…" label (PDF does) — toast carries the feedback; defer. OPEN (carried,
    not my domain): DedupePage `btn-primary` phantom-class; lightweight-popover focus-return baseline. (docx renderer
    layout = CEO/print-artifact domain; xlsx + DPDP-retention carries are CEO-tracked.)

## 2026-06-17 — CASE_REPORT S5 Slice 5 (FINAL) — Excel button enabled (FE only) — VERDICT: PASS (no BLOCK)
FE diff is tiny + surgical (CaseDetailPage.tsx): the previously-`disabled title="Coming soon"` Excel button is now live (`onClick={()=>generate.mutate('xlsx')}`, `disabled={generate.isPending}`); the mutation input type widened `'pdf'|'docx'`→`CaseReportFormat`; the copy updated. xlsx.ts/job.ts/sdk/tests are non-FE (CEO/Principal domains).
- **(a) Button group — all 4 now live + consistent.** Preview (`.btn-ghost`) / PDF (`.btn` primary) / Word (`.btn-ghost`) / Excel (`.btn-ghost`). The single `generate` mutation disables ALL THREE format buttons together while pending (PDF/Word/Excel each `disabled={generate.isPending}`, CaseDetailPage.tsx:1722/1728/1735) — correct: one in-flight enqueue, no double-fire across formats; Preview has its own `busy` flag (separate sync path). One primary (PDF `.btn`), three ghosts — the blessed single-primary-per-card hierarchy held. ✓
- **(b) Tokens-only / no phantom class.** Only `.btn` + `.btn-ghost` (both real classes); NO `.btn-primary` phantom. Diff adds no className/hex/rgb/arbitrary color. WCAG AA inherited (E-5). ✓
- **(c) a11y — no new gap.** Excel is now a TEXT-labelled live `<button>` (was a disabled `title="Coming soon"` ghost); dropping the `disabled`+`title` and adding `onClick` is a net a11y improvement (the control is now reachable + actionable). All 4 buttons text-labelled, keyboard-reachable; disabled-while-pending correctly drops them from interaction during the enqueue. No icon-only control. ✓
- **(d) Copy — accurate + de-staled.** Updated from "...PDF and Word generate in the background. Excel lands in the next slice." → "...PDF, Word, and Excel generate in the background and appear in the jobs tray when ready." The stale "lands in the next slice" promise is gone (it landed); the jobs-tray async model is now spelled out for the user. Sensible + truthful. ✓
- **(e) Responsive — unchanged.** Buttons still in `flex flex-wrap gap-2`; the now-active Excel button wraps cleanly at 320px like the others. No new overflow.
- **VERDICT: PASS.** All 4 client-report buttons live, tokens-only, single-primary hierarchy, shared-pending disable correct, a11y improved, copy de-staled. xlsx renderer internals = CEO/Principal domain. No design-system violation, no BLOCK. (DPDP-retention + worker-observability carries are CEO-tracked.)
