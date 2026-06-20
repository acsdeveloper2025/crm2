# Canonical V2 Frontend Design & Standards Checklist

_Phase-1 distillation from the freeze/standards docs + the actual shared primitives. Each dimension has a binary PASS rule and the exact primitive a page MUST reuse._

## 1. Design tokens
**PASS rule:** Every color comes from a semantic Tailwind token mapped from @crm2/ui-theme (bg-background, text-foreground, bg-card, bg-primary[-hover/-muted], text/bg-secondary, text/bg-muted-foreground, border-border[-strong], ring, bg-accent, text/bg-destructive/success/warning/info, the 8 status pairs text-st-<name>/bg-st-<name>-bg/border-st-<name> for pending|assigned|in-progress|submitted|under-review|approved|rejected|revisit, row-hover/row-selected/row-selected-border, chart-1..6). ZERO hardcoded #hex/rgb/hsl/named colors, ZERO arbitrary color classes (text-[#..]/bg-[#..]/[color:..]), ZERO slate-*/gray-* utilities, and ZERO dark: overrides (the .dark selector swaps variable values; class names stay identical). Elevation only shadow-sm/md/lg; radius via rounded-md/lg/sm.

**Reuse primitive:** @crm2/ui-theme tokens (tokens.css CSS vars + tailwind-preset.js token map) — the ONLY color source; consumed via apps/web/src/index.css

**Ref:** `packages/ui-theme/src/tokens.css:15-181; packages/ui-theme/tailwind-preset.js:14-69; apps/web/src/index.css:1-8`

## 2. Standard table
**PASS rule:** Every data list renders through the one Universal DataGrid (DataGrid<T> with columns:DataGridColumn<T>[], fetchPage, queryKey, rowId). NO bespoke <table> for data lists (the only allowed raw <table> are non-list chrome like the import preview grid). Columns are sortable (col.sortable → server sortBy, aria-sort on <th>), hideable (Columns menu, col.hideable), and the grid is selectable with bulkActions where rows support actions. Server-side only: manualPagination/Sorting/Filtering, no client-side filter/sort of operational data.

**Reuse primitive:** DataGrid (Universal DataGrid, TanStack Table)

**Ref:** `apps/web/src/components/ui/data-grid/DataGrid.tsx:79-154 (props), :318-333 (TanStack table, manual* flags), :659-832 (table render)`

## 3. Filters
**PASS rule:** List uses the DataGrid filter surface: global free-text search box (URL key q, 300ms debounce), per-column filters (col.filterable → f_<id> text input; col.filterOptions → Excel-style multi-select committed comma-joined to f_<id>), optional dateFilters (f_<id>_from / f_<id>_to), and page-level domain filters merged via the filters prop. All filter/search/page/sort/column state persists in the URL (q · sort · dir · page · size · cols · f_*) so a bookmarked URL reproduces the exact screen; new grids reuse these canonical keys, never invent per-page params.

**Reuse primitive:** DataGrid URL-state + ColumnFilterInput/ColumnFilterSelect + dateFilters

**Ref:** `apps/web/src/components/ui/data-grid/DataGrid.tsx:157-189 (q/sort/dir/page/size URL state + debounce), :216-238 (f_<id> column + date filters), :867-965 (ColumnFilterInput/ColumnFilterSelect)`

## 4. Pagination
**PASS rule:** List is server-paginated via the shared contract: request sends PageQuery {page, limit, search, sortBy, sortOrder, filters} and consumes the single envelope Paginated<T> {items, totalCount, page, pageSize, totalPages, sort, filters}. limit is one of PAGE_SIZES [25,50,100,200] (default 25; MAX 500 for MIS/reporting only; >500 rejected). Rows-per-page selector + Previous/Next pager + a 'N rows · Page X of Y' count are rendered; no unbounded fetch and no custom pagination shape.

**Reuse primitive:** DataGrid pager wired to @crm2/sdk pagination constants/envelope (PageQuery / Paginated / PAGE_SIZES / DEFAULT_PAGE_SIZE / MAX_PAGE_SIZE)

**Ref:** `apps/web/src/components/ui/data-grid/DataGrid.tsx:163-165 (PAGE_SIZES/DEFAULT_PAGE_SIZE), :836-858 (pager); packages/sdk/src/pagination.ts:6-9`

## 5. Import/Export
**PASS rule:** Export is the DataGrid's responsibility only (no module writes its own export): page passes exportFn → toolbar Export menu offering Current view + All matching × XLSX/CSV (and Export Selected when selectable), all respecting active search/filters/sort/visible cols; transport is apiExport which returns kind:'file' for sync (<10k) and kind:'job' (HTTP 202) when totalCount ≥ EXPORT_JOB_THRESHOLD=10000 (server throws 413 EXPORT_TOO_LARGE), surfaced via the Jobs tray + toast. Import (where the domain supports it) uses the one ImportButton/ImportModal flow (download template → upload → preview errors → confirm → background/result) via apiBlob/apiUpload — never a bespoke import.

