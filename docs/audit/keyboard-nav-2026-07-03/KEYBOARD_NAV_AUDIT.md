# Keyboard-Navigation & Focus-Management Audit — CRM2 Web (2026-07-03)

**Type:** compliance + correctness pass enforcing an existing standard — WCAG 2.1 AA keyboard SCs
(2.1.1 · 2.1.2 · 2.4.3 · 2.4.7 · 2.4.11 · 3.2.1), `DATAGRID_STANDARD.md §19/§20`, the WAI-ARIA APG
patterns, and the axe a11y CI gate (gate 29). **Not** a redesign — no design-system or focus-token change.
**Scope:** every page, dialog/modal/menu/popover, DataGrid & inline-grid, form control and custom widget in
`apps/web/src`. **Method:** 6 parallel read-only reader agents → merge/dedupe by WCAG SC → live keyboard
verification in the browser preview → this doc. **No source changed by the audit.**

**Verdict: the app is in excellent keyboard shape.** The mechanism (shared `<Button>`, `useFocusTrap`, the
global `:focus-visible` ring, the DataGrid §19 model) is sound and near-universally applied. **No High/Critical
findings. No unreplaced `outline:none`. 21 of 22 overlays correctly focus-trap.** The findings are one genuine
functional cluster (DataGrid **inline-cell edit is mouse-only** — a surface that postdates the prior H-10
keyboard sweep) plus one un-trapped alert dialog and a tail of ARIA-completeness / APG polish.

Baseline: registry **H-10** (prior keyboard sweep) shipped K1/K2/K3 (DataGrid header/row keys + `aria-sort`,
`.input` ring, `SearchableSelect` combobox, skip-link, deactivate-alert trap, MustAccept scroll region) and
consciously **deferred one P3** — arrow-key roving inside `role="menu"` popovers (axe-green; APG polish). This
audit **re-verifies H-10 holds** (it does) and covers the surfaces shipped since (inline-edit grids, KYC pages,
login redesign, footer, MIS rebuild).

---

## 1 · Live keyboard verification (driven in the browser, not inferred)

Logged in as `admin` on the local stack (web `:5273` → API `:4000`, dev PG `:54329`). Evidence:

| Check | Route | Result | Verdict |
|---|---|---|---|
| Editable cell keyboard-reachable? | `/admin/locations` (150 cells) | every editable `<td>` is **`tabIndex=-1`**; `.focus()` falls to `<body>`; Enter opens no editor | **KN-1 CONFIRMED** (2.1.1 fail) |
| Focus after cell commit/cancel | inline-edit path | `cancelCell`/`commitCell` only `setEditCell(null)` — no `.focus()` back to the cell (code) | **KN-2 CONFIRMED** (2.4.3) |
| Sortable header keyboard | `/admin/clients` | 6 headers, `tabIndex=0` (positive control) | H-10 K1 **holds** ✓ |
| Tabs APG | `/mis` | 2 `role="tab"`, **both `tabIndex=0`** (no roving), `aria-controls=null`, no `role="tabpanel"`, **ArrowRight inert** | **KN-5 CONFIRMED** (4.1.2) |
| Sidebar overlay | mobile 375px | open **moves focus into** the drawer ✓; backdrop is a focusable `<button tabIndex=0>` (no `aria-hidden`) → mouse-close orphans focus; Escape-close restores ✓ | **KN-6 CONFIRMED** (LOW) |
| ScrollRegion focus ring | `/admin/locations` scroll group | focusable `div tabIndex=0`; no author `outline:none`; global `:focus-visible` is the sole outline source | **KN-11 resolved — not a defect** |
| Overlay focus-trap sweep | 22 overlays | 21 use `useFocusTrap` correctly; 1 miss (`UsersPage` export alert) | **KN-3** (below) |

> Harness note: the Claude-Preview eval bridge dispatches *synthetic* events, which cannot engage the browser's
> real `:focus-visible` heuristic or move focus on a synthetic `Tab`. Structural facts (tabIndex, ARIA state,
> arrow-key inertness, focus movement on click) were confirmed live; **authoritative real-key verification of
> focus rings / tab-order belongs in Playwright** (`e2e/`), which the fix plan adds and which already exercises
> real `keyboard.press` on the grid in `datagrid.spec.ts`.

---

## 2 · Interactive-element matrix (consolidated)

