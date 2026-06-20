# Whole-App Cross-Cutting Sweeps

_The 4 specialist sweeps that look across the entire `apps/web/src` tree (vs the per-page audits). `tokens` ran in the first pass; `tables`/`a11y`/`reuse` ran in the completion pass after the cap reset._

## tables

Audited every list/table surface under apps/web/src. The Universal DataGrid (apps/web/src/components/ui/data-grid/DataGrid.tsx) is the table of record and is used by ALL 19 paginated list pages (Cases, Pipeline, Billing, Dedupe, FieldMonitoring, CommissionRates, RateManagement, Locations, Departments, Designations, VerificationUnits, Templates, ReportLayouts, Policies, Roles, CPV, Users, plus MasterDataCrud → Clients/Products). Bespoke <table> usage is confined to (a) detail/child surfaces inside a single case or expanded row, (b) modal history/preview tables, and (c) one dashboard rollup — none of which are paginated list views, so being bespoke is defensible. DataGrid centrally provides sortable/hideable columns, per-column + date-range + Excel-multiselect filters, URL state (q/sort/dir/page/size/cols/f_*), page/limit pagination reading totalCount/totalPages, bulk row-select + "select all N matching", and export via apiExport with 413/EXPORT_TOO_LARGE + background-job (ADR-0030) handling. Findings are PARITY GAPS where a list page omits an opt-in DataGrid capability it plausibly should expose (export, column filters, bulk-select, date filters, import) — all are page-level feature decisions, not primitive defects. No P0/P1 issues; the table layer is consistent and standards-compliant.

## Tables & Data Parity Matrix (apps/web/src)

Legend: ✅ present · ➖ N/A by design · ❌ absent (potential gap) · DG = uses shared DataGrid

