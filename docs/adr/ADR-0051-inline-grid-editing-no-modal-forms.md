# ADR-0051: Inline-grid editing for add/edit — no modal forms (Twenty-style)

- **Status:** Accepted (owner decision 2026-06-20)
- **Date:** 2026-06-20
- **Supersedes (in part):** the dialog-based CRUD pattern in ADR-0008 (design system) and `docs/MANAGEMENT_LIST_STANDARD.md` / `docs/DATAGRID_STANDARD.md` (where they assume a modal add/edit form).

## Context

The 2026-06-19/20 frontend design audit ([docs/design-audit-2026-06-19/ADD_EDIT_PATTERN.md](../design-audit-2026-06-19/ADD_EDIT_PATTERN.md)) found the add/edit interaction is inconsistent across `apps/web`: **11 pages use a centered modal dialog** for both add and edit (`MasterDataCrud` + the `*Dialog` components — Clients, Products, Departments, Designations, VerificationUnits, Roles, Policies, Templates, ReportLayouts, CommissionRates, Users), **3 are split** (inline add / popup edit — Locations, RateManagement, CPV), and a few are already inline (CaseCreate, CaseDetail inline-row, Profile, Security).

Constraints / forces:
- **Owner directive:** add/edit must be **inline — no popup/modal forms.**
- **Mobile-first** is a project standard (`docs/RESPONSIVE_DESIGN_STANDARD.md`): centered modals are cramped on phones and inline-row editing collapses badly inside the DataGrid's mobile card view.
- We benchmarked the CRM leaders: **Salesforce** = modal-create + **inline field editing on the record page**; **Twenty** (open-source "20" CRM) = **inline-grid (cell) editing + a full record page, no modal routing**. The owner chose the **Twenty-style inline-grid** model despite the larger build.
- We already have a full-page record/create pattern in production for **Cases** (`/cases/new`, `/cases/:id`) and inline-row editing on **CaseDetailPage** — proof the no-modal direction works in-repo.

## Decision

We will adopt a **two-surface, inline-only** add/edit model. No add/edit form will ever be a modal/dialog or a side-panel overlay.

1. **Editable Universal DataGrid (primary surface for flat entities).** We will extend `components/ui/data-grid/DataGrid.tsx` so columns can be `editable` with a typed inline editor (text / select / date / checkbox). Editing is spreadsheet-style: click (or keyboard-focus + Enter) a cell → inline editor → **Enter/blur commits, Escape cancels**. New records are created via an **inline add-row**. This is the Twenty/Airtable pattern.
2. **Full record page/route (surface for complex records).** Entities whose forms do not fit cell-editing — **Users** (2-tab Profile/Access), **Roles** (hierarchy + password/idle/session/scope), **ReportLayouts** (column-mapping designer), **CommissionRates** (cascading pickers) — will edit on a **dedicated full-page route** (`/admin/<entity>/new`, `/admin/<entity>/:id`) with inline field editing, mirroring Cases. A full page (not a side-panel overlay) keeps it mobile-native and "no popup."
3. **Remove all add/edit modals** — `MasterDataDialog` and every `*Dialog` used for entity add/edit are deleted; their forms move to (1) or (2).
4. **Overlays that are NOT add/edit forms stay as-is:** the OCC `ConflictDialog` (ADR-0019), `ImportModal`, delete/deactivate confirm prompts, action dialogs (Pipeline Assign), and header menus/popovers. The directive is about *forms*, not all overlays.
5. **Mobile behavior:** the DataGrid already collapses each row to a stacked card on mobile — inline edit becomes "tap the field in the card to edit in place"; the record page is a full screen.

## Consequences

### Positive
- **One consistent, mobile-first, no-popup model**, matching modern CRM leaders (Twenty inline-grid + record page; Salesforce inline-on-record).
- Keeps list context (edit without leaving the grid); record pages are **URL-addressable** → bookmarkable, deep-linkable, and **RBAC-guardable per route** (also closes the H-1 client-gating leaks).
- Forces the **DataGrid to be keyboard-operable**, which resolves the D15 keyboard P1s (sortable headers + row navigation + cell editing must all work by keyboard) in the same build.
- Eliminates ~13 bespoke `*Dialog` components → less code, one mental model.

### Negative / Risks
- **The editable DataGrid is a substantial new capability**, materially larger than full-page routes. It must handle: per-cell edit state; **per-row OCC** (carry `version`, guarded UPDATE → 409 `STALE_UPDATE`, surfaced inline / via `ConflictDialog`); **per-field validation** (zod schema from `@crm2/sdk`, inline error); **keyboard nav** (Tab/arrow between cells, Enter edit/commit, Escape cancel); **effective-dating** (ADR-0017) for date-sensitive master data (date-sensitive edits may route to the record page rather than a cell); optimistic update + rollback on failure.
- Inline cell editing is unsuitable for rich/multi-section fields → those entities must use the record page (surface 2), so the model is intentionally two-part, not pure-grid.
- Migration touches the DataGrid + ~14 pages + removes the dialogs; it is the largest item in the remediation plan and is sequenced after the smaller Wave 1–3 fixes.

## Alternatives Considered
- **Full-page route for ALL create/edit** — simpler, equally mobile-native and no-popup, lower risk; **rejected** by the owner in favor of the Twenty-style inline-grid desktop experience.
- **Keep centered modal dialogs** — smallest change; **rejected** (owner: no popups; cramped on mobile and for large forms).
- **Responsive drawer (side slide-over → mobile sheet)** — best-of-both ergonomically; **rejected** because it is still a side overlay, not "no popup."
- **In-page form panel / inline-row form** (non-cell) — **rejected** in favor of true Twenty-style cell editing.

## Migration

Per the fix plan **Wave 4** ([docs/plans/2026-06-20-frontend-design-compliance-fix-plan.md](../plans/2026-06-20-frontend-design-compliance-fix-plan.md)): build the editable-DataGrid capability first (Foundation), then convert the flat entities to inline-grid editing and the complex entities to record-page routes, then delete the dialogs — TDD + `pnpm verify` + axe/keyboard e2e + browser-verify per page. AUDIT/PLAN stage until this ADR is acted on.

## Related ADRs
- **ADR-0008** (design system) — superseded in part (dialog CRUD → inline-grid + record page).
- **ADR-0017** (effective-from temporal gating) — inline editors must respect effective-dating.
- **ADR-0019** (concurrency & editing / OCC) — `ConflictDialog` + version guard reused per-row/per-cell.
- Standards: `docs/DATAGRID_STANDARD.md`, `docs/MANAGEMENT_LIST_STANDARD.md` (update to document the editable-grid + record-page pattern), `docs/RESPONSIVE_DESIGN_STANDARD.md`.
