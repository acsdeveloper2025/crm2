# Universal DataGrid, Search, Filtering, Pagination & Table Experience Standard (CRM2)

> **Permanent UI/UX/scalability freeze (2026-06-05).** No redesign · no architecture change · no
> data-model change. This is the **single source of truth** for *all* tabular data in CRM2.
> It is the front-end realization of the server contract in
> **`docs/PAGINATION_AND_LOADING_STANDARDS.md`** (pagination envelope, page sizes, loading bands,
> background jobs) — read both together. Cross-linked from: `ACS_CRM_2.0_MASTER_MEMORY.md`
> (§3 + §4 + §7.6 + §8), `docs/ENGINEERING_STANDARDS.md`, `UI_STANDARDS.md`,
> `PERFORMANCE_STANDARDS.md`, `BUILD_GUIDE.md`, `AGENT_RULES.md`,
> `docs/MANAGEMENT_LIST_STANDARD.md`, `docs/CI_CD_STANDARDS.md`, `PROJECT_INDEX.md`.

---

## 1 — The Universal DataGrid is the ONLY table

There is exactly **one** approved table component. Every list/table on every page uses it.
**Forbidden:** custom table implementations · duplicated table logic · page-specific table
components · raw `<table>` for data lists.

**Canonical name & location.** The spec calls it `@crm2/ui/DataGrid`. The frozen package set is 5
(`ui-theme · sdk · access · config · test-utils`) with an explicit **"no `@crm2/ui` package —
components are owned in-app"** decision (MASTER_MEMORY §3/§4). Therefore the DataGrid physically
lives **app-internal** at **`apps/web/src/components/ui/data-grid/`** (alongside the
owned-in-app shadcn components). `@crm2/ui/DataGrid` is the conceptual name for that component. A
new `@crm2/ui` package is **NOT** created (that would reopen a frozen decision). If the grid is
ever needed by another app, promotion to a package requires a superseding ADR.

## 2 — Mandatory features (every instance, no exceptions)

1. Global search · 2. Column search · 3. Excel-style header filters · 4. Multi-column filtering ·
5. Server sorting · 6. Server pagination · 7. Column visibility · 8. Saved views · 9. Export
current view · 10. URL state persistence · 11. Loading states · 12. Empty states · 13. Error
states · 14. Permission states · 15. Row selection · 16. Bulk actions · 17. Sticky headers ·
18. Responsive layout · 19. Keyboard navigation · 20. Accessibility (a11y) support.

## 3 — Technology freeze

- **Foundation: TanStack Table** (headless). **No alternative table framework** is permitted.
- Integrated with: **TanStack Query** (data) · **URL state** (search/filter/sort/page/columns/
  view) · **`@crm2/sdk`** (the only data path — no raw fetch) · server pagination/filtering/sorting.
- Styling: `@crm2/ui-theme` tokens only (no hardcoded colors); uppercase display + Created/Updated
  columns per `docs/MANAGEMENT_LIST_STANDARD.md`.

## 4 — Server-side only (forbidden: client-side operations on operational data)

**Mandatory server-side:** search · filters · sorting · pagination. **Forbidden:** loading large
client-side datasets · client-side filtering/sorting/search for operational screens. The grid
sends `page, limit, search, sortBy, sortOrder, filters` and consumes the standard envelope
`{ items, totalCount, page, pageSize, totalPages, sort, filters }`
(see `docs/PAGINATION_AND_LOADING_STANDARDS.md`).

## 5 — Global search

Every operational page supports one **server-side** global search box across the domain's key
identifiers, e.g.: Case Number · Customer Name · Mobile · LOS ID · Application ID · Reference No ·
Address · PAN · Aadhaar · GST · Executive Name · Client · Product. Server decides the searchable
column set per domain (whitelisted). Never client-side.

## 6 — Column search

Each column supports independent **server-side** search (per-column input in the header), e.g.
Case Number / Client / Assigned To / Status each searchable on its own.