### A. Paginated list pages (DataGrid)
| Page (file) | DataGrid | Filters (col/date/status) | URL-state | Pagination (limit/offset+totalCount) | Export (apiExport+413/job) | Import (ImportModal) | Bulk-select |
|---|---|---|---|---|---|---|---|
| Cases `features/cases/CasesPage.tsx:74` | ✅ | col✅ status-filterOpt✅ / date❌ | ✅ | ✅ | ❌ | ➖ | ❌ |
| Pipeline `features/pipeline/PipelinePage.tsx:257` | ✅ | col✅ / date✅ / status=bucket-bar✅ | ✅ | ✅ | ✅ | ➖ | ✅ (bulk-assign) |
| Billing `features/billing/BillingPage.tsx:286` | ✅ | client-toolbar✅ / date✅ / col❌ | ✅ | ✅ | ✅ | ➖ | ❌ |
| Dedupe `features/dedupe/DedupePage.tsx:178` | ✅ (searchable=false) | external form✅ / col❌ date❌ | ✅ | ✅ | ✅ | ➖ | ➖ |
| FieldMonitoring `features/fieldMonitoring/FieldMonitoringPage.tsx:179` | ✅ | ❌ (none) | ✅ | ✅ | ✅ | ➖ | ➖ |
| CommissionRates `features/commissionRates/CommissionRatesPage.tsx:459` | ✅ | status✅ / date✅ / col❌ | ✅ | ✅ | ✅ | ✅ | ❌ (no bulk route) |
| RateManagement `features/rateManagement/RateManagementPage.tsx:303` | ✅ | col✅ / date✅ / client+product toolbar✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Locations `features/locations/LocationsPage.tsx:296` | ✅ | col✅ / date✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Departments `features/departments/DepartmentsPage.tsx:114` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Designations `features/designations/DesignationsPage.tsx:120` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| VerificationUnits `features/verificationUnits/VerificationUnitsPage.tsx:178` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Templates `features/templates/TemplatesPage.tsx:128` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| ReportLayouts `features/reportLayouts/ReportLayoutsPage.tsx:794` | ✅ | ❌ col / ❌ date | ✅ | ✅ | ❌ | ➖ | ❌ |
| Policies `features/policies/PoliciesPage.tsx:103` | ✅ | col✅ / date✅ | ✅ | ✅ | ❌ | ➖ | ❌ |
| Roles `features/access/RolesPage.tsx:198` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ➖ | ❌ (no bulk route) |
| CPV `features/cpv/CpvPage.tsx:310` | ✅ (master-detail) | col✅ / date✅ | ✅ | ✅ | ✅ | ✅ | ➖ (expand, not select) |
| Users `features/users/UsersPage.tsx:232` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ (+scope export) | ✅ (+scope import) | ✅ |
| Clients `features/clients/ClientsPage.tsx` → MasterDataCrud `components/MasterDataCrud.tsx:140` | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Products `features/products/ProductsPage.tsx` → MasterDataCrud | ✅ | col✅ / date✅ / status✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### B. Bespoke <table>/list surfaces (NOT paginated list views — bespoke is justified)
| Surface (file:line) | Kind | Why bespoke is OK |
|---|---|---|
| PortfolioTable `features/dashboard/components/PortfolioTable.tsx:34` | Dashboard rollup (client×product), full unpaginated result | small bounded rollup, own empty/loading/error states; not a browse list |
| CaseDetailPage Applicants `features/cases/CaseDetailPage.tsx:143` | Case-detail child table | bounded per-case set; detail surface |
| CaseDetailPage Tasks `…CaseDetailPage.tsx:462` | Case-detail tasks + inline action accordions + tab filter | bounded per-case; rich inline mutate forms |
| CaseDetailPage Attachments `…CaseDetailPage.tsx:1107` | Case-detail child table | bounded per-case |
| CaseCreatePage dedupe preview `features/cases/CaseCreatePage.tsx:295` | Transient inline dedupe-match preview | bounded, one-shot during creation |
| Billing expanded lines `features/billing/BillingPage.tsx:43` + breakdown panels `:122,:165` | Accordion detail + group-by rollups | nested under DataGrid row / aggregate summaries |
| CPV UnitManager `features/cpv/CpvPage.tsx:463` | Expanded-row child editor | bounded child of one CPV link |
| RateManagement HistoryDialog `features/rateManagement/RateManagementPage.tsx:671` | Modal rate-history | bounded, modal read-only |
| Users PolicyAcceptances `features/users/UsersPage.tsx:868` / Profile `features/profile/ProfilePage.tsx:274` | Read-only acceptance log | bounded per-user log inside dialog/card |
| ImportModal preview/errors `components/import/ImportModal.tsx:213,:241` | Import sample + error tables | bounded sample/errors inside import flow |
| SessionList `components/SessionList.tsx:38` | <ul> session cards (not a table) | small device list, dedicated component |

### Findings (6)

**[P2] Cases list (the highest-traffic operational browse) has no Export and no date filters**
- Scope: apps/web/src/features/cases/CasesPage.tsx:74-85
- Evidence: CasesPage renders DataGrid with columns/queryKey/fetchPage/onRowClick only — no `exportFn` and no `dateFilters` props. Peer browse pages (Pipeline PipelinePage.tsx:275, Billing BillingPage.tsx:301-303, Dedupe DedupePage.tsx:189) all wire `apiExport` + a `createdAt` date filter. Cases is the primary case-browse surface yet operators cannot export the filtered case list to XLSX/CSV nor narrow by a created-date window, despite the DataGrid supporting both for free once an endpoint exists.
- Fix: If `/api/v2/cases/export` exists (mirror cases/dedupe-search/export pattern), add `exportFn={(req)=>apiExport('/api/v2/cases/export?'+exportQueryToParams(req))}` and `dateFilters={[{id:'createdAt',label:'Created'}]}` to the DataGrid. If the export endpoint does not exist, this is a backend additive gap to register; FE wiring is a one-line change otherwise.

**[P3] ReportLayouts (MIS Layouts) list omits Export, date filters, and any column/header filters**
- Scope: apps/web/src/features/reportLayouts/ReportLayoutsPage.tsx:794-808
- Evidence: The DataGrid here passes no `exportFn`, no `dateFilters`, and none of its columns set `filterable` (columns defined at :718-773 — client/product/kind/name are plain `sortable` only). Comparable config catalogs (Roles RolesPage.tsx:208-209, Templates TemplatesPage.tsx:59-65,144) expose per-column filters + export. Admins browsing many per-(client,product) layouts cannot filter by client/product/kind in-grid nor export the catalog.
- Fix: Add `filterable: true` to the client/product/name columns and `filterOptions` (LAYOUT_KINDS) to the kind column; add `dateFilters={[{id:'createdAt',label:'Created'}]}`; wire `exportFn` if `/api/v2/report-layouts/export` is available. All are additive DataGrid props.

