# Findings (prioritized)

**Totals:** 0 P0 · 25 P1 · 56 P2 · 45 P3 — 126 findings.

- **P0** = broken / inaccessible · **P1** = standard violated, user-visible or RBAC/a11y risk · **P2** = real gap, additive fix · **P3** = cosmetic / polish.
- Every fix is **additive** — adopt an existing shared primitive. Evidence cites the worktree at `origin/main` (`11997a1`).

## P0 — none

## P1 (25)

### P1.1 · [d7 A11y] App Shell (Layout / nav / JobsTray / NotificationBell / UserMenu / HeaderClock) — Header popovers (Jobs / Bell / Account) are not focus-trapped and lack menu semantics
- **Evidence:** JobsTray.tsx:64-78 + :109-179, NotificationBell.tsx:60-74 + :96-139, UserMenu.tsx:50-64 + :89-122 — each dropdown handles only outside-click + Escape; none calls useFocusTrap, so Tab is not trapped and focus is not restored to the trigger on close. None of the panels carry role=menu and no trigger carries aria-haspopup (grep role="menu"/aria-haspopup/aria-modal across the 5 shell files = none). Contrast Layout.tsx:152 where the drawer correctly uses useFocusTrap.
- **Fix:** Adopt the existing useFocusTrap primitive (apps/web/src/lib/useFocusTrap.ts) in all three popovers and mark the panel role=menu with aria-haspopup on the trigger — matching the drawer and the DataGrid menus the standard cites.

### P1.2 · [d1 Tokens] Case create — Non-existent status token text-st-completed renders unstyled
- **Evidence:** CaseCreatePage.tsx:257 (text-st-completed); no such token in tailwind-preset.js:45-54 or tokens.css:63-78 (only 8: pending|assigned|in-progress|submitted|under-review|approved|rejected|revisit)
- **Fix:** Replace text-st-completed with the semantic token text-success (frozen feedback token) for the 'Case created' success banner, since there is no 'completed' workflow status token

### P1.3 · [d7 A11y] Case create — Async create/add errors and warnings are not announced to assistive tech
- **Evidence:** CaseCreatePage.tsx:279 ('Create failed.'); AddTasksForm.tsx:171-173 ('Failed to add tasks.' / 'attachments failed') — plain <span>, no role=alert/aria-live
- **Fix:** Wrap error/warning messages in role=alert (or an aria-live region), mirroring the DataGrid/ConflictDialog a11y wiring (DataGrid.tsx aria patterns; ConflictDialog.tsx:31-40)

### P1.4 · [d2 Table] Case detail — Tasks & Attachments lists are bespoke <table>, not the Universal DataGrid
- **Evidence:** apps/web/src/features/cases/CaseDetailPage.tsx:462-728 (Documents/Tasks raw <table className="rtable">), :1107-1163 (Attachments raw <table>). DataGrid is never imported.
- **Fix:** Render the Tasks and Attachments lists through DataGrid<T> (apps/web/src/components/ui/data-grid/DataGrid.tsx:79) with columns:DataGridColumn<T>[], fetchPage, queryKey, rowId — gaining sortable/hideable columns, selection, and the standard responsive/a11y behavior for free.

### P1.5 · [d4 Pagination] Case detail — Lists fetch unbounded arrays with no pagination contract
- **Evidence:** CaseDetailPage.tsx:84-87 (tasks embedded, rendered :481 with no limit), :1033-1036 (attachments full array), :1645-1648 (field-photos full array). No PageQuery/Paginated, no pager, no PAGE_SIZES.
- **Fix:** Move Tasks/Attachments onto the server-paginated DataGrid contract (PageQuery/Paginated envelope, PAGE_SIZES, Prev/Next pager — DataGrid.tsx:163-165,:836-858); for embedded sub-lists that must stay inline, at minimum bound the fetch.

### P1.6 · [d3 Filters] Case detail — Task filtering is in-memory with no URL-state persistence
- **Evidence:** CaseDetailPage.tsx:395-403 (client-side tasks.filter), tab in component useState :304, tablist :438-461. No q/sort/dir/f_* URL params; a bookmarked URL loses the active tab and filters.
- **Fix:** Use the DataGrid filter surface (q debounced search + col.filterable/filterOptions + URL state — DataGrid.tsx:157-189,:216-238) so filter/sort/page/column state is persisted in the URL and reproducible.

### P1.7 · [d11 RBAC-UI] Cases list — '+ New Case' button not gated on case.create (RBAC client leak)
- **Evidence:** CasesPage.tsx:69-71 renders the New Case button unconditionally; server requires distinct PERMISSIONS.CASE_CREATE on POST /api/v2/cases (apps/api/src/modules/cases/routes.ts:18-19) while the page/nav are gated on case.view (Layout.tsx:38). A case.view-only user sees a button that 403s.
- **Fix:** Adopt useAuth() (apps/web/src/lib/AuthContext.tsx:135) and render the button only when has('case.create') (user.grantsAll===true || user.permissions.includes('case.create')) — the same pattern in CaseCreatePage.tsx:386-387.

### P1.8 · [d7 A11y] Commission Rates — Bespoke add/revise dialog is not focus-trapped and lacks aria-labelledby
- **Evidence:** CommissionRatesPage.tsx:120-300 — role=dialog/aria-modal set (123-124) but no useFocusTrap ref and no aria-labelledby on the <h2> (127); compare ConflictDialog.tsx:31,38 and MasterDataDialog MasterDataCrud.tsx:214,248,251
- **Fix:** Adopt the shared focus-trap: `useFocusTrap<HTMLDivElement>(true, onClose)` on the dialog container + aria-labelledby→id'd h2 (lib/useFocusTrap.ts), exactly as MasterDataDialog does. Keyboard users currently can Tab out of the modal and focus is not restored on close — a CI axe-gate risk.

### P1.9 · [d10 Forms] Commission Rates — OCC 409 STALE_UPDATE shown as an inline string instead of the shared ConflictDialog
- **Evidence:** CommissionRatesPage.tsx:27-28,108-115 (dialog) and 319-326 (row toggle) surface e.code / a toast on stale; MasterDataDialog routes the same 409 to the shared dialog (MasterDataCrud.tsx:231-233,303-318)
- **Fix:** Render components/ConflictDialog.tsx on 409 STALE_UPDATE with reload-&-re-apply (adopt fresh version) / discard, replacing the inline string + toast, so concurrent edits are never silently lost the way other admin modules guarantee.

### P1.10 · [d2 Table] CPV — Expanded-row enabled-units list is a bespoke raw <table>, not a DataGrid
- **Evidence:** CpvPage.tsx:463-527 — <table className="rtable w-full text-sm"> with hand-rolled <thead>/<tbody>, mapping enabled.data (a real CPV-unit data list) row-by-row with its own Edit/Activate/Deactivate buttons.
- **Fix:** Render the enabled-units sub-list through a nested DataGrid (DataGrid<ClientProductVerificationUnitView>, DataGrid.tsx:79-154) — the grid already supports nesting inside an expanded row (.rtable child-combinator note, index.css:55-61). This brings sort/hide/filter/states/a11y for free.

### P1.11 · [d8 States] CPV — Units sub-list has no error/Retry state and a non-standard text loader
- **Evidence:** CpvPage.tsx:475-481 renders a plain 'Loading…' cell and CpvPage.tsx:519-525 an empty cell, but there is NO isError/Retry branch; loading is not the time-banded HexagonLoader.
- **Fix:** Adopt DataGrid (DataGrid.tsx:726-764 supplies skeleton via useLoadingBand+HexagonLoader, empty 'No records…', and error+Retry inline) instead of the hand-rolled <tbody> conditional rows.

### P1.12 · [d8 States] Dashboard — No standard loading state for the dashboard scan — bare '…' glyphs bypass the banded HexagonLoader
- **Evidence:** DashboardPage.tsx:41-45 branches only on stats.isError; while stats.isLoading the page renders CounterBar/KpiCards showing '…' (CounterBar.tsx:45, KpiCard.tsx:32). RosterSummary.tsx:30-47 likewise shows '…' with no loading branch. PortfolioTable.tsx:28-29 rolls its own animate-pulse skeleton. None use useLoadingBand.ts:18 / HexagonLoader.tsx:16.
- **Fix:** Adopt useLoadingBand + HexagonLoader (PAGINATION_AND_LOADING_STANDARDS §6) for the page scan and roster (skeleton 300ms-1s → HexagonLoader 1-3s), and replace PortfolioTable's bespoke pulse skeleton with the same banded loader.

### P1.13 · [d2 Table] Dashboard — Portfolio rollup is a bespoke <table>, not the Universal DataGrid
- **Evidence:** PortfolioTable.tsx:34-69 hand-builds <table className="rtable"> with manual thead/tbody for a server-fetched data list; index.css:51-54 marks .rtable as interim until DataGrid owns the strategy.
- **Fix:** Render the portfolio list through DataGrid<PortfolioRow> (DataGrid.tsx:136) with DataGridColumn<PortfolioRow>[] + fetchPage + queryKey + rowId to gain sortable/hideable columns and the shared responsive strategy.

### P1.14 · [d10 Forms] Policies — Form bypasses RHF + the SDK zod schemas (manual useState validation)
- **Evidence:** PolicyDialog.tsx:20-25 (raw useState fields), :105 (hand gating !name||!content||!code), :68-73 (hand-rolled UPPER_SNAKE regex) — while @crm2/sdk exports CreatePolicySchema/UpdatePolicySchema (packages/sdk/src/policies.ts:48-65) that are never imported.
- **Fix:** Adopt the shared react-hook-form + zodResolver pattern bound to CreatePolicySchema/UpdatePolicySchema from @crm2/sdk; render inline field errors under each Field. Client validation then matches the server contract.