## 7 — Excel-style header filters

Every column header opens an **Excel-style multi-select filter** (e.g. Status ▼ → ☑ Pending ☑
Assigned ☑ In Progress ☑ Submitted ☑ Approved ☑ Rejected ☑ Revisit). Multi-select; options come
from the server (distinct values / enum), applied server-side.

## 8 — Multi-column filtering

Filters **combine** (AND across columns), e.g. Client=HDFC · Product=Home Loan · Status=Pending ·
Verification Unit=Residence · Assigned To=Rajesh · Created=Last 7 Days — all applied together,
server-side, reflected in `filters`.

## 9 — Column visibility

Users show/hide columns; **preferences persist** (per user, via saved views / URL / user prefs).

## 10 — Saved views

Users save filter+sort+columns+search combinations as named views, e.g. My Pending Cases ·
Backend Review Queue · Today's Submissions · Overdue Cases · Rejected Cases · KYC Queue · MIS
Review. **Saved views persist per user** (server-backed). *(Backend store for saved views lands
with the operational phases; until then the grid supports URL-state views.)*

## 11 — Export & import (the DataGrid is the universal entry point)

**The DataGrid is the ONLY export surface on the platform — no module writes its own export.**
Every grid offers three export modes (SoT: `docs/IMPORT_EXPORT_STANDARD.md`):
1. **Export Current View** — exactly what the user sees.
2. **Export Selected Rows** — the current row selection.
3. **Export All Matching Records** — everything matching the active search + filters (re-runs the
   server query without the page `LIMIT`).

All three respect **search + filters + sort + visible columns + saved view**. Formats: **XLSX**
(primary) · **CSV** (secondary) · **PDF** (optional). **< 10,000 rows** generate immediately;
**≥ 10,000 rows** run as a **background job** (generate → store → notify → download;
`docs/PAGINATION_AND_LOADING_STANDARDS.md` §5/§10). Export is never an unbounded synchronous fetch.

**Import** (where the page supports it) uses the one **`@crm2/import-engine`** (app-internal;
`docs/IMPORT_EXPORT_STANDARD.md`) — download template → fill → upload → validate → preview errors →
confirm → background process → result summary + error file + audit record. No module writes a
bespoke import.

## 12 — URL state persistence

Page state survives refresh and is bookmarkable: **search · filters · sorting · pagination ·
visible columns · saved view** all live in the URL (query params). A bookmarked URL reproduces the
exact filtered screen.

**Canonical URL keys (frozen by the reference impl, `components/ui/data-grid/`):** the grid uses the
short keys `q` (search) · `sort` (sortBy) · `dir` (asc|desc) · `page` · `size` (limit); domain filters
use their own param names (e.g. `active`). These map to the request contract `search/sortBy/sortOrder/
page/limit` at the SDK boundary. New grids reuse these keys — do not re-invent per page.

## 13 — Pagination

Server-side only. Default **25**; allowed **25/50/100/200**; extended max **500** (MIS · Reports ·
Billing · Commission only); **above 500 forbidden** (require filters or export). No unbounded rows.

## 14 — Loading, skeletons & long-running operations

Loading bands (`PAGINATION_AND_LOADING_STANDARDS.md` §6): 0–300ms none · 300ms–1s **skeleton
rows** · 1–3s loader+% · 3–8s loader+%+operation · **>8s background job**. **Skeleton rows are
mandatory** — never an empty white screen, never a blocking spinner. Loader = **Hexagon**, real
stage-based %. Bulk/long ops (>8s) — MIS/Billing/Commission/Report export, PDF gen, bulk import,
**bulk assignment / reassignment / status update**, bank-API sync — are **background jobs**; the
user keeps working; completion via Notification Bell + Toast + In-App (+ optional Email).

## 15 — States (always rendered)

**Loading** (skeleton) · **Empty** ("no rows / adjust filters") · **Error** (retry) · **Permission**
(no access) · plus **Row selection** + **Bulk actions** bar when rows are selected.

