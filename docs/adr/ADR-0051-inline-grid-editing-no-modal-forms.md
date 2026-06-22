# ADR-0051: Inline-grid editing for add/edit — no modal forms (Twenty-style)

- **Status:** Accepted (owner decision 2026-06-20)
- **Date:** 2026-06-20 (decision); refined 2026-06-22 (review-panel fixes). Canonical reserved number per `docs/adr/README.md`.
- **Supersedes (in part):** the dialog-based CRUD pattern in ADR-0008 (design system) and `docs/MANAGEMENT_LIST_STANDARD.md` / `docs/DATAGRID_STANDARD.md` (where they assume a modal add/edit form).

## Context

The 2026-06-19/20 frontend design audit ([docs/design-audit-2026-06-19/ADD_EDIT_PATTERN.md](../design-audit-2026-06-19/ADD_EDIT_PATTERN.md)) found the add/edit interaction inconsistent across `apps/web`: **11 pages use a centered modal dialog** for both add and edit (`MasterDataCrud` + `*Dialog` — Clients, Products, Departments, Designations, VerificationUnits, Roles, Policies, Templates, ReportLayouts, CommissionRates, Users), **3 are split** (inline add / popup edit — Locations, RateManagement, CPV), and a few are already inline (CaseCreate, CaseDetail inline-row, Profile).

Forces: owner directive = add/edit must be **inline, no popup/modal forms**; **mobile-first** standard (centered modals are cramped on phones); benchmarked **Salesforce** (modal-create + inline-on-record edit) vs **Twenty** (inline-grid cell editing + record page, no modal routing) — owner chose the **Twenty-style inline-grid** model despite the larger build. Cases already proves the no-modal direction in production (`/cases/new`, inline-row edit on CaseDetail).

## Decision

Adopt a **two-surface, inline-only** add/edit model. No add/edit form is a modal/dialog or side-panel overlay.

1. **Editable Universal DataGrid (flat entities):** extend `components/ui/data-grid/DataGrid.tsx` so columns can be `editable` with a typed inline editor (text/select/date/checkbox). Spreadsheet-style: click or keyboard-focus + Enter a cell → inline editor → **Enter/blur commits, Escape cancels**. New records via an **inline add-row**.
2. **Full record-page route (complex entities):** Users (2-tab), Roles, ReportLayouts (designer), CommissionRates (cascading pickers) edit on a dedicated route (`/admin/<entity>/new`, `/:id`) with inline field editing — like Cases. A full page (not an overlay) keeps it mobile-native + "no popup".
3. **Remove all add/edit `*Dialog`/`MasterDataDialog` modals.**
4. **Keep** non-form overlays: OCC `ConflictDialog` (ADR-0019), `ImportModal`, confirm prompts, action dialogs (Assign), header menus.
5. **Mobile:** grid already collapses each row to a stacked card → inline edit = tap the field in the card; record page = full screen.

## Consequences
**Positive:** one consistent, mobile-first, no-popup model matching Twenty/Salesforce; keeps list context; record pages are URL-addressable + RBAC-guardable per route (also closes the H-1 client-gating leaks); forces the DataGrid to be keyboard-operable (resolves the D15 keyboard P1s in the same build); deletes ~13 bespoke dialogs.
**Negative/Risks:** the editable DataGrid is a substantial new capability (per-cell edit state; per-row OCC `version`→409; per-field zod validation; keyboard nav; effective-dating per ADR-0017; optimistic update + rollback) — larger than full-page routes; sequenced after the smaller Wave 1–3 fixes. Complex records use the record page, so the model is intentionally two-part.

## Alternatives Considered
- **Full-page route for ALL create/edit** — simpler/lower-risk; rejected (owner wants the Twenty-style inline grid).
- **Keep centered modals** — rejected (no popups; cramped on mobile/large forms).
- **Responsive drawer (sheet on mobile)** — rejected (still a side overlay).
- **In-page panel / inline-row form (non-cell)** — rejected in favor of true cell editing.

## Migration
Fix-plan **Wave 4**: build the editable-DataGrid (Foundation) → convert flat entities to inline-grid → record-page routes for complex entities → delete dialogs → guard test (no `role=dialog` add/edit form). TDD + `pnpm verify` + axe/keyboard e2e + browser-verify per page.

**Security (review 2026-06-22):** inline cell-edit, inline add-row, and the record-page write routes MUST enforce the same **server-side scope/ownership guards + per-row OCC** as the dialogs they replace — the new surfaces must not become an IDOR vector (FE gating is defense-in-depth only; the server stays authoritative). **De-risk before funding Wave 4:** spike inline-grid editing on ONE flat entity (e.g. Departments) to confirm it beats a full-page record route for real operator workflows; if it underwhelms, fall back to full-page-routes-for-all (cheap, the rest of the audit value is unaffected).

## Related ADRs
ADR-0008 (design system, superseded in part) · ADR-0017 (effective-from) · ADR-0019 (OCC/ConflictDialog reused) · **ADR-0052** (button system — sibling) · standards `DATAGRID_STANDARD.md` / `MANAGEMENT_LIST_STANDARD.md` (update).

## Implementation status (2026-06-22, branch `feat/design-build`)
⏳ **NOT started — this is fix-plan Wave 4 (the largest item, sequenced LAST).** Before funding: spike inline-grid editing on ONE flat entity (Departments); full-page-routes-for-all is the cheap fallback (CEO/CTO review). The editable-DataGrid build must reuse the dialogs' server-side scope guards + per-row OCC (no IDOR — Security review). The earlier waves (button system, dark toggle, token fixes, RBAC gates) ship first.