| Widget class | Reachable (Tab) | Operable keys | Focus-visible | Trap+restore | ARIA | Verdict | Ref |
|---|---|---|---|---|---|---|---|
| `<Button>` / native button | Y | Enter/Space | Y (global `:focus-visible`) | n/a | `type`, `aria-busy`, iconOnly→`aria-label` | ✅ | `ui/Button.tsx` |
| `<input>/<textarea>/<select>` (`.input`) | Y | native | Y (`.input` re-adds ring after `outline-none`) | n/a | caller `aria-*` | ✅ | `index.css:14` |
| Skip-link + landmarks | Y (first tabstop) | Enter→`#main` | Y (`focus:not-sr-only`) | n/a | one `<main tabIndex=-1>`, real `header/nav/main/footer` | ✅ | `Layout.tsx:169,248` |
| Popover (tray/menu triggers) | Y | Enter/Space; Esc closes+restores | Y | **Y** `useFocusTrap` | `aria-haspopup/-expanded`; panel label **iff `panelLabel`** | ⚠️ KN-9 | `ui/Popover.tsx` |
| Tabs (tablist) | Y (every tab) | Tab+Enter/Space; **no Arrow/Home/End** | Y | n/a | `role=tablist/tab` + `aria-selected`; **no `aria-controls`/`tabpanel`, no roving** | ⚠️ KN-5 | `ui/Tabs.tsx` |
| SearchableSelect (combobox) | Y | Arrow↑↓/Enter/Esc; **no Home/End** | Y | input-anchored (correct) | full APG combobox/listbox/option + `aria-activedescendant` | ⚠️ KN-8 | `ui/SearchableSelect.tsx` |
| ScrollRegion (focusable scroll) | Y `tabIndex=0` | Arrow-scroll | Y (global outline) | n/a | `role=group`+`aria-label` | ✅ (KN-11) | `ui/ScrollRegion.tsx` |
| DataGrid sortable header | Y `tabIndex=0` | Enter/Space→sort | Y (`ring-inset`) | n/a | `aria-sort` kept in sync; **no `role=button`** | ✅ (minor) | `data-grid/DataGrid.tsx:952` |
| DataGrid `onRowClick` row | Y `tabIndex=0` | Enter/Space→open | Y (`ring-inset`) | n/a | **no `role=button`** | ⚠️ KN-7 | `DataGrid.tsx:1107` |
| DataGrid expander-only row | **N** (chevron only) | chevron Enter/Space | chevron Y | n/a | chevron `aria-expanded`/`aria-label` | ⚠️ KN-4 | `DataGrid.tsx:1115` |
| **DataGrid editable cell** | **N `tabIndex=-1`** | **click-only to open** | editor `.input` ring | n/a | `aria-invalid` on error | ❌ **KN-1/KN-2** | `DataGrid.tsx:1172-1185,500-543` |
| DataGrid menus (cols/export/filter/views) | Y (trapped) | Tab+Enter+Esc; **no Arrow roving** | Y | **Y** `useFocusTrap` | `aria-haspopup=menu`,`aria-expanded`; `role=menu` over checkboxes | ⚠️ KN-10 (P3) | `DataGrid.tsx:358,407,1298` |
| Select-all / row-select checkbox | Y (native) | Space | Y | n/a | `aria-label`, `indeterminate` | ✅ | `DataGrid.tsx:937,1149` |
| 22 overlays (dialogs/trays/lightbox) | Y | Esc closes+restores | Y | **Y** on 21/22 | `role=dialog`/`aria-modal` | ⚠️ KN-3 (1 miss) | see §3 |
| Any `div/span/icon onClick` mouse-only | — | — | — | — | — | ✅ **none** (245 onClick sites swept) | — |

---

## 3 · Findings & dispositions

Severity: **Med** = real defect, keyboard/AT user materially affected but not fully blocked & axe-green;
**Low** = partial/edge/polish; **P3-DEFER** = axe-green APG enhancement (H-10 precedent). No High/Critical.