**Reuse primitive:** DataGrid exportFn + apiExport (job-threshold/413) for export; ImportButton/ImportModal + apiUpload/apiBlob for import

**Ref:** `apps/web/src/components/ui/data-grid/DataGrid.tsx:104-131 (exportFn prop), :256-301 (runExport, EXPORT_TOO_LARGE), :438-502 (Export menu); apps/web/src/lib/sdk.ts:134-161 (apiExport 202/job), :168-197 (apiUpload); apps/web/src/components/import/ImportModal.tsx:39-49 (ImportButton), :53-127 (flow)`

## 6. Mobile-first / responsive
**PASS rule:** Page works mobile-up at 320/768/1024/1440 with no horizontal page overflow: grids start single-column (grid-cols-1 md:.. — never bare grid-cols-N), toolbar/filter rows flex-wrap, dialogs are w-full + max-w-* + max-h-[90vh] overflow-y-auto. Tables use the DataGrid's responsive table→card strategy: below md the .rtable collapses each row to a stacked card and every <td> carries data-label (the column name). App nav collapses to a hamburger-driven overlay drawer below lg and is in-flow at lg+. Interactive controls meet ~44px touch targets.

**Reuse primitive:** DataGrid .rtable responsive table→card (index.css) + Layout responsive nav drawer

**Ref:** `apps/web/src/index.css:63-91 (.rtable card collapse + data-label); apps/web/src/components/ui/data-grid/DataGrid.tsx:417 (flex-wrap toolbar), :659 + :732/:813 (rtable + data-label cells); apps/web/src/components/Layout.tsx:149-178 (drawer <lg / lg:static)`

## 7. Accessibility
**PASS rule:** Every dialog/drawer/menu traps focus and restores it on close via useFocusTrap (dialogs role=dialog aria-modal aria-labelledby; menus role=menu aria-haspopup/aria-expanded). Sortable headers expose aria-sort; the horizontal-scroll table region is focusable (tabIndex=0 role=group aria-label) for axe scrollable-region-focusable; every input/checkbox/icon-button has a label or aria-label; live regions (aria-live) announce updating/selection; errors use role=alert. Color is never the sole signal and contrast meets the axe WCAG-AA gate (the CI a11y workflow is the bar). prefers-reduced-motion is honored.

**Reuse primitive:** useFocusTrap (dialogs/drawers/menus) + DataGrid aria wiring + HexagonLoader role=status

**Ref:** `apps/web/src/lib/useFocusTrap.ts:29-96; apps/web/src/components/ui/data-grid/DataGrid.tsx:653-657 (scrollable region focusable), :687 (aria-sort), :206/:255 (focus-trapped menus); apps/web/src/components/ConflictDialog.tsx:31-40; apps/web/src/components/ui/HexagonLoader.tsx:28-33`

## 8. States
**PASS rule:** Every async surface renders all four states consistently: Loading via the time-banded Hexagon system (0-300ms nothing → 300ms-1s skeleton rows → 1-3s HexagonLoader → 3-8s HexagonLoader+operation; >8s background job) using useLoadingBand + HexagonLoader (no spinners/progress bars/bouncing dots, never an empty white screen); Empty ('No records. Adjust your search or filters.' / distinguish no-data vs no-results); Error with a Retry affordance; and Permission (no-access) where RBAC applies. The DataGrid provides skeleton/empty/error inline; pages must not roll their own.

**Reuse primitive:** DataGrid loading/empty/error rows + useLoadingBand + HexagonLoader

**Ref:** `apps/web/src/components/ui/data-grid/DataGrid.tsx:726-764 (skeleton/loader/error/empty); apps/web/src/lib/useLoadingBand.ts:12-36; apps/web/src/components/ui/HexagonLoader.tsx:16-58`

## 9. Status & money & dates
**PASS rule:** Workflow/master-data status renders as a chip using the frozen status tokens (StatusChip for ACTIVE/SCHEDULED/INACTIVE → bg-st-approved-bg/text-st-approved, bg-st-pending-bg/text-st-pending, bg-muted/text-muted-foreground; other lifecycle statuses use the matching text-st-<name>/bg-st-<name>-bg pair, soft-bg+strong-fg, never color-only). Dates render via formatDateTime (DD Mon YYYY, HH:MM) — never ad-hoc toLocaleString. Money renders right-aligned in font-mono. NOTE: there is NO shared rupee/money formatter in lib/format.ts (it exports only formatDateTime/toDateInput/toIsoDate); BillingPage defines a local money() helper inline — a page using its own money formatter is a consistency gap to flag, and any '₹' formatting should be centralized.

