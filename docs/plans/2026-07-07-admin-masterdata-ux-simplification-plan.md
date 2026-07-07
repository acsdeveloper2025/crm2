# Admin Master-Data UX Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the accepted findings of the 2026-07-07 admin master-data UX audit
([SoT report](../audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md)) — collapse the
worst friction in the client-onboarding chain without touching any frozen semantics.

**Architecture:** Three independently shippable batches. Batch 1 = message/parity quick wins (FE +
one API module clone, all additive, no ADR/mig). Batch 2 = bulk-entry ergonomics (one additive bulk
endpoint, CSV import support, filters). Batch 3 = the strategic Client-Setup hub + onboarding
workbook — a **new UX pattern**, therefore ADR-0092 + owner sign-off BEFORE any code; this plan
defines its design cycle and decision points, not its code.

**Tech stack:** existing only — React 19 + shared DataGrid/ImportModal, Express modules
(routes/controller/service/repository), `@crm2/sdk` zod, shared `platform/import|export` engine
(ExcelJS 4.4.0, whose bundled fast-csv powers UX-14). **No new packages.**

## Global constraints (every task inherits these)

- `/api/v2` **additive-only**; never break mobile (`crm-mobile-native` consumes `/api/v2` — none of
  these endpoints are mobile-consumed, keep it that way).
- FE talks to API via `@crm2/sdk` only; one DataGrid; tokens-only styling; ADR-0058 uppercase
  transforms; OCC per ADR-0019 where a `version` exists.
- Export ≤ view-perm; import behind `MASTERDATA_MANAGE`; CWE-1236 formula guards via the shared engine.
- Any route change ⇒ regenerate `apps/api/openapi.json` (contract test enforces).
- No `any`/suppressions/`console.*`; raw SQL only in repositories + migrations.
- Gates: per-task tests green → per-batch **full `pnpm verify`** → Playwright subset if
  LoginPage/Layout touched → **browser-verify the actual action on crm2_dev** (perform + confirm
  persisted) → commit per task (author Mayur, conventional, NO AI trailer) → owner OK → push `main`
  (staging) → owner browser-check → promote `prod`.
- Registry: flip each UX-n to FIXED in §ADMIN-MASTERDATA-UX-2026-07-07 as its task ships.
- **Next ADR = 0092 (reserved for Batch 3). No migration expected anywhere in this plan (next mig
  stays 0117).**

## Verified facts this plan builds on (checked 2026-07-07, not assumptions)

- `rates/repository.ts:9,41` + `commissionRates/repository.ts:9,34` already map PG `23P01` EXCLUDE
  violations to `AppError.conflict('RATE_EXISTS' | 'COMMISSION_RATE_EXISTS')`.
- `RateRecordPage.tsx:197` renders `e.code` raw — the admin literally sees "RATE_EXISTS".
- `modules/shared/masterDataImport.ts` exports `masterDataImportSpec<T>(resource, schema)`; clients
  wires it in `clients/service.ts:41` — the clone source for rate-types import.
- ExcelJS 4.4.0 ships `fast-csv` (its `csv` API) — CSV import parse costs no new dependency.
- Rate-type availability is UX-gated only (0012 trigger dropped in 0013) — UX-8 is a **decision**,
  not a bug fix; it sits in Batch 3's ADR.

---

# BATCH 1 — Quick wins (no ADR, no mig; one worktree branch `feat/masterdata-ux-quickwins`)

### Task 1: Rate Types import + export (UX-5)

**Files:**
- Create: `apps/api/src/modules/rateTypes/import.ts`
- Modify: `apps/api/src/modules/rateTypes/service.ts`, `controller.ts`, `routes.ts`
- Modify: `apps/web/src/features/rateTypes/RateTypesPage.tsx`
- Modify: `apps/api/openapi.json` (regen)
- Test: `apps/api/src/modules/rateTypes/__tests__/rateTypes.import.test.ts` (new, mirror the clients import test file)

**Interfaces:**
- Consumes: `masterDataImportSpec` is the *shape* reference only — rate-types has extra columns, so
  build `RATE_TYPE_IMPORT_SPEC` from `CreateRateTypeSchema` with columns
  `Code | Name | Description | Category | Sort Order | Effective From` (blank Category → FIELD default).