| ID | Sev | WCAG | Finding | Root cause | Fix location | Disposition |
|---|---|---|---|---|---|---|
| **KN-1** | Med | 2.1.1 | DataGrid **editable cell opens on mouse-click only** (`<td tabIndex=-1>`, no `onKeyDown`). Affects Departments/Designations/RateTypes/Locations/MasterDataCrud grids. *Live-confirmed.* | click-to-edit wired for pointer only; keyboard entry never added | shared `DataGrid.tsx` (`clickToEdit` cell) | **FIX** |
| **KN-2** | Med | 2.4.3 | After cell commit/cancel, focus is **lost to `<body>`** (no restore to the cell). | `cancelCell`/`commitCell` reset state only | shared `DataGrid.tsx:500-543` | **FIX** (with KN-1) |
| **KN-3** | Med | 2.1.2 / 4.1.2 | `UsersPage` **"Export failed" alert is an un-trapped bare `<div>`** — no `useFocusTrap`, no `role=dialog`/`aria-modal`, no Escape, no restore. Its twin in `RolesPage:231` is done right. | hand-rolled, missed the shared pattern | `features/users/UsersPage.tsx:250-258` | **FIX** (mirror RolesPage) |
| **KN-4** | Low | 2.1.1 (partial) | **Expander-only rows** (CPV master-detail) not row-level keyboard-reachable; the chevron `<button>` works, so not a full block. | `tabIndex`/`onKeyDown` gate only on `onRowClick` | shared `DataGrid.tsx:1115,1123` | **FIX** (extend gate to `onRowClick \|\| renderExpanded`) |
| **KN-5** | Low | 4.1.2 | **Tabs**: operable via Tab+Enter (2.1.1 ✓) but no roving tabindex, **no Arrow/Home/End**, no `aria-controls`/`role=tabpanel`. *Live-confirmed.* 4 call-sites. | styled buttons, not an APG tablist | shared `ui/Tabs.tsx` (+ call-site panels) | **PARTIAL FIX** (add `aria-controls`+`tabpanel`); arrow-roving → **P3-DEFER** (see KN-10) |
| **KN-6** | Low | 2.4.3 | `useFocusTrap` **backdrop-close orphans focus**; the sidebar backdrop `<button>` lacks `aria-hidden`. Escape-close restores fine. *Live-confirmed.* | restore guard skips a sibling backdrop; backdrop focusable | `lib/useFocusTrap.ts:88-91` + `Layout.tsx` backdrop | **FIX** (widen restore guard + `aria-hidden` the backdrop) |
| **KN-7** | Low | 4.1.2 | `onRowClick` `<tr>` is Enter/Space-activatable but has **no `role="button"`** / accessible name. | role omitted on interactive row | shared `DataGrid.tsx:1107` | **FIX** (add `role=button`) |
| **KN-8** | Low | 4.1.2 | `SearchableSelect` missing **Home/End**; `onBlur` 150ms close race. Fully operable otherwise. | not implemented | shared `ui/SearchableSelect.tsx` | **FIX** (add Home/End) |
| **KN-9** | Low | 4.1.2 | `MisPage` Popover (`:199`) **omits `panelLabel`** → panel has no role/name. The other 3 consumers pass it. | optional prop not set | `features/mis/MisPage.tsx:199` | **FIX** (one line) |
| **KN-10** | P3 | 4.1.2 | `role="menu"` popovers (DataGrid cols/export/filter/views) are Tab+Enter operable but **not Arrow-roving APG menus**. **= the H-10 P3 deferral.** | trap gives Tab-cycling, not menu roving | shared `DataGrid.tsx` / `SavedViewsPicker.tsx` | **RE-AFFIRM DEFER** (owner-accepted; or optional low-risk `role=group` relabel) |
| KN-L1 | Info | — | `useFocusTrap` `offsetParent` filter would exclude a `position:fixed` focusable (no live bug; no overlay uses fixed children). | visibility heuristic | `lib/useFocusTrap.ts:46-49` | **NOTE** (optional harden to `checkVisibility()`) |
| KN-L2 | Info | — | Nested-overlay Escape `stopPropagation` only works if inner container is a DOM descendant of outer (no live nesting). | by-design | `lib/useFocusTrap.ts:59-83` | **NOTE** |
| KN-L3 | Info | — | Container `tabIndex=-1` set for empty-overlay focus is never cleaned up (harmless; container unmounts). | no cleanup | `lib/useFocusTrap.ts:55` | **NOTE** |
| KN-L4 | Info | — | No modal marks background `inert`/`aria-hidden`; the JS Tab-trap covers keyboard reachability everywhere the trap is present. | relies on trap alone | all modals | **WONTFIX** (enhancement; belt-and-suspenders only) |
| KN-L5 | Info | 2.4.3 | No **route-change focus/scroll management** (focus stays on the clicked nav link on SPA nav). Not a hard SC failure; skip-link + landmarks mitigate. | absent | `Layout.tsx` / router | **DEFER** (enhancement) |
| KN-T1 | — | — | **Test gap:** inline-edit keyboard-entry, Tabs keys, `/kyc-queue` + `/mis` axe, open-overlay axe, and Tab-order/Space-activation are **not** covered by Playwright/axe. | coverage rides on primitives | `apps/web/e2e/` | **FIX** (add specs — regression home for KN-1/2/5) |
| KN-T2 | — | — | **Doc drift:** `CI_CD_STANDARDS.md:45,91` says gate 29 "gates CRITICAL, reports SERIOUS" but the code gates **serious+critical** (`a11y.spec.ts:13`). | stale doc | `docs/CI_CD_STANDARDS.md` | **FIX** (align doc to stricter code) |