**[P3] Billing & CommissionRates lists lack per-column header filters despite wide, browse-heavy grids**
- Scope: apps/web/src/features/billing/BillingPage.tsx:221-272; apps/web/src/features/commissionRates/CommissionRatesPage.tsx:328-431
- Evidence: Neither grid sets `filterable` on any column. Billing columns (caseNumber/client/product/status/...) and CommissionRates columns (user/client/rateType/product/unit/location/...) are only `sortable`. Cases (CasesPage.tsx:25-49) and Pipeline (PipelinePage.tsx:103-139) prove the pattern (free-text + filterOptions header filters with server `f_*` whitelisting). On Billing the client picker is a toolbar select only; status/product cannot be header-filtered.
- Fix: Mark high-cardinality identity columns `filterable: true` (e.g. Billing caseNumber/client/product; CommissionRates user/client) and add `filterOptions` to enum columns (Billing status, CommissionRates classification). Server PageSpec.filterMap must whitelist each `<id>` (per DataGrid §6) — verify the endpoint supports the filter before enabling, else the filter is silently ignored.

**[P3] FieldMonitoring roster exposes no filters at all (no column filters, no date filters)**
- Scope: apps/web/src/features/fieldMonitoring/FieldMonitoringPage.tsx:179-191
- Evidence: The DataGrid receives no `dateFilters` and no column sets `filterable` (columns at :46-150 are sortable/plain). The only narrowing is the global search box. Supervisors monitoring large field teams cannot filter by territory or last-activity window in-grid; export is present (:189) but is unfiltered beyond search/sort.
- Fix: Add `dateFilters={[{id:'lastActivityAt',label:'Last Activity'},{id:'createdAt',label:'Created'}]}` and mark name/phone/territory columns `filterable` where the `/field-monitoring/agents` PageSpec whitelists them. Additive only.

**[P3] Policies admin list has no Export and no Import despite being a managed catalog**
- Scope: apps/web/src/features/policies/PoliciesPage.tsx:103-113
- Evidence: PoliciesPage's DataGrid passes only a `dateFilters` for effectiveFrom; there is no `exportFn` and no `ImportButton` in the header (header at :96-100 has only '+ New Policy'). Other admin catalogs (Templates, Roles, Users, all MasterDataCrud entities) provide export and most provide import. Policies are versioned compliance records (ADR-0043) where an exportable audit list is plausibly expected.
- Fix: Add `exportFn` if `/api/v2/policies/export` exists. Import is likely intentionally absent (policy content is authored, not bulk-loaded) — treat that as WONTFIX unless owner wants bulk policy seeding. Confirm with the domain owner; register the decision in COMPLIANCE_GAPS_REGISTRY.

**[P3] PortfolioTable is a hand-rolled <table> with its own loading/empty/error states, duplicating DataGrid affordances**
- Scope: apps/web/src/features/dashboard/components/PortfolioTable.tsx:34-70
- Evidence: PortfolioTable builds a bespoke `<table className="rtable">` plus its own isError/isLoading/empty branches (:23-33) and an inline CompletionBar. It fetches the FULL rollup unpaginated (`api<PortfolioRow[]>('GET','/api/v2/dashboard/portfolio')`, :12-14). This is a defensible dashboard summary (not a browseable list), but it re-implements skeleton/empty/error UX the DataGrid already standardizes, and would not scale if a scope ever returns many client×product rows.
- Fix: Acceptable as-is for a bounded dashboard rollup (no sort/filter/page needed). If portfolio cardinality grows, migrate to DataGrid with a non-paginated/large `limit` or a dedicated paginated endpoint. Otherwise WONTFIX — record rationale (dashboard rollup, intentionally bespoke) in the registry.

