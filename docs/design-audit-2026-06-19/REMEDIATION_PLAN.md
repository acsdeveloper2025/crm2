# Remediation Plan — V2 Frontend Design Compliance

**AUDIT-ONLY — proposed, not implemented.** Awaiting owner approval. Every item is **additive**: adopt a shared primitive that already exists. No architecture/freeze change. Sequenced by risk×leverage. file:line evidence lives in [FINDINGS.md](./FINDINGS.md); patterns map to the R-numbers in [README.md](./README.md).

## Guiding principle
The fix is "**adopt the primitive the admin cluster already uses, on the pages that hand-rolled around it.**" Use `MasterDataCrud` / `DataGrid` / `ConflictDialog` / `useFocusTrap` / `StatusChip` / `useLoadingBand`+`HexagonLoader` / `apiExport` / `react-hook-form`+`zodResolver(@crm2/sdk)` as the reference implementations.

---

## Wave 1 — P1 authorization & accessibility (do first)

### R1 · Close RBAC-UI client-gating leaks ⭐ net-new — **highest priority**
Newer pages render write controls with **no** `useAuth().has(perm)` gate, so read-only users see buttons the server answers with 403. The admin cluster and `ReportLayoutsPage` already do this correctly — copy that pattern.
- **Templates** — `TemplatesPage.tsx` imports no `useAuth` at all; `+ New` (`:124`), per-row `Edit`/`Activate`/`Deactivate` (`:98,:103`), bulk (`:133`) are unconditional. Gate on `has('report_template.manage')` exactly as `ReportLayoutsPage.tsx:696,:776`.
- **Cases list** — `+ New Case` (`CasesPage.tsx:69`) ungated; gate on `case.create`.
- **Rate Management** — write actions visible to non-managers; gate the same way.
- **RBAC Roles** — page actions/route rely on nav-hiding only; mirror the manage perm.
- **Policies** — write/toggle controls; gate on the policies manage perm.
- **Fix:** `const { has } = useAuth();` → wrap each write affordance in `has(<server-perm>)`. Mirror the *exact* permission the write endpoint enforces. ~1 line per control; 5 pages.

### R2 · Focus-trap every bespoke dialog/popover
The drawer + admin dialogs use `useFocusTrap`; these don't, so Tab escapes the modal and focus isn't restored — an axe CI-gate risk.
- **App Shell** — Jobs / Bell / Account header popovers (`JobsTray`/`NotificationBell`/`UserMenu`) handle outside-click+Esc only; no `useFocusTrap`, no `role=menu`/`aria-haspopup`.
- **Commission Rates** — add/revise dialog has `role=dialog`+`aria-modal` (`CommissionRatesPage.tsx:123`) but no `useFocusTrap` and no `aria-labelledby`.
- **RBAC Roles** — "Cannot deactivate" overlay is a bespoke modal with no trap/semantics.
- **Security** — form inputs lack accessible names; errors not announced.
- **Fix:** `useFocusTrap<HTMLDivElement>(open, onClose)` + `aria-labelledby` on each dialog; for the 3 popovers, **extract one shared `Popover`/`DropdownMenu`** (compose `useFocusTrap` + `role=menu`) and have all three consume it — this also closes R-reuse for the triplicated dropdown code.

### R3 · Standardize loading/error states on async surfaces
- **Dashboard** — bare `…` glyphs bypass the banded `HexagonLoader`.
- **NotificationBell** — plain `Loading…` text; **no error/Retry** (a failed feed fetch is coerced to `[]`/`0`, indistinguishable from empty). Same silent-empty on **Jobs**, **CPV** units, **Policies** toggle.
- **Security** — MFA status defaults to OFF → flash-of-wrong-content + no error state.
- **Fix:** `useLoadingBand` + `HexagonLoader` for the loading band; add an inline **error + Retry** row matching the DataGrid state contract; never coerce fetch errors to empty.

