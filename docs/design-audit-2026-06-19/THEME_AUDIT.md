# Theme & Design-System Audit — light + dark (`apps/web`)

**Date:** 2026-06-22 · **Audited rev:** origin/main `8a5f1f5` · **Method:** whole-tree hardcoded-color sweep + per-page surface→token map (8 agents) + skeptic + live light/dark capture. AUDIT-ONLY.

## Verdict — the redesign you want costs almost nothing

`packages/ui-theme/src/tokens.css` (frozen 2026-06-04) is a **complete professional light + dark palette**, and the FE is **~100% token-driven**. Whole-tree sweep of **83 files**: **ZERO** hex/rgb/hsl/`text-white`/`bg-black`/`dark:` overrides/arbitrary-color/inline-style colors/gradients — **exactly ONE** stray palette color + one broken token. Skeptic re-ran independent greps: **0 false positives, 0 missed.**

1. **Dark mode already works end-to-end** (proven live: dashboard, tables, dialogs, forms, tabs, badges all render under the `.dark` class). It only lacks a **toggle**.
2. **An awesome redesign = editing ONE file** (`tokens.css`). Change `--primary`/`--background`/`--radius`/surface/border tokens → the whole app re-skins in both themes. No page-by-page work.
3. Only **2 one-line fixes** to a perfectly clean theme.