## a11y

Accessibility is broadly strong and pattern-driven in apps/web: there is a single shared useFocusTrap (lib/useFocusTrap.ts) that handles focus-in-on-open, cyclic Tab trapping, Escape, and focus-restore, and 15 of 16 role="dialog" surfaces use it plus aria-labelledby. The DataGrid (the universal table) is exemplary — its horizontal scroll wrapper has tabIndex=0+role="group"+aria-label, its menus/exports use role=menu+aria-haspopup+aria-expanded, headers carry aria-sort, and bulk bar/loader use role=region/status+aria-live. All <img> tags have correct alt (decorative avatar alt="" sits inside a labelled button). Inputs use the implicit-label pattern (control nested in <label> with a <span>), which is valid. CI enforces a real axe gate (e2e/a11y.spec.ts, gate 29: fails on serious/critical WCAG 2.0/2.1 A+AA across 13 pages + one open modal + the mobile drawer), a focus-trap/Escape gate (layout.spec.ts + datagrid.spec.ts), and a no-horizontal-overflow/responsive gate (viewport.spec.ts). The gaps are: (1) ONE dialog — CommissionRatesPage — is the lone outlier with no focus trap, no Escape, and no accessible name; (2) the bespoke (non-DataGrid) horizontally-scrollable table wrappers omit the tabIndex/role/aria-label that the DataGrid applies; (3) no <th> anywhere carries scope=; (4) several routes (notably /cases/:id, /cases/new, /dashboard, /profile, /security, /admin/{departments,designations,policies}, /dedupe, /field-monitoring) are NOT in the axe gate's page list, so their a11y is unenforced; (5) the three header dropdown popovers (UserMenu, NotificationBell, JobsTray) are non-modal menus with Escape+labelled triggers but no role=menu/menuitem and no focus-in-on-open.

### Findings (5)

**[P1] CommissionRatesPage dialog is the only modal with NO focus trap, NO Escape, and NO accessible name**
- Scope: apps/web/src/features/commissionRates/CommissionRatesPage.tsx
- Evidence: CommissionRateDialog renders role="dialog" aria-modal="true" at lines 122-126 but (a) does NOT import or call useFocusTrap (grep: it is the ONLY file with role="dialog" missing useFocusTrap), so focus is never moved into it on open, Tab is not trapped, and focus is not restored to the trigger on close; (b) has no onKeyDown/Escape handler anywhere in the file (grep for 'Escape' = none) — it can only be dismissed via the Cancel button (line 283) or after a save (onClose at line 106); (c) carries aria-modal="true" but no aria-labelledby/aria-label, and its <h2> title (lines 127-129) has no id, so the dialog has no accessible name. Every other dialog (15/16) uses useFocusTrap + aria-labelledby pointing at its h2 (e.g. RolesPage.tsx:360-361, UsersPage.tsx:593-594, MasterDataCrud.tsx:247-248). The carried-OPEN focus-trap/Escape behaviour proven by datagrid.spec.ts:232-246 is therefore broken specifically here. Note: /admin/commission-rates IS in a11y.spec PAGES (line 34) but axe only scans it CLOSED — the open dialog is never axe-checked, so the gate does not catch this.
- Fix: Mirror the universal pattern used by every other dialog: const ref = useFocusTrap<HTMLDivElement>(true, onClose); attach ref to the role="dialog" div; add aria-labelledby="commission-rate-dialog-title" and give the <h2> id="commission-rate-dialog-title". This gives focus-in/trap/restore + Escape-to-close + an accessible name in one change, with zero new abstraction.