### R7 · Fix the two token slips ⭐ net-new (trivial)
- `CaseCreatePage.tsx:257` — `text-st-completed` is a **non-existent** token (the 8 frozen status names have no "completed") → success banner renders **unstyled**. Use `text-success` or `text-st-approved` (how COMPLETED is mapped elsewhere).
- `AddTasksForm.tsx:173` — `text-amber-600` raw palette color → use the `text-warning` semantic token.
- **Fix:** 2 one-line edits. Add a lint rule for non-existent `st-*` names to prevent recurrence.

---

## Wave 2 — P1/P2 contract adoption

### R4 · Move hand-rolled forms onto RHF + `zodResolver(@crm2/sdk)`; OCC via `ConflictDialog`
Forms use raw `useState` + imperative `disabled={!a||!b}` with a single bottom error line instead of per-field inline validation; OCC 409 `STALE_UPDATE` is shown as an inline string instead of the shared `ConflictDialog`.
- Pages: Commission Rates, Policies, Report Layouts (designer), + the admin dialogs (`MasterDataCrud` & friends) as the P2 tail.
- **Fix:** adopt `react-hook-form` + `zodResolver(<sdk schema>)` for validation/error rendering; surface 409 via `ConflictDialog` (reload-adopts-version / discard) exactly as `MasterDataCrud.tsx`. Overlaps registry **C-10 (OCC retrofit)** — fold these pages into that workstream.

### R5 · Replace embedded bespoke `<table>`s with the DataGrid (or a documented sub-list primitive)
Sub-lists that hand-roll `<table>` lose pagination, URL-state, filters, responsive card-collapse, and the state contract.
- Dashboard portfolio rollup; Case detail tasks & attachments; CPV expanded-row units; Profile session list; Billing & Commission breakdowns.
- **Fix:** use `DataGrid` where it's an operational list; for genuinely small fixed sub-lists, keep a raw table but add the `.rtable`+`data-label` responsive pattern + semantics. Overlaps registry **C-9 (responsive retrofit)**.

### R6 · Honor the export/pagination contract everywhere
- **Users** — `Export Scope` bypasses `apiExport`'s job-threshold/413 path; route it through `apiExport`.
- **Case detail** — task/attachment lists fetch unbounded arrays; adopt the `PageQuery`/`Paginated<T>` envelope (or document as array-by-design).
- **Policies** — no export wired; add the DataGrid `exportFn`. Overlaps registry **B-13**.

---

## Wave 3 — P2/P3 consistency & polish

### R8 · Status/money/date through shared formatters
- Cases list & Case detail render status as **plain text** instead of `StatusChip`; several pages inline date/₹ instead of `formatDateTime`/the money fmt. Route all through the shared helpers (dim 9).

### R9 · Filters & URL-state on the remaining lists (dim 3)
- Case detail (in-memory filter, no URL-state), Commission Rates, Rate Management, Dedupe, Field Monitoring, RBAC Roles, Report Layouts — adopt the DataGrid `q`/`f_*` URL-state contract where the list is operational.

### R10 · Misc consistency (dim 13) + responsive touch targets (dim 6)
- **Users** — duplicate `Import` button + split `Export Scope`/`Export` (see VISUAL_VERIFICATION) — de-duplicate.
- **LocationsPage** — bespoke inline create form instead of the shared `+ New` dialog.
- **Code inputs** — `.toUpperCase()` in `onChange` violates the WYSIWYG/CSS-only-uppercase rule; coerce at submit, not keystroke.
- Row-action text links + `h-7` filter inputs are below the ~44px mobile touch-target; render row actions with `.btn-ghost`.

---

## Effort shape
- **Wave 1** is mostly one-liners (R1 gates, R7 tokens) + a handful of `useFocusTrap` adoptions (R2) + one shared `Popover` extraction → disproportionate risk reduction (closes all RBAC-UI P1s, most a11y P1s, both token P1s).
- **Wave 2** is medium (form migrations, table swaps) and **largely already scoped** under registry C-9/C-10/B-13 — this audit supplies the precise page list + file:line.
- **Wave 3** is polish.

**Recommendation:** approve **Wave 1** (R1, R2, R3, R7) as a single small PR — it removes every P1 except the table/contract items, with near-zero blast radius. Fold Wave 2 into the existing C-9/C-10/B-13 retrofit workstreams.
