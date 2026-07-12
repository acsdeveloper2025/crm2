# Plan — Departments + Designations CREATE_PAGE_STANDARD retrofit (2026-07-12)

Roll-out page 3. **Owner-approved (build as recommended).** These are two bespoke inline-grid pages
(ADR-0051, hand-rolled twins of MasterDataCrud) — **name-keyed** org sub-entities under **User
Management** (`user.manage` / `page.users`), not verification master-data. Singular → fan-out N/A.
This is the *Clients* treatment (retrofit inline grid in place), not the VU step-card treatment.

## Note: prior-session work reconciled
The FE retrofit (toasts + `canManage` RBAC gating) was already partly done and left **uncommitted**
from a prior/compacted session (DepartmentsPage + DesignationsPage + friendlyError.ts/test showed as
`M` at session start). This slice completed it (Departments toast wiring) + added the missing API
import seams, then verified the whole set. No data lost.

## Changes (additive — no schema, no migration, no ADR)
- `apps/web/src/lib/friendlyError.ts` — new `friendlyNameError(e, entity)` for NAME-keyed masters
  (`<ENTITY>_EXISTS` → "A department/designation with this name already exists."; unknown → raw).
  Test added.
- `DepartmentsPage.tsx` / `DesignationsPage.tsx` — green success / red error toasts on
  create/save/(de)activate; client RBAC gate `canManage = has('user.manage')` on +Add row / Import /
  actions column / selectable+bulk / inlineEdit. Designations keeps its Department FK `select` cell.
- `departments/service.ts` + `designations/service.ts` — per-entity `sampleRows` (one shape per row:
  dated + blank-`effectiveFrom`=now; distinct names so the template self-imports) + `templateNotes`.
  Designations' Department column resolves a department NAME→id; its Notes explain that.

## Frozen — untouched
Name-uniqueness, the Designation→Department FK, the `user.manage`/`page.users` audience split
(departments/designations deliberately live under User Management, not `masterdata.manage`).

## Gates
`pnpm verify` green (web 29 test files, api 86; +`friendlyNameError` test; dept+desig api 30).
Browser-verified crm2_dev: Departments duplicate → red inline "already exists" + create (PONYTAIL DEPT)
success; Designations renders with the Department FK column + RBAC write controls; console clean.
6-lens + logicality review deferred (per owner, after limit reset). No `pnpm openapi` (no route change).