- Produces: `GET /rate-types/export` (DATA_EXPORT), `GET /rate-types/import-template` +
  `POST /rate-types/import?mode=preview|confirm` (MASTERDATA_MANAGE) — same contract every other
  master-data module exposes.

- [ ] Step 1: Read `apps/api/src/modules/clients/service.ts` (import/export wiring) + `modules/shared/masterDataImport.ts` + one export manifest (e.g. products) — copy the wiring verbatim, adjust columns.
- [ ] Step 2: Write failing API integration test: template download returns the 6 headers; preview of a 2-row file (1 valid, 1 duplicate-code) reports 1 valid + 1 row-error; confirm persists the valid row; export round-trips it (headers == template).
- [ ] Step 3: Run it — expect FAIL (routes 404).
- [ ] Step 4: Implement `import.ts` spec + service export columns (`id, code, name, description, category, sortOrder, isActive, effectiveFrom, createdAt, updatedAt`) + controller/route wiring copied from clients (perm guards as above).
- [ ] Step 5: Regen openapi (`pnpm --filter @crm2/api openapi`), run module tests + contract test — PASS.
- [ ] Step 6: FE: add `ImportButton` + DataGrid `exportFn` to `RateTypesPage.tsx` — copy the exact props from `ClientsPage.tsx`.
- [ ] Step 7: Browser-verify on crm2_dev: download template → import a row → grid shows it → export → re-import preview = 0 errors. Delete the test row.
- [ ] Step 8: Commit `feat(rate-types): import/export parity with master-data pages (UX-5)`.

### Task 2: Friendly overlap + gating messages (UX-4 + UX-3, same files)

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateRecordPage.tsx` (error map + gating states)
- Modify: `apps/web/src/features/commissionRates/CommissionRateRecordPage.tsx` (error map)
- Modify: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentRecordPage.tsx` (CPV-missing warning)
- Test: colocated `__tests__` for each page (extend existing page tests)

**Interfaces:**
- Consumes: server codes `RATE_EXISTS`, `COMMISSION_RATE_EXISTS` (verified above); existing queries
  `/rate-types/available` + `/cpv-units/available`.
- Produces: a tiny shared `friendlyError(code): string | null` map local to each page (two entries — do
  NOT build a global error-copy framework; YAGNI).

- [ ] Step 1: Failing web test: submitting a rate whose mock API rejects `ApiError('RATE_EXISTS')` renders "An active rate for this combination already overlaps this period — revise or end-date it first." (assert exact copy); same for commission page with its code.
- [ ] Step 2: Implement the code→copy map in both pages' catch (fall through to current behavior for unknown codes).
- [ ] Step 3: Failing web test (RateRecordPage): combo fully selected + `available` returns `[]` → renders "No rate types assigned for this combination" + a link with `href=/admin/rate-type-assignments/new`; combo incomplete → keeps "Pick client, product & unit first". Two distinct states, distinct copy.
- [ ] Step 4: Implement the two-state message (the data is already in the component — `available.data` vs combo-readiness booleans).
- [ ] Step 5: Failing web test (RTA record page): client+product concrete + `cpv-units/available` returns `[]` → renders warning "This client + product has no CPV mapping yet" + link `/admin/cpv` (picker still falls back to all units — behavior unchanged, warning only).
- [ ] Step 6: Implement warning. Run all three pages' tests — PASS.
- [ ] Step 7: Browser-verify each state on crm2_dev (create a real overlap → see friendly 409; pick an unmapped combo → see both warnings).
- [ ] Step 8: Commit `fix(web): friendly overlap 409s + explicit rate-type/CPV gating messages (UX-3, UX-4)`.

### Task 3: Field/Office toggle guard (UX-9)

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateRecordPage.tsx`
- Test: extend its page test

- [ ] Step 1: Failing test: with unit or pincode or rate-type filled, the Field/Office toggle renders `disabled` + helper text "Clear unit/location fields to switch mode"; with all downstream empty it stays enabled.
- [ ] Step 2: Implement (`disabled={hasDownstreamValues}` + muted helper `<p>`; no confirm dialog — disabling is the simpler, keyboard-safe option).
- [ ] Step 3: Tests PASS; browser-verify; commit `fix(web): guard Field/Office toggle against silent downstream reset (UX-9)`.

### Task 4: RTA bulk-deactivate parity (UX-11)

**Files:**
- Modify: `apps/api/src/modules/rateTypeAssignments/{routes,controller,service,repository}.ts`
- Modify: `packages/sdk/src/rateTypeAssignments.ts` (BulkIdsSchema reuse — check `sdk` for the existing bulk-ids schema used by rates and import it, don't redefine)
- Modify: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx` (row-selection bulk action)
- Modify: `apps/api/openapi.json` (regen)
- Test: extend `rateTypeAssignments` API integration test