**Reuse primitive:** StatusChip (status tokens) + formatDateTime (dates); money formatter MISSING from format.ts

**Ref:** `apps/web/src/components/StatusChip.tsx:4-13; apps/web/src/lib/format.ts:11-16 (formatDateTime, no money export); apps/web/src/features/billing/BillingPage.tsx:20-23 (bespoke inline money())`

## 10. Forms
**PASS rule:** Forms use react-hook-form + zodResolver against a schema imported from @crm2/sdk (never inline zod); inline field errors render below the field and submit shows a disabled/pending state. Editable inputs/textareas use the shared .input class and stay WYSIWYG (no uppercase/case mutation — case-sensitive data in font-mono/.case-sensitive). Every editable entity carries an OCC version token; a 409 STALE_UPDATE surfaces the shared ConflictDialog (reload & re-apply / discard) rather than silently overwriting; (de)activation is a version-guarded write.

**Reuse primitive:** ConflictDialog (OCC 409 handling) + .input class + RHF/zodResolver(@crm2/sdk) pattern

**Ref:** `apps/web/src/components/ConflictDialog.tsx:17-63; apps/web/src/components/MasterDataCrud.tsx:19-21 (STALE_UPDATE), :52-60 (version-guarded toggle); apps/web/src/index.css:11-13 (.input)`

## 11. RBAC-gated UI
**PASS rule:** Permission-gated columns/actions/buckets/nav mirror the server permission codes exactly (no client-only gating leak): gating uses useAuth() with has(perm) = user.grantsAll === true || user.permissions.includes(perm); nav items carry the SAME permission their page's read endpoint enforces (a route the user would be 403'd from is not shown). Gating is UX-only — the server re-validates; menu visibility ≠ data scope.

**Reuse primitive:** useAuth (AuthContext) + Layout nav perm map (has(perm) pattern)

**Ref:** `apps/web/src/lib/AuthContext.tsx:135 (useAuth); apps/web/src/components/Layout.tsx:35-62 (perm-tagged nav), :44-45 (mirror-the-API comment), :83 (has); apps/web/src/features/dashboard/DashboardPage.tsx:23-24 (has helper), :83 (gated bucket)`

## 12. Component reuse / no bespoke
**PASS rule:** All UI is assembled from the shared owned-in-app set — DataGrid for tables, StatusChip for status, ConflictDialog for OCC, BulkStatusActions for bulk activate/deactivate, ImportButton/ImportModal for import, HexagonLoader for loading, MasterDataCrud for code/name/is-active admin lists, the .btn/.btn-ghost/.input component classes for buttons/inputs, and the SDK client (api/apiExport/apiBlob/apiUpload) for all API calls. NO one-off reimplementations of tables, dialogs, badges, loaders, export/import flows, or raw fetch in the FE.

**Reuse primitive:** Shared component set: DataGrid · StatusChip · ConflictDialog · BulkStatusActions · ImportButton · HexagonLoader · MasterDataCrud · .btn/.btn-ghost/.input · sdk client

**Ref:** `apps/web/src/components/MasterDataCrud.tsx:1-17 (composes DataGrid/StatusChip/ConflictDialog/BulkStatusActions/ImportButton/sdk); apps/web/src/components/BulkStatusActions.tsx:23-31; apps/web/src/index.css:10-19 (.btn/.btn-ghost/.input)`

## 13. Consistency
**PASS rule:** Nav, page header (H1 + one-line subtitle left, primary action right), section grouping (Operations / Administration), spacing/density (px-6 py-5 page padding, 36px dense rows, 14px base), and terminology are consistent across pages and identical at every breakpoint. UPPERCASE display is applied globally via CSS only (body text-transform) with inputs/textareas/font-mono/.case-sensitive/links exempted — components never call .toUpperCase(). New screens follow the same shell (Layout) and Created/Updated column conventions; no page-specific chrome.

**Reuse primitive:** Layout (shell/nav/header) + global uppercase-display + shared spacing/density tokens

**Ref:** `apps/web/src/components/Layout.tsx:34-78 (nav sections + link class), :80-110 (NavContent shell); apps/web/src/index.css (uppercase via tokens.css); packages/ui-theme/src/tokens.css:199-236 (UPPERCASE display standard, CSS-only)`

## Notes