### P1.15 · [d5 Import/Export] Policies — No export wired on the Policies list
- **Evidence:** PoliciesPage.tsx:103-113 omits the DataGrid exportFn prop, so the Export menu (DataGrid.tsx:438-503) and apiExport job/413 flow are unavailable for this admin list.
- **Fix:** Pass exportFn that calls apiExport against /api/v2/policies/export (DataGrid.tsx:109,256-301; sdk apiExport job-threshold/413), matching the export contract used by other admin grids.

### P1.16 · [d8 States] Policies — Toggle (activate/deactivate) silently swallows non-409 errors and shows no pending state
- **Evidence:** PoliciesPage.tsx:28-30 onError only branches on isStale (409); any other failure produces no toast/alert, and the toggle button (74-79) is never disabled while toggle.isPending.
- **Fix:** Surface non-stale toggle failures via a toast/role=alert and disable+label the toggle button on toggle.isPending — the same error/pending discipline DataGrid already applies.

### P1.17 · [d11 RBAC-UI] Rate Management — Write actions not RBAC-gated client-side (visible to non-managers, 403 server-side)
- **Evidence:** RateManagementPage.tsx renders Add/Import (:281-284), Revise/Activate/Deactivate (:245-262), and BulkStatusActions (:308-310) with no useAuth/has gate; server requires masterdata.manage for all writes (apps/api/src/modules/rates/routes.ts:25-32) while page/nav gate is only page.masterdata (Layout.tsx:51, routes.ts:11)
- **Fix:** Adopt the useAuth()+has('masterdata.manage') gating pattern already used by the sibling CommissionRatesPage.tsx:304-306,:433 to hide write controls from users lacking the write permission

### P1.18 · [d7 A11y] RBAC Roles (Access Control) — 'Cannot deactivate' error overlay is a bespoke modal with no focus trap / dialog semantics
- **Evidence:** RolesPage.tsx:224-236 — fixed inset-0 z-50 overlay with no useFocusTrap, no role=dialog/aria-modal/aria-labelledby, and Escape does not dismiss; the only focus target is the OK button but focus is neither moved in nor restored.
- **Fix:** Render this blocked-deactivation message through a focus-trapped dialog: reuse useFocusTrap + role=dialog + aria-modal + aria-labelledby (the ConflictDialog.tsx:31-40 pattern) or a shared alert-dialog primitive, so it meets the same a11y bar (axe gate 29) as RoleDialog/ConflictDialog.

### P1.19 · [d11 RBAC-UI] RBAC Roles (Access Control) — Page actions and route render are not RBAC-mirrored (relies on nav-hiding only)
- **Evidence:** RolesPage.tsx:193 ('+ New Role') and :161-175 (Edit/Deactivate) render with no useAuth()/has() check; App.tsx:75 mounts /admin/rbac with no client guard while only Layout.tsx:58,83-85 gates the nav link on page.access. Direct navigation shows the full management UI to a user without page.access.
- **Fix:** Mirror the server permission with useAuth().has('page.access') (AuthContext + the Layout has() pattern at Layout.tsx:83-85): guard the page render and the New Role / Edit / Deactivate controls, so UI visibility matches the API the same way the nav does.

### P1.20 · [d10 Forms] Report Layouts (MIS Layouts) — OCC 409 conflict surfaced as inline string, not the shared ConflictDialog
- **Evidence:** ReportLayoutsPage.tsx:40-41 (isStale), :233-234 (save onError → 'reload and retry' string), :707-708 (toggle onError → toast string). ConflictDialog is never imported.
- **Fix:** Adopt apps/web/src/components/ConflictDialog.tsx for the STALE_UPDATE path so a 409 offers reload & re-apply / discard instead of a dead-end string toast.

### P1.21 · [d10 Forms] Report Layouts (MIS Layouts) — Designer form bypasses the frozen react-hook-form + zodResolver(@crm2/sdk) pattern
- **Evidence:** ReportLayoutsPage.tsx:129-275 — ~12 raw useState fields with hand-written rowError/canSave validation; no RHF, no zod schema imported from @crm2/sdk.
- **Fix:** Refactor the LayoutDesignerDialog onto react-hook-form + zodResolver against an @crm2/sdk-exported schema, rendering inline field errors per the shared forms pattern.

### P1.22 · [d8 States] Security — MFA status loading state defaults to OFF (flash-of-wrong-content) + no error state
- **Evidence:** SecurityPage.tsx:47 `const enrolled = status.data?.enrolled ?? false` renders the 'OFF / Enable MFA' card (:66,:73-77) while the status query (:12) is still loading; status.isError is never surfaced.
- **Fix:** Gate the card on status.isLoading using useLoadingBand + HexagonLoader (skeleton→loader bands) and render an error+Retry affordance on status.isError, instead of defaulting enrolled to false.

### P1.23 · [d7 A11y] Security — Form inputs lack accessible names; errors not announced
- **Evidence:** SecurityPage.tsx:91-97 (code) and :115-120 (disableCode) have only placeholder, no <label>/aria-label; error <p> at :70/:132 and SessionList revoke failures have no role=alert/aria-live; ON/OFF at :61-67 is color+text with no aria.
- **Fix:** Add aria-label/<label> to the two inputs, wrap error text in role=alert (aria-live=polite), and give the ON/OFF state an accessible name — mirroring DataGrid/ConflictDialog aria wiring.

### P1.24 · [d11 RBAC-UI] Templates (Report Templates) — Write buttons (+New/Edit/Activate/Deactivate/bulk) shown to read-only page.templates users — server requires report_template.manage
- **Evidence:** TemplatesPage.tsx:123 (+New unconditional), :98-106 (Edit/Activate/Deactivate unconditional), :133 (bulk), nav gated only on read perm Layout.tsx:59; server writes all require TEMPLATE_MANAGE (routes.ts:14-20). Correct precedent exists at ReportLayoutsPage.tsx:776 (if(!has('report_template.manage')) no-access) + Layout.tsx:53.
- **Fix:** Adopt the useAuth() has('report_template.manage') gating already used by the sibling ReportLayoutsPage (ReportLayoutsPage.tsx:696,:776): hide/guard the +New button, per-row Edit/Activate/Deactivate actions, and the bulkActions render for users lacking the manage perm so the UI mirrors the server.

### P1.25 · [d5 Import/Export] Users — Export Scope bypasses apiExport job-threshold/413 contract
- **Evidence:** UsersPage.tsx:206-225 — 'Export Scope' calls apiBlob('/scope/export?mode=all&format=xlsx') with a hand-rolled createObjectURL/anchor download and a custom setExportError modal, never apiExport. A ≥10k-row scope export cannot degrade to the 202 background job and a 413 EXPORT_TOO_LARGE surfaces as a raw error string.
- **Fix:** Route scope export through the shared apiExport (sdk.ts:134-161) so kind:'file'/'job' + EXPORT_TOO_LARGE + Jobs-tray/toast apply, or expose it as a DataGrid exportFn mode; delete the bespoke apiBlob+anchor+modal.

## P2 (56)

### P2.1 · [d10 Forms] Admin CRUD cluster (MasterDataCrud + Clients/Products/Locations/Departments/Designations/VerificationUnits) — Admin dialogs are hand-rolled useState forms, not RHF + zodResolver(@crm2/sdk)
- **Evidence:** MasterDataDialog/EditLocationDialog/DepartmentDialog/DesignationDialog/VerificationUnitDialog all use raw useState + manual mutationFn with imperative validation (MasterDataCrud.tsx:208-240,296; LocationsPage.tsx:340-374,435; DepartmentsPage.tsx:168-202,257; DesignationsPage.tsx:174-212,278; VerificationUnitDialog.tsx:51-103,196). No react-hook-form, no zodResolver, no per-field inline errors — only a single text-destructive line.
- **Fix:** Adopt the shared react-hook-form + zodResolver(@crm2/sdk schema) form pattern so validation/error rendering is the canonical inline-per-field flow rather than button-disable heuristics.

### P2.2 · [d6 Responsive] Admin CRUD cluster (MasterDataCrud + Clients/Products/Locations/Departments/Designations/VerificationUnits) — Row-action controls miss the ~44px mobile touch target
- **Evidence:** Edit/Activate/Deactivate are bare text <button>s with no padding or min-height (MasterDataCrud.tsx:103-111; LocationsPage.tsx:168-176; DepartmentsPage.tsx:81-89; DesignationsPage.tsx:87-95; VerificationUnitsPage.tsx:139-147).
- **Fix:** Render row actions with the shared .btn-ghost class (or adequately-sized icon buttons) so interactive controls meet the responsive-standard touch-target minimum.

### P2.3 · [d13 Consistency] Admin CRUD cluster (MasterDataCrud + Clients/Products/Locations/Departments/Designations/VerificationUnits) — LocationsPage uses a bespoke inline create form instead of the shared '+ New' dialog
- **Evidence:** LocationsPage.tsx:198-294 renders an in-page create form (pincode/areas chips/city/state/country/effectiveFrom + Add button), whereas Clients/Products/Departments/Designations/VerificationUnits all use the '+ New' button → modal dialog pattern (MasterDataCrud.tsx:134-138,175-177).
- **Fix:** Where multi-area batch entry isn't strictly required, route creation through the same dialog component the rest of the cluster uses to keep the create UX consistent; if the batch form must stay, encapsulate it as a documented variant rather than page-specific chrome.

