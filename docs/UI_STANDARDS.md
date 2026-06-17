# UI_STANDARDS.md — CRM2 (web)

The index of frozen UI/UX standards. All web work obeys these. Change a frozen standard only via
a superseding ADR + CTO + domain-owner sign-off (`LONG_TERM_PROTECTION.md`).

## Frozen UI standards (each is authoritative in its own file)

- **Design system / colors** → `docs/COLOR_SYSTEM_FREEZE.md` (blue/slate tokens, light+dark,
  `@crm2/ui-theme` is the only color source — no hardcoded colors).
- **Uppercase display** → `docs/UPPERCASE_DISPLAY_STANDARD.md` (visual-only CSS, data preserved).
- **Management lists** → `docs/MANAGEMENT_LIST_STANDARD.md` (Created+Updated date-time columns,
  labelled headers, single-column accordion for master-detail — no empty side panels).
- **Pagination, loading experience & long-running operations** →
  **`docs/PAGINATION_AND_LOADING_STANDARDS.md`** (the freeze below).
- **Responsive-First web design** → **`docs/RESPONSIVE_DESIGN_STANDARD.md`** (the freeze below).

## Loading experience (summary — full spec in PAGINATION_AND_LOADING_STANDARDS.md)

Time bands: **0–300 ms** no loader (avoid flicker) · **300 ms–1 s** skeleton only · **1–3 s**
animated loader + percentage · **3–8 s** loader + percentage + current-operation text · **>8 s**
background job.

**Loader design:** the **Hexagon Loader** (modern geometric). **Forbidden:** spinning circles,
old-style progress bars, bouncing dots. The loader shows current operation, **real** percentage
(no fake animation — §8 stage maps), and an optional sub-step.

**Tables:** **skeleton rows** mandatory (Pipeline · Cases · Tasks · MIS · Billing · Reports ·
Users and every list table). Never an empty white screen; never a large blocking spinner.

**Background-job UX:** show `Preparing Export — 67%` + "You may continue working." Completion via
Notification Bell + Toast + In-App Notification (optional Email).

## Lists & data density

Every list is **search-first** (search + filters + sorting) and **server-side paginated**
(default 25; allowed 25/50/100/200; max 500 for MIS/reporting; above 500 forbidden) — see
`docs/PAGINATION_AND_LOADING_STANDARDS.md`. Loading/empty/error/permission states are mandatory
on every data view.

---
*Cross-links: `CRM2_MASTER_MEMORY.md` · `docs/DESIGN_AND_STACK_FREEZE.md` ·
`PERFORMANCE_STANDARDS.md` · `BUILD_GUIDE.md` · `AGENT_RULES.md` · `PROJECT_INDEX.md`.*

## Universal DataGrid (FROZEN 2026-06-05) — SoT `docs/DATAGRID_STANDARD.md`
**One table component for the whole platform.** Every list/table uses the Universal DataGrid
(`apps/web/src/components/ui/data-grid/`; conceptual name `@crm2/ui/DataGrid` — app-internal
per the frozen "no @crm2/ui package" decision). **Forbidden:** custom/page-specific tables, raw
`<table>` for data, duplicated table logic, client-side filtering/search/sort on operational data.
Built on **TanStack Table** + TanStack Query + URL state + `@crm2/sdk`. 20 mandatory features:
global+column search · Excel-style header filters · multi-column filtering · server sort/pagination ·
column visibility · saved views · export-current-view (XLSX/CSV via background job) · URL-state
persistence · loading/empty/error/permission states · row selection · bulk actions · sticky headers ·
responsive · keyboard nav · a11y. Skeleton rows mandatory; Hexagon loader; pagination per
`docs/PAGINATION_AND_LOADING_STANDARDS.md`. Component built once when the first operational list
lands; pre-freeze tables (VU/MasterDataCrud/CPV/Rates/Locations) retrofit before GA (MASTER_MEMORY §8).

## Responsive-First web design (FROZEN 2026-06-05) — SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`
The web app is **responsive-first / device-agnostic** — one UI for all screens. Every page is designed
**mobile-up** and must work at **320 / 768 / 1024 / 1440** with **no horizontal overflow** and **no
desktop-only workflow**. Responsive nav (persistent sidebar `lg+`, **hamburger→Sheet `<lg`**), grids
mobile-up (`grid-cols-1 md:…`, never bare `grid-cols-N`), dialogs `w-full`+vertical-scroll (or mobile
Sheet), filters `flex-wrap`. **Table strategy:** desktop DataGrid → tablet condensed → **mobile
card/list** (never a wide table on a phone; interim tables min. `overflow-x-auto`). **Playwright
viewport testing required** (320/768/1024/1440; CI gates 49–50). Scope = WEB UI only (not
offline-/mobile-app-/mobile-workflow-first). Pre-freeze screens = responsive retrofit cohort.

## Import / Export (FROZEN 2026-06-05) — SoT `docs/IMPORT_EXPORT_STANDARD.md`
First-class platform capability, NOT per-module. **Export = the DataGrid is the only export surface**
(Current View · Selected Rows · All Matching; XLSX/CSV/PDF; respects search/filters/sort/columns/
saved-view; `<10k` immediate, `≥10k` background job). **Import = one `@crm2/import-engine`** (app-internal):
download template → fill → upload → validate → preview errors → confirm → background process → result
summary (Total/Success/Failed/Duration + downloadable error file Row/Column/Message) + permanent import
audit record. No module writes a bespoke import/export.