SCOPE = apps/web read-only audit (BASE worktree, origin/main). EXPORT JOB THRESHOLD = EXPORT_JOB_THRESHOLD = 10000 rows: <10k exports stream synchronously (apiExport → kind:'file'); ≥10k → server 413 EXPORT_TOO_LARGE / HTTP 202 background job (apiExport → kind:'job'), surfaced in the Jobs tray + toast (apps/web/src/lib/sdk.ts:134-161; CRM2_MASTER_MEMORY.md:202). FROZEN PAGE SIZES = [25,50,100,200], DEFAULT 25, MAX 500 (MIS/reporting only), >500 rejected (packages/sdk/src/pagination.ts:6-9).\n\nEXACT FROZEN TOKEN CLASS NAMES (packages/ui-theme/tailwind-preset.js:14-69, values tokens.css:15-181):\n- Base/surface: bg-background, text-foreground, bg-card/text-card-foreground, bg-popover/text-popover-foreground, bg-surface, bg-surface-muted, bg-surface-sunken.\n- Brand/secondary: bg-primary, text-primary-foreground, bg-primary-hover, bg-primary-muted, bg-secondary, text-secondary-foreground, bg-secondary-hover.\n- Muted/accent: bg-muted, text-muted-foreground, bg-accent, text-accent-foreground.\n- Lines/focus: border-border, border-border-strong, border-input, ring.\n- Semantic feedback: text/bg-destructive(+ -foreground), text/bg-success, text/bg-warning, text/bg-info.\n- 8 WORKFLOW STATUS tokens, each as text-st-<name> (strong fg) / bg-st-<name>-bg (soft chip) / border-st-<name>: pending, assigned, in-progress, submitted, under-review, approved, rejected, revisit.\n- Table interaction: bg-row-hover, bg-row-selected, border-row-selected-border.\n- Charts: chart-1..chart-6 (blue/green/amber/violet/cyan/rose), e.g. bg-chart-1.\n- Shape/type/elevation: rounded-lg/md/sm (var(--radius)=0.5rem), font-sans/font-mono, shadow-sm/md/lg (3 levels only).\nForbidden: any #hex/rgb/hsl literal, arbitrary color classes (text-[#..]/bg-[#..]/[color:..]), slate-*/gray-* utilities, and dark: overrides (the .dark class swaps variable values — component classes stay identical).\n\nKEY DISCREPANCIES vs the audit brief (flag for downstream auditors):\n1. NO shared money/rupee formatter exists. lib/format.ts exports ONLY formatDateTime/toDateInput/toIsoDate (apps/web/src/lib/format.ts:11-32) — there is no formatRupee/Intl en-IN helper. BillingPage rolls its own `const money = (n) => `₹${n.toFixed(2)}`` inline (BillingPage.tsx:20-23). So Dimension 9's 'money via shared fmt' has NO canonical primitive to point at; treat any page formatting money as needing a centralized helper, and BillingPage's inline money() is itself a consistency gap. (₹ uses plain toFixed, not Intl grouping.)\n2. The SDK FE error class is ApiError (apps/web/src/lib/sdk.ts:13-22), NOT 'SdkError' as DESIGN_AND_STACK_FREEZE Part 7 names it — match on ApiError + e.code (e.g. STALE_UPDATE, EXPORT_TOO_LARGE, IMPORT_TOO_LARGE).\n3. ImportModal.tsx exports the page-facing **ImportButton** (which renders the internal ImportModal); pages reuse ImportButton, not a bare ImportModal.\n4. StatusChip is a THREE-STATE master-data chip only (ACTIVE/SCHEDULED/INACTIVE, derived via effectiveStatus, ADR-0017) — it is NOT a general workflow-status badge. Lifecycle statuses (pending/assigned/in-progress/submitted/etc.) have frozen tokens (text-st-*/bg-st-*-bg) but no single shared chip component; pages render them with the tokens directly, so check token usage rather than a StatusChip import for non-master-data status.\n5. Per the standards docs, several pre-freeze admin lists (VU/Clients/Products/CPV/Rates/Locations) carry a retrofit obligation to DataGrid + server pagination (DATAGRID_STANDARD §19, PAGINATION §15) — relevant when auditing those pages for Dimensions 2/4.\n\nSTANDARDS SoT read: DESIGN_AND_STACK_FREEZE.md, ENGINEERING_STANDARDS.md, COLOR_SYSTEM_FREEZE.md, DATAGRID_STANDARD.md, PAGINATION_AND_LOADING_STANDARDS.md, IMPORT_EXPORT_STANDARD.md, RESPONSIVE_DESIGN_STANDARD.md (all under docs/). CI a11y is the contrast bar (axe gate 29; WCAG-AA token darkenings recorded COLOR_SYSTEM_FREEZE.md:51-68). I did NOT separately open UPPERCASE_DISPLAY_STANDARD.md / CONCURRENCY_AND_EDITING_STANDARD.md / UI_STANDARDS.md / CI_CD_STANDARDS.md full text — their rules were captured via cross-references and the verbatim implementation in tokens.css/Concurrency/DataGrid; treat those four as UNVERIFIED-in-full if exact gate numbers are needed.