### P2.4 · [d12 Reuse] App Shell (Layout / nav / JobsTray / NotificationBell / UserMenu / HeaderClock) — Dropdown/popover pattern reimplemented three times with no shared primitive
- **Evidence:** Identical open-state + document mousedown/keydown(Escape) useEffect and identical 'absolute right-0 z-50 mt-2 …rounded-md border border-border bg-popover text-popover-foreground shadow-lg' panel markup appear in JobsTray.tsx:60-78/110, NotificationBell.tsx:52-74/97, UserMenu.tsx:30-64/90 — three one-off copies of the same header menu.
- **Fix:** Extract one shared Popover/DropdownMenu component (composing useFocusTrap + role=menu + outside-click/Escape) and have JobsTray, NotificationBell and UserMenu consume it, eliminating the triplicated effect+markup and closing the Dim-7 trap gap at the same time.

### P2.5 · [d8 States] App Shell (Layout / nav / JobsTray / NotificationBell / UserMenu / HeaderClock) — NotificationBell loading is bespoke text; no error/Retry on tray feed failure
- **Evidence:** NotificationBell.tsx:111-112 renders a plain 'Loading…' line instead of the §6/§7 time-banded HexagonLoader; neither tray renders an error or Retry state — useJobs (JobsTray.tsx:62) and useUnreadCount/useNotificationList (NotificationBell.tsx:54-55) coerce to []/0 so a failed fetch is indistinguishable from empty.
- **Fix:** Use the shared useLoadingBand + HexagonLoader (apps/web/src/lib/useLoadingBand.ts, components/ui/HexagonLoader.tsx) for the bell list-loading band and add an inline error+Retry row for feed-fetch failures, matching the DataGrid state contract.

### P2.6 · [d7 A11y] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Accept-policies blocking dialog lacks focus trap + dialog ARIA
- **Evidence:** MustAcceptPoliciesPage.tsx:24-51 — dialog-styled card (header/scroll-body/Log out + I Accept footer) with NO useFocusTrap, NO role=dialog, NO aria-modal, and no aria-labelledby tying the :28 title to the card. Compare ConflictDialog.tsx:31-40 and SessionTimeoutModal.tsx:15-24 which do this correctly.
- **Fix:** Adopt useFocusTrap (apps/web/src/lib/useFocusTrap.ts:29) on the card and add role=dialog/aria-modal=true/aria-labelledby pointing at the title id, mirroring ConflictDialog.tsx:31-40.

### P2.7 · [d7 A11y] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Policy scroll region is not keyboard-focusable (axe scrollable-region-focusable)
- **Evidence:** MustAcceptPoliciesPage.tsx:33 — the long-policy region uses overflow-y-auto but has no tabIndex=0 / role=group / aria-label, so keyboard-only users cannot scroll it and axe's scrollable-region-focusable rule (the CI a11y gate bar) fails.
- **Fix:** Apply the DataGrid scrollable-region pattern (DataGrid.tsx:653-657): tabIndex=0 role=group aria-label on the overflow-y-auto container.

### P2.8 · [d8 States] Billing & Commission — Bespoke case-lines & breakdown sub-queries have no error/Retry state — a fetch failure renders a false 'No completed tasks.'
- **Evidence:** BillingPage.tsx:37-39 (BillingCaseLines: only isLoading, then `q.data ?? []` → empty msg) and BillingPage.tsx:116-117 (BillingBreakdownPanels: only isLoading, then `q.data ?? {byLocation:[],byBand:[]}`); neither reads q.isError. clientOpts also unguarded (l.313).
- **Fix:** Route these lists through the Universal DataGrid (apps/web/src/components/ui/data-grid/DataGrid.tsx:747-764 already renders error+Retry and a distinct empty), or at minimum branch on isError with a Retry affordance and distinguish no-data vs no-results.

### P2.9 · [d2 Table] Billing & Commission — Per-task billing lines and by-location/by-band breakdowns are hand-rolled <table>s instead of the Universal DataGrid
- **Evidence:** BillingPage.tsx:42-103 (BillingCaseLines raw <table class='rtable'>), :122-161 and :165-204 (BillingBreakdownPanels two raw tables). These are operational data lists, not import-preview chrome.
- **Fix:** Render these through DataGrid (apps/web/src/components/ui/data-grid/DataGrid.tsx) — the expanded slot can nest a DataGrid; the aggregates become a small DataGrid — gaining sortable/hideable columns, the error/empty states, and the focusable scroll region for free.

### P2.10 · [d9 Status/₹/Date] Billing & Commission — Case Status rendered as bare uppercase text, not the frozen status-token chip used elsewhere
- **Evidence:** BillingPage.tsx:235 `<span className='text-xs uppercase'>{r.status.replace(/_/g,' ')}</span>` — no tone; PipelinePage.tsx:150-152 renders the same status field with `bg-st-<name>-bg text-st-<name>` chips.
- **Fix:** Reuse the frozen status tokens (the STATUS_TONE map pattern in apps/web/src/features/pipeline/PipelinePage.tsx:29-35 → bg-st-*-bg/text-st-*) so the same status reads identically across Billing and Pipeline; lifecycle statuses have no shared chip component, so apply the tokens directly.

### P2.11 · [d1 Tokens] Case create — Raw Tailwind palette color text-amber-600 bypasses frozen tokens
- **Evidence:** AddTasksForm.tsx:173 (text-amber-600 on the 'attachments failed' warning)
- **Fix:** Use the frozen semantic token text-warning from @crm2/ui-theme instead of the raw amber-600 palette utility

### P2.12 · [d8 States] Case create — Four async dropdown queries have no loading state (empty selects while pending)
- **Evidence:** clients/products CaseCreatePage.tsx:51-58; available-units AddTasksForm.tsx:75-82; areaMatches AddTasksForm.tsx:202-210; pool AddTasksForm.tsx:215-226 — no HexagonLoader/useLoadingBand
- **Fix:** Adopt HexagonLoader + useLoadingBand (HexagonLoader.tsx:16-58; useLoadingBand.ts:12-36) for the time-banded loading contract on these queries

### P2.13 · [d8 States] Case create — Create/add error states lack a Retry affordance
- **Evidence:** CaseCreatePage.tsx:279; AddTasksForm.tsx:171 — error text only, no retry button (mutate is re-callable but no UI affordance)
- **Fix:** Add a Retry control to the error state to satisfy the four-state (loading/empty/error+retry/permission) contract the DataGrid enforces inline

### P2.14 · [d9 Status/₹/Date] Case create — Date rendered via ad-hoc toLocaleString instead of shared formatDateTime
- **Evidence:** CaseCreatePage.tsx:182 (new Date().toLocaleString())
- **Fix:** Render via formatDateTime from apps/web/src/lib/format.ts:11 (DD Mon YYYY, HH:MM) for date consistency

### P2.15 · [d2 Table] Case create — Dedupe match list is a bespoke <table>, not the Universal DataGrid
- **Evidence:** CaseCreatePage.tsx:295-341 (hand-rolled thead/th/tbody/td); DataGrid.tsx:91-93 names the dedupe form as an intended DataGrid consumer (searchable=false)
- **Fix:** Render matches through DataGrid<DuplicateMatch> (DataGrid.tsx:79-154) with searchable=false; gains sort/aria-sort/column-hide/focusable scroll region for free

### P2.16 · [d12 Reuse] Case detail — Inline forms use raw input/select/button markup instead of .input/.btn/.btn-ghost
- **Evidence:** CaseDetailPage.tsx:792,:808,:833 (AssignForm raw selects/inputs), :875,:889 (CompleteForm), :978,:992 (CaseFinalizeForm), :1336,:1451 (DataEntry/Pickup), bespoke save buttons :838,:895,:945,:998,:1304,:1505.
- **Fix:** Adopt the shared component classes .input / .btn / .btn-ghost (apps/web/src/index.css:10-19) for all inline form controls and submit buttons; drop the duplicated 'h-9 rounded-md border border-border bg-background' / 'bg-primary ...' strings.

### P2.17 · [d8 States] Case detail — Top-level loading/error use plain text, not the Hexagon loading system + Retry
- **Evidence:** CaseDetailPage.tsx:101 (<p>Loading…</p>), :102 (<p>Case not found.</p> with no Retry). useLoadingBand/HexagonLoader are not used for the main fetch (HexagonLoader is only used in lazy sub-sections).
- **Fix:** Replace the top-level loading/error with useLoadingBand + HexagonLoader (apps/web/src/lib/useLoadingBand.ts:12-36; HexagonLoader.tsx) and add a Retry affordance to error states, matching the DataGrid inline state pattern.

### P2.18 · [d10 Forms] Case detail — Finalize / Data-Entry / Pickup OCC surfaced as inline text, not ConflictDialog
- **Evidence:** CaseDetailPage.tsx:98 + :1008-1009 (finalize STALE → inline text), :1267-1268 (data-entry STALE → inline text), :1444-1445 (pickup STALE → inline text). Only the task-assign path uses ConflictDialog (:729-742).
- **Fix:** Route every 409 STALE_UPDATE through the shared ConflictDialog (apps/web/src/components/ConflictDialog.tsx:17) — reload-&-re-apply / discard — as the task-assign path already does, instead of an inline destructive-text message.

### P2.19 · [d7 A11y] Case detail — Bespoke table scroll regions are not keyboard-focusable (axe scrollable-region-focusable)
- **Evidence:** CaseDetailPage.tsx:139,:410,:1071 (overflow-x-auto wrappers) — none carry tabIndex=0/role=group/aria-label, and the <table> headers expose no aria-sort. DataGrid provides both (DataGrid.tsx:653-657,:687).
- **Fix:** Migrate the lists to DataGrid (which makes the horizontal-scroll region focusable and adds aria-sort); if kept bespoke, add tabIndex=0 role=group aria-label to each overflow-x-auto wrapper.