---

## 4 · Fix plan (clustered at the shared source — never per call-site)

Everything except KN-10/KN-5-roving is **build-only WCAG/APG compliance** using the WCAG-standard keys and the
existing `--ring` token — **no design-token change, no new shortcut scheme**. Each slice: `pnpm verify` green +
**local Playwright a11y run green** (`cd apps/web && CI= pnpm exec playwright test e2e/a11y.spec.ts e2e/datagrid.spec.ts e2e/layout.spec.ts --project=setup --project=Laptop`)
+ real-browser keyboard re-verify + memory/§8 update.

- **Cluster A — DataGrid inline-edit keyboard (KN-1, KN-2, KN-4).** In the shared grid: make the `clickToEdit`
  `<td>` `tabIndex={0}` + `role="button"`-ish affordance + `onKeyDown` (Enter, and F2 as the spreadsheet
  convention) → `startCellEdit`; capture the cell in a ref and `.focus()` it in `cancelCell` and after a
  successful `commitCell`; extend the row `tabIndex`/`onKeyDown` gate to `onRowClick || renderExpanded`
  (route Enter/Space → `toggleExpand`). Add a Playwright spec asserting Enter-opens-editor + Escape-returns-focus.
- **Cluster B — Overlay/dialog focus (KN-3, KN-6).** Focus-trap the `UsersPage` export-failed alert by mirroring
  `RolesPage` (`useFocusTrap`, `role=dialog`, `aria-modal`, `aria-labelledby` — ~4 lines, hook already imported).
  Widen the `useFocusTrap` restore guard so a sibling-backdrop close still restores to the trigger, and add
  `aria-hidden`/`tabIndex=-1` to the sidebar backdrop `<button>`. Add Playwright focus-restore assertions.
- **Cluster C — ARIA semantics (KN-5 partial, KN-7, KN-8, KN-9).** Tabs: emit `id`+`aria-controls`, callers add
  `role="tabpanel" aria-labelledby`. `onRowClick` row `role="button"`. `SearchableSelect` Home/End. `MisPage`
  `panelLabel`. All axe-neutral-to-positive, low risk.
- **Cluster D — Deferred/re-affirm (KN-10, KN-5 arrow-roving, KN-L1–L5).** Keep the `role="menu"` arrow-roving
  deferred (H-10 precedent, axe-green) — or, if owner prefers, the lower-risk `role="menu"→role="group"` relabel
  that matches the actual Tab+Space behavior. Optional `useFocusTrap` `checkVisibility()` harden (KN-L1). No build
  unless owner opts in.
- **Cluster E — Tests & doc (KN-T1, KN-T2).** New Playwright keyboard specs (inline-edit entry+restore, Tabs
  keys, `/kyc-queue` + `/mis` axe, open-overlay axe, one Tab-order + Space walk). Fix the gate-29 doc drift.

**Owner decision (the only one):** Cluster D — keep the APG arrow-roving (menus **and** Tabs) **DEFERRED**
(recommended: consistent with the owner-accepted H-10 P3; both are axe-green and fully operable today), or build
it now. All other clusters are compliance fixes to proceed with as CTO.

---

## 5 · Cross-check vs H-10 (prior sweep)