**[P2] Bespoke horizontally-scrollable table wrappers are not keyboard-focusable (axe scrollable-region-focusable / WCAG 2.1.1)**
- Scope: apps/web/src/features/cases/CaseDetailPage.tsx, apps/web/src/features/cases/CaseCreatePage.tsx, apps/web/src/features/profile/ProfilePage.tsx, apps/web/src/features/users/UsersPage.tsx, apps/web/src/components/import/ImportModal.tsx
- Evidence: The DataGrid scroll region is correctly made keyboard-reachable: DataGrid.tsx:654-657 sets className="overflow-x-auto …" tabIndex={0} role="group" aria-label="Table (scroll horizontally)" (comment at line 651 cites the axe rule). The bespoke (non-DataGrid) overflow-x-auto wrappers do NOT replicate this: CaseDetailPage.tsx:139, :410, :1071 (members table, tasks table, attachments table), CaseCreatePage.tsx:285 (preview table), ProfilePage.tsx:273, UsersPage.tsx:867, and ImportModal.tsx:240 (max-h-48 overflow-x-auto) are all plain <div className="overflow-x-auto …"> with no tabIndex/role/aria-label (verified per-line). A keyboard-only user cannot scroll these regions when their content overflows. ImportModal's wrapper sits inside a focus-trapped dialog, so it is the lowest-risk of the set.
- Fix: Apply the same triple the DataGrid uses — tabIndex={0} role="group" aria-label="… (scroll horizontally)" — to each bespoke overflow-x-auto wrapper, or route these tables through the shared DataGrid where feasible. CaseDetailPage's three tables are the priority (it is the busiest bespoke page).

**[P2] Key operational routes are excluded from the axe a11y gate — most notably /cases/:id (CaseDetailPage)**
- Scope: apps/web/e2e/a11y.spec.ts (PAGES list, lines 17-36) vs apps/web/src/App.tsx (routes, lines 62-88)
- Evidence: a11y.spec.ts scans 13 routes plus one open modal and the mobile drawer. App.tsx defines these additional routes that are NOT in that list and therefore have zero serious/critical axe enforcement: /dashboard (63), /admin/departments (73), /admin/designations (74), /admin/policies (78), /security (79), /profile (80), /field-monitoring (82), /dedupe (83), /cases/new (85), /cases/:id (86). /admin/locations is deliberately omitted with a documented reason (a11y.spec.ts:22-25), but the others are silently uncovered. /cases/:id is the largest bespoke-table page and is exactly where the scroll-region gap above lives — so the gate cannot catch P2-scroll regressions there. viewport.spec.ts also omits these same routes (its PAGES, lines 21-37, do not include /cases/:id, /cases/new, /dashboard, /profile, /security, /dedupe, /field-monitoring, departments, designations, policies).
- Fix: Add the uncovered routes (especially /cases/:id, /cases/new, /dashboard, /profile, /security) to a11y.spec.ts PAGES and viewport.spec.ts PAGES, following the existing per-page loop. If any page needs auth-state/seed setup, reuse auth.setup.ts and the e2e seed already wired in ci.yml. Document any deliberate omission inline the way /admin/locations is.

**[P3] No data table sets scope="col" on header cells (table semantics)**
- Scope: apps/web/src/components/ui/data-grid/DataGrid.tsx, apps/web/src/features/cases/CaseDetailPage.tsx, apps/web/src/features/cases/CaseCreatePage.tsx, apps/web/src/features/rateManagement/RateManagementPage.tsx, apps/web/src/features/billing/BillingPage.tsx, apps/web/src/features/dashboard/components/PortfolioTable.tsx, apps/web/src/features/profile/ProfilePage.tsx, apps/web/src/features/users/UsersPage.tsx, apps/web/src/features/cpv/CpvPage.tsx
- Evidence: grep 'scope=' across apps/web/src returns zero matches. All tables use real <table>/<thead>/<th> markup (e.g. DataGrid.tsx:659-704 header row at 681; CaseDetailPage.tsx:146-150, 465-477, 1110-1116; PortfolioTable.tsx:37-42) but none declare scope="col" on the column headers. For simple single-header-row tables this is not an axe serious/critical violation (hence the gate stays green), but it weakens the programmatic header-to-cell association for screen readers.
- Fix: Add scope="col" to the <th> column headers. Highest leverage is the universal DataGrid header (DataGrid.tsx:681) which fixes every grid-driven page at once; then the bespoke tables. Low risk, no behaviour change.