### P2.20 · [d5 Import/Export] Case detail — No list export for Tasks/Attachments
- **Evidence:** CaseDetailPage.tsx — no exportFn/apiExport usage anywhere (grep negative); the page offers Client Report generation (:1781-1801) but no per-list CSV/Excel export.
- **Fix:** Wire DataGrid exportFn → apiExport (job-threshold/413, apps/web/src/lib/sdk.ts:134-161) on the Tasks/Attachments grids once they move to DataGrid.

### P2.21 · [d9 Status/₹/Date] Cases list — Case status rendered as plain text, not a frozen status chip
- **Evidence:** CasesPage.tsx:50 renders status via c.status.replace(/_/g,' ') with no st-* token/chip; the sibling CaseDetailPage.tsx:60-65,118 renders the same entity's status as a colored chip using bg-st-*-bg/text-st-* tokens. Color is absent and the two pages disagree.
- **Fix:** Reuse the frozen workflow-status tokens (the CASE_STATUS→tone map from CaseDetailPage) to render the Status cell as a soft-bg+strong-fg chip; color must not be the only signal but must be present and match the detail page.

### P2.22 · [d5 Import/Export] Cases list — Cases list has no export (and no import)
- **Evidence:** CasesPage.tsx:74-85 passes no exportFn, so the DataGrid Export menu (DataGrid.tsx:438-503) never appears; there is no server /cases/export endpoint (apps/api/src/modules/cases/routes.ts:76 GET / has no export sibling; the only export is the unrelated /dedupe-search/export at routes.ts:16). An operational list cannot be exported.
- **Fix:** Add a cases-list /export endpoint, then pass exportFn wired to apiExport (apps/web/src/lib/sdk.ts:134-161) so the toolbar offers Current/All × XLSX/CSV under the EXPORT_JOB_THRESHOLD/413 rule; use ImportButton/ImportModal if bulk case import is in scope.

### P2.23 · [d9 Status/₹/Date] Commission Rates — Bespoke inline money() — no shared rupee formatter; no Intl grouping
- **Evidence:** CommissionRatesPage.tsx:25 `const money = (n)=>`₹${n.toFixed(2)}`` rendered at line 391; duplicates BillingPage's own money(); lib/format.ts:11-32 exports no rupee helper
- **Fix:** Add a centralized formatRupee (en-IN Intl grouping) to apps/web/src/lib/format.ts and consume it here (and in BillingPage), removing the duplicate inline helpers.

### P2.24 · [d2 Table] Commission Rates — DataGrid not selectable and no bulkActions despite per-row activate/deactivate
- **Evidence:** CommissionRatesPage.tsx:459-491 omits selectable/bulkActions; per-row toggle at 311-327,419-425; sibling MasterDataCrud.tsx:144-147 passes selectable + BulkStatusActions
- **Fix:** Add `selectable` + `bulkActions={(sel)=><BulkStatusActions selection={sel} basePath='/api/v2/commission-rates' queryKey='commission-rates'/>}` (components/BulkStatusActions.tsx) for bulk activate/deactivate, matching the admin standard — or, if no bulk endpoint exists (line 310), record that exception.

### P2.25 · [d9 Status/₹/Date] Commission Rates — Status column rendered as bare uppercase text with no status token (color-only-absent)
- **Evidence:** CommissionRatesPage.tsx:394-398 — `<span className="text-xs uppercase">{r.isActive?'Active':'Inactive'}</span>`; master-data lists use StatusChip (MasterDataCrud.tsx:95)
- **Fix:** Render via StatusChip (components/StatusChip.tsx) using the row's isActive/effectiveFrom, or apply the frozen status tokens (bg-st-approved-bg/text-st-approved vs bg-muted/text-muted-foreground) so status carries a non-text signal.

### P2.26 · [d4 Pagination] CPV — Enabled-units fetched unbounded — no pagination contract
- **Evidence:** CpvPage.tsx:373-377 fetches GET /api/v2/cpv-units?clientProductId=<id> as api<ClientProductVerificationUnitView[]> (bare array, no Paginated<T> envelope, no limit/offset, no pager).
- **Fix:** Move to the shared PageQuery/Paginated contract via a nested DataGrid fetchPage (pageQueryToParams, DataGrid.tsx:163-165 pager); requires the server endpoint to return Paginated<T> (verify endpoint — UNVERIFIED).

### P2.27 · [d7 A11y] CPV — Bespoke units table is outside the focusable scroll region and lacks a live-region loader
- **Evidence:** CpvPage.tsx:463 table is not wrapped in the tabIndex=0 role=group aria-label scroll container the DataGrid provides (DataGrid.tsx:653-657); its loader is plain text, not HexagonLoader role=status (HexagonLoader.tsx:28-33).
- **Fix:** Use DataGrid for the sub-list to inherit the scrollable-region-focusable wrapper and role=status loading announce (axe gate 29).

