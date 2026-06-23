# Management List Standard (CRM2)

Design standard for every **management / admin / master-data** list in the web app
(Verification Units, Clients, Products, CPV Mapping, and all future admin sections —
Rate Management, Location Management, User Management, Templates, etc.).

## Mandatory: Created AND Updated date + time columns

Every management list table **must** show two timestamp columns, each displaying
**date and time** (not date alone):

1. **Created** — when the record was created (`createdAt`).
2. **Updated** — when the record was last changed (`updatedAt`); reflects every edit
   / activate / deactivate.

This is a standing product requirement (user directive, 2026-06-05) — apply both to
every current and future management section.

- Source fields: the entity's `createdAt` / `updatedAt` (ISO `timestamptz` from the API).
- Format: `DD Mon YYYY, HH:MM` (local time, 24h) via the single shared helper
  `formatDateTime` in `apps/web/src/lib/format.ts`. Do **not** hand-roll date
  formatting per page — always use that helper so every list is identical.
- Placement: dedicated `Created` then `Updated` columns, conventionally just before
  `Status`/`Actions`.
- Uppercase display (the global visual standard) applies automatically; the data is
  unchanged. Empty/invalid timestamps render as blank, never `Invalid Date`.

Rationale: operators need to know *when* every master-data / config record was created
and last changed, to the minute — for audit, dedupe, and "what changed recently" triage.

## Mandatory: Effective From column + ACTIVE/SCHEDULED/INACTIVE status (ADR-0017)

Every master-data list **also** shows an **Effective From** column (`effectiveFrom`,
`formatDateTime`) and a three-state **Status** chip — **ACTIVE** / **SCHEDULED**
(effective in the future) / **INACTIVE** — instead of a binary active chip. This is the
user-settable temporal usability standard; SoT = `docs/EFFECTIVE_FROM_STANDARD.md` /
[ADR-0017](./adr/ADR-0017-effective-from-temporal-usability-gating.md). Use the shared
`StatusChip` + `effectiveStatus` helpers; create/edit dialogs carry an Effective From
date input. A row is USABLE only when `isActive AND effectiveFrom <= now()`.

## Master–detail layout: single-column accordion (no empty side panel)

When a management row has child records to manage (e.g. CPV Mapping: a client-product
row owns its verification units), use a **single-column accordion**, NOT a two-pane
master/detail:

- One full-width table. Clicking a row **expands its detail inline directly beneath it**
  (a chevron `▸`/`▾` indicates expand state); the detail holds that row's children +
  their add/enable control and their own labelled sub-table.
- Do **not** use a side-by-side two-pane layout where one pane sits empty until a row is
  selected — an empty panel reads as a stray/confusing second box. (This was the original
  CPV layout; replaced 2026-06-05.)
- The expanded detail's sub-table follows the same column standard (labelled headers +
  Created + Updated date-time columns).

Reference implementation: `apps/web/src/features/cpv/CpvPage.tsx` (the `UnitManager`
inline-expand). Apply this pattern to every future master-detail management screen.

## Add/edit pattern: inline-grid + record-page, NO modal forms (ADR-0051)

Add/edit is **inline, never a centered modal/overlay form**
([ADR-0051](./adr/ADR-0051-inline-grid-editing-no-modal-forms.md), owner-accepted 2026-06-20). This
**supersedes the dialog-based create/edit** previously implied here and in ADR-0008. Two surfaces:

- **Flat entities → editable DataGrid (per-cell inline editing + inline add-row).** Click a cell to
  edit it in place (Enter/blur commits, Escape cancels); "+ Add row" creates. Reuses the list
  endpoint's `PUT`/`POST` + `version` (per-row OCC → `ConflictDialog`). The Effective From input named
  above is now an editable `date` cell (or a record-page field), not a dialog field. Reference:
  `MasterDataCrud` + `components/ui/data-grid/` — Departments, Designations, Clients, Products,
  Locations.
- **Complex entities → full record-page route** `/admin/<entity>/new` + `/:id` (RBAC self-guarded,
  hydrated from `GET /:id`) — Policies, ReportLayouts, Roles, CommissionRates, Users (2-tab),
  VerificationUnits.

Kept overlays (not add/edit forms): OCC `ConflictDialog`, bulk `ImportModal`, confirm prompts, task
Assign, the Users list-row `ResetPasswordDialog`. Not converted (scope): CPV (master-detail
accordion, above), Templates + Rate-Management Revise (`COMPLIANCE_GAPS_REGISTRY.md §H`). See
`docs/DATAGRID_STANDARD.md §21` for the full inline-edit contract; a guard test
(`apps/web/src/lib/adr0051-no-modal-forms.guard.test.ts`) prevents regressions.

## Notes

- The backend already bumps `updated_at = now()` on every write (edit / activate /
  deactivate), so the Updated column tracks any change automatically.
- New management modules inherit both columns by reusing the shared `MasterDataCrud`
  component (`apps/web/src/components/MasterDataCrud.tsx`). Bespoke management
  tables must add both explicitly using `formatDateTime`.

## Pagination & loading (FROZEN 2026-06-05)
Every management list is **server-side paginated** and **search-first** per
**`docs/PAGINATION_AND_LOADING_STANDARDS.md`** (default 25; allowed 25/50/100/200; max 500
MIS-only; `>500` forbidden; envelope `{items,totalCount,page,pageSize,totalPages,sort,filters}`).
Tables show **skeleton rows** while loading (not spinners/blank). The Created/Updated +
labelled-header rules above still apply to every page of results. Pre-freeze management lists
(VU/Clients/Products/CPV/Rates/Locations) currently return capped/unpaginated and are tracked for
retrofit (MASTER_MEMORY §8).

## Universal DataGrid (FROZEN 2026-06-05)
Every management list is rendered by the one **Universal DataGrid**
(`docs/DATAGRID_STANDARD.md`) — not a bespoke table. The Created/Updated + labelled-header +
accordion-master-detail rules above are satisfied *through* DataGrid columns/features. The current
admin pages (VU · `MasterDataCrud` Clients/Products · CPV · Rates · Locations) predate this freeze
and are tracked for DataGrid retrofit (MASTER_MEMORY §8); no new management list ships without it.