**Interfaces:**
- Produces: `POST /rate-type-assignments/bulk-deactivate` `{ ids: number[] }` → per-row result map
  `{ id, status: 'OK' | 'NOT_FOUND' }` (RTA has **no version column** — verified in DB audit — so no
  per-row OCC; mirror the shape, not the version mechanics, of rates' bulk endpoint).

- [ ] Step 1: Read `modules/rates` bulk-deactivate (routes→repo) + the rates page's bulk action wiring.
- [ ] Step 2: Failing API test: bulk-deactivate 2 real + 1 missing id → 200 with 2 OK + 1 NOT_FOUND, rows inactive, audit rows written; MASTERDATA_MANAGE required (viewer → 403).
- [ ] Step 3: Implement (single `UPDATE ... WHERE id = ANY($1) AND is_active` returning ids; diff for NOT_FOUND). Regen openapi. PASS.
- [ ] Step 4: FE: enable DataGrid row selection + "Deactivate selected" bulk action (copy ClientsPage `BulkStatusActions` usage, deactivate-only).
- [ ] Step 5: Browser-verify (select 2 → deactivate → both show Inactive after reload). Commit `feat(rate-type-assignments): bulk deactivate parity (UX-11)`.

### Task 5: Immutable-code affordance (UX-12)

**Files:**
- Modify: `apps/web/src/components/ui/data-grid/` cell renderer for the `createOnly` column flag (find where `createOnly` renders read-only — the flag shipped with RateTypesPage, ADR-0064 Phase A) + `apps/web/src/components/MasterDataCrud.tsx` code column
- Test: extend `datagrid` web test

- [ ] Step 1: Failing test: a `createOnly` column cell on an existing row renders `aria-disabled` styling hook + `title="Locked — set at creation"` (and MasterDataCrud's code column gets `title="Code locks once referenced"`).
- [ ] Step 2: Implement: muted text + a small lock glyph (existing icon set only) + title. No behavior change.
- [ ] Step 3: PASS; browser-verify tooltip; commit `fix(web): visually mark immutable code cells (UX-12)`.

### Task 6: Rate history export (UX-13)

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateManagementPage.tsx` (HistoryDialog)
- Test: extend its page test

- [ ] Step 1: Failing test: HistoryDialog with 2 loaded rows shows "Export CSV"; clicking produces a Blob download whose text contains the header `When,Action,Old,New` and 2 data lines, cells prefixed per CWE-1236 when starting with `=+-@`.
- [ ] Step 2: Implement client-side (rows are already in memory — join to CSV string, reuse the web app's existing download-blob helper if one exists, else `URL.createObjectURL`; ponytail: no new endpoint for data already on screen).
- [ ] Step 3: PASS; browser-verify a real download; commit `feat(web): export rate history from HistoryDialog (UX-13)`.

### Batch 1 gate
- [ ] Full `pnpm verify` green (api+sdk+web, typecheck→…→build) against `crm2_test` :5433.
- [ ] Browser-verified each task on crm2_dev (actions performed + persisted, per standing rule).
- [ ] Registry §ADMIN-MASTERDATA-UX-2026-07-07: UX-3/4/5/9/11/12/13 → FIXED with commit shas.
- [ ] Owner OK → push `main` → staging browser-check → owner OK → promote `prod`.

---

# BATCH 2 — Bulk-entry ergonomics (no ADR, no mig; branch `feat/masterdata-ux-bulk`)

### Task 7: CPV multi-select unit enable + paginated sub-table (UX-6)

**Files:**
- Modify: `apps/api/src/modules/cpv/{routes,controller,service,repository}.ts` (new `POST /cpv-units/bulk`)
- Modify: `packages/sdk/src/cpv.ts` (`BulkCreateCpvUnitsSchema { clientProductId, verificationUnitIds: number[]≤MAX_BATCH }`)
- Modify: `apps/web/src/features/cpv/CpvPage.tsx` (UnitManager: multi-select checkbox list → one bulk POST; paginate sub-table client-side, page size 20)
- Modify: `apps/api/openapi.json` (regen)
- Test: cpv API integration + CpvPage web test

**Interfaces:**
- Produces: `POST /api/v2/cpv-units/bulk` (MASTERDATA_MANAGE) → per-row `{ verificationUnitId, status: 'CREATED'|'REACTIVATED'|'ERROR', error? }`;
  single-create stays untouched (additive). Reuses the existing idempotent create (NULLS-NOT-DISTINCT re-activate) per unit inside one transaction.

- [ ] Step 1: Failing API test: bulk 3 units (1 new, 1 previously-deactivated → REACTIVATED, 1 bogus id → ERROR row) — 200, per-row statuses, audit written, other rows unaffected.
- [ ] Step 2: Implement service loop in one tx calling the existing repo create/reactivate path; regen openapi; PASS.
- [ ] Step 3: FE failing test: UnitManager renders unit checkboxes + "Enable selected (n)" button → one POST with the checked ids; sub-table pages at 20.
- [ ] Step 4: Implement (keep the single-select + Universal option; the checkbox list replaces the one-at-a-time select for multi). PASS.
- [ ] Step 5: Browser-verify: enable 3 units in one click on crm2_dev; reload persists; pagination works. Commit `feat(cpv): bulk unit enablement + paginated sub-table (UX-6)`.

### Task 8: Pincode dead-end messaging (UX-7, message half)

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateRecordPage.tsx` + `apps/web/src/features/commissionRates/CommissionRateRecordPage.tsx`
- Test: both page tests

- [ ] Step 1: Failing test: 6-digit pincode entered + `locations?pincode=` returns `[]` → renders "Pincode not found — add it in [Location Management](/admin/locations) first" and Area select stays disabled.
- [ ] Step 2: Implement in both forms (same 3 lines each). PASS; browser-verify; commit `fix(web): explicit pincode-not-found message in rate/commission forms (UX-7)`.
- *(The in-form add-location dialog from the audit is **deliberately dropped** — Location Management already exists one click away; YAGNI until the owner asks.)*

### Task 9: Commission page filters + picker hygiene (UX-10)

**Files:**
- Modify: `apps/web/src/features/commissionRates/CommissionRatesPage.tsx` (toolbar: User + Client SearchableSelect filters — copy RateManagementPage's toolbar wiring; list query already accepts the params — verify in `commissionRates/routes.ts` list filters first, add param pass-through if absent)
- Modify: `apps/web/src/features/commissionRates/CommissionRateRecordPage.tsx` (rate-type picker: `<optgroup>` FIELD / OFFICE; choosing an OFFICE type clears + disables pincode/area with helper "OFFICE rates are location-less")
- Modify: TAT band query: replace `limit=100` with the endpoint's max page size (read `tatPolicies` routes for the cap; if server caps lower than the row count, iterate pages — 2 lines with the existing sdk list helper)
- Test: both page tests

- [ ] Step 1: Read `commissionRates` list route params; wire missing filters server-side ONLY if already-supported params are unexposed (no new filter semantics without need).
- [ ] Step 2: Failing tests: toolbar filters narrow the query; OFFICE selection disables location inputs; TAT picker renders >100 policies when present.
- [ ] Step 3: Implement; PASS; browser-verify; commit `fix(web): commission list filters + OFFICE picker hygiene + TAT cap (UX-10)`.

### Task 10: CSV import support (UX-14)

**Files:**
- Modify: `apps/api/src/platform/import/index.ts` (accept `text/csv` MIME + `.csv` filename) + `format.ts` (parse via ExcelJS `wb.csv.read` on a readable from the buffer — ExcelJS 4.4.0 bundles fast-csv; NO new dependency)
- Modify: `apps/web/src/components/import/ImportModal.tsx` (accept `.csv` in the file input + copy text)
- Test: `apps/api/src/platform/import/__tests__` — one spec: identical 2-row dataset imports equal via xlsx and csv (same preview result object)

- [ ] Step 1: Failing test as above (csv branch 415s today).
- [ ] Step 2: Implement the csv parse branch mapping to the same `rows: Record<string,string>[]` shape the xlsx path emits (headers row 1; trim cells; same formula-guard on export side is untouched).
- [ ] Step 3: PASS across ALL modules automatically (one engine); regen nothing (no route change). Browser-verify a real .csv import on clients. Commit `feat(import): accept CSV alongside XLSX in the shared import engine (UX-14)`.

### Batch 2 gate
Same as Batch 1 gate; registry UX-6/7/10/14 → FIXED (UX-7 dialog half → WONTFIX-YAGNI note).

---

# BATCH 3 — Strategic: Client Setup hub + onboarding workbook (ADR-0092 FIRST, then its own plan)

**Nothing in this batch is coded from this plan.** Frozen-process requirement: new UX pattern + new
import mode ⇒ superseding/additive ADR + CTO + owner sign-off (`LONG_TERM_PROTECTION.md`).

- [ ] Step 1: Write `docs/specs/2026-07-XX-client-setup-hub-design.md` covering:
  - **Hub** `/admin/client-setup` (pick client → stepper: Products → CPV units → Rate types → Rates → Commission), each step embedding the EXISTING forms/grids (no duplicate form logic), plus a completeness checklist (counts from existing list endpoints; at most ONE new additive aggregator `GET /clients/:id/setup-status` if client-side count queries prove chatty — decide in spec).
  - **Workbook import**: one multi-sheet XLSX (`Products | CPV | RateTypeAssignments | Rates | CommissionRates`) processed sheet-by-sheet in dependency order through the EXISTING per-module ImportSpecs, with cross-sheet code resolution (a product created by sheet 1 is resolvable by sheet 2's preview) + one combined preview→confirm screen. Template downloadable pre-filled with the client's code.
  - **UX-8 decision matrix** (owner picks in the ADR): (a) keep UX-gate + document · (b) 400 `RATE_TYPE_NOT_ASSIGNED` on create/import when a concrete combo lacks the assignment · (c) warn-only response field. Recommendation: **(b) for imports, (a) for the API** until mobile/API consumers are re-audited — imports are new surface (no back-compat), the create endpoint is existing surface (additive-only rule).
- [ ] Step 2: 3-lens adversarial design review (CTO/Design/Security agents) — the repo's standard pre-build review for a new surface.
- [ ] Step 3: Write ADR-0092 (references the audit + spec; states what it does NOT change: resolution semantics, Universal storage, form patterns of existing pages).
- [ ] Step 4: Owner sign-off on spec + ADR + UX-8 choice.
- [ ] Step 5: Only then: write `docs/plans/2026-07-XX-client-setup-hub-plan.md` (same format as this file) and build in slices (hub shell → steps → checklist → workbook template → workbook import → e2e).

---

## Sequencing & effort

| Batch | Tasks | Est. effort | Ships |
|---|---|---|---|
| 1 | T1–T6 | ~1 focused session | independently, first |
| 2 | T7–T10 | ~1 session | independently, second |
| 3 | design→ADR→plan→build | ~2–3 sessions after owner sign-off | last |

Dependencies: none between T1–T6 (parallelizable across subagents on disjoint files; T2/T3 share
`RateRecordPage.tsx` → same implementer). T7 before T8 only for shared-page hygiene. Batch 3
independent of 1–2 but benefits from T10 (CSV) landing first.

## Self-review (spec-coverage check)

- UX-1, UX-2, UX-8 → Batch 3 (design cycle, by governance — intentionally not code-planned here).
- UX-3 ✅ T2 · UX-4 ✅ T2 · UX-5 ✅ T1 · UX-6 ✅ T7 · UX-7 ✅ T8 (dialog half dropped, YAGNI, recorded) ·
  UX-9 ✅ T3 · UX-10 ✅ T9 · UX-11 ✅ T4 · UX-12 ✅ T5 · UX-13 ✅ T6 · UX-14 ✅ T10 ·
  UX-15 → registry stays DEFERRED (documented, no task — owner's call later).
- No placeholders: every task names exact files, test intent with assertable copy, and the verified
  pattern-source to clone. Where a step says "read X first" that X is a named file — the
  no-guessing rule for files not yet opened in this session.