### P2.28 · [d—] CROSS: tokens — Forbidden named Tailwind color utility `text-amber-600` instead of a frozen token
- **Evidence:** AddTasksForm.tsx:173 — `<span className="text-sm text-amber-600">Tasks added, but some attachments failed to upload.</span>`. `amber-600` is a raw Tailwind palette color, not a mapped semantic/status token. It is the ONLY named-color utility in the entire apps/web/src tree (verified via grep for (text|bg|border|...)-(red|amber|green|...)-N — single hit). It also breaks dark-mode theming (palette colors don't swap with the .dark variable layer, unlike tokens).
- **Fix:** Replace `text-amber-600` with the frozen warning token `text-warning` (semantic feedback token defined in tailwind-preset.js:42 / tokens.css). This is the canonical color for a non-fatal warning message and theme-swaps correctly. (Optionally `text-st-under-review` if a status tone is intended, but `text-warning` is the right semantic match.)

### P2.29 · [d—] CROSS: tokens — Reference to non-existent status token `text-st-completed` (silent no-color fallback)
- **Evidence:** CaseCreatePage.tsx:257 — `<span className="text-sm font-medium text-st-completed">✓ Case {created.caseNumber} created …</span>`. The frozen workflow-status set has exactly 8 names (tailwind-preset.js:46-53 / tokens.css:63-78): pending, assigned, in-progress, submitted, under-review, approved, rejected, revisit. There is NO `st-completed` token, so Tailwind generates no CSS rule for `text-st-completed` and the success text renders with inherited/default foreground instead of the intended green — a broken/dead class. Contrast: the correct pattern for 'completed' is elsewhere mapped to st-approved (PipelinePage.tsx STATUS_TONE COMPLETED→`text-st-approved`; CaseDetailPage CASE_STATUS_TONE COMPLETED→`text-st-approved`).
- **Fix:** Replace `text-st-completed` with `text-success` (semantic success token) — or `text-st-approved` to match how COMPLETED is rendered in the status tone maps. Either resolves the dead class to a real, theme-aware color.

### P2.30 · [d4 Pagination] Dashboard — Portfolio fetch is unbounded (no Paginated envelope / pager)
- **Evidence:** PortfolioTable.tsx:11-16 fetches PortfolioRow[] (raw array) from /api/v2/dashboard/portfolio with no page/limit; no PAGE_SIZES selector or pager (contrast DataGrid.tsx:836-858).
- **Fix:** Route the portfolio list through the SDK pagination contract (PageQuery/Paginated/PAGE_SIZES) via DataGrid so a large scope is paged, not loaded whole.

### P2.31 · [d7 A11y] Dashboard — Async error/loading transitions are not announced to assistive tech
- **Evidence:** Error blocks are plain text with no role='alert': DashboardPage.tsx:42-44, PortfolioTable.tsx:24, RosterSummary.tsx:31. Loading '…' placeholders carry no aria-live/role=status (CounterBar.tsx:45, KpiCard.tsx:32).
- **Fix:** Use role='alert' on error surfaces and the HexagonLoader's built-in role=status/aria-live='polite' (HexagonLoader.tsx:28-33) for loading, so state changes are announced.

### P2.32 · [d3 Filters] Dedupe — Primary search inputs (name/pan/mobile/company) are not URL-persisted — bookmarked /dedupe cannot reproduce the searched screen
- **Evidence:** DedupePage.tsx:47-52 (identifiers in component useState), :52/:185 (submitted drives filters prop, never written to the URL); contrast DataGrid.tsx:155-165 where q/sort/page/size/cols ARE URL-synced. searchable={false} (:182) and zero filterable columns mean the grid's own URL-backed filter surfaces are off, so NOTHING about the active dedupe query lives in the URL.
- **Fix:** Persist the four identifiers via the DataGrid URL-state contract: either lift them into URL params (e.g. f_name/f_pan/f_mobile/f_company committed to the URL) and pass them through the existing `filters` prop, or read/write them with useSearchParams so the form is initialized from and synced to the URL — making the search bookmarkable/shareable like every other grid.

### P2.33 · [d8 States] Field Monitoring — Stat cards have no loading-band or error/retry state — permanent '…' on slow/failed stats
- **Evidence:** FieldMonitoringPage.tsx:41-44 (stats useQuery, no isError use) + :162-173 (`{v ?? '…'}` shows ellipsis for loading AND error AND undefined, indefinitely)
- **Fix:** Drive the cards through the shared time-banded loading (useLoadingBand.ts:12-36 + HexagonLoader) and surface stats.isError with a Retry, instead of a bespoke '…' that never resolves — match the DataGrid four-state contract (DataGrid.tsx:726-764).

### P2.34 · [d12 Reuse] Field Monitoring — Request-location button bypasses the shared .btn/.btn-ghost component class
- **Evidence:** FieldMonitoringPage.tsx:240-247 raw <button> with hand-written 'rounded-md border border-border px-2 py-1 text-xs … hover:bg-accent disabled:opacity-50'
- **Fix:** Replace the inline class string with the shared .btn-ghost (or .btn) component class (index.css:10-19) so the button inherits frozen sizing/focus/disabled styling and touch-target rules.

### P2.35 · [d3 Filters] Field Monitoring — Roster offers no per-column or date-range filters despite obvious filterable dimensions
- **Evidence:** FieldMonitoringPage.tsx:46-150 — no column sets filterable/filterOptions; :179-191 passes no dateFilters prop (only global search)
- **Fix:** Add col.filterable to textual columns and dateFilters for lastActivityAt/createdAt using the DataGrid filter surface (DataGrid.tsx:216-238, :703-719) so f_<id> / f_<id>_from-to persist in the URL like every other grid.

### P2.36 · [d9 Status/₹/Date] Pipeline — Workflow-status chip reimplemented inline (duplicated across 3 pages)
- **Evidence:** apps/web/src/features/pipeline/PipelinePage.tsx:28-36 STATUS_TONE + :147-167 chip render; same pattern duplicated in apps/web/src/features/cases/CaseDetailPage.tsx:59 (CASE_STATUS_TONE) and apps/web/src/features/dedupe/DedupePage.tsx:21 (STATUS_TONE). StatusChip.tsx is master-data only (ACTIVE/SCHEDULED/INACTIVE) so there is no shared lifecycle chip
- **Fix:** Add a shared WorkflowStatusChip primitive (frozen text-st-*/bg-st-*-bg token map + label underscore-replace + the ⚠ TAT badge) alongside StatusChip and have Pipeline/CaseDetail/Dedupe consume it, eliminating the three inline maps

### P2.37 · [d12 Reuse] Pipeline — Bulk-assign dialog buttons/inputs bypass shared .btn/.btn-ghost/.input classes
- **Evidence:** apps/web/src/features/pipeline/PipelinePage.tsx:429 Cancel = 'h-9 rounded-md border border-border px-4 text-sm', :437 Assign = 'h-9 rounded-md bg-primary px-4 ... text-primary-foreground disabled:opacity-50', and selects/number input at :375,:399,:419 = 'h-9 rounded-md border border-border bg-background px-2 text-sm' — canonical is .btn/.btn-ghost (ConflictDialog.tsx:53-56, MasterDataCrud.tsx:134/:287-291) and .input (MasterDataCrud.tsx:258/:271; index.css:11-19)
- **Fix:** Replace the inline button classes with .btn (Assign) / .btn-ghost (Cancel) and the inline select/input classes with the .input component class

### P2.38 · [d12 Reuse] Policies — Bespoke row action buttons + inline toggle instead of MasterDataCrud / BulkStatusActions
- **Evidence:** PoliciesPage.tsx:65-82 renders one-off Edit/Activate text-link buttons and :20-31 re-implements a version-guarded activate/deactivate, duplicating MasterDataCrud (MasterDataCrud.tsx:1-17,52-60) and BulkStatusActions.
- **Fix:** Migrate the policies list to MasterDataCrud (code/name/is-active admin wrapper) or DataGrid selectable + BulkStatusActions to inherit bulk de/activate, export and import without bespoke buttons.

### P2.39 · [d12 Reuse] Profile — Zero shared primitives reused — bespoke table, status pills, and loaders
- **Evidence:** features/profile/ProfilePage.tsx imports none of DataGrid/StatusChip/ConflictDialog/HexagonLoader; it hand-rolls a status pill (ProfilePage.tsx:71-77), a raw acceptance <table> (ProfilePage.tsx:274-295) and plain-text loaders (ProfilePage.tsx:267,319). SessionList.tsx:38-65 likewise hand-rolls the session list + 'This device' badge.
- **Fix:** Adopt the shared set: DataGrid (apps/web/src/components/ui/data-grid/DataGrid.tsx) for the acceptance/session lists, StatusChip (components/StatusChip.tsx) for Active/Inactive, HexagonLoader (components/ui/HexagonLoader.tsx) for loading.

### P2.40 · [d7 A11y] Profile — Password inputs are placeholder-only (no label) and scroll region is not focusable
- **Evidence:** ProfilePage.tsx:204-228 — Current/New/Confirm password inputs have only placeholder, no <label>/aria-label (axe label rule). ProfilePage.tsx:273 — the acceptance table sits in an overflow-x-auto region with no tabIndex/role=group/aria-label (axe scrollable-region-focusable).
- **Fix:** Add labels/aria-label to the password inputs (mirror the email/phone htmlFor pattern at ProfilePage.tsx:108,124); make the scroll region focusable per DataGrid.tsx:653-657, or migrate the table to DataGrid for built-in aria wiring.

### P2.41 · [d2 Table] Profile — Policy-acceptance record list uses a bespoke <table> instead of DataGrid
- **Evidence:** ProfilePage.tsx:274-295 renders a hand-built <table>/thead/tbody for the consent log with no sortable/hideable columns, no responsive table→card collapse, and no data-label cells.
- **Fix:** Render the consent log through the Universal DataGrid (DataGrid.tsx:79-154) or, if kept inline, apply the shared .rtable + data-label responsive strategy (index.css:63-91).

### P2.42 · [d7 A11y] Rate Management — Bespoke SearchableSelect combobox is keyboard-inaccessible
- **Evidence:** RateManagementPage.tsx:55-117 renders a <ul>/<li><button onMouseDown> dropdown with no role=combobox/listbox/option, no aria-expanded, no aria-activedescendant and no arrow/enter/escape keyboard support; it drives every picker in the Add/Revise forms
- **Fix:** Promote a shared accessible combobox primitive (none exists under apps/web/src/components/ui) with full ARIA + keyboard nav, or add those to SearchableSelect; the axe a11y CI gate is the bar

### P2.43 · [d9 Status/₹/Date] Rate Management — Bespoke inline money() formatter instead of a centralized rupee helper
- **Evidence:** RateManagementPage.tsx:28 `const money = (n) => ₹${n.toFixed(2)}` used at :219,:594,:689 — no Intl en-IN grouping; lib/format.ts (format.ts:11-32) exports no money formatter
- **Fix:** Add a centralized rupee formatter to apps/web/src/lib/format.ts and adopt it here (same gap flagged for BillingPage); align all admin/billing money rendering on one helper

### P2.44 · [d9 Status/₹/Date] Rate Management — ActiveChip reimplements the shared StatusChip
- **Evidence:** RateManagementPage.tsx:39-49 hand-rolls an ACTIVE/INACTIVE chip duplicating the bg-st-approved-bg/text-st-approved + bg-muted/text-muted-foreground mapping that StatusChip.tsx:4-13 already owns
- **Fix:** Render status via the shared StatusChip component (StatusChip.tsx) rather than a local ActiveChip

### P2.45 · [d10 Forms] Rate Management — Forms bypass the RHF + zodResolver(@crm2/sdk) pattern and lack inline validation
- **Evidence:** AddRateForm/ReviseDialog use raw useState (RateManagementPage.tsx:391-400,:562-563) + manual useMutation; validation is only a submit-disable predicate (:531-539,:621) with no per-field error messages
- **Fix:** Use react-hook-form + zodResolver against a schema imported from @crm2/sdk and render inline field errors, matching the shared form pattern

### P2.46 · [d10 Forms] RBAC Roles (Access Control) — RoleDialog form is hand-rolled (no RHF + zod schema, no inline field errors)
- **Evidence:** RolesPage.tsx:277-298 (raw useState fields), :353 (manual canSave regex /^[A-Z][A-Z0-9_]{1,19}$/), :568 (single bottom-of-form error string only) — diverges from the shared react-hook-form + zodResolver(@crm2/sdk schema) form contract with inline per-field validation.
- **Fix:** Adopt the shared RHF + zodResolver pattern bound to an @crm2/sdk role schema and surface inline per-field errors below each input; keep the existing OCC/ConflictDialog wiring (already correct).

### P2.47 · [d5 Import/Export] Report Layouts (MIS Layouts) — Admin list has no Export (exportFn not wired)
- **Evidence:** ReportLayoutsPage.tsx:794-808 — DataGrid is rendered without exportFn, so no Export menu / apiExport job-threshold path exists for this list.
- **Fix:** Pass exportFn (→ apiExport against /report-layouts/export) so the DataGrid Export menu (DataGrid.tsx:438-503) and the <10k file / ≥10k 413-job rule engage.

### P2.48 · [d9 Status/₹/Date] Report Layouts (MIS Layouts) — Status chip hand-rolled and diverges from the shared StatusChip tone
- **Evidence:** ReportLayoutsPage.tsx:735-739 uses bg-surface-muted for INACTIVE, whereas the shared StatusChip uses bg-muted for INACTIVE (StatusChip.tsx:7) — same status, different chip.
- **Fix:** Render status via apps/web/src/components/StatusChip.tsx (ACTIVE/INACTIVE) to centralize the chip and remove the bg-surface-muted vs bg-muted divergence.

### P2.49 · [d3 Filters] Report Layouts (MIS Layouts) — No per-column filters or date-range filters on a multi-dimension admin list
- **Evidence:** ReportLayoutsPage.tsx:718-774 — no column sets filterable/filterOptions; ReportLayoutsPage.tsx:794-808 — no dateFilters and no domain filters prop. Only global search filters the list.
- **Fix:** Add filterable/filterOptions on client/product/kind/status columns and a dateFilters entry for createdAt/updatedAt using the DataGrid's canonical f_<id> / f_<id>_from-to surface (DataGrid.tsx:216-238,699-723).

### P2.50 · [d8 States] Security — SessionList rolls its own loading/empty instead of the banded loader
- **Evidence:** SessionList.tsx:33-36 renders 'Loading…' text and 'No active sessions.' rather than HexagonLoader + useLoadingBand; no error state for the sessions query or revoke mutation.
- **Fix:** Adopt useLoadingBand + HexagonLoader for the loading band and the standard empty/error states (the DataGrid loading/empty/error primitives) instead of bespoke text.

### P2.51 · [d10 Forms] Security — MFA forms bypass the shared RHF + zodResolver(@crm2/sdk) form pattern
- **Evidence:** SecurityPage.tsx:13-45 uses raw useState + useMutation with a generic catch-all error string (:35,:44) and no inline per-field validation.
- **Fix:** Migrate the enroll/verify/disable inputs to react-hook-form + zodResolver against an @crm2/sdk schema with inline field errors, keeping the existing .input/.btn classes.

### P2.52 · [d8 States] System — Bespoke loading state — plain 'Loading…' text instead of the banded HexagonLoader
- **Evidence:** apps/web/src/features/system/SystemPage.tsx:36 (<p className="text-sm text-muted-foreground">Loading…</p>)
- **Fix:** Adopt useLoadingBand(isLoading) (apps/web/src/lib/useLoadingBand.ts) + HexagonLoader (apps/web/src/components/ui/HexagonLoader.tsx) — the single platform loader; spinners/plain-text loaders are forbidden by PAGINATION_AND_LOADING_STANDARDS.

### P2.53 · [d8 States] System — Error state has no Retry affordance and is not announced
- **Evidence:** apps/web/src/features/system/SystemPage.tsx:37 (<p className="text-sm text-destructive">Failed to reach the API.</p>)
- **Fix:** Render the error in a block with role=alert and a Retry button wired to the useQuery refetch (destructure refetch from useQuery at SystemPage.tsx:19); matches the DataGrid error+retry pattern.

### P2.54 · [d10 Forms] Templates (Report Templates) — Edit/Create form not built on the shared react-hook-form + zodResolver(@crm2/sdk) contract
- **Evidence:** TemplatesPage.tsx:182-191 raw useState fields; ad-hoc validation '!name || code.length<2' at :306 with no per-field inline errors and no zod schema imported from @crm2/sdk.
- **Fix:** Use the canonical RHF + zodResolver against an @crm2/sdk template schema for the dialog, rendering inline field errors below each field (keep the existing ConflictDialog OCC wiring, which is already correct). Note this is a shared deviation inherited from MasterDataCrud, so fixing the shared form pattern lifts both.

### P2.55 · [d7 A11y] Users — Export-error modal is an untrapped, unlabeled overlay
- **Evidence:** UsersPage.tsx:263-275 — bespoke fixed overlay with a focusable OK button but no useFocusTrap, no role=dialog, aria-modal, or aria-labelledby (unlike ResetPasswordDialog/UserDialog/ConflictDialog which all trap focus).
- **Fix:** Wrap it in useFocusTrap (useFocusTrap.ts:29) with role=dialog/aria-modal/aria-labelledby, or reuse the shared ConflictDialog/dialog shell; this disappears entirely if the Export Scope finding (P1) is fixed via apiExport's standard error path.

### P2.56 · [d8 States] Users — Policy-acceptance sub-list uses ad-hoc loading/empty states + a bespoke table
- **Evidence:** UsersPage.tsx:860-891 — PolicyAcceptancesSection renders plain 'Loading…' text (disallowed spinner-equivalent), its own error/empty copy, and a raw <table> instead of the time-banded Hexagon/skeleton system and the Universal DataGrid.
- **Fix:** Use useLoadingBand+HexagonLoader (or the DataGrid's inline skeleton/empty/error) for states, and render the log through the DataGrid (or accept as dialog chrome but at minimum adopt the shared loading primitive).

## P3 (45)

### P3.1 · [d13 Consistency] Admin CRUD cluster (MasterDataCrud + Clients/Products/Locations/Departments/Designations/VerificationUnits) — Code inputs mutate case via .toUpperCase() in onChange (violates WYSIWYG/CSS-only uppercase rule)
- **Evidence:** MasterDataCrud.tsx:260 (setCode(e.target.value.toUpperCase())) and VerificationUnitDialog.tsx:122-129 (toUpperCase + regex) mutate an editable input's value; the uppercase-display standard requires display-casing be CSS-only and inputs stay WYSIWYG.
- **Fix:** Stop case-mutating the editable field; apply UPPER_SNAKE coercion only at submit/normalize time (or via CSS text-transform on display) and validate with the shared schema, keeping the input WYSIWYG.

### P3.2 · [d13 Consistency] Admin CRUD cluster (MasterDataCrud + Clients/Products/Locations/Departments/Designations/VerificationUnits) — Inconsistent page-header flex alignment across the cluster
- **Evidence:** items-center justify-between (MasterDataCrud.tsx:121; VerificationUnitsPage.tsx:157) vs items-start justify-between gap-2 (LocationsPage.tsx:186; DepartmentsPage.tsx:99; DesignationsPage.tsx:105).
- **Fix:** Standardize the page-header row markup (single shared header wrapper) so spacing/alignment is identical across all admin pages.

### P3.3 · [d7 A11y] App Shell (Layout / nav / JobsTray / NotificationBell / UserMenu / HeaderClock) — Live-updating unread / active-job badges have no aria-live announcement
- **Evidence:** NotificationBell.tsx:89-93 (unread badge) and JobsTray.tsx:102-106 (active-job badge) update live via useRealtimeNotifications/useRealtimeJobs (Layout.tsx:154-156) but carry no aria-live region; the count change is silent to screen readers. grep aria-live across the 5 shell files = NONE_FOUND.
- **Fix:** Wrap the badge counts in an aria-live="polite" region (the same live-region approach the DataGrid uses for selection/updating announcements) so assistive tech hears new notifications/jobs.

### P3.4 · [d7 A11y] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Login/change-password inline errors are not announced to screen readers
- **Evidence:** LoginPage.tsx:92 <p className="... text-destructive">{error}</p> and MustChangePasswordPage.tsx:88/:90 render submit/validation errors with no role=alert / aria-live, so SR users get no notification when a sign-in or change fails.
- **Fix:** Add role=alert (or aria-live=assertive) to the inline error <p>, matching the live-region a11y convention used in SessionTimeoutModal.tsx:29.

### P3.5 · [d10 Forms] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Auth forms are hand-rolled useState, not the shared RHF + zodResolver(@crm2/sdk) pattern
- **Evidence:** LoginPage.tsx:11-16 and MustChangePasswordPage.tsx:16-20 use raw useState fields with manual validation/submit gating, diverging from the react-hook-form + zodResolver-against-@crm2/sdk-schema form standard.
- **Fix:** Move to react-hook-form + zodResolver with the login/change-password schemas exported from @crm2/sdk for consistent inline-error rendering and pending/disabled handling.

### P3.6 · [d12 Reuse] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Accept-policies dialog chrome is a one-off reimplementation
- **Evidence:** MustAcceptPoliciesPage.tsx:24-51 builds its own modal frame (backdrop card + header/scroll/footer) instead of composing the established dialog primitives; ConflictDialog.tsx and SessionTimeoutModal.tsx (SessionTimeoutModal.tsx:15-24) show the canonical aria-modal + useFocusTrap composition it omits.
- **Fix:** Reuse useFocusTrap + the role=dialog/aria-modal scaffolding (ConflictDialog.tsx:31-40) rather than bespoke dialog chrome; no shared generic Modal exists, so at minimum match that composition.

### P3.7 · [d6 Responsive] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Touch targets below ~44px on auth buttons/inputs (shared-class shortfall)
- **Evidence:** LoginPage.tsx:94-100, MustChangePasswordPage.tsx:92-101, SessionTimeoutModal.tsx:35-39 inherit .btn/.btn-ghost (index.css:14-19 py-1.5 ≈ 32px) and .input (index.css:11-13 py-1.5); none meet the ~44px mobile touch-target bar.
- **Fix:** Raise the shared .btn/.btn-ghost/.input min-height to ~44px in index.css (primitive-level fix benefits all pages), per RESPONSIVE_DESIGN_STANDARD.

### P3.8 · [d8 States] Auth & gates (LoginPage · MustChangePasswordPage · MustAcceptPoliciesPage · SessionTimeoutModal · PasswordPolicyChecklist) — Auth-probe loading uses raw text instead of the Hexagon loading band
- **Evidence:** App.tsx:45-50 renders a bare 'Loading…' text div during the initial session probe rather than the time-banded HexagonLoader + useLoadingBand system (the loading primitive mandated by PAGINATION_AND_LOADING_STANDARDS). This is the loading surface that precedes the login gate.
- **Fix:** Use HexagonLoader (apps/web/src/components/ui/HexagonLoader.tsx) gated by useLoadingBand (apps/web/src/lib/useLoadingBand.ts) for the boot probe. Note: App.tsx is outside the named file set but is the gate's loading state.

### P3.9 · [d9 Status/₹/Date] Billing & Commission — Bespoke inline money() formatter duplicated across Billing/RateManagement/CommissionRates; no Intl en-IN grouping
- **Evidence:** BillingPage.tsx:20-23 (`money`, `lineMoney` → `₹${n.toFixed(2)}`); identical copies at RateManagementPage.tsx:28 and CommissionRatesPage.tsx:25. lib/format.ts:11-32 exports only date helpers — no shared rupee formatter exists.
- **Fix:** Add a single shared rupee formatter to apps/web/src/lib/format.ts (e.g. Intl.NumberFormat('en-IN', {style:'currency',currency:'INR'})) and replace the three inline copies; centralizing also fixes the missing thousands grouping.

### P3.10 · [d7 A11y] Billing & Commission — Bespoke data tables miss the DataGrid a11y scaffolding (focusable horizontal-scroll region, sort semantics)
- **Evidence:** BillingPage.tsx:42-103 and :122-204 are plain <table>s with a <thead> but no focusable scroll wrapper; contrast DataGrid.tsx:653-657 (tabIndex=0 role=group aria-label) and :687 (aria-sort).
- **Fix:** Adopting DataGrid for these lists (see the Dim 2 finding) supplies the focusable scrollable-region and header semantics; otherwise wrap them in the same tabIndex=0 role=group scroll container.

### P3.11 · [d9 Status/₹/Date] Case create — Workflow-status token st-revisit repurposed for non-status match-type chips
- **Evidence:** CaseCreatePage.tsx:330-334 (bg-st-revisit-bg text-st-revisit on match-type 'NAME'/'PAN' labels)
- **Fix:** Use a neutral chip (bg-muted text-muted-foreground) or a shared chip component for match-type tags; reserve st-* tokens for actual workflow status

### P3.12 · [d7 A11y] Case create — Horizontal-scroll dedupe table region is not keyboard-focusable
- **Evidence:** CaseCreatePage.tsx:285 (overflow-x-auto wrapper, no tabIndex/role=group/aria-label) vs DataGrid.tsx:653-657
- **Fix:** Adopt DataGrid (which makes the scroll region focusable) or add tabIndex=0 role=group aria-label to the scroll wrapper to satisfy axe scrollable-region-focusable

### P3.13 · [d10 Forms] Case create — Manual useState validation instead of RHF+zodResolver(@crm2/sdk)
- **Evidence:** CaseCreatePage.tsx:104-114 (hand-rolled canCreate/disabledReason); zero react-hook-form usages in apps/web/src
- **Fix:** Codebase-wide: no RHF anywhere, so this is an adopt-the-standard item, not a page regression; if RHF is adopted, drive validation from an @crm2/sdk zod schema (reuses PAN_REGEX/PHONE_REGEX already imported at CaseCreatePage.tsx:5)

### P3.14 · [d9 Status/₹/Date] Case detail — Field-photo capture time uses toLocaleString instead of formatDateTime
- **Evidence:** CaseDetailPage.tsx:1721 — new Date(captureTime).toLocaleString().
- **Fix:** Use the shared formatDateTime helper (apps/web/src/lib/format.ts:11-16) for consistent DD Mon YYYY, HH:MM rendering.

### P3.15 · [d13 Consistency] Case detail — Page lacks the standard H1+subtitle header / shell padding; custom status pill reimplements a chip
- **Evidence:** CaseDetailPage.tsx:106 (custom '← Back to cases' link), :112 (H1 with no subtitle), :115-119 (inline status pill), :105 (space-y-4 local spacing, not px-6 py-5 shell).
- **Fix:** Adopt the standard page-header pattern (H1 + one-line subtitle, primary action right) and shared spacing/density from Layout; render the case status via the frozen status-token chip idiom consistently (it already uses st-* tones, just inline).

### P3.16 · [d12 Reuse] Cases list — Inline status-label casing duplicates the shared CASE_STATUS_LABELS
- **Evidence:** CasesPage.tsx:8-14 hand-rolls title-casing of CASE_STATUSES for STATUS_OPTIONS and CasesPage.tsx:50 re-derives the cell label, instead of importing CASE_STATUS_LABELS from @crm2/sdk (packages/sdk/src/cases.ts:27-34) that CaseDetailPage.tsx:10,118 already uses — risk of label drift.
- **Fix:** Import and use CASE_STATUS_LABELS from @crm2/sdk for both the filter options and the Status cell, removing the inline casing helper.

### P3.17 · [d3 Filters] Cases list — Created column is sortable but not date-filterable
- **Evidence:** CasesPage.tsx:53-57 declares createdAt sortable only; no dateFilters prop is passed to the DataGrid, so the standard From/To date-window surface (DataGrid.tsx:99-103,570-595) is unavailable on a timestamped operational list.
- **Fix:** Pass dateFilters={[{id:'createdAt',label:'Created'}]} to the DataGrid (and whitelist createdAt as kind:'date' in the server PageSpec.filterMap) to reuse the canonical date-range filter.

### P3.18 · [d3 Filters] Commission Rates — No per-column header filters on a multi-dimension list
- **Evidence:** CommissionRatesPage.tsx:328-431 — zero columns set filterable; DataGrid supports it (DataGrid.tsx:698-723); MasterDataCrud.tsx:69,72 marks columns filterable
- **Fix:** Mark user/client/classification/status columns `filterable:true` (filterOptions for status/classification) to enable the DataGrid's standard per-column filter row; whitelist each f_<id> in the server PageSpec.filterMap.

### P3.19 · [d12 Reuse] CPV — Page-local RescheduleDialog duplicates the shared dialog shell
- **Evidence:** CpvPage.tsx:29-87 defines a bespoke modal (fixed inset-0, role=dialog, useFocusTrap) reused for both link and unit reschedule; the same shell pattern is re-implemented per page rather than a shared dialog primitive.
- **Fix:** No shared generic dialog primitive exists today (only ConflictDialog/ImportModal are shared). Acceptable, but if a shared Dialog shell is introduced, route this through it; meanwhile keep the single page-local RescheduleDialog (already shared across both call sites here).

### P3.20 · [d2 Table] CPV — Main grid does not offer bulk activate/deactivate despite being master-data rows
- **Evidence:** CpvPage.tsx:310-330 omits selectable/bulkActions; per-row Activate/Deactivate are inline buttons (CpvPage.tsx:223-228). DataGrid notes renderExpanded is row-click-exclusive (DataGrid.tsx:123-131), which conflicts with row-select UX.
- **Fix:** Intentional given renderExpanded uses the row click; if bulk (de)activation is desired, wire selectable+bulkActions with BulkStatusActions (BulkStatusActions.tsx:23-31). Low priority — flag only.

### P3.21 · [d8 States] Dashboard — Error states say 'Please retry' but offer no Retry affordance
- **Evidence:** DashboardPage.tsx:42-44, PortfolioTable.tsx:23-25, RosterSummary.tsx:30-31 render static 'Please retry'/'Couldn't load' text with no button wired to refetch.
- **Fix:** Add a Retry button (calls react-query refetch) to each error state, consistent with the DataGrid's inline error+retry pattern.

### P3.22 · [d12 Reuse] Dashboard — One-off CompletionBar mini progress bar (no shared primitive)
- **Evidence:** PortfolioTable.tsx:76-90 implements a bespoke completion/progress bar; the platform has no shared sparkline/bar primitive.
- **Fix:** Tolerable as-is given no shared primitive; if portfolio moves to DataGrid, render it inside a DataGridColumn cell to keep table chrome unified.

### P3.23 · [d13 Consistency] Dedupe — Search button uses undefined '.btn-primary' class instead of the canonical bare '.btn'
- **Evidence:** DedupePage.tsx:169 className="btn btn-primary"; .btn-primary is defined nowhere (grep across apps/web/src + packages returns this single usage and zero definitions — index.css:14-19 defines only .btn/.btn-ghost). All sibling pages use className="btn" (ReportLayoutsPage.tsx:674/789, CommissionRatesPage.tsx:287/454, RolesPage.tsx:193, SecurityPage.tsx:74).
- **Fix:** Use the shared .btn component class alone (className="btn") — it already applies bg-primary/text-primary-foreground (index.css:14-16); remove the inert non-canonical 'btn-primary' token to match the platform button convention.

### P3.24 · [d12 Reuse] Field Monitoring — Header KPI cards re-implement card chrome inline rather than a shared StatCard primitive
- **Evidence:** FieldMonitoringPage.tsx:161-177 hand-rolled `rounded-lg border border-border bg-card p-3` cards with inline label/value markup, duplicating the dashboard KPI pattern
- **Fix:** If a shared KPI/StatCard component exists (DashboardPage buckets), reuse it; otherwise the duplication is a candidate for a shared primitive to keep counter chrome consistent across Dashboard/Field Monitoring.

### P3.25 · [d7 A11y] Field Monitoring — Async stat values and address lookups are silent to assistive tech
- **Evidence:** FieldMonitoringPage.tsx:167-173 (cards) and :216-219 (AddressCell '…') update without aria-live/aria-busy, so screen readers get no announcement when values resolve
- **Fix:** Wrap the cards grid in aria-live='polite' and/or set aria-busy on values while stats.isLoading / geo.isLoading, mirroring the DataGrid's live-region wiring.

### P3.26 · [d7 A11y] Pipeline — Interactive controls below the ~44px touch target; ⚠ TAT meaning via title= only
- **Evidence:** apps/web/src/features/pipeline/PipelinePage.tsx:241 bucket chips px-3 py-1 text-xs; :429,:437 dialog buttons h-9 (~36px); :154-164 overdue chip conveys 'Out of TAT' via title= attribute (:158) with no aria-label
- **Fix:** Adopt the shared sizing used elsewhere and bump interactive controls to min-h ~44px on touch; give the ⚠ TAT chip an aria-label (or sr-only text) so the warning is announced, per the a11y standard the DataGrid already follows

### P3.27 · [d10 Forms] Pipeline — Bulk-assign form is imperative, not the RHF + zodResolver(@crm2/sdk) pattern
- **Evidence:** apps/web/src/features/pipeline/PipelinePage.tsx:293-348 uses useState fields + manual run() with no react-hook-form/zodResolver and no inline per-field validation (only the disabled-submit guard at :439). The BulkAssignSchema exists in @crm2/sdk (packages/sdk/src/tasks.ts:84-95) but is not wired to the form
- **Fix:** Where a richer form is warranted, wire react-hook-form + zodResolver(BulkAssignSchema from @crm2/sdk) for inline validation; per-row OCC handling (version summarization) is already correct and should stay

### P3.28 · [d7 A11y] Policies — Save-error message is not announced to screen readers
- **Evidence:** PolicyDialog.tsx:93 renders the save error as a plain <p>, unlike DataGrid's role=alert export error (DataGrid.tsx:597-601).
- **Fix:** Add role="alert" to the error paragraph at PolicyDialog.tsx:93 to mirror the shared error-region pattern.

### P3.29 · [d11 RBAC-UI] Policies — Write-action buttons not client-gated; page does not call useAuth/has
- **Evidence:** PoliciesPage.tsx:71-79,97 expose New/Edit/Activate with no has(perm) check; App.tsx:78 route is unguarded (consistent with app-wide convention, but the page doesn't independently mirror server gating).
- **Fix:** If a distinct manage permission applies, gate the write buttons with useAuth().has(...) (AuthContext.tsx:135) so action visibility mirrors the server; otherwise document that page.policies covers both read and manage.

### P3.30 · [d8 States] Profile — Loading uses plain text instead of the time-banded Hexagon system; no Retry on error
- **Evidence:** ProfilePage.tsx:267,319 and SessionList.tsx:34 render plain 'Loading…' text (standard forbids plain-text/spinner loaders); error states (ProfilePage.tsx:269,327) offer no Retry affordance.
- **Fix:** Use HexagonLoader + useLoadingBand (components/ui/HexagonLoader.tsx; lib/useLoadingBand.ts) for loading and add a Retry button to the error states.

### P3.31 · [d9 Status/₹/Date] Profile — Active/Inactive rendered as bespoke bg-primary/10 pill, not the frozen status chip
- **Evidence:** ProfilePage.tsx:71-77 builds an ad-hoc pill (bg-primary/10 text-primary // bg-muted text-muted-foreground) for the user's active state instead of StatusChip; SessionList.tsx:45-47 similarly hand-rolls the 'This device' badge.
- **Fix:** Use StatusChip (components/StatusChip.tsx:4-13) or the frozen text-st-*/bg-st-*-bg token pair for the Active/Inactive state.

### P3.32 · [d10 Forms] Profile — Forms hand-rolled with useState + imperative safeParse instead of RHF + zodResolver
- **Evidence:** ProfilePage.tsx:38-39,46,167-169,175 manage form state via useState and call UpdateSelfProfileSchema/ChangePasswordSchema.safeParse imperatively rather than react-hook-form + zodResolver(@crm2/sdk).
- **Fix:** Adopt the shared RHF + zodResolver(@crm2/sdk) form pattern; keep the .input class. (No OCC token is exposed by the self-scoped writes — ConflictDialog is not wired; verify whether the server expects a version for /users/me/profile.)

### P3.33 · [d8 States] Rate Management — HistoryDialog bypasses the banded loading system and omits error/empty states
- **Evidence:** RateManagementPage.tsx:668-669 shows a plain 'Loading history…' text instead of HexagonLoader/useLoadingBand, with no error/Retry and no empty-history state at :680
- **Fix:** Reuse HexagonLoader + useLoadingBand for the loading band and add error (Retry) + empty-message states

### P3.34 · [d3 Filters] Rate Management — Page-level client/product filters not URL-persisted
- **Evidence:** RateManagementPage.tsx:127-128 hold clientId/productId in component state and pass them via the filters prop (:313); unlike the grid's q/sort/page/f_* state they are not in the URL, so a bookmarked link drops those two picks
- **Fix:** Persist the two domain filters in the URL via the DataGrid filter contract (f_* keys) so the full screen state is bookmarkable

### P3.35 · [d3 Filters] RBAC Roles (Access Control) — Enum columns not exposed as standard multi-select header filters
- **Evidence:** RolesPage.tsx:71,131,150 (hierarchyMode/kind/status) have no filterOptions; status is instead filtered via a one-off toolbar <select> at :211-220, duplicating the canonical f_<id> Excel-style multi-select the DataGrid already supports (DataGrid.tsx:52-53,706-712).
- **Fix:** Add col.filterOptions to hierarchyMode/kind/status (and drop or fold the bespoke toolbar status <select> into it) so all filtering uses the standard ColumnFilterSelect surface and URL keys.

### P3.36 · [d2 Table] RBAC Roles (Access Control) — Grid is not selectable — no bulk activate/deactivate or selected-export
- **Evidence:** RolesPage.tsx:198-222 omits selectable/bulkActions; the per-row Deactivate (:168-175) is the only path, and selected-mode export (DataGrid.tsx:399-401,624-643) is unavailable.
- **Fix:** If bulk role (de)activation or selected export is desired, pass selectable + bulkActions and reuse BulkStatusActions (the OCC-aware bulk bar) per DataGrid §15; otherwise document this as intentionally single-row.

### P3.37 · [d12 Reuse] Report Layouts (MIS Layouts) — Per-row activate/deactivate instead of BulkStatusActions
- **Evidence:** ReportLayoutsPage.tsx:758-771 — bespoke per-row Edit/Activate/Deactivate buttons; the grid is not selectable and BulkStatusActions is not used.
- **Fix:** Make the DataGrid selectable and provide bulkActions via apps/web/src/components/BulkStatusActions.tsx for version-guarded bulk activate/deactivate.

### P3.38 · [d7 A11y] Report Layouts (MIS Layouts) — Unlabeled Required checkbox + save error not announced (no role=alert)
- **Evidence:** ReportLayoutsPage.tsx:647-651 (Required checkbox bound only to an adjacent text node) and :668 (save-error <p> is plain text, no role=alert).
- **Fix:** Add an explicit label/aria-label to the Required checkbox and role=alert to the error <p>, matching the ConflictDialog/DataGrid (DataGrid.tsx:598) error conventions.

### P3.39 · [d9 Status/₹/Date] Security — MFA ON/OFF and 'This device' rendered as color-only text, not a token chip
- **Evidence:** SecurityPage.tsx:61-67 ON/OFF is plain text-primary/text-muted-foreground; SessionList.tsx:45 'This device' is a near-chip but state-as-color-only.
- **Fix:** Render the binary state as a soft-bg token chip (bg-st-approved-bg/text-st-approved family, soft-bg+strong-fg) so color is never the sole signal.

### P3.40 · [d7 A11y] System — Loading/error <p>s lack aria-live/role=alert
- **Evidence:** apps/web/src/features/system/SystemPage.tsx:36-37
- **Fix:** Using HexagonLoader (role=status aria-live, HexagonLoader.tsx:30-31) for loading and role=alert for the error resolves the a11y gap together with the States finding.

### P3.41 · [d12 Reuse] System — One-off Card layout helper defined inline
- **Evidence:** apps/web/src/features/system/SystemPage.tsx:87-94 (function Card)
- **Fix:** Low priority — no shared card primitive exists in the audited set; if a shared metric/card primitive is later added, migrate this and the Record-Counts tile (:72) to it for consistency.

### P3.42 · [d13 Consistency] System — Page header sizing/rhythm not confirmed against the shared admin-page convention
- **Evidence:** apps/web/src/features/system/SystemPage.tsx:28-34 (space-y-4 wrapper, h1 text-xl font-bold)
- **Fix:** Align H1 sizing/spacing to the shared header convention used by sibling admin pages (Layout provides px-6 py-5 page padding); cosmetic only.

### P3.43 · [d7 A11y] Templates (Report Templates) — Save-failure error text lacks role=alert for assistive announce
- **Evidence:** TemplatesPage.tsx:294 <p className="text-sm text-destructive">{error}</p> — visually present but not announced (DataGrid's own export error correctly uses role=alert at DataGrid.tsx:598).
- **Fix:** Add role="alert" to the dialog error <p> to match the shared error-announce convention used by DataGrid.tsx:598.

### P3.44 · [d6 Responsive] Users — Row action buttons and chip-remove buttons miss 44px touch targets and can crowd the mobile card
- **Evidence:** UsersPage.tsx:162-184 — 4 inline text buttons in a whitespace-nowrap flex (no .btn class, no min-h/min-w); UserAccessSection.tsx:219-225,278-284 — chip × buttons are bare text. None meet the ~44px target on the .rtable card row.
- **Fix:** Apply the shared .btn-ghost sizing or a min-h-[44px]/min-w-[44px] tap area to row actions and chip-remove controls per RESPONSIVE_DESIGN_STANDARD; consider an overflow/menu for the 4-action cluster on narrow widths.

### P3.45 · [d10 Forms] Users — Forms hand-roll validation instead of RHF + zodResolver(@crm2/sdk)
- **Evidence:** UsersPage.tsx:481-586 — useState fields with imperative phoneValid regex and a canSave/saveDisabledReason ladder duplicating server rules; UserAccessSection.tsx:298-360 pickers likewise. The canonical pattern is react-hook-form + zodResolver against an @crm2/sdk schema.
- **Fix:** Migrate UserDialog/ResetPasswordDialog to react-hook-form + zodResolver using the shared Create/Update user schemas from @crm2/sdk for inline field errors; keep the existing .input class and ConflictDialog OCC handling.