## 16 — Performance budgets

Dashboard / Pipeline / Cases / Task Workspace **< 2 s** · MIS **< 3 s** · Exports = background job.
DB: indexed sort/filter columns, no `SELECT *`, no full scans, `EXPLAIN` reviewed (§13–14 of the
pagination standard).

## 17 — Mandatory pages (must use DataGrid)

**Operations:** Dashboard widgets · Pipeline · Cases · Tasks · Verification Units Queue · Backend
Review · KYC Review · MIS · Reports · Billing · Commission · Field Monitoring · Attendance
Monitoring · Notifications · Audit Logs.
**Administration:** Clients · Products · Verification Units · CPV Mapping · Rate Management ·
Location Management · Country · State · City · Pincode · Users · Roles · Permissions · Templates ·
Feature Flags · System Health · API Configurations · Retry Queue.
**Any future list screen MUST use DataGrid.**

**Export/Import is first-class, not per-module** (`docs/IMPORT_EXPORT_STANDARD.md`): every grid on
the mandatory pages above exports via the DataGrid (current view / selected / all-matching; XLSX/
CSV/PDF; `≥10k` rows = background job). Import-enabled domains (Clients · Products · Verification
Units · CPV · Rates · Country/State/City/Pincode · Users · Case Creation · Bulk Assignment) use the
one `@crm2/import-engine`. Forbidden import: Audit Logs · Billing/Commission History · System/
Notification logs.

## 18 — Machine enforcement (CI gates)

DataGrid behaviour is CI-validated (activates as the component + endpoints land): pagination ·
global search · column search · header filters · multi-column filters · server sorting · column
visibility · saved views · export (respects view) · URL-state persistence · loading/empty/error/
permission states · row selection / bulk actions · keyboard nav · a11y (axe). A custom/raw table
for a data list **fails review**. See `docs/CI_CD_STANDARDS.md` gates 45–48.

## 19 — Build & compliance obligation

- The **standard is frozen now**; the DataGrid component is **built once** when the first
  operational paginated list lands (Pipeline/Cases), then reused on every page above. It depends on
  the paginated server endpoints from `PAGINATION_AND_LOADING_STANDARDS.md` (also not yet built).
- **Retrofit obligation:** the pre-freeze bespoke tables — Verification Units page, the shared
  `MasterDataCrud` (Clients/Products), `CpvPage`, `RatesPage`, `LocationsPage` — predate this freeze
  and are **non-compliant** (custom tables). They MUST migrate to DataGrid before GA. Tracked in
  `ACS_CRM_2.0_MASTER_MEMORY.md` §8. **No new list ships without DataGrid.**

## 20 — Master-detail row expansion (opt-in)

Some admin lists are master-detail: a parent row owns an inline collection edited in place (the
canonical case is **CPV Mapping** — a client-product link with its enabled verification units). The
owner-approved UX for these is a **single-column inline accordion** (click a row → its detail expands
beneath it), never a side-by-side master/detail with an empty pane (see `MANAGEMENT_LIST_STANDARD.md`).

The DataGrid supports this with an **additive, opt-in `renderExpanded?: (row) => ReactNode` prop**:

- When set, a leading chevron column appears; clicking a row (or its chevron) toggles an inline
  detail row rendered by `renderExpanded`. **One row open at a time**; expansion is ephemeral and
  resets when the matched set or page changes.
- It is **mutually exclusive with `onRowClick`** for the row-body click (pass only one). All other
  DataGrid features (server search/sort/pagination/filters/column-visibility/export/loaders) work
  unchanged — the detail is purely presentational chrome on top of the standard grid.
- This keeps master-detail screens on the **one** table component (no bespoke accordion table), so
  CPV Mapping is now DataGrid-compliant.

---

*Change this frozen standard only via a superseding ADR + CTO + domain-owner sign-off
(`LONG_TERM_PROTECTION.md`).*