## The only 2 theme defects in the whole app
- **named-palette** — `features/cases/AddTasksForm.tsx:229`: Tasks added, but some attachments failed to upload. — hardcoded amber-600 named Tailwind palette utility on a warning message; amb → **fix:** text-warning (semantic warning token; mirrors the sibling text-destructive warni
- **undefined token** — `features/cases/CaseCreatePage.tsx:299` `text-st-completed` (no such token; 8 status names have no completed) → unstyled in light AND dark. **Fix:** `text-st-approved`. (Both = audit finding H-7.)

## Dark-mode gap — the one thing to build

`.dark` is fully defined but **nothing adds the class** (no toggle, no `prefers-color-scheme`, no persisted pref). Ship dark = add **~1 toggle component** (set/remove `.dark` on `<html>`, persist per-user, optional system default). No per-page work — every surface already themes.

## Per-page dark-readiness

| Page | Dark-safe? | Notes |
|---|---|---|
| auth/LoginPage | PASS | token-driven |
| auth/MustChangePasswordPage | PASS | token-driven |
| auth/MustAcceptPoliciesPage | PASS | token-driven |
| auth/SessionTimeoutModal | PASS | token-driven |
| components/Layout | PASS | token-driven |
| components/JobsTray | PASS | token-driven |
| components/NotificationBell | PASS | token-driven |
| components/UserMenu | PASS | token-driven |
| components/HeaderClock | PASS | token-driven |
| dashboard/DashboardPage | PASS | token-driven |
| dashboard/components/CounterBar | PASS | token-driven |
| dashboard/components/KpiCard | PASS | token-driven |
| dashboard/components/PortfolioTable | PASS | token-driven |
| dashboard/components/RosterSummary | PASS | token-driven |
| pipeline/PipelinePage | PASS | token-driven |
| fieldMonitoring/FieldMonitoringPage | PASS | token-driven |
| billing/BillingPage | PASS | token-driven |
| CasesPage (list) | PASS | token-driven |
| CaseDetailPage (detail + tabs) | PASS | token-driven |
| CaseCreatePage (create) | FIX 1 | Undefined status token text-st-completed — bypasses the |
| AddTasksForm (add tasks, shared by create + detail) | FIX 1 | Hardcoded named Tailwind palette color text-amber-600 — |
| MasterDataCrud (renders ClientsPage + ProductsPage) | PASS | token-driven |
| DepartmentsPage | PASS | token-driven |
| DesignationsPage | PASS | token-driven |
| VerificationUnitsPage + VerificationUnitDialog.tsx | PASS | token-driven |
| LocationsPage (+ inline EditLocationDialog) | PASS | token-driven |
| Shared components (StatusChip / ConflictDialog / BulkStatusActions / DataGrid + SavedViewsPicker / Input / .btn .input utils) | PASS | token-driven |
| access/RolesPage | PASS | token-driven |
| policies/PoliciesPage | PASS | token-driven |
| policies/PolicyDialog | PASS | token-driven |
| templates/TemplatesPage | PASS | token-driven |
| reportLayouts/ReportLayoutsPage | PASS | token-driven |
| rateManagement/RateManagementPage | PASS | token-driven |
| commissionRates/CommissionRatesPage | PASS | token-driven |
| cpv/CpvPage | PASS | token-driven |
| users/UsersPage | PASS | token-driven |
| profile/ProfilePage | PASS | token-driven |
| security/SecurityPage | PASS | token-driven |
| system/SystemPage | PASS | token-driven |
| dedupe/DedupePage | PASS | token-driven |
| components/ui/data-grid/DataGrid | PASS | token-driven |
| components/import/ImportModal | PASS | token-driven |
| components/StatusChip | PASS | token-driven |
| components/ConflictDialog | PASS | token-driven |
| components/ui/HexagonLoader | PASS | token-driven |
| apps/web/src/index.css (shared utility layer consumed by all of the above) | PASS | token-driven |

## Redesign levers — edit in `tokens.css` (`:root` + `.dark`)

| Token | Light → Dark | Drives |
|---|---|---|
| `--background` | white → charcoal 222 28% 9% | page bg |
| `--card`/`--popover` | white → 222 24% 12% | cards, dialogs, menus |
| `--surface-muted` | slate-50 → 222 20% 15% | table headers, zebra, tiles |
| `--primary` | blue-600 → blue-500 | primary buttons, links, active nav, ring |
| `--secondary` | slate-100 → 222 18% 20% | secondary surfaces |
| `--border`/`--border-strong` | slate-200/300 → dark | dividers/inputs |
| `--foreground`/`--muted-foreground` | slate-800/500 → light | text |
| `--destructive`/`--success`/`--warning`/`--info` | red/green/amber/sky | feedback |
| 8x `--st-*`(+`-bg`) | status pairs | chips |
| `--radius` 0.5rem · 3x `--shadow-*` | — | corners, elevation |

## Per-page surface → token reference (appendix)

**auth/LoginPage** — pageBg=bg-surface-muted text-foreground (L40); card/form=bg-card border-border shadow-sm (L43); inputs=.input util → bg-background border-input text-foreground focus:border-ring disabled:bg-muted (src/index.css:12, via components/ui/Input.tsx); labels=text-foreground / text-muted-foreground (L55,90); logoutReason banner=bg-surface-muted border-border text-muted-foreground (L49); buttons=.btn util 

**auth/MustChangePasswordPage** — pageBg=bg-surface-muted text-foreground (L42); card/form=bg-card border-border shadow-sm (L45); inputs=.input util (border-input bg-background text-foreground, src/index.css:12); labels=text-foreground / text-muted-foreground; buttons=.btn (bg-primary text-primary-foreground) + .btn-ghost (border-input text-foreground hover:bg-accent, src/index.css:18); error/mismatch=text-destructive (L92,94). Re

**auth/MustAcceptPoliciesPage** — pageBg=bg-surface-muted text-foreground (L25); card=bg-card border-border shadow-sm (L26); card header/footer dividers=border-b/border-t border-border (L27,43); policy body=text-muted-foreground, <pre> font-sans (L37); buttons=.btn + .btn-ghost (L44,47). No nav/table/tabs/inputs/badges.

**auth/SessionTimeoutModal** — dialog scrim=bg-foreground/40 (L17 — token-based alpha overlay, dark-safe); dialog=bg-card border-border text-card-foreground shadow-lg (L24); title=text-foreground (L26); body=text-muted-foreground (L29) with countdown text-destructive (L31); buttons=.btn + .btn-ghost (L35,38). No pageBg/header/nav/table/tabs/inputs/badges.

**components/Layout** — pageBg=bg-surface-muted text-foreground (L160); sidebar/nav=bg-card border-r border-border shadow-lg (L178); nav logo bar=border-b border-border, brand text-foreground (L184-185); navLink active=bg-primary text-primary-foreground, idle=text-secondary-foreground hover:bg-accent hover:text-accent-foreground (L73-78); section titles=text-muted-foreground (L67); disabled nav item=text-muted-foreground

**components/JobsTray** — trigger button=text-secondary-foreground hover:bg-accent hover:text-accent-foreground (L98); count badge=bg-primary text-primary-foreground (L103); popover=bg-popover text-popover-foreground border-border shadow-lg (L110); popover header/rows=border-b border-border (L111,116,134); row meta/status=text-muted-foreground (L127,138,141,163,172); download link=text-primary hover:underline (L149); cappe

**components/NotificationBell** — trigger button=text-secondary-foreground hover:bg-accent hover:text-accent-foreground (L85); unread count badge=bg-destructive text-destructive-foreground (L90); popover=bg-popover text-popover-foreground border-border shadow-lg (L97); header divider=border-b border-border (L98); 'Mark all read'=text-primary hover:underline disabled:opacity-50 (L102); list items=border-b border-border hover:bg-acc

**components/UserMenu** — avatar button=bg-primary text-primary-foreground border-border (L79); popover=bg-popover text-popover-foreground border-border shadow-lg (L90); header=border-b border-border, name text-foreground, role text-muted-foreground (L91-95); menu items=hover:bg-accent hover:text-accent-foreground (L99,106,113); Sign Out divider=border-t border-border (L113). No table/tabs/inputs/badges.

**components/HeaderClock** — date line=text-muted-foreground (L34); time line=text-foreground (L35). No background surface of its own (sits in the bg-card header). No nav/table/tabs/dialog/inputs/buttons/badges.

**dashboard/DashboardPage** — pageBg=inherits body (no own bg); header=text-foreground + text-muted-foreground (DashboardPage.tsx:34-38); card(error state)=bg-card border-border text-muted-foreground (DashboardPage.tsx:42); no nav/tabs/dialog/inputs/buttons/badges on this page (composes CounterBar/KpiCard/PortfolioTable/RosterSummary)

**dashboard/components/CounterBar** — card=bg-card border-border, hover:border-border-strong hover:bg-accent (CounterBar.tsx:37); status dots=bg-st-pending/bg-st-assigned/bg-st-in-progress/bg-st-under-review/bg-st-approved/bg-st-rejected (CounterBar.tsx:13-25); label=text-muted-foreground (CounterBar.tsx:41); value=text-foreground (CounterBar.tsx:45)

**dashboard/components/KpiCard** — card=bg-card border-border, hover:border-border-strong hover:bg-accent (KpiCard.tsx:38,40); number=text-foreground / alert tone=text-st-rejected (KpiCard.tsx:25-27); label+sub=text-muted-foreground (KpiCard.tsx:30,35); trend delta=text-success / text-destructive / text-muted-foreground (KpiCard.tsx:53,59)

**dashboard/components/PortfolioTable** — card=bg-card border-border (PortfolioTable.tsx:19); tableHeader=text-muted-foreground over card bg, divider border-b border-border (PortfolioTable.tsx:20,35-36); tableRow=border-b border-border (PortfolioTable.tsx:47); cells=text-muted-foreground / font-medium foreground-default (PortfolioTable.tsx:48-62); loading skeleton=bg-surface-sunken (PortfolioTable.tsx:29); completion bar track=bg-surface-

**dashboard/components/RosterSummary** — card=bg-card border-border, hover:border-border-strong hover:bg-accent (RosterSummary.tsx:27); labels=text-muted-foreground (RosterSummary.tsx:29,38); value=text-foreground / alert tone=text-st-rejected (RosterSummary.tsx:42-44); error=text-muted-foreground (RosterSummary.tsx:31)

**pipeline/PipelinePage** — pageBg=inherits body; header=text-foreground + text-muted-foreground (PipelinePage.tsx:224-227); tabs/buckets=pill buttons: active=border-primary bg-primary text-primary-foreground, inactive=border-border bg-card text-secondary-foreground hover:bg-accent (PipelinePage.tsx:241-245); badges (status)=bg-st-*-bg text-st-* pairs PENDING/ASSIGNED/IN_PROGRESS/SUBMITTED/COMPLETED/REVOKED/CANCELLED, fallba

**fieldMonitoring/FieldMonitoringPage** — pageBg=inherits body; header=text-foreground + text-muted-foreground (FieldMonitoringPage.tsx:155-158); counter card=bg-card border-border (FieldMonitoringPage.tsx:165); card label=text-muted-foreground, value=text-foreground / overdue tone=text-st-rejected (FieldMonitoringPage.tsx:166-170); overdue badge=bg-st-rejected-bg text-st-rejected (FieldMonitoringPage.tsx:86); coordinates link=text-primar

**billing/BillingPage** — pageBg=inherits body; header=text-foreground + text-muted-foreground (BillingPage.tsx:279-284); access-denied=text-destructive (BillingPage.tsx:274); breakdown card=bg-card border-border (BillingPage.tsx:120,163); card heading=text-sm font-semibold default foreground (BillingPage.tsx:121,164); tableHeader=text-muted-foreground (BillingPage.tsx:45,124,167); tableRow divider=border-t border-border, 

**CasesPage (list)** — pageBg=inherits bg-background (no own bg); header=text-foreground + text-muted-foreground (h1/p, lines 66-67); nav=n/a; card/table/tableHeader/tableRow/hover/selected/inputs/badges=ALL delegated to <DataGrid> component (not in this cluster's files; lines 74-85); buttons=btn (line 69, '+ New Case' → bg-primary text-primary-foreground via index.css:14) ; status cell=plain text, no badge (line 50); m

**CaseDetailPage (detail + tabs)** — pageBg=inherits bg-background; backLink=text-primary hover:underline (line 112); card=bg-card border-border shadow-sm (lines 116,145,221,404,1375,1570,1717,1821,1960); cardHeader/sectionHeader=bg-surface-muted text-muted-foreground (lines 146,554,1265); tableHeader=text-muted-foreground (thead, lines 150,606,1301) — header row itself transparent, no bg; tableRow=border-t border-border (lines 161,6

**CaseCreatePage (create)** — pageBg=inherits bg-background; header=text-foreground/text-muted-foreground (lines 162-163); card=bg-card border-border shadow-sm (lines 168,327,448); dedupe section header=bg-surface-muted text-muted-foreground (line 328); tableHeader=text-muted-foreground thead (line 348); tableRow=border-t border-border (lines 340,361); inputs=.input (token-based, lines 172,182,207,219 etc.) + Input/TextArea co

**AddTasksForm (add tasks, shared by create + detail)** — pageBg=n/a (embedded); card=bg-card border-border shadow-sm (line 316, TaskRowEditor); cardHeader=bg-surface-muted border-b border-border text-muted-foreground (lines 318-319); inputs=.input (token-based, lines 335,348,364,378,410,421,434,442,472,488 + Input component line 410 etc.); ratePreview box=bg-surface-muted border-border text-foreground/text-muted-foreground, separator text-border (lines 

**MasterDataCrud (renders ClientsPage + ProductsPage)** — pageBg=inherited (no own bg); header=h1 text-foreground (text-xl font-bold) + subtitle text-muted-foreground; nav=n/a; card=DataGrid table wrapper bg-card border-border shadow-sm (DataGrid.tsx:656); tableHeader=bg-surface-muted text-muted-foreground (DataGrid.tsx:662); tableRow=border-border, hover=bg-row-hover, selected/expanded=bg-accent (DataGrid.tsx:776-777); tabs=n/a; dialog=bg-card text-card

**DepartmentsPage** — header=h1 text-foreground + p text-muted-foreground; card+tableHeader+tableRow(hover/selected)=DataGrid (bg-card/bg-surface-muted/bg-row-hover/bg-accent); dialog=bg-card text-card-foreground border-border shadow-lg (line 213), scrim=bg-foreground/40 (line 207); inputs=.input util + ui/Input + ui/TextArea (className="input") + status <select className="input"> (line 134); buttons=.btn / .btn-ghost 

**DesignationsPage** — header=text-foreground + text-muted-foreground; card+tableHeader+tableRow=DataGrid; dialog=bg-card text-card-foreground border-border shadow-lg (line 223), scrim=bg-foreground/40 (line 217); inputs=.input util + ui/Input + ui/TextArea + Department <select className="input"> (line 240) + status <select className="input"> (line 140); buttons=.btn / .btn-ghost + Edit text-primary / Deactivate text-mu

**VerificationUnitsPage + VerificationUnitDialog.tsx** — header=text-foreground + text-muted-foreground; card+tableHeader+tableRow=DataGrid; tabs=n/a; dialog=bg-card text-card-foreground border-border shadow-lg (VerificationUnitDialog.tsx:113), scrim=bg-foreground/40 (line 107); inputs=.input util + ui/Input + Kind/Category <select className="input"> (Dialog lines 140,150) + PII checkbox (native, no color class) + status <select className="input"> (Page

**LocationsPage (+ inline EditLocationDialog)** — header=text-foreground + text-muted-foreground; create panel=card bg-card border-border shadow-sm (line 199); card+tableHeader+tableRow=DataGrid; dialog=bg-card text-card-foreground border-border shadow-lg (line 385), scrim=bg-foreground/40 (line 379); inputs=.input util + ui/Input + date <input className="input"> (lines 254,423); buttons=.btn 'Add location' / .btn + .btn-ghost in dialog + Edit te

**Shared components (StatusChip / ConflictDialog / BulkStatusActions / DataGrid + SavedViewsPicker / Input / .btn .input utils)** — StatusChip badges=st-approved/st-pending pairs + INACTIVE bg-muted text-muted-foreground (StatusChip.tsx:5-7); ConflictDialog dialog=bg-card text-card-foreground border-border shadow-lg, scrim=bg-foreground/40, title text-destructive, body text-foreground/text-muted-foreground (ConflictDialog.tsx:33-56); BulkStatusActions=btn-ghost + text-muted-foreground status (BulkStatusActions.tsx:59,67,82); D

**access/RolesPage** — pageBg=inherits bg-background (page is space-y-4, no own bg); header=h1 text-foreground tracking-tight + p text-muted-foreground (RolesPage.tsx:189-193); card=DataGrid (external, not in file); tableHeader=DataGrid-owned (external); tableRow+hover=DataGrid-owned (external); tabs=none; dialog=bg-card text-card-foreground border-border shadow-lg (RoleDialog .tsx:364) + scrim=bg-foreground/40 (.tsx:35

**policies/PoliciesPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:91-94); card/tableHeader/tableRow+hover=DataGrid-owned (external); tabs=none; dialog=delegated to PolicyDialog; inputs=none on this page (DataGrid filter only, external); buttons=.btn New Policy (.tsx:97) + row link text-primary hover:underline (.tsx:71) + text-muted-foreground hover:text-foreground (.tsx:75);

**policies/PolicyDialog** — dialog=bg-card text-card-foreground border-border shadow-lg (.tsx:58) + scrim=bg-foreground/40 (.tsx:52); inputs=Input/TextArea with .input util (border-input bg-background text-foreground) (.tsx:66,83,86,89); labels=text-foreground (.tsx:138); buttons=.btn / .btn-ghost (.tsx:100,103); error=text-destructive (.tsx:97)

**templates/TemplatesPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:120-123); card/tableHeader/tableRow+hover=DataGrid-owned (external); tabs=none; dialog=bg-card text-card-foreground border-border shadow-lg (TemplateDialog .tsx:237) + scrim=bg-foreground/40 (.tsx:231); inputs=.input util on Input/TextArea/select/date (.tsx:148,247,256,278,290); labels=text-foreground; buttons

**reportLayouts/ReportLayoutsPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:788-792); card/tableHeader/tableRow+hover=DataGrid-owned (external); tabs=none; dialog=bg-card text-card-foreground border-border shadow-lg (LayoutDesignerDialog .tsx:286) + scrim=bg-foreground/40 (.tsx:280); inner panels=border-border (.tsx:488,526); inputs=.input util on Input/TextArea/select (.tsx:298,344,4

**rateManagement/RateManagementPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:274-278); card=DataGrid (external); AddRateForm card=bg-card border-border shadow-sm (.tsx:458); SearchableSelect dropdown popover=bg-card border-border shadow-lg (.tsx:96) with option hover:bg-surface-muted (.tsx:102) and empty-state text-muted-foreground (.tsx:97); tableHeader/tableRow+hover=DataGrid-owned (

**commissionRates/CommissionRatesPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:436-441); card/tableHeader/tableRow+hover=DataGrid-owned (external); tabs=none; dialog=bg-card text-card-foreground border-border shadow-lg (CommissionRateDialog .tsx:127) + scrim=bg-foreground/40 (.tsx:123); inputs=.input util on select/number/date + datalist (.tsx:135,155,168,181,192,210,228,241,255,270); la

**cpv/CpvPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:240-244); link-creation card=bg-card border-border shadow-sm (.tsx:255); card=DataGrid (external); tableHeader/tableRow+hover=DataGrid-owned (external); EXPANDED UnitManager: panel=bg-card border-border (.tsx:424), filter bar border-b border-border (.tsx:425), inner table=.rtable with tableHeader=bg-surface-mu

**users/UsersPage** — pageBg=inherits bg-background; header=h1 text-foreground + p text-muted-foreground (.tsx:196-199); card/tableHeader/tableRow+hover=DataGrid-owned (external); tabs=UserDialog Profile/Access tab strip border-b border-border, active=border-b-2 border-primary text-primary, inactive=text-muted-foreground hover:text-foreground (.tsx:602-617); dialog=bg-card text-card-foreground border-border shadow-lg (

**profile/ProfilePage** — pageBg=inherits body bg-background (no own bg); header=h1 text-foreground (implicit) + p text-muted-foreground (L314-315); card=bg-card border-border shadow-sm (L69,201,267); inputs=Input .input (border-input bg-background text-foreground, index.css L11-12); buttons=.btn (bg-primary text-primary-foreground L142,239) + .btn-ghost (border-input text-foreground hover:bg-accent L99,146); badges=Active

**security/SecurityPage** — pageBg=inherits bg-background; header=h1 (implicit text-foreground) + p text-muted-foreground (L53-55); card=bg-card border-border shadow-sm (L59,139,158); code/secret block=border-border bg-muted font-mono text-foreground (implicit) (L86-88,147-149); inputs=Input .input (L92-99,117-122); buttons=.btn (L75,101) + .btn-ghost (L104,124); status text ON/OFF=text-primary | text-muted-foreground (L62-6

**system/SystemPage** — pageBg=inherits bg-background; header=h1 + p text-muted-foreground (L30-33); card=bg-card border-border shadow-sm (L66,89); record-count tile=border-border bg-surface-muted (L72), label text-muted-foreground (L73); status badge=bg-st-approved-bg text-st-approved | bg-st-rejected-bg text-st-rejected (L45-46); db-disconnected text=text-destructive (L55); errors=text-destructive (L37); no inputs/tabs

**dedupe/DedupePage** — pageBg=inherits bg-background; header=h1 + p text-muted-foreground (L118-121); card=search form bg-card border-border shadow-sm (L125); inputs=Input .input + field labels text-muted-foreground (L132-170); buttons=.btn .btn-primary Search (L172); table=delegated to DataGrid; status badges=STATUS_TONE map bg-st-*-bg text-st-* (L22-27,86); matchType chip=bg-surface-muted text-muted-foreground (L100);

**components/ui/data-grid/DataGrid** — toolbar=transparent; inputs=Input .input + native select.input + date input.input (L420,554,579,588); buttons=.btn-ghost (export/columns/pager L443,508,646,846); popover menus (Export/Columns/ColumnFilterSelect)=bg-card border-border shadow-md, items hover:bg-row-hover (L465,531,947); scrim=none (transparent fixed backdrop button L457,521,938); bulkBar=bg-surface-muted border-border, text-foregrou

**components/import/ImportModal** — trigger button=.btn-ghost (L43); scrim=bg-foreground/40 (L147); dialog=bg-card text-card-foreground border-border shadow-lg (L153); title=text-foreground implicit + p text-muted-foreground (L155-160); error banner=border-destructive/40 bg-destructive/10 text-destructive (L165); buttons=.btn (L271,298) + .btn-ghost (L173,268,293,307); file input=.input (L184); preview/error tables=border-border, se

**components/StatusChip** — badge=ACTIVE bg-st-approved-bg text-st-approved | SCHEDULED bg-st-pending-bg text-st-pending | INACTIVE bg-muted text-muted-foreground (L5-8); no page chrome

**components/ConflictDialog** — scrim=bg-foreground/40 (L33); dialog=bg-card text-card-foreground border-border shadow-lg (L39); title=text-destructive (L41); body=text-foreground (L44) + text-muted-foreground (L49); buttons=.btn-ghost Discard (L53) + .btn Reload (L56)

**components/ui/HexagonLoader** — container=text-foreground/text-muted-foreground only (no bg); svg outline=stroke-border (L37); svg progress arc=stroke-primary (L41); percent label=text-foreground (L49); operation=text-foreground (L54); subStep=text-muted-foreground (L55); animation classes .hex-march/.hex-fill are geometry/transition only, no color (index.css L24-47)

**apps/web/src/index.css (shared utility layer consumed by all of the above)** — .input=border-input bg-background text-foreground focus:border-ring disabled:bg-muted disabled:text-muted-foreground (L11-12); .btn=bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 (L14-15); .btn-ghost=border-input text-foreground hover:bg-accent (L17-18); .rtable mobile card=border-border bg-card shadow-sm, td::before text-muted-foreground (L73-82); hex keyframes=geometry o

_Skeptic: 2 confirmed, 0 overturned. FE genuinely fully tokenised + dark-safe except the 2 cited spots._
