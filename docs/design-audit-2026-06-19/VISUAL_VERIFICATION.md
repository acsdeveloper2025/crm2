# Live Visual Verification (browser preview)

Run against the running app (web dev server → API `:4000`), logged in as SUPER_ADMIN, at mobile/tablet/desktop + the `.dark` class. Independent cross-check of the code audit.

## Confirmed PASS (verified live)
| Area | Verified |
|---|---|
| Mobile drawer | hamburger → left overlay drawer, scrim, grouped nav, active highlight (375px) |
| Responsive DataGrid | Cases list collapses to stacked cards with `data-label`s at 375px; full grid at 1280px |
| No page horizontal-scroll | Dashboard/Cases/New-Case = 0px page overflow at 375px |
| Focus-trapped dialog | Clients New dialog: `role=dialog`, `aria-modal`, `aria-labelledby`, focus into first input, labeled fields |
| Status badge tones | green `ACTIVE` StatusChip badges render (frozen `st-*` tokens) |
| Import/Export/bulk | Clients & Users have Import + Export + Columns + Views + bulk-select + date-range filters |
| Responsive form | New-Case single-column at 375px, hints, `CREATE CASE` disabled with inline reason |
| **Dark theme (2026-06-22)** | injecting `.dark` on `<html>` renders dashboard, Clients table+dialog+inputs+scrim+badges, Case-detail header+tabs+inline form+tasks table — all correct in charcoal. **Dark works end-to-end; only a toggle is missing.** |

## Findings (corroborate the code audit)
| Sev | Finding | Detail |
|---|---|---|
| P2 | Users: duplicate `Import` button + split `Export Scope`/`Export` | header had `Import, Import, Export Scope` + toolbar `Export` |
| P2 | Cases list: STATUS is plain text | `NEW` renders as text, not a toned StatusChip |
| P3 | Commission Rates: no mobile card-stack | wide table horizontal-scrolls (0 `data-label` cells vs 7 on Cases) |

## Method note
Horizontal-overflow measured via `documentElement.scrollWidth − clientWidth` at a pinned viewport (an early "258px overflow" was an artifact of a degraded `clientWidth=0` native-size state; 0px at a pinned 1280px). Live login requires native-setter input events (preview_fill alone doesn't trigger React's controlled-input onChange).
