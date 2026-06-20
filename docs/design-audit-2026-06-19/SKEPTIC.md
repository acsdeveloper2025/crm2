# Skeptic / QA Re-Verification

_Adversarial re-check of the load-bearing verdicts to catch theater (false-PASS / false-FAIL). Re-verified 17 high-stakes verdicts at source._

## Bottom line

**No false-PASS found. No false-FAIL found.** 17 re-verified verdicts held up. 2 **calibration refinements** (severity/scope, not correctness of the code facts):

### Templates (Report Templates) — dimension 11
- **Claimed:** P1 RBAC leak — write buttons (+New/Edit/Activate/Deactivate/bulk) shown to read-only page.templates users; equal severity to the Cases-list and Rate-Management P1 leaks.
- **Corrected:** The CODE facts are SOLID (TemplatesPage has zero useAuth/has gating — verified empty grep; routes require TEMPLATE_MANAGE for writes vs TEMPLATE_VIEW for read — reportTemplates/routes.ts:11-20; ReportLayouts sibling gates correctly at :776). But the P1 severity is OVERSTATED on reachability: no SEEDED default role has page.templates without report_template.manage — only SUPER_ADMIN (grantsAll) carries TEMPLATE_VIEW in ROLE_PERMISSIONS (permissions.ts:88,104-127). The leak is reachable ONLY via a custom runtime role (ADR-0022 role_permissions is editable) that grants page.templates but withholds report_template.manage. Contrast: the Cases-list (TL+BE have case.view, not case.create — permissions.ts:104-125) and Rate-Management (MGR/TL/BE have page.masterdata, not masterdata.manage) leaks ARE reachable by seeded roles TODAY. Recommend downgrading the Templates leak to P2-latent (custom-role-only), keeping Cases/Rates at P1.
- **Why:** Re-verifying the role map (permissions.ts:87-128) shows TEMPLATE_VIEW/page.templates is SUPER_ADMIN-only in the seeded set, so the day-0 attack surface is empty unless an admin authors a custom role — materially lower exposure than the two genuinely-reachable P1 leaks it was equated with.
- **Evidence:** permissions.ts:88 (SUPER_ADMIN=Object.values(PERMISSIONS)), :104-127 (MANAGER/TEAM_LEADER/BACKEND_USER/FIELD_AGENT/KYC_VERIFIER lists — none contain TEMPLATE_VIEW); reportTemplates/routes.ts:11 (read=TEMPLATE_VIEW) vs :14-20 (writes=TEMPLATE_MANAGE); TemplatesPage.tsx grep for useAuth/has/report_template.manage = empty; ReportLayoutsPage.tsx:776 (sibling has the gate).