- H-10 **K1** (DataGrid header/row keys, `aria-sort`) — **holds** (live: headers `tabIndex=0`; `datagrid.spec.ts` green).
- H-10 **K2/K3** (`.input` ring, `SearchableSelect` combobox, skip-link, deactivate-alert trap, MustAccept scroll) — **hold** (readers 1/3/5). KN-8 (Home/End) is a *new* polish nuance on the same combobox.
- H-10 **P3 deferral** (menu arrow-roving) — **still deferred**, re-affirmed as KN-10.
- **New since H-10** (surfaces that postdate the sweep): KN-1/KN-2 (inline-edit, ADR-0051), KN-3 (export-failed
  alert), KN-5 (Tabs on KYC/case-detail/MIS). This is why the inline-edit keyboard path was never previously audited.

**SoT / registry:** this file. Registered in `docs/COMPLIANCE_GAPS_REGISTRY.md` §KEYBOARD-NAV-2026-07-03.

---

## 6 · Fix log — BUILT 2026-07-03 (owner chose "Compliance + APG roving, A–E")

All root-cause fixes at the shared source; no per-call-site patching.

| Cluster | Change | Files |
|---|---|---|
| A | Editable cell now keyboard-focusable (`tabIndex=0` + `title` hint + Enter/F2 `onKeyDown` → `startCellEdit`, focus-visible ring); focus returns to the cell after commit/cancel (`cellNodes` ref + `refocusCell` effect); row keyboard gate extended to `onRowClick \|\| renderExpanded` with an `e.target===e.currentTarget` guard (no inner-control double-fire) | `data-grid/DataGrid.tsx` |
| B | Sidebar backdrop → `aria-hidden`+`tabIndex=-1` (KN-6 root cause); `UsersPage` export-failed alert now `useFocusTrap` + `role=dialog`/`aria-modal`/`aria-labelledby` (mirrors `RolesPage`) | `Layout.tsx`, `features/users/UsersPage.tsx` |
| C | `SearchableSelect` Home/End; `MisPage` Popover `panelLabel`; Tabs `aria-controls` via optional `panelId` | `SearchableSelect.tsx`, `MisPage.tsx`, `Tabs.tsx` |
| D | Opt-in `arrowKeys` on `useFocusTrap` (Arrow/Home/End roving, guarded off in caret fields) → enabled on Columns/Export/filter-select/SavedViews menus; Tabs roving `tabIndex` + Arrow(L/R)/Home/End + wrapping + automatic activation | `lib/useFocusTrap.ts`, `data-grid/DataGrid.tsx`, `data-grid/SavedViewsPicker.tsx`, `ui/Tabs.tsx` |
| E | New Playwright keyboard specs (inline-edit entry+return, menu roving, Tabs roving); gate-29 doc drift fixed | `e2e/locations.spec.ts`, `e2e/datagrid.spec.ts`, `e2e/tabs.spec.ts`, `CI_CD_STANDARDS.md` |

**Verification.** `pnpm verify` FE subset green (typecheck · format · no-suppressions · boundaries · web vitest 69 · web build). Playwright green: **26** a11y (all 22 axe page scans + Import-dialog + mobile-drawer overlay scans — **zero new violations**) + **3** new keyboard specs + existing grid/layout specs. **Real-browser key-press verified** (Claude Preview): editable cell `tabIndex=-1→0`, Enter opens the editor + Escape returns focus to the cell; Columns menu ArrowDown/End/Home roving + Escape restores to trigger; `/mis` Tabs roving `[0,-1]→[-1,0]` + wrap; mobile backdrop-close restores focus to the hamburger.

**Two build-time reconsiderations** (both make the change safer/better, documented in the registry): **KN-7 → WONTFIX** — `role="button"` on a clickable `<tr>` strips table-row semantics for AT (net-negative); the row is already operable. **KN-1** uses a focusable cell + `title` hint rather than `role="button"`+`aria-label`, which would have hidden the cell's value from AT and risked an axe `aria-allowed-role` flag on `<td>`.

**Deferred (documented):** KN-5 `role="tabpanel"` call-site wiring (conditional-swap panels need persistent render for valid ARIA; marginal benefit); KN-T1 axe-route expansion (`/kyc-queue`, `/mis` — needs per-role storage-state and could surface unrelated pre-existing violations); KN-10-adjacent `role=group` relabel (not needed — roving shipped); KN-L1–L5 latent items.
