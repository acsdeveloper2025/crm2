# Live Visual Verification (browser preview)

Run by the orchestrator against the running app (web dev server `:5273` → API `:4000`), logged in as **SUPER_ADMIN** with seed data, no policy gate. Viewports tested: **375 (mobile) / 768 / 1280 (desktop)** + emulated **dark** color-scheme. This is the independent cross-check the user requested ("don't audit from code alone"). Caveat: the live server is the main tree (`22bfdfc`); the 5 FE files changed in the gap were audited from code at `origin/main` instead.

## Confirmed PASS (visually verified)
| Area | What was verified |
|---|---|
| **Mobile drawer** | Hamburger → left overlay drawer with scrim, grouped nav (Operations / MIS & Billing / Administration), active-item highlight. Works at 375px. |
| **Responsive DataGrid** | Cases list collapses to **stacked cards with `data-label`s** at 375px (7 data-label cells); full sortable/filterable grid at 1280px. Dashboard cards reflow 2-col → no page overflow. |
| **No page horizontal-scroll** | Dashboard, Cases, New Case = 0px page overflow at 375px (wide tables scroll inside their own `overflow-x-auto` container, not the page). |
| **Focus-trapped dialog** | Clients `+ New` dialog = `role=dialog`, `aria-modal=true`, `aria-labelledby="masterdata-dialog-title"`, focus moved into first input, labeled fields, `SAVE` disabled until valid. |
| **Status badge tones** | Clients list shows green `ACTIVE` `StatusChip` badges (frozen `st-*` tokens render correctly). |
| **Import / Export / bulk** | Clients & Users have Import + Export + Columns + Views + bulk-select checkboxes + per-row actions + date-range filters. |
| **Responsive form** | New Case form single-column at 375px, labeled fields with hints, `CREATE CASE` disabled with inline reason ("SELECT A CLIENT"). |

## Findings (corroborate the code audit)
| Sev | Finding | Detail | Code-audit match |
|---|---|---|---|
| P2 | **Users: duplicate `Import` button** + split `Export Scope`/`Export` | Header buttons (verified via DOM): `Import, Import, Export Scope, +New` then toolbar `Views, Export, Columns`. Two identical "Import" + two export variants is confusing. | Users d5 P1 (`Export Scope` bypasses 413) + d13 consistency |
| P2 | **Cases list: STATUS is plain text** | `NEW` renders as plain text in both card (mobile) and column (desktop) view — not a toned `StatusChip`. | Cases list d9 FAIL |
| P3 | **Commission Rates: no mobile card-stack** | Wide table sits in `overflow-x-auto` with **0 `data-label` cells** (vs 7 on Cases) → horizontal scroll on mobile instead of card collapse. (Stale-preview; code audit confirms bespoke vs DataGrid.) | Commission Rates d2/d6 |
| info | **Dark mode not toggled** | Under emulated `prefers-color-scheme: dark` the body stays white, no `.dark` class. The token system *defines* a `.dark` variable layer (per checklist) but the web app exposes **no dark toggle**. Treat as **by-design / N-A** unless the freeze requires a toggle. | n/a |

## Method notes
- Horizontal-overflow measured via `documentElement.scrollWidth − clientWidth` at a pinned viewport. An early "258px overflow" reading on `/cases/new` was an **artifact** of the viewport being in a degraded "native size" state (`clientWidth=0`); at a pinned 1280px it is **0px** — no real bug. (Recorded to show the skeptic discipline applied to visual findings too.)