**[P3] Header dropdown popovers (UserMenu, NotificationBell, JobsTray) lack menu semantics and do not move focus into the panel on open**
- Scope: apps/web/src/components/UserMenu.tsx, apps/web/src/components/NotificationBell.tsx, apps/web/src/components/JobsTray.tsx
- Evidence: All three are non-modal dropdowns with a correctly labelled trigger (UserMenu.tsx:77-78 aria-label="Account menu"+aria-expanded; NotificationBell.tsx:83-84 aria-label+aria-expanded; JobsTray.tsx:96-97 aria-label+aria-expanded) and document-level Escape-to-close (UserMenu.tsx:56, NotificationBell.tsx:66, JobsTray.tsx:70). However the open panels declare no role="menu"/role="menuitem" (grep role="menu" = 0 in all three) — e.g. UserMenu.tsx:89-121 is a plain <div> of <button>s — and none call useFocusTrap or otherwise move focus into the panel on open, so the panel content is only reachable by continuing to Tab past the trigger (no arrow-key menu navigation, no focus containment). Contrast the DataGrid menus which DO use role="menu"+useFocusTrap (DataGrid.tsx:461,527; SavedViewsPicker.tsx). This is below the axe serious/critical bar (these are valid focusable buttons), so it is a polish/consistency gap rather than a blocker.
- Fix: For consistency with the DataGrid menus, add role="menu"/role="menuitem" to the panels and move initial focus to the first item on open (the lighter option), or adopt useFocusTrap if menu modality is desired. Verify against axe after the change. Lowest priority of the set.

## reuse

Component-reuse / no-bespoke sweep of apps/web/src (76 files, worktree @ origin/main 11997a1). The shared primitives are well-adopted overall: DataGrid backs every main list, useFocusTrap covers all dialogs but one, format.ts/formatDateTime is used in 27 files, HexagonLoader and useLoadingBand power the grid. The real reuse gaps are NOT in the big primitives — they are in MISSING small primitives that pages reinvent: (1) NO shared status-tone badge → three duplicate STATUS_TONE/CASE_STATUS_TONE maps + the identical `rounded px-2 py-0.5 text-xs font-medium ${tone}` badge string copied across pipeline/case-detail/dedupe + two hand-rolled ACTIVE/INACTIVE chips that duplicate StatusChip's logic; (2) NO money formatter in format.ts → `const money = n => ₹${n.toFixed(2)}` defined three times; (3) NO shared Tabs → two byte-identical bespoke tablists. Plus one genuine a11y reuse defect: CommissionRatesPage's modal is the ONLY role=dialog overlay that does not use useFocusTrap. Remaining items (raw detail tables, "Loading…" text loaders, one bespoke button) are lower-severity judgment calls. All findings are AUDIT-ONLY with file:line evidence; nothing was edited.

### Findings (8)

**[P1] CommissionRatesPage modal is the only role=dialog without useFocusTrap (a11y reuse defect)**
- Scope: apps/web/src/features/commissionRates/CommissionRatesPage.tsx:121-126
- Evidence: The rate-edit modal renders `<div className="fixed inset-0 z-50 ..."><div role="dialog" aria-modal="true" ...>` with NO ref to useFocusTrap — no Escape-to-close, no Tab cycle trap, no focus restore, no click-outside backdrop. It is the ONLY file in the dialog set missing the hook: `comm -23 <(dialog files) <(useFocusTrap importers)` returns exactly this file. Every other dialog (RateManagement HistoryDialog at RateManagementPage.tsx:646, PolicyDialog, VerificationUnitDialog, ConflictDialog, MasterDataCrud, all the master-data pages) calls `useFocusTrap<HTMLDivElement>(true/open, onClose)`. The shared primitive is apps/web/src/lib/useFocusTrap.ts.
- Fix: Adopt useFocusTrap: `const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);` and put `ref={dialogRef}` on the role=dialog div, matching RateManagementPage.tsx:646-659 (its byte-identical HistoryDialog already does this correctly). Add aria-labelledby on the heading too for parity.