### Billing & Commission — dimension 2
- **Claimed:** Two bespoke data lists violate the DataGrid contract with equal weight: (a) the per-task BillingCaseLines table and (b) the by-location/by-band BillingBreakdownPanels — both 'hand-rolled <table>s instead of the Universal DataGrid.'
- **Corrected:** Half of this is overstated. BillingCaseLines (raw <table> at BillingPage.tsx:43) is rendered through the DataGrid's renderExpanded slot (BillingPage.tsx:304), which is a SANCTIONED DataGrid feature for master-detail row content (DataGrid.tsx:130 + doc :123-128, DATAGRID_STANDARD §20 — 'Used by CPV (the unit manager)'). Custom JSX inside renderExpanded is the contract, not a violation — so flagging the case-lines table as 'should be DataGrid' contradicts the platform's own master-detail pattern. Only BillingBreakdownPanels (raw tables at :122/:165, rendered standalone at :321 OUTSIDE any DataGrid) is a fair bespoke-table flag. The reuse cross-sweep already noted this correctly ('BillingPage's raw tables 43/122/165 are correctly nested inside a DataGrid renderExpanded') — the per-page Billing D2 finding contradicts that sweep by lumping the nested table in.
- **Why:** renderExpanded is an opt-in DataGrid capability whose entire purpose is hosting bespoke detail markup; counting its content as a DataGrid-reuse violation double-penalizes correct use of the primitive. The finding is not false (breakdown panels remain valid) but its scope/weight should drop to the breakdown panels only.
- **Evidence:** BillingPage.tsx:32-43 (BillingCaseLines defines the table) used at :304 renderExpanded={(r)=><BillingCaseLines .../>}; DataGrid.tsx:130 renderExpanded?:(row)=>ReactNode + doc :123-128 (DATAGRID_STANDARD §20, master-detail, ephemeral expansion); BillingBreakdownPanels at :110 (tables :122/:165) rendered standalone at :321 — not in any grid slot.

## Re-verification notes

SCOPE: Re-verified by reading cited file:line myself for every PASS on Dashboard/Pipeline/Cases-list/Case-detail/Billing/Users(via shared)/Admin-CRUD cluster plus ALL P0/P1 findings and the cross-cutting token+a11y+reuse sweeps. Worktree clean at the cited paths.

NO FALSE-PASS FOUND. Every load-bearing verdict I checked is supported by the cited evidence. NO FALSE-FAIL FOUND.

CONFIRMED SOLID (17 high-stakes verdicts re-verified at source):
1. Token sweep PARTIAL=2 violations: independent grep across apps/web/src confirms EXACTLY 2 — text-amber-600 (AddTasksForm.tsx:173) and text-st-completed (CaseCreatePage.tsx:257, a dead class: st set is 8 names, no 'completed' — tailwind-preset.js:45-53); zero hex, zero dark:, zero named-palette beyond the one. success/warning ARE valid frozen tokens (preset:42-43).
2. Cases-list P1 RBAC leak (CasesPage.tsx:69 +New Case ungated, no useAuth import; POST /cases=CASE_CREATE routes.ts:19 vs list=CASE_VIEW routes.ts:78; case.view/case.create distinct permissions.ts:31-32) — REACHABLE BY SEEDED ROLES (TEAM_LEADER permissions.ts:104-112 + BACKEND_USER :113-125 have case.view, NOT case.create; nav gates /cases on case.view Layout.tsx:38).
3. RateManagement P1 RBAC leak (RateManagementPage.tsx zero useAuth/has — empty grep; all writes=MASTERDATA_MANAGE rates/routes.ts:24-32; reads=MASTERDATA_VIEW; nav=page.masterdata Layout.tsx:51) — REACHABLE (MGR/TL/BE have page.masterdata not masterdata.manage). Sibling CommissionRatesPage gates the whole page on has('masterdata.manage') :433 — pattern is real.
4. Templates P1 RBAC code facts SOLID but reachability overstated — see overturned[0].
5. CommissionRates P1 a11y FAIL: dialog has role=dialog+aria-modal (:123-124) but NO useFocusTrap/Escape/aria-labelledby (grep returned only those 2 lines). Cross-checked role=dialog files (17) minus useFocusTrap importers — CommissionRatesPage is the EXACTLY-ONE outlier; 'only dialog missing it' claim is accurate.
6. MustAcceptPoliciesPage P2 a11y: dialog-styled card (MustAcceptPoliciesPage.tsx:26) with NO role=dialog/aria-modal/useFocusTrap and a non-focusable overflow-y-auto scroll region (:33) — SOLID.
7. CaseDetailPage P1 cluster: DataGrid never imported (empty grep), 3 raw <table className=rtable> at :143/:462/:1107, top-level <p>Loading…</p>/<p>Case not found.</p> with no Retry (:101-102) — SOLID.
8. Dashboard PortfolioTable D2/D4/D8: unbounded PortfolioRow[] array fetch (:14, no PageQuery/Paginated), bespoke animate-pulse skeleton (:28), raw <table> (:33) — SOLID.
9. Dedupe P3 dead class: btn-primary used once (DedupePage.tsx:169), undefined in index.css (only .btn/.btn-ghost at :14-19); .btn does apply bg-primary (:15) so it still renders — SOLID.
10. a11y route-coverage P2: a11y.spec PAGES = 13 routes (lines 18-35); /cases/:id, /cases/new, /dashboard, /profile, /security, /dedupe, /field-monitoring, /admin/{departments,designations,policies} all absent (grep=0); Locations omission is documented (:22-25) — SOLID.
11. DataGrid scroll-region a11y PASS: tabIndex=0 role=group aria-label confirmed DataGrid.tsx:653-658.
12. Pipeline D2 PASS: zero <table> in PipelinePage, DataGrid imported (:22).
13. Money-formatter duplication: format.ts exports only date helpers (:11/:19/:27); const money duplicated verbatim at RateManagement:28, CommissionRates:25, Billing:20 — SOLID.
14-17. renderExpanded is a real DataGrid feature (DataGrid.tsx:130, doc §20); .btn def applies bg-primary; permission constants distinct; ReportLayouts sibling gate at :776 — all confirmed.

TWO REFINEMENTS (not full overturns) recorded in overturned[]: Templates P1 reachability overstated (custom-role-only vs seeded for Cases/Rates), and Billing D2 overstates the renderExpanded-nested case-lines table (only the standalone breakdown panels are a fair flag — the reuse sweep already got this right, so the per-page finding internally contradicts the sweep).

Net: the page-audit results and sweeps are highly reliable; the two adjustments are about severity-calibration and scope, not correctness of the underlying code facts.