**[P2] Status-badge tone logic duplicated 3× — no shared status-tone badge primitive**
- Scope: apps/web/src/features/pipeline/PipelinePage.tsx:28-36,150 · apps/web/src/features/cases/CaseDetailPage.tsx:59-66,116 · apps/web/src/features/dedupe/DedupePage.tsx:21-26,85
- Evidence: Three separate `STATUS_TONE`/`CASE_STATUS_TONE` Record<string,string> maps to the same `bg-st-*-bg text-st-*` token pairs (PipelinePage.tsx:28, CaseDetailPage.tsx:59, DedupePage.tsx:21) and the same render string `className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[s] ?? 'bg-surface-muted'}`}` (PipelinePage.tsx:150, CaseDetailPage.tsx:116, DedupePage.tsx:85). StatusChip.tsx exists but is hard-scoped to master-data ACTIVE/SCHEDULED/INACTIVE only ({isActive, effectiveFrom} API), so case/task statuses can't reuse it. CasesPage.tsx:50 renders status as bare text (`c.status.replace(/_/g,' ')`) — a 4th, inconsistent treatment of the same data.
- Fix: Add a shared workflow-status badge (e.g. extend StatusChip or add a sibling `<WorkStatusChip status=… />` in components/) that owns the canonical status→token map and the `rounded px-2 py-0.5 text-xs font-medium` chrome, then have pipeline/case-detail/dedupe (and CasesPage) consume it. Eliminates the 3 maps and the drift between them (e.g. dedupe map lacks ASSIGNED/SUBMITTED that pipeline has).

**[P2] Money formatter reimplemented 3× — format.ts has no currency helper**
- Scope: apps/web/src/features/commissionRates/CommissionRatesPage.tsx:25 · apps/web/src/features/rateManagement/RateManagementPage.tsx:28 · apps/web/src/features/billing/BillingPage.tsx:20,22-23
- Evidence: `const money = (n: number) => `₹${n.toFixed(2)}`;` appears verbatim at CommissionRatesPage.tsx:25 and RateManagementPage.tsx:28; BillingPage.tsx:20 is the same with a null guard plus a near-clone `lineMoney` at :22-23. lib/format.ts is the documented single source for display formatters (header comment: "Single source so every management/admin list renders … identically") but exports only date helpers — no money fn. Confirmed no money/currency formatter exists in apps/web/src/lib/ nor is one exported for display from packages/sdk.
- Fix: Add `export function formatMoney(n: number | null): string` (₹ + 2dp, '—' for null) to apps/web/src/lib/format.ts and import it in all three pages; drop the local `money`/`lineMoney` definitions.

**[P3] Bespoke tablist duplicated — no shared Tabs primitive**
- Scope: apps/web/src/features/cases/CaseDetailPage.tsx:438-461 · apps/web/src/features/users/UsersPage.tsx:600-616
- Evidence: Two hand-rolled `<div role="tablist">` with `.map` over `[key,label]` rendering `<button role="tab" aria-selected={…} className={`px-3 py-1.5 text-sm font-medium ${active ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>`. The active-marker class string is byte-identical between the two files (grep for `border-b-2 border-primary` returns only these two). No shared Tabs component exists in components/.
- Fix: Extract a small `<Tabs>`/`<TabList>` primitive into components/ (carry the role=tablist/role=tab + aria-selected + active underline), or at minimum a shared `tabButtonClass(active)` helper, and consume it in both pages. Low effort, prevents further copies as more tabbed detail views are added.

**[P3] Section/page loaders use bare "Loading…" text instead of HexagonLoader**
- Scope: apps/web/src/features/cases/CaseDetailPage.tsx:101 · apps/web/src/features/system/SystemPage.tsx:36 · apps/web/src/features/profile/ProfilePage.tsx:267,319 · apps/web/src/features/users/UsersPage.tsx:861 · apps/web/src/features/cpv/CpvPage.tsx:478 · apps/web/src/components/SessionList.tsx:34 · apps/web/src/components/NotificationBell.tsx:112
- Evidence: These render `<p className="text-sm text-muted-foreground">Loading…</p>` (or a table loading row at CpvPage.tsx:478) as the section/page busy state. PAGINATION_AND_LOADING_STANDARDS designates HexagonLoader (apps/web/src/components/ui/HexagonLoader.tsx) as 'the ONE platform loader' and useLoadingBand for the time bands; BillingPage.tsx:37 and JobsTray already use `<HexagonLoader operation=…/>` correctly. (Button-label 'Loading…' uses at PipelinePage.tsx:381, AddTasksForm.tsx:378, CaseDetailPage.tsx:816 are fine — not loaders.)
- Fix: Replace the section/page-level `<p>Loading…</p>` with `<HexagonLoader operation="Loading …"/>` (optionally gated via useLoadingBand to avoid sub-300ms flicker), matching BillingPage.tsx:37. App.tsx:48's pre-mount full-screen gate is borderline-acceptable as bare text but could also adopt it for consistency.

**[P3] Hand-rolled ACTIVE/INACTIVE chips duplicate StatusChip's two-state logic (with tone drift)**
- Scope: apps/web/src/features/rateManagement/RateManagementPage.tsx:39-49 · apps/web/src/features/reportLayouts/ReportLayoutsPage.tsx:734-740 · apps/web/src/features/verificationUnits/VerificationUnitsPage.tsx:32-38
- Evidence: RateManagementPage `ActiveChip` (:39) and ReportLayoutsPage status cell (:734) both render an ACTIVE/INACTIVE badge with `rounded px-2 py-0.5 text-xs font-medium` + `bg-st-approved-bg text-st-approved` for active — identical to StatusChip.tsx's ACTIVE branch — but the INACTIVE tone drifts: StatusChip uses `bg-muted text-muted-foreground`, RateManagement uses `bg-muted…`, ReportLayouts uses `bg-surface-muted…`. VerificationUnitsPage:32 is a sibling kind-badge using the same chrome string. StatusChip's `{isActive, effectiveFrom}` API doesn't fit these (no effectiveFrom), which is why they reinvented it.
- Fix: Either generalize StatusChip to accept a plain status/active prop (so these can call it) or extract the shared badge chrome+token map; at minimum align the INACTIVE token to StatusChip's `bg-muted text-muted-foreground` to kill the drift.

**[P3] Bespoke button skin instead of .btn-ghost utility**
- Scope: apps/web/src/features/fieldMonitoring/FieldMonitoringPage.tsx:244
- Evidence: The 'Request location' button uses `className="whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"` — a one-off near-clone of the shared `.btn-ghost` utility (index.css:17: `rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-50`).
- Fix: Use `className="btn-ghost text-xs"` (add size override only if the smaller padding is required), matching the dozens of other ghost buttons across the app.

**[P3] Small detail/summary tables hand-roll table chrome (no DataGrid) — judgment-call**
- Scope: apps/web/src/features/cpv/CpvPage.tsx:463-481 · apps/web/src/features/dashboard/components/PortfolioTable.tsx:34 · apps/web/src/features/cases/CaseCreatePage.tsx:295 · apps/web/src/features/profile/ProfilePage.tsx:274 · apps/web/src/features/users/UsersPage.tsx:868 · apps/web/src/features/rateManagement/RateManagementPage.tsx:671
- Evidence: These raw `<table className="rtable…">` reimplement the DataGrid thead chrome by hand (sticky `bg-surface-muted … uppercase tracking-wide` header, hover:bg-row-hover rows, manual loading row — e.g. CpvPage.tsx:463-481 even hand-codes a `colSpan` Loading… row). DataGrid.tsx is the documented 'ONE table for the platform'. HOWEVER these are bounded, non-paginated detail/summary/result views (dedupe matches, policy acceptances, portfolio rollup, rate history dialog, CPV enabled-units sub-list) where DataGrid's server-pagination/URL-state machinery is overkill, and BillingPage's raw tables (43/122/165) are correctly nested inside a DataGrid renderExpanded. Flagged as a consistency note, not a clear violation.
- Fix: Leave as raw tables where the dataset is bounded/non-paginated (over-adopting DataGrid would be its own anti-pattern), but consider a tiny shared `<SimpleTable>`/header-chrome helper to stop each from re-deriving the `bg-surface-muted uppercase tracking-wide` thead + skeleton row. Only CpvPage.tsx:463 (a growing enabled-units list with its own add-form) is a plausible future DataGrid candidate.

