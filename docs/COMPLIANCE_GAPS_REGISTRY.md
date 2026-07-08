# Compliance Gaps Registry (CRM2)

> **Permanent ledger of frozen decisions that are partially implemented, deferred, pending, or
> fixed-after-audit.** Purpose: never lose institutional knowledge as more agents build in parallel.
>
> **RULE — findings are never silently removed.** Every Yellow/Red finding must end in one of:
> **FIXED · DEFERRED · RATCHET · WONTFIX**, with evidence. A finding may move state (e.g.
> DEFERRED → FIXED) but its history stays. Companions: `docs/FROZEN_DECISIONS_REGISTRY.md` (what is
> locked) · `FREEZE_LOCK_REPORT.md` (enforcement) · `docs/ARCHITECTURE_GOVERNANCE.md` (process).

---

## Section A — FIXED gaps (discovered broken, fixed; keep history)

### A-1 · Coverage enforcement — 🔴 → 🟢 FIXED
- **Severity:** HIGH
- **Original finding:** Coverage thresholds (90/85) were configured but **never enforced** — the
  gate did not run.
- **Root cause:** `@vitest/coverage-v8` not installed; `test` script ran `vitest run` **without
  `--coverage`**, so thresholds were inert. Measured actual once enabled: api-v2 85.7% lines /
  59.4% branch; sdk 48% (transport `client.ts` 0%).
- **Fix applied:** installed `@vitest/coverage-v8` (api-v2/sdk/logger); set `coverage.enabled:true`
  (always-on → enforced in `pnpm test`/CI); added SDK transport test `client.test.ts` (injectable
  `fetchImpl`, all 31 methods → sdk 100% lines); set honest **enforced** floors with a ratchet;
  corrected the stale "≥90" claim in ENGINEERING_STANDARDS + CI_CD_STANDARDS row 18.
- **Date fixed:** 2026-06-05
- **Evidence:** commit `642c362`; `pnpm verify` green with coverage now enforced.

### A-2 · Effective-From temporal usability gating — ✅ BUILT (ADR-0017)
- **Severity:** MEDIUM (owner-requested capability, not a defect)
- **What:** master data had only `is_active` (binary) — no way to schedule a row to become usable
  on a future date and keep it visible-but-not-usable until then.
- **Built:** migration `0015_effective_from.sql` (7 tables + backfill `= created_at` + indexes on
  locations/users); the rule **USABLE ⇔ `is_active AND effective_from <= now()`**; `?active=true`
  on every master-data list now means USABLE; hard-coded operational reads gated (auth login,
  cases availableUnits/assignableUsers, rateTypes lookup, locations pincode cascade); user-settable
  `effectiveFrom` on create/update; admin lists show ACTIVE/SCHEDULED/INACTIVE + an Effective From
  column. SoT `docs/EFFECTIVE_FROM_STANDARD.md`; FROZEN_DECISIONS #30.
- **Date:** 2026-06-05
- **Evidence:** `pnpm verify` green (api 113 tests incl. gating tests in clients/auth/cases/cpv);
  live dev-API + browser verified (scheduled client → SCHEDULED chip, hidden from `active=true`).
- **Extended to CPV (2026-06-05):** migration `0016` adds `effective_from` to `client_products` +
  `client_product_verification_units` (the owner flagged CPV as missing it). Same USABLE rule;
  case-creation `availableUnits`/`allUnitsEnabled` now gate `vu` + `cp` + `cpvu`. **Also fixed a CPV
  UX bug (Finding A):** verification-unit mapping existed but was hidden behind a bare accordion
  chevron — added an active unit-count column + explicit "Manage units" action. CpvPage shows
  Effective From + ACTIVE/SCHEDULED/INACTIVE on links and unit enablements.

---

## Section B — DEFERRED gaps (frozen standards, approved, not yet built — NOT blockers)

These are scheduled for a future implementation phase. They are **not bugs and not missing
architecture** — simply not built yet. Each is built when its phase lands.

| ID | Item | Status | Governing standard | Target phase |
|---|---|---|---|---|
| B-1 | Universal DataGrid component | ✅ ROLLED OUT to all 6 lists (2026-06-06, `9c5fb5c`/`29ca2b0`/`36a633b`/`6b2bf77`) | `docs/DATAGRID_STANDARD.md` | Core + onRowClick on every admin/ops list (C-1..C-8 except CPV); advanced features B-3..B-6/B-13 still layer next |
| B-2 | Server-side pagination (envelope) | ✅ ALL list endpoints on Paginated<T> (2026-06-06) | `docs/PAGINATION_AND_LOADING_STANDARDS.md` | clients/products/users/verification_units/report_templates/locations/cases/rates converted; array-by-design endpoints (pincodes/dedupe/available-units/assignable-users/rates-history) stay arrays |
| B-3 | Column filters (§6 column search / §8 multi-column) | ✅ **FIXED + ROLLED OUT to all 8 lists** (2026-06-06) — clients/products/VU + users/templates/locations/rates/cases. Per-page `filterMap`+`filterable` | `docs/DATAGRID_STANDARD.md` | Shipped everywhere (CPV bespoke, excluded) |
| B-4 | Excel-style header filters (§7 multi-select) | ✅ **FIXED + ROLLED OUT** (2026-06-06) — `in` contract + grid `ColumnFilterSelect`; enum header multi-selects live on VU kind · users role · templates type · rates kind · cases status (replaced the old toolbar single-selects) | `docs/DATAGRID_STANDARD.md` | Shipped across admin + cases |
| B-5 | Saved views | ✅ **FIXED** (2026-06-15) — server-backed `saved_views` (mig 0051, own-user scoped like notifications/jobs); `/api/v2/saved-views` list/create/update/delete/set-default; `@crm2/sdk` `savedViews.*`; `SavedViewsPicker` in the DataGrid toolbar (reuses the grid's `queryKey` as resourceKey → all ~15 grids, zero per-page edits); captures every URL key except `page`, switch applies, default auto-loads on clean open. Audit Panel 4 PASS + 1 BLOCK (phantom `btn-primary`→`btn`) fixed | `docs/DATAGRID_STANDARD.md` §10 | Browser-verified on /admin/locations (create→switch→set-default→reload-auto-applies→delete). CARRY: delete confirm/undo; 23505 constraint-discrimination (unreachable today) |
| B-6 | Column visibility | ✅ **FIXED** (2026-06-06, Slice 2) — Columns menu on the universal grid; hidden ids persist in the `cols` URL key (§9/§12 interim before the saved-views store §10); all 7 migrated lists inherit it | `docs/DATAGRID_STANDARD.md` | Shipped |
| B-7 | Background-job UX | ✅ **FIXED** (2026-06-23 cross-check, §X-CHECK) — `JobsTray.tsx` determinate HexagonLoader % + download-on-SUCCEEDED + error/cap; realtime `useJobs` | `docs/PAGINATION_AND_LOADING_STANDARDS.md` §10–11 | Shipped |
| B-8 | Skeleton loading | ✅ **FIXED** (2026-06-09, Slice 9) — skeleton now band-gated to 300 ms–1 s (§6); 0–300 ms renders nothing (no flicker) | `docs/PAGINATION_AND_LOADING_STANDARDS.md` §6/§9 | Full §6 time-band ladder live in the DataGrid (`>8s`=background job stays DEFERRED → B-7) |
| B-9 | Hexagon loader (real %) | ✅ **FIXED** (2026-06-09, Slice 9) — `components/ui/HexagonLoader.tsx`; geometric hexagon, determinate (real % for staged jobs) + indeterminate (single-stage waits); reduced-motion-safe | `UI_STANDARDS.md`, `docs/PAGINATION_AND_LOADING_STANDARDS.md` §7/§8 | Indeterminate wired to the list-fetch now; determinate-% path awaits the operations/worker jobs (reports/MIS/export) |
| B-10 | Playwright E2E + axe a11y | DEFERRED | `docs/CI_CD_STANDARDS.md` (19/29) | First UI flow; CI step already stubbed |
| B-11 | OpenAPI generation | ✅ **FIXED (phase 1)** (2026-06-15, ADR-0031) — `platform/openapi` derives an OpenAPI 3.1 doc from the LIVE app (paths/methods/tags/security, zero new deps); committed `apps/api/openapi.json` via `pnpm openapi`. Request/response **schemas = phase 2** (zod single source) | `DOCUMENTATION_AS_CODE.md` (ADR-0011/0031) | Surface contract shipped; schema bodies deferred to the responses-into-zod migration |
| B-12 | SDK drift detection | ✅ **FIXED** (2026-06-15, ADR-0031) — **validate-don't-replace** (hand-written SDK stays authoritative). Two gates: (1) CI Part 21 re-emits + `git diff --exit-code openapi.json` (every route); (2) contract test asserts committed spec is current AND every `@crm2/sdk` path resolves to a real route (SDK→route, 0 violations). Reverse not asserted (FE uses `api()` for import/bulk/export/dashboard → would rot an allowlist; git-diff covers them) | `docs/CI_CD_STANDARDS.md` (21), ADR-0031 | Response-shape drift caught in phase 2; request drift already prevented by shared zod |
| B-13 | Universal export (current view / selected / all-matching; XLSX/CSV/PDF; `≥10k`=job) | 🟡 **PARTIAL — current-view + all-matching + `selected` DONE on ALL 7 ADMIN LISTS** (XLSX/CSV, `<10k` sync; `selected` mode added 2026-06-09 with row-select); see progress log | `docs/IMPORT_EXPORT_STANDARD.md` + `docs/DATAGRID_STANDARD.md` | Remaining: ops **cases** export · PDF · ≥10k report-worker job tier (streaming builders). Ops **tasks** (Pipeline) export shipped with the list itself (2026-06-11, current/all/selected, scope-honoring). |
| B-23 | Row selection + bulk actions (DATAGRID_STANDARD §15) | ✅ **FIXED** (2026-06-09) — shared DataGrid selection (checkbox col + select-all-page + "select all N matching" banner + bulk bar) on all 7 admin lists; built-in **Export Selected** (B-13 mode 2) + **bulk Activate/Deactivate** (per-row OCC per CONCURRENCY_AND_EDITING_STANDARD §1, per-row OK/CONFLICT/NOT_FOUND result) | `docs/DATAGRID_STANDARD.md` §15, `docs/CONCURRENCY_AND_EDITING_STANDARD.md` §1/§7 | Selection captures row `version` (Map) for OCC; `allMatching` disables versioned bulk (export still works). DON'T-REGRESS: scoped-resource bulk must enforce scope inside the per-row apply fn. |
| B-14 | Universal import engine (`@crm2/import-engine`: template/validator/mapper/processor + flow + validation report + import audit) | DEFERRED | `docs/IMPORT_EXPORT_STANDARD.md` | First import need (Clients/Products/Rates/Pincode/Users…) |
| B-15 | Authentication (login / JWT-pair + refresh / password set, web) — **SHIPPED** (ADR-0014, mig `0009_auth.sql`): scrypt passwords + `jose` HS256, `/api/v2/auth/{login,refresh,logout}`+`/me`, web login + Bearer + single-flight 401→refresh; dev `x-test-auth` seam is backend-test-only now. | ✅ **FIXED** (ADR-0014) | ADR-0014, ADR-0012 | Remaining: mobile rebase to `/api/v2/auth` (separate repo) + refresh-revoke-on-password-change — tracked, short access TTL mitigates. |
| B-16 | Report rendering engine (Handlebars/text → PDF) + CPV-scoped template overrides (client+product+vtype) | DEFERRED | BLUEPRINT report-engine section | Reports/operations phase. Field/case report rendering exists on built-in defaults (`FIELD_REPORT_DEFAULTS` / `DEFAULT_CASE_REPORT_TEMPLATE`); the `report_layouts`-backed CPV-scoped OVERRIDE layer was removed (ADR-0083, mig 0108, §MIS-RM) pending the new MIS design. PDF/Word/Excel download tier still open. |
| B-17 | Verification Workspace — single page (Zion NewDataQC): per-task data-entry/MIS · assignment · FE-mobile images+data · report entry · auto-gen · Final Status + Case Report | DEFERRED | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §1, ADR-0015 | Operations phase — reuse `/cases/:id` behind a flag. Keystone. |
| B-18 | Per-client+product Reporting Engine — two kinds (MIS_EXCEL + CASE_REPORT), formats PDF/WORD/EXCEL, field/column mapping (FE data+images+seal), 200+ formats config-driven; ~~extends `report_templates` 0008~~ ~~built on `report_layouts` (ADR-0037/0039/0041/0049)~~ — the `report_layouts` engine was REMOVED (ADR-0083, mig 0108, §MIS-RM); to be rebuilt fresh with the new MIS design | DEFERRED | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §2, ADR-0015 | Operations phase — rebuild the config layer (ADR-0083), then generation via report-worker (PDF) + export engine (Excel). |
| B-19 | Admin Template Designer (design/upload MIS-Excel + Case-Report templates per client+product[+type]; versioned, immutable-once-used) | ↩️ **REMOVED → back to DEFERRED** (2026-07-01, ADR-0083, §MIS-RM). Was FIXED 2026-06-23 (`reportLayouts` module + `ReportLayoutRecordPage.tsx` kind-branched designer, ADR-0037/0051 D4) but the entire MIS / report-layout engine — designer, `report_layouts` store, `/mis`, office data-entry — was torn out (mig 0108) for a clean-slate MIS rebuild. Field/case reports now render from built-in defaults only. | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §2.2, ADR-0015 | DEFERRED — pending the new MIS design (ADR-0083) |
| B-21 | Rate Management — **SHIPPED as the FLAT one-table model** (ADR-0018, migs `0013_rate_management_flatten`+`0014_rate_types_lookup`), NOT the ADR-0016 4-table rebuild: one `rates` row `(client,product,VU,location,rate_type)→amount` effective-dated + a read-only managed `rate_types` lookup. The owner reversed the 4-table design mid-build → `rate_type_eligibility` + `service_zone_rules` + the eligibility trigger were dropped. | ✅ **FIXED** (ADR-0018 supersedes ADR-0016) | ADR-0018; `docs/RATE_MANAGEMENT_FREEZE.md` (superseded banner) | Shipped + browser-verified. Commission (FUCA) later phase. |
| B-20 | Territory (pincode/area) scoped assignment + assignment-history audit. Task Assignment (`0011`, commit `22a56c0`) ships **hierarchy** scope only (SA/MANAGER subtree/TEAM_LEADER direct reports). True territory matching (FE sees tasks in their pincodes/areas, per `MOBILE_API_COMPATIBILITY_MATRIX.md` `assignedPincodes/Areas`) needs location on cases/users — neither exists in v2 yet. Reassignment overwrites in place (no append-only assignment history). | ✅ **FIXED — generalized far beyond the ask** (ADR-0022 Access Control 2.0): cases carry `pincode_id/area_id` (0031); assignments live in the generic `user_scope_assignments` (0034) wired per ROLE (`role_scope_dimensions`, EXPAND/RESTRICT) across 7 dimensions (PINCODE/AREA/CLIENT/PRODUCT/STATE/CITY/VERIFICATION_TYPE); visibility enforced centrally (`platform/scope`); admin UI (Roles screen + the user dialog Access tab) + bulk import/export; every layer fail-closed + audited. Residual ✅ CLOSED by the Pipeline milestone (2026-06-11, `12ba6b5`/`66d97db`/`fcce76e`): append-only `task_assignment_history` (mig 0036, immutability trigger) + `assignableUsers` = unit.worker_role ∩ hierarchy ∩ territory (per-task + intersection endpoints) + VERIFICATION_TYPE task-grain list legs (`taskPredicate`) live on `/api/v2/tasks`. | ADR-0022; migrations 0030–0035; `noRoleLiterals` gate | Shipped slices AC2.0 1–8 (2026-06-10/11), browser-verified. |

**Reason:** scheduled for future implementation; not architecture blockers. Build order:
MASTER_MEMORY §9.

---

## Section C — RETROFIT requirements (built pre-freeze; must upgrade later)

| ID | Component | Current state | Required future state | Target phase |
|---|---|---|---|---|
| C-1 | Master-data tables (Clients/Products via `MasterDataCrud`) | ✅ MIGRATED to DataGrid + server pagination (`4e7a8fd`) | — | DONE (reference impl) |
| C-2 | Verification Units page | ✅ MIGRATED to DataGrid + server pagination (`9c5fb5c`) | — | DONE |
| C-3 | CPV Mapping page | ✅ MIGRATED to the Universal DataGrid via the new additive `renderExpanded` master-detail prop (DATAGRID_STANDARD §20) — `client_products` list→`Paginated` envelope, server search/sort/filter, column visibility, date-range filters, export + import; the inline `UnitManager` accordion is preserved as the expanded row. (`2d461ae`/`066cbaf`/`183b76e`/`324592b`) | Universal DataGrid (row-expansion) | DONE — full parity with the 7 other admin lists; row-select/bulk deliberately excluded (B-23 scope) |
| C-4 | Rate Management page | ✅ MIGRATED to DataGrid + server pagination + global search; Revise/History → dialogs (`6b2bf77`) | — | DONE |
| C-5 | Location Management page | ✅ MIGRATED to DataGrid + server pagination + migration 0020 trgm/sort indexes (`29ca2b0`) | — | DONE (157k, EXPLAIN-verified <2s) |
| C-6 | User Management page | ✅ MIGRATED to DataGrid + server pagination (`9c5fb5c`) | — | DONE |
| C-7 | Report Templates page | ✅ MIGRATED to DataGrid + server pagination (`9c5fb5c`) | — | DONE |
| C-8 | Cases list page | ✅ MIGRATED to DataGrid + server pagination + onRowClick→detail (`36a633b`) | — | DONE |
| C-10 | **Concurrency/editing (OCC) retrofit — ALL pre-freeze admin modules** (clients/products/VU/CPV/rates/locations/users/templates + cases/tasks) | last-write-wins: `UPDATE … WHERE id=$1`, no version guard; `version` column missing on ~9 tables (only VU/rate_types/rates have it, VU's is an unenforced counter); no master-data change history (only `rates.rate_history`) | OCC per `docs/CONCURRENCY_AND_EDITING_STANDARD.md` (ADR-0019): add `version`; guarded UPDATE → 409 STALE_UPDATE; require version on update; append immutable audit/history; per-row bulk OCC; FE conflict dialog | Editing-standard retrofit (migration adds `version` + generic `audit_log`; new modules build it from day 1). See FROZEN #33. |
| C-9 | **Responsive-First retrofit — ALL pre-freeze screens** (app shell/sidebar, every feature page, dialogs, filters) | desktop-layout: persistent fixed sidebar (no mobile drawer), wide tables with no mobile card view, some non-responsive grids/dialogs → breaks `<768px` | responsive-first per `docs/RESPONSIVE_DESIGN_STANDARD.md`: sidebar→hamburger/Sheet `<lg`, table→card on mobile, mobile-up grids/dialogs, no horizontal overflow at 320/768/1024/1440 + Playwright viewport specs | Responsive retrofit (app shell first; table→card folds into the DataGrid build). See FROZEN #32. |

**Rule:** no NEW list ships without pagination + DataGrid; these pre-freeze pages migrate before GA
(also tracked in `CRM2_MASTER_MEMORY.md` §8).

**PROGRESS 2026-06-06 (`4e7a8fd`) — DataGrid epic started (vertical reference):** the Universal DataGrid
core + the server-pagination envelope shipped on the clients/products reference (C-1 ✅). DataGrid lives
app-internal at `apps/web/src/components/ui/data-grid/` (TanStack Table; NOT a new package). Core =
server pagination/sorting/global-search · skeleton/empty/error states · URL-state (keys `q/sort/dir/page/
size`) · sticky header · responsive `.rtable` card (the grid now owns it). **Next:** roll the DataGrid +
`pageQueryToParams`/envelope retrofit out to the remaining 16 list endpoints (C-2..C-8 + ops), then layer
advanced features (B-3 column filters · B-4 Excel header filters · B-5 saved views · B-6 column visibility ·
B-13 export · bulk/row-select · B-8 Hexagon loader + loader bands). **B-22 — ✅ FIXED (Slice 1B, see below).**

**PROGRESS 2026-06-06 — ✅ DataGrid + server-pagination ROLLOUT COMPLETE (`9c5fb5c`·`29ca2b0`·`36a633b`·`6b2bf77`, LOCAL/unpushed).**
B-1/B-2 done; C-2/C-4/C-5/C-6/C-7/C-8 ✅ MIGRATED (only C-3 CPV stays bespoke — master-detail accordion, no grid
row-expansion). 4 slices: (1) users·verification_units·report_templates `9c5fb5c`; (2) locations[157k] + migration
0020 (pg_trgm GIN + sort btree) `29ca2b0`; (3) cases (+ additive `onRowClick` on the Universal DataGrid) `36a633b`;
(4) rates — effective-dated/history, KYC null rows, global search, Revise/History→dialogs `6b2bf77`. Every slice:
green `pnpm verify` (api 165→192 · sdk 62) + Playwright 61/0 + Audit Panel (CEO + Principal + DB + Security +
Performance + Design + API/Contract, ledgers `docs/agents/*.md`; on slices where audit subagents hit the session
limit the CTO discharged the gap inline, logged in the ledger). Array-by-design endpoints kept as arrays:
`/locations/pincodes`, `/cases/dedupe|available-units|assignable-users`, `/rates/:id/history`. **Carried OPEN:**
~~B-22~~ ✅ (Slice 1B); ~~widen the e2e crash-guard to every envelope page~~ ✅ + ~~`viewport.spec` flake~~ ✅ (Slice 1C);
wire SDK-drift/contract CI gates (still DEFERRED — needs OpenAPI B-11/B-12); advanced DataGrid features
(B-3..B-6/B-13/bulk/keyboard-nav) still DEFERRED.

**ROLLOUT-TAIL Slice 1C — ✅ e2e crash-guard widening + viewport flake DONE (2026-06-06, test-only; CTO-discharged audit [CEO/Principal/Design] — logged in ledgers; Playwright 61 passed).**
`datagrid.spec.ts` crash-guard widened from 3 paths to ALL 10 envelope/options-consuming routes (clients·products·verification-units·users·
locations·rates·cpv·templates·/cases·/cases/new) — asserts shell+h1 survive AFTER data load (catches `.map` on an envelope OR `.items` on a
flat array). `viewport.spec.ts` flake fixed: added `await page.waitForLoadState('networkidle')` after goto so the table→card cell-count
assertion no longer races the list fetch. SDK-drift/contract CI gates remain DEFERRED (need OpenAPI B-11/B-12).

**MASTER-DATA EDIT Slice — ✅ ADR-0020 correctable identity keys (clients + products `code`) DONE (2026-06-06; Audit Panel 6 roles; Security+DB+API/Contract PASS, CEO+Principal FLAG→RESOLVED, Design PASS).**
Owner-approved fix for "user typos a code and can't correct it." New **ADR-0020** (amends ADR-0001): a master-data `code` is editable while the row is
UNREFERENCED, locked (409 CODE_LOCKED) once in use. Reference impl on clients + products (shared `MasterDataCrud`): `UpdateClient/ProductSchema` gain
optional `code`; repo `hasDependents(id)` (EXISTS client_products|rates|cases) + `updateRow` (OCC-guarded, `SET code=COALESCE($2,code)`, unique→*_CODE_EXISTS);
service throws CODE_LOCKED pre-mutation if the code changed AND has dependents. FE: code input un-frozen on edit + helper "correctable only while unused (ADR-0020)"
+ friendly CODE_LOCKED message. api 217→220; sdk 63 (contract tests updated: code now optional); live-verified (HDFC CPV-referenced code-change→409, name-only→200,
fresh code-correct→200). **CEO/Principal FLAG (hasDependents covers only 3 referencing tables) → RESOLVED/false-positive (CTO):** the auditor cross-checked the
v1 `acs_db_final_version.sql`; the LIVE v2 schema has EXACTLY 3 tables with client_id/product_id (cases·client_products·rates — confirmed via live test DB +
v2 migrations; the 0012 eligibility/SZR FK tables were DROP CASCADE'd in 0013; invoices/kyc_rates/etc. are v1-only, 0 rows/0 tables in v2). hasDependents is
COMPLETE for v2 (the DB auditor confirmed correctly against db/v2/migrations). Stale "code immutable" service file-headers corrected. **ROLLOUT TODO (this task,
not jumping): apply ADR-0020 to VU·locations·templates `code`/`pincode` (+ users.username = login rename, no FK deps).** When new referencing tables land
(invoices/reporting in later phases), ADD them to the relevant `hasDependents` (DON'T-REGRESS: hasDependents must list every live FK referrer).

**ADR-0020 ROLLOUT cont. — ✅ templates + locations + users DONE (2026-06-06; Audit Panel DB+Security+Principal+CEO+Design 5/5 PASS).** Same proven
pattern: **report_templates** `code` (0 v2 referrers → `hasDependents`=false → always editable; lock wired+dormant), **locations** `pincode`
(`hasDependents`=EXISTS(rates) → `409 PINCODE_LOCKED`; lock test creates a rate referencing it), **users** `username` (login rename — NO FK deps since
refs are by uuid id → no gate, uniqueness→`USER_EXISTS`). Each: SDK Update schema +optional key; repo renumbered UPDATE `SET key=COALESCE($2,key)`
(audit verified `$N`↔params EXACT in all 3) + hasDependents + unique mapping; service gate (locations) / no-gate (templates·users); FE dialog key field
un-frozen + helper + lock message (locations pincode static `<p>`→editable input). The 2 pre-existing immutability api tests (templates·users) +
3 SDK contract tests updated to "unchanged when omitted". api 220→223; sdk 63; Playwright 64; browser-verified (users username editable). 4 stale
"immutable" doc-comments corrected. **DON'T-REGRESS: auditors must check `db/v2/migrations`/live DB for
FK referrers, NOT the v1 `acs_db_final_version.sql`.**

**ADR-0020 ROLLOUT ✅ COMPLETE — VU `code` DONE (2026-06-06; Audit Panel DB+Security+Principal+CEO+Design 5/5 PASS).** The last + trickiest entity:
VU's update merges the patch over the existing row + re-validates via CreateVerificationUnitSchema. Replaced the `CODE_IMMUTABLE` throw with the
`hasDependents` gate (EXISTS cpv_units|rates|case_tasks → 409 CODE_LOCKED); `merged` no longer forces `code:existing.code` (a permitted new code flows
through, still Create-schema-validated). repo.update writes `code = COALESCE($23, code)` — **$23 is a FRESH TRAILING param** appended after the dense
$1..$22 (audit-verified exact, no renumbering) + try/catch→UNIT_CODE_EXISTS. SDK `UpdateVerificationUnitSchema` un-omits code (optional, validated). FE VU
dialog: code un-frozen + CODE_LOCKED message. api 223 (VU test: name-edit→200, code-correct-unreferenced→200 v3, CPV-reference→409 CODE_LOCKED); sdk 63.
Removed the now-dead `CODE_IMMUTABLE` error enum (my change orphaned it). **✅ Option B now LIVE on ALL keyed admin entities: clients·products·VU `code` ·
templates `code` · locations `pincode` · users `username` — each correctable while unreferenced, locked once in use (users always — no FK deps).** CPV/CP
keys + rates composite stay immutable-by-design (recreate / Revise). **DON'T-REGRESS: when new FK referrers land (invoices/reporting), add them to the
relevant `hasDependents`.**

**MASTER-DATA EDIT Slice — ✅ CPV effective-from reschedule edit DONE (2026-06-06; Audit Panel Security+DB+API/Contract+CEO+Principal+Design 6/6 PASS).**
Closes the lone master-data gap where CPV had NO edit at all (every other admin list could already reschedule `effective_from` per ADR-0017). Added
`updateEffectiveFrom` (OCC-guarded, in-tx audited, mirrors the proven `setActive` pattern) to BOTH cpv sub-repos + service `update` (requireVersion) +
controller + `PUT /client-products/:id` & `PUT /cpv-units/:id` (MASTERDATA_MANAGE) + SDK `UpdateClientProduct/CpvUnitSchema` + `.update()` methods. FE:
`RescheduleDialog` (date input, OCC ConflictDialog on 409) on an Edit button on each link + unit row. **ONLY `effective_from` is editable — keys
(client/product/unit) stay immutable per ADR-0001** (dialog copy says so: deactivate+recreate to fix a wrong key). api 215→217; sdk 63 (client.test 66→68);
live routes verified (VERSION_REQUIRED / CPV_UNIT_NOT_FOUND); browser-verified the dialog. Design caught + fixed a token nit (`bg-black/40`→`bg-foreground/40`).
**OPEN (master-data mistake-fix, owner-raised):** a typo in an IMMUTABLE key (code/username/pincode/CPV-keys) still can't be corrected in place — only
deactivate+recreate. Making keys editable would reopen ADR-0001 (immutable+versioned codes for history/report coherence) → needs a decision (options:
keep deactivate+recreate · allow code-edit-while-unreferenced · hard-delete-if-unreferenced). FLAGGED to owner, not changed.

**ADVANCED DATAGRID Slice 5 — ✅ COLUMN-FILTER ROLLOUT to all remaining lists DONE (2026-06-06; Audit Panel DB+Security+Performance+CEO+Principal+Design 6/6 PASS).**
Applied the (already-7/7-PASS'd) B-3/B-4 filter contract + grid UI to the 5 lists that lacked it — **users · report-templates · locations · rates · cases** —
joining clients/products/VU. Each: service `filterMap` + `resolveFilters` + echo; repo `filterClauses`; page `filterable`/`filterOptions`. Enum header
multi-selects REPLACED the old toolbar single-selects (users role · templates type · cases status; matches the VU-kind precedent — adds multi-select,
loses nothing; kept the `active`/status + rates clientId/productId toolbar selects). **Count-query join safety enforced per list** (the load-bearing
invariant): users filters only `u.*` (NOT manager `m.name`); cases only `cs.*`+`pa.name` (NOT `cl`/`p` — the lean COUNT doesn't join them); rates uses
the shared RATE_FROM so joined `vu.kind`/`l.pincode` are safe; locations/templates single-table. NO change to `platform/pagination.ts` or the grid core
(pure declarative reuse). Injection-safe (every filter column a hardcoded filterMap literal incl. join aliases; values bound; enums validated). `pnpm verify`
green; api 210→215 (+1 filter test per module); Playwright 64; **live dev API all 5 verified** (users role-IN→2, name→1; templates type→1; locations
state→12,754 on the 157k catalog via 0020 trgm; rates kind→2; cases status→1; all echoed). Large-table-text-filter RATCHET RESOLVED (locations 0020,
cases 0021 trgm already cover it). **CPV stays bespoke (excluded). NOTE: owner directive — future compliance-gap PRIORITIZATION is Administration-first;
this completed work (incl. cases) is kept.**

**ADVANCED DATAGRID Slice 7 — ✅ DATE-RANGE filters (Created + Effective From) on all 7 admin lists; EXPORT honors them (2026-06-09; owner-requested "export for a from/to date").**
Extends the column-filter contract (`platform/pagination.ts`) with a new `FilterField` **`kind:'date'`** + `AppliedFilter` ops **`gte`/`lt`**: `resolveFilters` reads `f_<field>_from` / `f_<field>_to` (each optional, strict `YYYY-MM-DD` validation → malformed dropped, no SQL exposure); `filterClauses` builds a **half-open window** `col >= $n::date` AND `col < ($n::date + 1)` (so the To-day is inclusive). All 7 services add `createdAt` + `effectiveFrom` date entries to their filterMap (qualified to the COUNT query alias: `u.created_at`, `r.created_at`, else bare). **Export auto-honors them** — `exportData` already reuses `resolveFilters`, so the same `f_<field>_from/_to` flow into the file (no export-side change). FE: DataGrid gains a `dateFilters?:{id,label}[]` prop → a From/To `<input type=date>` pair per entry below the toolbar (URL-synced `f_<id>_from/_to`, merged into the query so list + export share them; inputs cap `max-w-[42vw]` so two never overflow a 320px phone — responsive gate). All 7 pages pass `dateFilters=[{createdAt,'Created'},{effectiveFrom,'Effective From'}]`. **`pnpm verify` green; api 277→282 (+5: 4 pagination unit + 1 clients date-range api), sdk 70; Playwright 65→66 (+date-range e2e).** Browser-verified on /admin/clients: 4 date inputs render; Created 2026-06-01..09 narrows 3→2 (April-dated row excluded); URL `?f_createdAt_from=…&f_createdAt_to=…`; **export honors it (June range→2 rows, April range→1 row, live-confirmed)**. **DON'T-REGRESS:** a `kind:'date'` filterMap column must exist in the COUNT query FROM (qualified alias); date inputs cap width to avoid mobile overflow.

**ADVANCED DATAGRID Slice 10 — ✅ ROW SELECTION + BULK ACTIONS (B-23) + Export-Selected (B-13 mode 2) DONE on ALL 7 admin lists (2026-06-09; 4 commits f81a2c9·5afc895·e98ea4a·fff8a27, LOCAL/unpushed; Audit Panels 6/6 + 6/6 PASS).** Completes DATAGRID_STANDARD §15.
Built in 4 sub-slices (reference→rollout cadence): **(1)** shared DataGrid selection — checkbox column (select-all-on-page + per-row), "Select all N matching" banner, bulk-action bar (count + Clear), built-in **Export Selected**; selection is ephemeral (clears on search/sort/filter change, accumulates across pages); `allMatching` never holds all ids client-side. Export contract gained `mode:'selected'` + optional `ids` (additive); backend `resolveExport` parses ids; clients/products repo.list gained an `ids` filter (`id = ANY($n)`, bound, ANDed on top of the scoped query) + service exports NOTHING for an empty/invalid id set. **(2)** rolled Export-Selected to the other 5 admin lists (int `id = ANY($n)`; users `u.id = ANY($n::uuid[])`). **(3)** bulk Activate/Deactivate (clients/products reference) — selection refactored `Set<string>`→`Map<string,T>` to capture each row's `version` (the OCC token); new `platform/bulk.ts` (`parseBulkItems` caps 500/400s malformed + `applyBulkOcc` per-row → STALE_UPDATE=CONFLICT/404=NOT_FOUND/else rethrow); `service.bulkSetActive` reuses the version-guarded `repo.setActive`; `POST /bulk-activate|/bulk-deactivate` (own manage perm, before `/:id`); SDK `bulk.ts` (BulkItem/BulkRequest/BulkResult, additive); FE `BulkStatusActions` (per-row result summary; clears on clean run, keeps on partial; `allMatching` shows a hint). **(4)** rolled bulk to the other 5 (users uuid via `String(id)`).
**Per-row OCC** (CONCURRENCY_AND_EDITING_STANDARD §1/§7): each ticked row's captured version guards its write — a row changed since selection → CONFLICT, never a silent overwrite. **Per-row tx is REQUIRED** (Database ruling), not set-based (preserves OCC + per-row audit). `>500` = a later background-job tier.
**🔧 TEST-HARNESS FIX:** the api suite flaked ~1/319 non-deterministically once 3b's files landed — `fileParallelism:false` still let vitest spread files across forks, so one file's `TRUNCATE … CASCADE` raced a shared FK-parent table mid-query in another. Added `poolOptions.forks.singleFork` (apps/api/vitest.config.ts) → one serial process → 319/319 deterministic (verified twice). **DON'T-REGRESS: keep singleFork — the shared-DB integration suite is NOT safe across parallel forks.**
**Gates:** `pnpm verify` green; api 282→319; Playwright 12/12 datagrid (incl bulk-bar + selection tests) + a11y 11/11; live-browser verified the full bulk loop on /admin/clients (deactivate→bulk-deactivate 200→restored) + Export-Selected on /admin/users (uuid `ids` → 200). **Audit Panels:** sub-slice 1 CEO+Principal+Security+API-Contract+Database+Design 6/6 PASS; sub-slice 3a same 6/6 PASS; rollouts CTO-discharged consistency. **NEW OPEN (in ledgers, non-blocking):** partial-conflict retry holds stale versions until re-tick (UX polish); FE bulk-mutation Playwright test; server-side "act on all matching" bulk endpoint; **scoped-resource bulk must enforce scope inside the per-row apply fn (IDOR guard) when bulk reaches cases/tasks.**

**ADVANCED DATAGRID Slice 9 — ✅ B-8/B-9 HEXAGON LOADER + §6 LOADING TIME-BANDS DONE (2026-06-09; LOCAL/unpushed; Audit Panel CEO + Principal-Engineer + Design-Quality 3/3 PASS).** Implements PAGINATION_AND_LOADING_STANDARDS §6/§7/§8 on the Universal DataGrid (built once → all 8 lists inherit it).
NEW **`components/ui/HexagonLoader.tsx`** — the ONE platform loader (geometric hexagon `<polygon>` outline; NO spinning circle / progress bar / bouncing dots — §7). Two modes: **determinate** (`percent` → outline fills via `stroke-dashoffset` on a `pathLength=100` hexagon + the `{value}%`/operation/sub-step; ONLY for genuine staged jobs per §8 maps) and **indeterminate** (`percent` omitted → a `25 75` dash marches the outline via the `.hex-march` keyframe + operation text only). NEW **`lib/useLoadingBand.ts`** — the §6 bands (`none` 0–300 ms / `skeleton` 300 ms–1 s / `loader` 1–3 s / `loader-op` ≥3 s), setTimeout-driven, resets on inactive. `DataGrid.tsx` wires them into the **first-load** path (`isLoading && band===…` so a stale band can't co-render with rows on the resolve frame; refetches keep prior rows + the "Updating…" hint). `index.css`: `.hex-march`/`.hex-fill` + a **`prefers-reduced-motion`** guard (static hexagon; `role=status` text still announces). +1 Playwright test (route-delays the clients list 1.8 s → asserts the `role=status` loader shows then clears).
**§6-vs-§8 RECONCILIATION (unanimous Audit verdict — does NOT reopen the freeze):** §6's 1–3 s row says "loader + percentage", but **§8 is the controlling rule** ("percentages MUST reflect actual work stages — never an animated guess"; its stage maps are report/MIS/case-creation jobs) and §9 mandates **skeleton rows, not a %**, for tables. A single list `fetchPage` is one round-trip with no knowable stages → any number would be the fabrication §8 bans. So list loads use the **indeterminate** loader (operation text, no number) and the determinate-% path is reserved for the staged operations-phase jobs. No ADR needed.
**Gates:** `pnpm verify` green; Playwright **11/11 datagrid** (incl. the loader test) + **11/11 axe**; **live-browser eval confirmed** the loader renders (`role=status`, aria-label "Loading Users", 2 hexagon polygons, `.hex-march` animating). FE-only — no API/SDK/SQL/contract surface. Audit applied 2 SHOULD-FIXes before commit (the `isLoading &&` one-frame-overlap guard; reduced-motion on the determinate `.hex-fill` transition).
**DON'T-REGRESS:** NEVER pass a fabricated `percent` to HexagonLoader for a single-stage wait (§8) — omit it for indeterminate; determinate is ONLY for real staged jobs. The `.hex-march`/`.hex-fill` classes are hand-authored `@layer components` (not JIT utilities) — keep them in `index.css`. Loader/skeleton bands gate on `isLoading` (not just the band) so they never co-render with data.
**NEW OPEN (LOW, in ledgers):** axe-scan the open loading state (a11y.spec only scans loaded pages — folds with the open-dialog-axe rec from Slice 8); determinate-% loaders wire up when the report/MIS/export jobs land (operations phase).

**ADVANCED DATAGRID Slice 8 — ✅ KEYBOARD-NAV / FOCUS-MANAGEMENT (menus + modal dialogs) DONE (2026-06-09; LOCAL/unpushed; Audit Panel CEO + Principal-Engineer + Design-Quality 3/3 PASS).** Closes the carried-OPEN "menu focus-trap / return-focus-on-Escape" item (DATAGRID_STANDARD §19/§20; axe gate 29) — the focus-trap notes folded into the keyboard-nav DEFERRED item are now RESOLVED for all in-scope surfaces.
New shared hook **`apps/web/src/lib/useFocusTrap.ts`** (`useFocusTrap<T>(active, onEscape): RefObject<T>`): on open moves focus into the overlay (first focusable, else the container); traps Tab/Shift+Tab cyclically; Escape→`onEscape` with `stopPropagation` (so nested overlays close innermost-only); on close restores focus to the opener **only when focus would otherwise be lost** (still inside the overlay, or on `<body>`) so a deliberate click elsewhere is never yanked back. Effect deps `[active]` only; `onEscape` read via a latest-ref → no focus re-grab on re-render (stale-closure-safe, no `exhaustive-deps` suppression). Listener is container-scoped (not document). React-18 `RefObject<T>` return.
Wired into the **3 DataGrid popovers** (Export · Columns · ColumnFilterSelect — replaced their bespoke document-level Escape effects) and **8 modal dialogs**, each now carrying `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (unique id → title) + Escape-close via the hook: `ConflictDialog` (Escape = no-op must-decide; Tab reaches both buttons → not a 2.1.2 trap), `MasterDataCrud` (clients/products), `VerificationUnitDialog`, `UsersPage` UserDialog, `TemplatesPage` TemplateDialog, `LocationsPage` EditLocationDialog, `CpvPage` RescheduleDialog (role moved overlay→inner panel), `RateManagementPage` ReviseDialog + HistoryDialog. **Nested ConflictDialog is a SIBLING** of the parent's ref'd panel (not a descendant) → the outer trap stays passive while focus is in the inner (Principal-verified, not fragile). +2 Playwright tests (datagrid.spec.ts): Columns menu focus-in→Escape-close→return-focus, and New-Client dialog trap→Escape→return-focus.
**Gates:** `pnpm verify` green (typecheck/lint/format/boundaries/vitest/build); Playwright **10/10 datagrid** (incl. the 2 new focus tests) + **11/11 axe a11y** (0 serious/critical — no ARIA regression); **live-browser confirmed** on /admin/clients (Columns menu: focus→first checkbox, Escape→closed + focus back on the trigger; New dialog: `aria-modal=true`, labelled "New Client", focus on first input, Escape→closed + focus back on +New). FE-only — no API/SDK/SQL/contract surface.
**DELIBERATE CARVE-OUT (CTO):** the `Layout` mobile nav drawer is excluded — dual-mode (`lg:static` in-flow at lg+ / fixed overlay below lg); a trap keyed on `open` would trap desktop keyboard users in the sidebar. → **new OPEN item below.**
**NEW OPEN items (logged in ledgers):** (1) **Layout mobile nav-drawer focus-trap — MEDIUM** (open overlay below lg has no trap / `aria-modal` / Escape; mobile AT users can Tab onto the obscured page; cheap now the hook exists: `useFocusTrap(open && !isWide, close)` on the panel + Escape in the overlay-only branch). (2) **axe open-dialog scan — LOW** (`a11y.spec.ts` only scans closed-state pages; add one axe pass with a dialog open). **DON'T-REGRESS:** a modal's `aria-labelledby` id must match a real, unique element id in the SAME dialog; menu/dialog overlays must mount the hook (focus-in + trap + Escape + return-focus); keep ConflictDialog's Escape a no-op (must-decide).

**ADVANCED DATAGRID Slice 6b — ✅ B-13 EXPORT ROLLOUT to all remaining admin lists DONE (2026-06-07; pattern-identical to the 7-dim-PASS'd reference → CTO-discharged consistency audit).**
Applied the reference export pattern to **verification-units · users · report-templates · locations · rates** (joining clients/products) via 5 parallel specialists, each: a resource `*_EXPORT_COLUMNS: ExportColumn<T>[]` manifest whose `id`s match the FE DataGrid columns + `exportData(query, ex)` that REUSES that module's exact `list()` repo.list args (active/search/columnFilters + resource-specific filters — VU kind, users role, rates clientId/productId/kind, locations pincode, templates templateType) with the export limit/offset rule (`all`→`limit=exportThreshold()`/offset 0 + `assertExportable`) + `export` controller + `GET /export` (perm `data.export`, declared before `/:id`, after `/options`/`/pincodes`/before `/:id/history`) + FE `exportFn` on each page's `<DataGrid>` + an `export` api-test block (CSV/XLSX/cols/400/403/401). SDK gained `.export()` on all 5 (CTO did the shared `client.ts` edits). **`pnpm verify` green; api 241→277 (+36), sdk 69→70 (+1 rollout URL test); all 7 admin `/export` endpoints live-verified 200** (correct per-resource headers: VU `Code,Name,Category,Kind,Billing,…`; users `Username,Name,Role,Reports To,…`; rates `Client,Product,Kind,Verification Unit,Pincode,Area,Rate Type,Rate,…`; locations `Pincode,Area,City,State,Country,…`; templates `Code,Name,Type,…`) + **browser-verified on /admin/rates** (Export menu → All-matching CSV → `GET /rates/export?…&mode=all → 200`). Consistency-checked: every module's route order + `assertExportable`/`exportThreshold` guards identical to the reference. **CARRIED OPEN (unchanged):** ops **cases** export · `selected` mode (row-select) · PDF · ≥10k report-worker job tier (streaming) · cases/locations non-default export-sort indexes (RATCHET). **DON'T-REGRESS:** each resource export REUSES its list query path (never bespoke SQL); manifest `id`s must track the FE DataGrid column ids; `/export` before `/:id`.

**ADVANCED DATAGRID Slice 6 — 🟡 B-13 EXPORT engine + current-view/all-matching (XLSX/CSV) on the clients/products reference DONE (2026-06-07; Audit Panel Security+API-Contract+Performance+Database+Principal+CEO+Design 5 agents/7 dimensions ALL PASS).**
First Administration-first export slice, built to the FROZEN ownership (FROZEN_DECISIONS rows 26/27 + PLATFORM_CAPABILITIES_OWNERSHIP Part 3): **builders are backend-owned at `apps/api/src/platform/export/`** (NOT client-side) and the **DataGrid is the sole export surface**. New `platform/export/`: `format.ts` (`ExportColumn<T>` manifest · RFC-4180 `toCsv` + **CWE-1236 formula-injection** `escapeCsvCell` · `toXlsx` via **exceljs**, lazy-imported · `selectColumns` for visible `cols` · Date→ISO in the cell formatter since pg timestamptz arrives as Date) + `index.ts` (`resolveExport` [400 BAD_EXPORT_FORMAT/MODE], `assertExportable` [**413 EXPORT_TOO_LARGE** at `totalCount ≥ EXPORT_JOB_THRESHOLD=10000`], `writeExport` [streams + @crm2/logger export-audit line]). Per resource: `exportData(query, ex)` REUSES the list `resolvePage`/`resolveFilters`/`repo.list` (mode `current`=exact page · `all`=no page LIMIT, capped at threshold/offset 0) + a thin `GET /:resource/export` route (perm **`data.export`**, declared BEFORE `/:id`). Shared `modules/shared/masterDataExport.ts` manifest (clients+products byte-identical). New `@crm2/access` `DATA_EXPORT` (default-deny; granted SA/MGR/TL/BE, excluded FIELD_AGENT/KYC_VERIFIER) + `@crm2/config` `EXPORT_JOB_THRESHOLD`. SDK: `export.ts` (`ExportRequest`/`exportQueryToParams` — `all` drops page/limit) + `reqBlob` transport + `clients/products.export()` (purely **ADDITIVE**, never-break-mobile holds — web-only). Web: `apiBlob` (401-refresh-aware blob GET) in `lib/sdk.ts` + DataGrid `exportFn?` prop + toolbar **Export menu** (Current view / All matching × XLSX/CSV; mirrors the Columns-menu tokens/a11y; `Exporting…` busy state + `role=alert` EXPORT_TOO_LARGE banner); `MasterDataCrud` wires it. **`pnpm verify` green; api 223→241 (+18), sdk 63→69 (+6); Playwright 64→65 (+download e2e at Laptop band); live dev API verified** (CSV current + XLSX `all` [PK-magic] + `cols` selection + 400 bad-format + 403 no-perm + ISO dates) + **browser-verified** (menu renders 4 items/2 groups; click → `GET /clients/export?…&format=csv&mode=all&cols=… → 200`). **CARRIED OPEN / RATCHETS (Audit):** (1) `selected` mode DEFERRED → needs row-select (separate item); PDF DEFERRED (optional); (2) **≥10k report-worker job tier DEFERRED** — streaming XLSX/CSV builders MANDATORY there (buffered exceljs blows memory at 100k+); (3) when `all`-export rolls to **locations[157k]/cases**, non-default export sort cols need `(col,id)` indexes or restrict to indexed sorts (default-sort + trgm search already indexed 0020/0021); (4) at row-scoped tables (cases), the SCOPED total must drive `assertExportable` (auto-inherits via `repo.list` reuse) so a 413 can't leak out-of-scope row existence. **ROLLOUT TODO (this task, Administration-first): VU · users · report-templates · locations · rates** (+ then ops cases). **DON'T-REGRESS:** export builders stay backend-owned in `platform/export/`; every new resource export REUSES its list query path (never bespoke SQL); `cols` only ever filters a hardcoded `ExportColumn[]` manifest by id (never reaches SQL); add new FK-scoped tables' scope to the reused list query, not the export.

**ADVANCED DATAGRID Slice 4 — ✅ B-4 Excel-style header multi-select (§7) DONE (2026-06-06; Audit Panel Security+DB+Performance+CEO+Principal+API/Contract+Design 7/7 PASS).**
Extends the column-filter contract from single→multi-value: `AppliedFilter` now `{field,column,op:'ilike'|'eq'|'in',values:string[]}`; `resolveFilters`
parses comma-separated enum (keeps only filterMap-allowed, de-duped → `in` if >1 else `eq`); NEW `filterClauses(filters,params)` centralizes
WHERE-building (`in`→`${col} = ANY($n)` array-bound · `ilike`→`${col} ILIKE $n` · `eq`→`${col} = $n`) — clients/products/VU repos refactored to
it (DRY; clients/products text behavior byte-identical). Grid: `DataGridColumn.filterOptions?:{value,label}[]` → header filter renders an
Excel-style multi-select `ColumnFilterSelect` (button "All"/"N selected" + checkbox panel + click-outside backdrop + Escape) committing
comma-joined values to `f_<id>`. VU `kind` is the reference (all 3 `KINDS`) — **the old toolbar kind `<select>` (only 2 of 3 kinds → DESK_DOCUMENT
was silently unfilterable) REMOVED**, so this is defect-closing (CEO-noted). **Injection-safe** incl. the ANY path (column always a filterMap literal;
values bound as a typed array). `AppliedFilter` shape change is server-INTERNAL (no SDK/wire change; wire still `?f_<id>=v1,v2`). `pnpm verify`
green; api 207→210 (+filterClauses unit, +enum-multi unit, +VU f_kind api); Playwright 64 (+§7: open→check→URL `f_kind=FIELD_VISIT`→reload "1
selected"→uncheck clears); browser-verified. **DON'T-REGRESS:** filter `column` only ever from filterMap; ANY binds the array param (never build an
IN-list string). Focus-trap on the dropdown folds into the keyboard-nav OPEN.

**ADVANCED DATAGRID Slice 3b — ✅ B-3 grid per-column filter UI DONE (2026-06-06, FE consumer; Audit Panel CEO+Principal+Design 3/3 PASS) → B-3 now FIXED end-to-end.**
`DataGridColumn.filterable?:boolean`; the grid reads each filterable column's `f_<id>` URL key, merges into the request `filters` (SDK emits
`?f_<id>=v` to the contract from 3a), keys the react-query. A per-column filter row in `<thead>` (below the header, mapped over `visibleColumns`
so it stays 1:1 with the visibility-aware headers) renders a debounced `ColumnFilterInput` (local draft → commits to URL after 300ms → re-seeds
on external URL change — mirrors the global-search idiom). MasterDataCrud marks code+name filterable → clients+products grids get column filters.
`.input` token + `normal-case` (filter th not uppercased), `aria-label="Filter <col>"`, filter row inside the `overflow-x-auto` wrapper (no page
overflow). `pnpm verify` green; Playwright 63 (+1: fill→URL `f_code=hd`→reload re-seeds→clear removes param); browser-verified (server
`f_code=hd`→only HDFC; filter inputs render under CODE+NAME aligned). **Rollout to other lists = add `filterMap` (service) + `filterable` (column def) per page** — next as lists need it.

**ADVANCED DATAGRID Slice 3a — 🟡 B-3 server-side column-filter CONTRACT DONE (2026-06-06, backend-only; Audit Panel Security+DB+Performance+CEO+Principal+API/Contract 6/6 PASS).**
Generic per-column filtering on the universal list contract, mirroring the proven `sortMap` whitelist: `platform/pagination.ts` gains
`FilterField` + `PageSpec.filterMap` (apiField→{column, kind:'text'|'enum', values?}) + `AppliedFilter` + `resolveFilters()` (parses request
`f_<apiField>` params; unknown fields + out-of-set enum values DROPPED; text→ILIKE, enum→eq). clients+products services declare `filterMap`
(code/name text), call resolveFilters, pass `columnFilters` to the repo, echo `f_<field>` into the envelope `filters`; repos append
`${f.column} ILIKE|= $n` with the VALUE bound as a param. **Injection-safe BY CONSTRUCTION** (audit-confirmed + tested): `f.column` is only ever
a hardcoded `filterMap` literal — resolveFilters validates the request field is a filterMap KEY and copies the def's column; no request string
ever reaches SQL text. Filters apply to BOTH count + items (shared where/params), AND-combined (§8). Purely ADDITIVE (`Paginated.filters` already
`Record<string,unknown>`; `pageQueryToParams` already serializes `filters` → `?f_code=x` works via the SDK today); no SDK/contract change,
never-break-mobile holds. `pnpm verify` green; api 200→207 (+5 `resolveFilters` unit covering whitelist/enum/injection, +2 clients api). **NEXT
sub-slice: the grid per-column filter UI (header inputs, `f_<id>` URL keys) consuming this.** **RATCHET (Performance):** when this contract rolls
to large tables (cases/locations), each filterable text column needs a trigram GIN index (precedent: migrations 0020/0021).

**ADVANCED DATAGRID Slice 2 — ✅ B-6 Column visibility DONE (2026-06-06, FE-only, Audit Panel CEO+Principal+Design 3/3 PASS).**
Toolbar "Columns" menu on the universal `DataGrid` (button + panel + click-outside backdrop + Escape); hidden column ids persist in the
`cols` URL key (comma-separated; reuses the grid's existing URL-state convention — §12; URL-state interim before the saved-views backend
store §10). New optional `hideable?: boolean` on `DataGridColumn` (default true; false = pinned always-visible). TanStack `columnVisibility`
wired into table state; skeleton rows + empty/error colSpan now track `visibleColumns`. **Guards (belt-and-suspenders):** the menu cannot
hide the last visible column, AND a tampered/stale URL that would hide every column falls back to all-visible (never a blank table). All 7
migrated lists inherit it with ZERO per-page edits. `pnpm verify` green; Playwright 62 passed (+1: toggle→header removed + URL `cols=`→reload
persists→re-show clears); browser-verified menu renders all 7 clients columns token-styled. **CARRIED OPEN:** menu has no focus-trap /
return-focus-on-Escape (LOW; not an axe serious/critical → gate 29 green) — folds into the DATAGRID_STANDARD §2 **keyboard-nav** DEFERRED item.

**ROLLOUT-TAIL Slice 1B — ✅ B-22 lightweight options endpoints DONE (2026-06-06, Audit Panel CEO+Principal+Security+API/Contract+Performance+Design 6/6 PASS).**
New unpaginated USABLE `/options` feeds so dropdowns never silently truncate (the old feeders did `?active=true&limit=200`+`.items`):
`GET /api/v2/{clients,products,verification-units}/options` → `Option {id,code,name}` (VU also returns `kind` via `VerificationUnitOption`
since rate-management filters units by kind); `GET /api/v2/users/options` → `UserOption {id,username,name,role}` (the reports-to picker).
Per module: repository.options() (zero-input raw SELECT, hardcoded ORDER BY — no injection surface) + service passthrough + controller +
route registered BEFORE `/:id` (param-capture trap); same RBAC as the sibling list (MASTERDATA_VIEW / USER_VIEW). SDK: new `options.ts`,
`UserOption` (users.ts), `VerificationUnitOption` (verificationUnit.ts), 4 client methods + tests (call-count 62→66 + focused URL test).
FE: 9 feeder call sites in CaseCreate/CPV/RateMgmt/UsersPage switched (envelope→flat-array flipped in lockstep; unused full-type imports
dropped). `pnpm verify` green (api 200 [+8] · sdk green · web build); browser-verified on /cases/new (Client+Product dropdowns populate;
VU options return id/code/name/kind live). **Scope beyond literal B-22 (clients/products/VU): added `users.options()` (same truncation bug
class) + VU `kind` (real RateMgmt consumer) — Audit confirmed disciplined, not creep. CARRIED OPEN (NEW):** (1) RateMgmt
`locations?pincode=&limit=200` feeder LEFT as-is (bounded-per-pincode, different shape) — track if a pincode ever exceeds ~200 locations;
(2) **RATCHET (Performance):** `users/options` is unpaginated — if a deployment ever reaches ~thousands of users, switch the reports-to
picker to server-side typeahead (not needed at current scale).

**ROLLOUT-TAIL Slice 1A — ✅ cases-growth index ratchet DONE (`0021_cases_growth_indexes.sql`, 2026-06-06, Audit Panel CEO+Principal+DB+Performance 4/4 PASS).**
cases is the one unbounded operational table; the DataGrid list now has matching indexes for all three access paths:
`idx_cases_created_at (created_at DESC, id DESC)` = default sort first-page-off-index; `idx_cases_product (product_id)`
= the products JOIN (client side already had `idx_cases_client`); `idx_cases_case_number_trgm` + `idx_applicants_name_trgm`
(gin trgm) = the leading-wildcard `ILIKE '%term%'` global search (pre-existing `idx_applicants_name`=`lower(name)` is
equality-only). Triple-write (file + dev `crm2_dev`@54329 + test `crm2_test`@5433, idempotent); full chain 0001→0021
clean on a fresh DB twice. **Dispositions (Audit-confirmed):** `count(*) OVER()` → **WONTFIX** (the list deliberately
runs a separate LEAN count joining only cases+primary-applicant, avoiding the per-row applicant/task correlated
subqueries — windowing would force them into the count); LATERAL/grouped counts → **WONTFIX** (those subqueries are
index-backed by `idx_applicants_case`+`idx_case_tasks_case` and page-bounded ≤500); **small-table sort indexes
(users/VU/templates) → RATCHET/defer-by-design** (planner won't choose an index over seq-scan+in-memory-sort at
≤few-hundred rows → pure write overhead; revisit at GA if any table exceeds ~5k rows). EXPLAIN-at-scale not locally
provable (tiny dev/test cases tables); index defs provably match the access paths (proactive pre-growth ratchet).

---

## Section D — BUILD BLOCKERS

**Current status: NONE.** CRM2 can continue building safely (see the 2026-06-05 freeze
compliance audit, F-1). If a blocker appears, record here: issue · severity · owner · resolution
plan — and do not start dependent work until resolved.

---

## Section E — RATCHET items (good enough today; must improve gradually)

Floors are enforced now and **only ratchet up** (never lowered without CTO sign-off —
`TECH_DEBT_POLICY.md`).

| ID | Metric | Current (enforced floor) | Target | Status |
|---|---|---|---|---|
| E-1 | api-v2 line/stmt coverage | 85.7% (floor 85) | 90% | RATCHET |
| E-2 | api-v2 branch coverage | 59.4% (floor 58) | 85% | RATCHET |
| E-3 | sdk branch coverage | 68.9% (floor 65) | 85% | RATCHET |
| E-4 | logger funcs/branch coverage | 80% (floor 80) | 90% | RATCHET |
| E-5 | axe a11y gate severity (gate 29) | gates `serious` + `critical` (0 violations) | hold | ✅ FIXED |

Raise a module's floor when its coverage rises so it cannot regress. **E-5 → FIXED 2026-06-06** (owner-signed-off):
darkened 4 light tokens (`--muted-foreground` 47→43% [4.96:1], `--st-in-progress` 53→45%, `--st-approved` 29→25%,
`--st-revisit` 42→35%) to ≥4.5:1 + `aria-disabled` on the inactive Operations nav (WCAG 1.4.3 exemption); a11y
`GATED_IMPACTS` now gates `serious`+`critical` (0 violations). Dark mode audited → already AA by computation
(amendment recorded in `docs/COLOR_SYSTEM_FREEZE.md`).

---

## Section F — AUDIT HISTORY (never delete findings)

Each finding is marked OPEN · FIXED · DEFERRED · WONTFIX.

### F-1 · Freeze Compliance Audit — 2026-06-05
- **Scope:** frozen-vs-implemented across workspace, architecture, data model, API, data access,
  tooling, logger, design, governance, machine enforcement.
- **Result:** GREEN — build may continue; **0 blockers**.
- **Findings:**
  - Coverage gate non-functional → **FIXED** (A-1, `642c362`).
  - DataGrid / pagination / search-filter / loading-UX not built → **DEFERRED** (Section B).
  - 6 pre-freeze bespoke tables → **DEFERRED/RETROFIT** (Section C).
  - api-v2 / sdk coverage below 90/85 → **RATCHET** (Section E).
  - OpenAPI / SDK-drift / Playwright pending → **DEFERRED** (B-10/11/12).
  - Migration number gap `0005` (removed users mig; forward-only) → **WONTFIX** (cosmetic; harness
    sorts by filename, not a violation).
- **Evidence:** the audit report (session 2026-06-05); commits `642c362` (coverage), `9bce9b5`
  (governance), `7970a39`/`b23c61d` (DataGrid + pagination freezes).

### F-2 · State + Freeze-Compliance Audit — 2026-06-05
- **Scope:** shipped code vs frozen decisions + `pnpm verify`; Rate-Management doc drift; migration
  chain 0001→0016 on a fresh DB; FROZEN_DECISIONS / COMPLIANCE_GAPS vs reality.
- **Result:** code GREEN (verify exit 0; migration chain clean; no live refs to dropped rate tables;
  frozen-decision conformance 5/5). Documentation/governance drift found (no code defects).
- **Findings:**
  - `pnpm verify` green · migration chain coherent · no dead refs to `rate_type_eligibility`/
    `service_zone_rules` · repo pattern / no-Prisma / /api/v2 / 6 pkgs all conform → **PASS**.
  - **Rate-Management doc drift** — ADR-0016 + `RATE_MANAGEMENT_FREEZE.md` + FROZEN #29 + B-21 +
    `PROJECT_INDEX`/`BUILD_GATE_REGISTRY_LOCK` describe the OLD 4-table model (eligibility + SZR +
    trigger) but the shipped model is the FLAT one-table `rates` (migs 0013/0014 dropped those
    tables). → ✅ **FIXED (2026-06-05, same session)**: wrote superseding **ADR-0018** (flat model) +
    status-banner on ADR-0016/RATE_MANAGEMENT_FREEZE + marked FROZEN #29 SUPERSEDED→ADR-0018 + added
    flat-model FROZEN #31 + moved B-21 to FIXED + corrected PROJECT_INDEX / BUILD_GATE_REGISTRY_LOCK /
    MASTER_MEMORY §8 rate row.
  - **B-15 Authentication** registry row was stale (said "deferred / x-test-auth") though auth shipped
    (ADR-0014). → ✅ **FIXED (2026-06-05)** — B-15 moved to FIXED.
  - `docs/adr/README.md` index table was missing ADR-0014/0015/0016 → **FIXED** this session (added
    0014–0018 rows).
  - Stale ADR-range/decision-count pointers across rule/kickoff/governance docs + FREEZE_LOCK_REPORT
    missing 3 enforcement rows + MANAGEMENT_LIST_STANDARD missing the Effective-From column note →
    ✅ **FIXED (2026-06-05 doc-consistency sweep)**.
- **Evidence:** audit report (session 2026-06-05, 3 parallel specialists) + the doc-consistency sweep;
  commits `11f1970`, `f59715f`, and the docs-reconciliation commit.

### F-3 · Responsive-Design Implementation Review — 2026-06-05 (freeze: ADR-0008/0013 umbrella, FROZEN #32)
- **Scope:** every shipped web screen vs the new Responsive-First standard (`docs/RESPONSIVE_DESIGN_STANDARD.md`),
  by parallel code audit + live browser at 320/768/1024/1440.
- **Verdict:** 🔴 the app is **desktop-only today — not usable below ~1024px**. Two systemic defects + a
  table-strategy gap. (No code defects in logic; this is a UI-responsiveness gap → retrofit cohort **C-9**.)
- **Browser evidence (320px, /admin/clients):** horizontal overflow **93px**; sidebar **240px** (75% of a
  320px viewport) with **no hamburger/drawer**; table content 743px clipped (wrapper is `overflow-hidden`).
- **CRITICAL findings:**
  - **C1 — fixed always-visible sidebar, no mobile nav** (`components/Layout.tsx:38` `aside w-60 shrink-0`;
    no `Sheet`/`Drawer`/hamburger anywhere). #1 blocker — blocks every screen. (`main` already has `min-w-0`.)
  - **C2 — 9 wide tables wrapped in `overflow-hidden`** (clips columns, no scroll): MasterDataCrud
    (Clients/Products), CPV, Locations, VerificationUnits, Templates, Users, Cases list, CaseCreate, CaseDetail.
  - **C3 — 3 bare tables with no scroll wrapper** (CPV #2 `:308`, CaseCreate dedupe `:206`, CaseDetail tasks `:132`).
  - **C4 — widest tables need card/list on mobile**: Rate Mgmt (13 cols), Access Control matrix, Case Detail.
- **MAJOR:** only 2/15 tables use `overflow-x-auto`; ubiquitous `whitespace-nowrap` forces width; no top app-bar
  for mobile nav once the sidebar hides; dialog panels lack `max-h-[90vh] overflow-y-auto` (tall forms clip).
- **Already OK:** Login (fully responsive); System (content responsive, blocked only by the shell). Filter rows
  are `flex flex-wrap` (OK); meta grids are mostly mobile-up already.
- **Status → DEFERRED (retrofit C-9)**; fix order: (1) sidebar→drawer + mobile top-bar, (2) flip 9
  `overflow-hidden`→`overflow-x-auto` + wrap 3 bare tables, (3) card/list for the wide tables (folds into the
  DataGrid build), (4) dialog `max-h`/scroll, (5) stat-card `grid-cols-1 sm:grid-cols-2`.
- **Evidence:** parallel code-audit agent + live preview viewport test (this session).
- **UPDATE 2026-06-05 → MOSTLY FIXED (steps 1,2,4 done; owner directive "works on any device"):**
  Shell reworked to **one hamburger-driven sidebar at every breakpoint** (`Layout.tsx`): top bar with hamburger
  on all screens; sidebar **pushes** content at `lg+` (in-flow, `lg:static`, starts open) and **overlays** with
  backdrop below `lg` (starts closed, closes on nav). 10 table wrappers → `overflow-x-auto`; 5 dialog panels →
  `max-h-[90vh] overflow-y-auto`; Locations + CPV toolbars full-width-on-mobile. **Verified live** at 320/768/
  1024/1440: page horizontal-overflow = 0 everywhere; 13-col Rate table scrolls inside its card; dialog scrolls
  within a 560px-tall viewport; desktop toggle pushes (content left 240↔0); phone toggle overlays. CEO audit:
  APPROVE (token-only colors, a11y labels, surgical, no scope creep). `pnpm verify` web gates green
  (typecheck/lint/format/build). **STILL OPEN (next wave):** step (3) true table→card mobile views (interim
  `overflow-x-auto` satisfies the mandatory minimum); step (5) any residual non-responsive stat grids
  (e.g. pre-existing `TemplatesPage` bare `grid-cols-2`); the standard's per-page **Playwright** 320/768/1024/
  1440 specs (harness not yet stood up — CI gates 49–50 still stubbed). C-9 stays OPEN until those land.
- **UPDATE 2026-06-06 → NEXT-WAVE FIXED (steps 3 + 5 + Playwright harness; commits `63e6681` + `8dc57b8`,
  two CEO audits APPROVE):** all three remaining items landed.
  - **(3) table→card** via a reversible CSS utility `.rtable` (`apps/web/src/index.css`): below `md`
    (<768px) each row collapses into a stacked card, each `<td>` shows its column name through a `data-label`
    `::before`; `td[colspan]` state/expand rows auto-render full-width; opt-out via `data-label=""`. Interim
    mechanism, **removed when the Universal DataGrid (B-1/C-8) lands** (it then owns the responsive column
    strategy). Applied to the 8 flat list pages first (MasterDataCrud clients/products, users, locations,
    verification_units, templates, rate_management 13 cols, cases), then — on owner cross-check ("cpv page not
    using this card, cross check all pages first", commit `defa3c4`) — to **every remaining record-list table**:
    CPV (link + nested unit sub-table), Case Detail (applicants + tasks), Case Create (dedupe + unit picker),
    Rate Mgmt history sub-table. **Sole card-exemption = Access Control role×perm matrix** (columns ARE the
    roles); System has no list. **🔑 `.rtable` made NEST-SAFE** by switching to the CHILD combinator
    (`table.rtable > tbody > tr > td`) so an outer table never leaks into a nested table inside an expand/colspan
    row — each cards independently (verified live on CPV at 375px).
  - **(5) residual stat grids** fixed: bare `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` in MasterDataCrud,
    UsersPage, TemplatesPage (stat cards + dialog field-pairs). Repo-wide grep = **0 bare `grid-cols-N`** in
    `apps/web/src`.
  - **Playwright harness STOOD UP** (`apps/web/playwright.config.ts` + `e2e/`): `setup` project logs in
    once → storageState; 4 viewport projects render at 375/768/1280/1440 (band minimums 320/768/1024/1440);
    `viewport.spec` asserts **no horizontal overflow + reachable nav trigger + primary action** on all 11 pages,
    **+ the mobile card transform (`td` `display:flex`)** on the 8 list pages; `login.spec` covers the unauth
    page. `webServer` boots `pnpm dev` (vite proxy `/api`→:4000). **49/49 green vs the live stack.** Script
    `pnpm --filter @crm2/web test:e2e`; kept OUT of `pnpm verify`/turbo `test` (vitest-only) — `vitest.config`
    scopes vitest to `src/**` so it never collects the Playwright specs.
  - **CI gates 49–50 now have a real harness** (no longer stubbed); CI activation = add the `test:e2e` step
    against a booted stack (web + api + DB).
    DON'T-REGRESS: any new list page ships with `.rtable` + data-labels and a `card:true` row in `viewport.spec`.
- **UPDATE 2026-06-06 (cont.) → A11Y GATE 29 + CI E2E JOB DONE (commit `f91a414`, CEO PASS):**
  - **axe a11y (gate 29)** `apps/web/e2e/a11y.spec.ts` — WCAG 2.0/2.1 A+AA on every page (once at the
    Laptop band; a11y is viewport-independent). **Gates CRITICAL** (0 after the fix); **reports SERIOUS** via a
    test annotation (not gated). Fixed the critical `select-name` findings = `aria-label` on the always-visible
    toolbar filter selects (MasterDataCrud/Cases/VU/Users/Templates) + CPV's 3 selects (dialog selects already
    have wrapping `<label>` — untouched). **Location Management excluded** from axe (157k-row catalog = analysis
    too slow/flaky; same components covered elsewhere; still in viewport.spec).
  - **Harness self-booting:** `playwright.config` webServer is now `[API, web]` — boots `pnpm --filter @crm2/api
    dev` (health `/api/v2/system/health` 401=ready) + web; `reuseExistingServer:!CI` (local reuses a running
    stack, CI boots fresh — API needs only `DATABASE_URL`, other env defaulted). Card assertion made
    **data-tolerant** (`cells.count()>0`) so a fresh empty CI DB passes (overflow/nav/primary still always assert).
  - **CI e2e job** (`.github/workflows/ci.yml`): dedicated `e2e` job `needs: build`, postgres:17, applies all
    migrations (seeds dev admin via 0009 → login works), installs the browser, runs `test:e2e`, uploads the html
    report. **Proven locally end-to-end** (fresh DB → migrate → API boots → admin/admin123 → 200 SUPER_ADMIN).
  - **C-9 now substantially CLOSED.** New tracked **RATCHET E-5** (below): serious `color-contrast` a11y on the
    FROZEN design tokens — raise `GATED_IMPACTS` to include `'serious'` once a token-contrast remediation lands
    (needs design sign-off vs COLOR_SYSTEM_FREEZE). Optional tablet "condensed" tier remains a nice-to-have.

### C-10 · OCC / editing retrofit — progress (ADR-0019, FROZEN #33)
- **2026-06-05 → slice 0 + slice 1 (Users) DONE** (commit `21cf2d6`, CEO audit APPROVE):
  - **Slice 0 (platform, once):** migration `0017` = generic **immutable `audit_log`** (trigger blocks
    UPDATE/DELETE) + `version integer NOT NULL DEFAULT 1` on `clients`/`products`/`locations`/`users`/
    `report_templates` (`verification_units` already had one). `platform/occ.ts` `requireVersion()` →
    400 VERSION_REQUIRED; `platform/audit.ts` `appendAudit()` (structural query-fn param, never imports
    `db.ts` — boundary-clean); `STALE_UPDATE`/`VERSION_REQUIRED` codes; error middleware surfaces
    `{ current }` on 409.
  - **Slice 1 (Users = reference vertical every later module copies):** guarded UPDATE
    `… version=version+1 … WHERE id=$id AND version=$expected RETURNING`; 0 rows → 404 vs 409
    `STALE_UPDATE(current)`; activate/deactivate guarded; create/update/(de)activate each append ONE
    audit row in the SAME tx. SDK `User.version` + versioned update/activate/deactivate (version OUT of
    the zod schema → missing = VERSION_REQUIRED, not VALIDATION). FE reusable `ConflictDialog` (reload &
    re-apply / discard, no silent overwrite); `ApiError` carries body. `pnpm verify` green (117 tests incl.
    OCC contract); live preview verified conflict + reload-&-re-apply recovery.
- **2026-06-05 → slice 2 (clients + products) DONE** (commit `115b2f9`, CEO audit APPROVE): faithful
  mirror of the Users vertical on both modules (guarded update/setActive + in-tx audit, requireVersion,
  404-vs-409, SDK `Client/Product.version` + versioned mutators) + the **shared `MasterDataCrud` FE**
  (edit dialog + toggle send version, reusable `ConflictDialog` on 409 — covers clients AND products).
  `pnpm verify` green (125 api + 62 sdk); live preview verified conflict + reload-&-re-apply on
  `/admin/clients`. (int-PK divergence from Users: tests truncate `audit_log` too, since RESTART
  IDENTITY reuses `entity_id`.)
- **2026-06-05 → slice 3 (verification_units) DONE** (commit `64c460a`, CEO audit APPROVE): VU already had
  a `version` column that bumped but was UNENFORCED — this slice **enforces the guard** (`WHERE id=$1 AND
  version=$22`, param numbering verified) + adds in-tx audit + FE conflict (VerificationUnitDialog + page
  toggle). service does `requireVersion(patch)` before the merge-revalidate (existing.version stripped by
  zod). `pnpm verify` green (129 api + 62 sdk); live preview verified conflict + reload-&-re-apply on
  `/admin/verification-units`.
- **2026-06-05 → slice 4 (CPV mapping) DONE** (commit `abe8f31`, CEO audit APPROVE): toggle-only
  client_products + cpv-units. Migration `0018` adds `version` (only — these tables never had
  created_by/updated_by; actor captured in audit_log). Guarded setActive on both sub-repos (404 vs 409),
  create/(de)activate audited in-tx. **List SELECTs are hand-written (not the COLS constant) — fixed both
  to return `version`** (the toggle needs it) + regression assertions. FE CpvPage: both toggles
  (client-product + unit) send version → ConflictDialog. `pnpm verify` green (137 api + 62 sdk); live
  client-product toggle conflict verified on `/admin/cpv`. **Known asymmetry (tracked, non-defect):** the 2
  CPV tables are the only master tables without `updated_by` (actor lives in audit_log).
- **2026-06-05 → slice 5 (rates) DONE** (commit `2306749`, CEO audit APPROVE): rates is effective-dated
  (ADR-0018) and had NO version col (0013 flatten dropped it). Migration `0019` adds `version`. updateAmount
  + setActive guarded (404 vs 409); **revise** = OCC version-check throws `stale(cur)` BEFORE any mutation
  (rollback-safe), then end-dates current (version+1) + inserts new dated row — end-date-first preserves the
  `rates_no_overlap` GiST constraint. Keeps `rate_history` (domain audit); **audit_log untouched** (§2:
  effective-dated domains keep domain history). Hand-written list SELECT carries `r.version`. FE: rate toggle
  + ReviseForm → ConflictDialog. `pnpm verify` green (142 api + 62 sdk); live toggle conflict verified.
- **2026-06-05 → slice 6 (locations + report_templates) DONE** (commit `96d065f`, CEO audit APPROVE): both
  mirror the clients reference (version cols already existed from 0017 — no migration); guarded update/setActive
  + in-tx audit_log; both `list()` use the shared SELECT_COLS constant (trap cleared); FE EditLocationDialog +
  TemplateDialog + both toggles → ConflictDialog. `pnpm verify` green (150 api + 62 sdk); live location toggle
  conflict verified.
- **✅ 2026-06-05 → C-10 ADMINISTRATION COMPLETE (owner: "focus on admin only").** All 8 editable
  administration surfaces are OCC-guarded + audited + have FE conflict dialogs: **users · clients · products ·
  verification_units · CPV (client_products + cpv-units) · rates · locations · report_templates**. (Read-only
  admin surfaces — access-control matrix, system health, rate_types lookup — have no edits, so OCC is N/A.)
  Platform: migrations 0017/0018/0019, generic immutable `audit_log` (+ rates keeps `rate_history`),
  `platform/occ.requireVersion`, `platform/audit.appendAudit`, reusable FE `ConflictDialog`. Every slice
  CEO-APPROVED + live-verified + pushed (origin/main `f82c06f`).
- **DEFERRED (operations, NOT admin — out of current scope):** `cases`/`case_tasks` OCC (cases immutable
  post-create; case_tasks = assign/unassign mutations; would need a `version` column on case_tasks + guarding
  the assign/unassign paths + audit). Pick up when operations work resumes. **Also still deferred:** the §1
  production hardening on `audit_log` (hash-chain + monthly partition + off-DB copy). C-10 stays OPEN for
  these two items, but the **admin retrofit it was created for is DONE.**

### (reserved) Security Audit · Architecture Audit · Performance Audit
- None run yet for v2. When run, append here with date · scope · result · findings (OPEN/FIXED/
  DEFERRED/WONTFIX) · evidence. Never delete prior findings.

---

## Section G — Commission ↔ Rate cross-audit (2026-06-18)

Source: [`docs/engineering/COMMISSION_RATE_CROSS_AUDIT_2026-06-18.md`](engineering/COMMISSION_RATE_CROSS_AUDIT_2026-06-18.md)
(5 parallel read-only auditors, areas A–E). Governed by ADR-0036 (commission model) + ADR-0018 (flat
rates). **No code changed — audit only.** All findings below carry a disposition; none are blockers to
the *audit*, but G-1 gates the *rebuild* on an owner decision (+ superseding ADR if amount-varies).

**OWNER DECISIONS LOCKED 2026-06-18:** commission model = **(i) amount-varies, fully decoupled from
the client rate_type** (executive's own pincode/area mapping; OGL-for-client can be LOCAL-for-executive)
→ supersedes ADR-0036, needs **ADR-0046**. Dimensions = executive + location + client + product/VU +
**TAT band**. `bill_count` = multiplier → **FIX** (G-2). Pipeline tab = **REMOVE entirely** (G-3).
**SEQUENCE:** build the **TAT band system first** (G-7), then the full commission rebuild. See the
audit doc's "Decisions LOCKED" section.

**✅ BUILT & GATE-VERIFIED 2026-06-19 (ADR-0046, branch `worktree-feat-commission-rebuild`, NOT yet
deployed).** TAT (ADR-0044) shipped first; this rebuild then decoupled commission from the client rate
(`COMMISSION_LATERAL` rewritten: location + client + product/VU + completed-in-TAT-band cascade, no
`rate_type` join; point-in-time as-of `COALESCE(ct.completed_at, now())` per ADR-0046 §4 — read-derived,
no persisted ledger), added the dimensions to `commission_rates` (mig **0079**, generalized no-overlap
EXCLUDE), fixed the `bill_count` rollup (+`billable_units`), added the per-pincode/area + completed-in-band
billing breakdown, removed the pipeline money surface, and added the cascading-picker commission form +
breakdown panels. Resolutions: **G-1 ✅ FIXED**, **G-2 ✅ FIXED**, **G-3 ✅ FIXED**, **G-7 ✅ FIXED**
(TAT shipped + consumed). Acceptance §E proven by integration test (T1 ₹50 @ L1 vs T2 ₹90 @ L2, total
₹140; bill_count ×; by-location/by-band breakdown). Full `pnpm verify` GREEN (63 api + 25 sdk test files,
coverage met, build clean). **Live browser-verify OUTSTANDING** — preview MCP unavailable this session;
verify on the prod-dev box post-deploy or via a local preview. New discovery → **G-8** below.

### G-1 · Commission has no pincode/area dimension — ✅ FIXED (ADR-0046, 2026-06-19)
- **Severity:** HIGH (the requested capability). **Finding:** `commission_rates` is keyed
  `(user_id, rate_type, client_id, time)` with no location term; `COMMISSION_LATERAL`
  (`laterals.ts:35-42`) has no location operand. Commission varies by location only *transitively*
  via the location-resolved `rt.rate_type` — so two completed tasks with the **same** `rate_type` in
  **different** pincodes/areas earn the **same** commission (proven §E: ₹50 vs ₹50).
- **Disposition:** DEFERRED pending owner decision §1 (amount-varies → model (i)/(iii) → **supersedes
  ADR-0036, needs ADR-0046**; reporting-only → model (ii) → no supersession). Not a defect against
  ADR-0036 (which deliberately excludes location); it is a scope/requirement change.

### G-2 · Billing rollup ignores `case_tasks.bill_count` — ✅ FIXED (ADR-0046, 2026-06-19)
- **Severity:** HIGH (location-independent amount/count correctness). **Finding:** `bill_count`
  (`0011_task_assignment.sql:11`, default 1, per-task editable in the SDK) is never read by the
  rollup or laterals — a `bill_count=3` task contributes `bill_amount×1` and counts as 1. If it is a
  billable-units multiplier (name + editability imply so), `bill_total` should be
  `SUM(rt.bill_amount * ct.bill_count)` and the count may need weighting.
- **Disposition:** DEFERRED pending owner confirmation of intent (Decisions §2). If confirmed a bug →
  FIXED in the rebuild; if vestigial/always-1 → WONTFIX with rationale. **Must not be silently dropped.**

### G-3 · "Commissionable" tab surfaces ₹ in the pipeline (operational view) — ✅ FIXED (ADR-0046, 2026-06-19)
- **Severity:** LOW (UX/scope; **not** a security hole). **Finding:** `PipelinePage.tsx` shows
  bill/commission columns + a Commissionable bucket (gated `billing.view` on the FE). The **server is
  already safe** — it nulls amounts and ignores `commissionable=1` for non-`billing.view` actors
  (proven by `tasks.api.test.ts:734-767`). Pure FE-surface concern.
- **Disposition:** DEFERRED pending owner decision §5 (remove from pipeline; confine money to the
  `billing.view` Billing page). Clean ~6-edit FE-only removal; no backend/security change.

### G-4 · MIS Layout `RATE_AMOUNT`/`COMMISSION_AMOUNT` column types ungated at generation — ✅ FIXED (ADR-0049, MIS build, 2026-06-19)
- **Severity:** LOW (no live leak today). **Finding:** these were bindable column *types* in the
  report-layout catalog (`packages/sdk/src/reportLayouts.ts:36-37`) with no generation endpoint to turn
  them into money.
- **Disposition:** FIXED by the MIS generation/export build (ADR-0049, `docs/specs/2026-06-19-mis-page-design.md`).
  The `mis` service enforces **per-column `billing.view` gating at BOTH `/rows` and `/export`**
  (`apps/api/src/modules/mis/service.ts` `filterColumns`): when the actor lacks `billing.view` (and isn't
  grants_all), `RATE_AMOUNT`/`COMMISSION_AMOUNT` columns are dropped **server-side** from the resolved
  set, the SQL, and the `ExportColumn[]` manifest (the laterals are omitted entirely). **Proven** by
  `mis.api.test.ts` (a non-`billing.view` actor's `columns` exclude the money columns and rows carry no
  money keys — structural absence, not nulling) + an independent security review (APPROVE). Full
  `pnpm verify` green. (Live prod browser-verify pending deploy.)

### G-5 · Billing SUMs do not normalize currency — 🟢 RATCHET (latent; all-INR today)
- **Severity:** LOW. **Finding:** `SUM(bill_amount)`/`SUM(commission_amount)` add `amount` across
  whatever `currency` the rows carry; `rates.currency`/`commission_rates.currency` exist but are never
  filtered/grouped. Harmless while every row is INR.
- **Disposition:** RATCHET — add a currency guard/group if a non-INR rate is ever introduced.

### G-6 · `float8` cast on `numeric` money before `SUM` — 🟢 WONTFIX (minor; revisit if it bites)
- **Severity:** TRIVIAL. **Finding:** `r.amount::float8` / `cmr.amount::float8` (`laterals.ts:21,36`)
  sum in IEEE-754; sub-cent drift possible on large fractional sums. Negligible for current INR integers.
- **Disposition:** WONTFIX for now (cast is intentional for JS number transport); revisit if money
  precision is ever reported wrong.

### G-7 · TAT band system (4/6/8/12/24/48h) is unbuilt — prerequisite for commission-by-TAT — ✅ FIXED (ADR-0044 shipped + consumed by ADR-0046, 2026-06-19)
- **Severity:** MEDIUM (newly prioritized prerequisite). **Finding:** the owner recalled TAT bands as
  "built earlier" — they are **not**. ADR-0044 (task-tat-priority) is **Status: Proposed**, nothing in
  the schema (`tat_hours`/`tat_policies`/`due_at` all absent). What exists: the priority enum
  (`0037_case_task_dispatch_fields.sql:43-46`) + an open-task "out of TAT" breach flag from hard-coded
  12/24/48/72h thresholds off `created_at` (`apps/api/src/modules/tasks/repository.ts:13-19`, ADR-0032).
  No "completed-in band" exists anywhere; ADR-0044 explicitly states "Commission unaffected — priority
  is not a commission input" (must be amended). Raw timestamps for elapsed (`assigned_at`,
  `started_at`, `completed_at`) DO exist (server-side `timestamptz`).
- **Disposition:** DEFERRED but **sequenced FIRST** (owner choice 2026-06-18): build/accept the TAT
  band system (elapsed `completed_at − assigned_at`, bucket 4/6/8/12/24/48h, an assign/complete/band
  read-model) + amend ADR-0044 to allow commission as a consumer, **before** the commission rebuild.
  TAT design decisions (clock start, wall-clock vs business-hours, completion-time source,
  target-vs-actual band, full-ADR-0044 vs minimal) pending owner lock in the TAT design phase.

### G-8 · `RATE_LATERAL` location ladder ranks a non-matching scoped rate above the location-less default — ✅ FIXED (ADR-0048 CASE-rank `87f5f88`; verified at HEAD 2026-06-23 — see §X-CHECK)
- **Severity:** MEDIUM (latent client-bill correctness). **Finding:** `RATE_LATERAL`
  (`apps/api/src/platform/billing/laterals.ts:21-32`) orders by `(r.location_id = ct.area_id) DESC NULLS
  LAST, …, (r.location_id IS NULL) DESC`. Under Postgres, a row scoped to a **non-matching** location
  yields `FALSE` (a non-null), which sorts **above** the location-less default's `NULL` (nulls last). So
  for a CPV that has both a location-less default rate and a different-location override, a task at a
  *third* location resolves the wrong (override) rate instead of the default. The same flaw was present
  in the new `COMMISSION_LATERAL` and was **fixed there** (collapsed to a single `CASE` rank: match >
  location-less > non-matching; see ADR-0046 spec §3). `RATE_LATERAL` (client bill) was **left
  untouched** — it is governed by ADR-0018 (FROZEN) and out of ADR-0046's scope.
- **Disposition:** DEFERRED — needs a superseding ADR (touches the frozen flat-rate model + changes
  historical client-bill resolution) + owner/CTO sign-off. The same `CASE`-rank fix applies. The
  mirrored `cases/repository.ts:139-149` rate_type display subquery shares the flaw and must be fixed
  together. Real-world impact depends on whether any CPV actually has both a location-less default and a
  location override (verify against prod data before prioritizing). **Must not be silently dropped.**

### G-9 · `toXlsx` omits the formula-injection escape that `toCsv` applies — ✅ FIXED (ADR-0049, MIS build, 2026-06-19)
- **Severity:** MEDIUM (was latent across **all** XLSX exports; CWE-1236). **Finding:** `escapeCsvCell`
  prefixes a leading `= + - @ \t \r` with `'` and was applied by `toCsv`, but **`toXlsx` wrote raw cell
  values** — so a cell starting with `=`/`+`/`-`/`@` was a live formula in Excel. Latent for system-text
  exports (billing/locations/tasks); the **MIS export** carries attacker-influenceable free text
  (`form_data`, `DATA_ENTRY_FIELD`, `remark`/`address`), making it exploitable.
- **Disposition:** FIXED platform-wide in `apps/api/src/platform/export/format.ts` — extracted
  `neutralizeFormula(v)` (prefix `'` on a formula-leading STRING; native number/Date/boolean pass
  through) and applied it in `toXlsx`'s cell write; also corrected `escapeCsvCell` to apply the guard
  **AND** RFC-4180 quoting (a formula cell that also contains a comma/quote gets both — the earlier
  "guard-instead-of-quote" form produced invalid CSV). Covered by `platform/export/__tests__/format.test.ts`
  (CSV + XLSX) + the pre-existing `platform/__tests__/export.test.ts`. Full `pnpm verify` green.

### Verified PASS (no finding)
- RBAC: commission config = `masterdata.manage` = SUPER_ADMIN-only; `billing.view` = MANAGER +
  BACKEND_USER + SA; no role accidentally sees amounts (server-nulled fail-safe). A location dimension
  needs **no new permission** (scope-dimension registry). Matches ADR-0036 §3 + the 6-role model.
- The geography substrate (locations, `case_tasks`/`cases` area/pincode, `RATE_LATERAL` cascade) is
  fully live for rates and reusable as the reference model for commission.

## Section R0050 — ADR-0050 rate-type / office two-actor commission: pre-push review gate (2026-06-20)

4-agent adversarial review (CEO · CTO · Design · Security) of the two-rate-type + office flat-commission
build, on top of a green `pnpm verify`. Verdicts: Security **GO**, CEO/Design **GO-with-nits**, CTO
**NO-GO** (one blocker, now fixed). All findings dispositioned below.

### R0050-1 · Migration re-run breaks the 2nd deploy (rename trap) — ✅ FIXED (2026-06-20)
`0083` renames `rate_type`/`distance_band`, but the deploy migrate replays the FULL set every deploy and
earlier migrations reference the OLD names verbatim. **Reproduced** (apply set ×2 on a scratch DB): 2nd
pass hard-failed on `0058` (index on `rate_type` — `CREATE INDEX IF NOT EXISTS` still resolves columns),
`0079` (`ALTER COLUMN rate_type DROP NOT NULL`), `0083`; and silently resurrected `rates.rate_type` +
`case_tasks.distance_band` (`0013`/`0011`). Same class as the `0037`/`0081` MIS incident. **FIX:** guarded
each old-name block on the renamed column's absence (`IF NOT EXISTS field_rate_type/client_rate_type`) in
`0011`/`0013`/`0058`/`0079` — runs once on a fresh DB / first deploy, no-ops on every re-run; kept the
`rates.rate_type_id` unconditional cleanup (`0012` re-adds it each deploy). **Verified:** 3 consecutive
full deploys apply clean, schema converges (renamed cols only, no-overlap constraints intact). **Guardrail
added:** `apps/api/src/platform/__tests__/migrations.rerun.test.ts` (applies the set ×3, asserts no
resurrected columns). DON'T-REGRESS: any future column RENAME / DROP+ADD CHECK must keep this test green.

### R0050-2 · OFFICE distance-band picker shown on 2 assign surfaces — ✅ FIXED (2026-06-20)
ADR-0050 §3 = no LOCAL/OGL picker for OFFICE (auto-stamped). `AddTasksForm` honored it; `CaseDetailPage`
`AssignForm` + `PipelinePage` `BulkAssignAction` showed it unconditionally (server ignored it → no
corruption, but misleading). Gated both on `visitType==='FIELD'` + clear stale `fieldRateType` on switch.

### R0050-3 · SDK field renames are a wire-contract change (not "additive") — 🟢 WONTFIX/authorized
`rateType→clientRateType`, `distanceBand→fieldRateType` on `/api/v2` request/response schemas. Authorized
by ADR-0050 (supersedes ADR-0046, owner+CTO sign-off — a freeze exception, not a silent break). **Mobile
unaffected:** the `/sync/download` projection emits none of these fields; web FE moves in lockstep.

### R0050-4 · ₹0-on-missing-commission-config is silent — 🟡 DEFERRED (ADR-0050 open item)
A task whose dims match no active commission row earns ₹0 silently (LEFT JOIN → NULL → COALESCE 0);
renders as `—` like "not yet completed". Pre-existing ADR-0050 "Consequences" risk. **Launch-checklist:**
pre-seed OFFICE rates before go-live; ship a distinct "unresolved" indicator (TODO). Not a leak (Security).

### R0050-5 · Office-exec has no in-app Excel-export / relay-state — 🟡 DEFERRED (product follow-up)
The two-actor relay (KYC_VERIFIER downloads→emails source→forwards response; never completes) has no
per-task Excel export affordance and no "sent/received" timestamp, so an ASSIGNED office task is
indistinguishable from a stuck one on aging surfaces. First post-launch ask; not a blocker.

### R0050-6 · Design nits — ✅ FIXED (2026-06-23, cross-check §X-CHECK)
`AddTasksForm.tsx` + `CaseDetailPage.tsx` separator `·` used `text-border` (a border color) as a text
color → `text-muted-foreground` (the only two such uses). The second nit — "FIELD assign-at-create has no
client-side guard for the now-required `fieldRateType`" — was re-verified RESOLVED: the form already blocks
submit via the blocked-row / rate-preview mechanism (R0056-2/3), so no change needed there.

### Verified PASS (Security — no finding)
COMMISSION_LATERAL: `cmr.user_id = ct.assigned_to` is a top-level AND (enforced on the OFFICE branch too);
LOCAL/OGL and OFFICE rate-spaces are disjoint; `fieldRateType` client enum = LOCAL/OGL only (OFFICE is
server-derived from `visit_type`, not client-settable); the MANAGER/TL grant unlocks only the 2 task-close
routes (no money/export/admin); completion stays scope-bound (404, IDOR-safe); all SQL parameterized.

## Section R0054 — ADR-0054 v2-native mobile: 3 app-side findings + pre-release review gate (2026-06-20)

The 3 device-smoke findings from the v2-native cutover (`crm-mobile-native`, branch `feat/v2-native-sync`)
fixed via the multi-agent method, then a 4-agent adversarial review gate (CEO · CTO · Design · Security)
on the green static gate (`tsc --noEmit` + `contract:mobile` 14/14 + eslint). Verdicts: CEO/Design/CTO
**GO-with-fixes**, Security **NO-GO** (one cross-user PII blocker — now fixed). All dispositioned below.
Re-smoked on the real device (Android RZ8M813301M, debug 10073 vs local v2-native :4000): login + consent
sync clean, v2 sync "Downloaded 2 / Available 2", addresses render clean on TaskCard + TaskInfoModal.

### R0054-1 · Address `", ,"` gap when v2 drops city/state — ✅ FIXED + device-verified (2026-06-20)
ADR-0054 made `/sync/download` send one free-text `address` (→ local `addressStreet`) + `pincode` and DROP
city/state (now empty). `TaskCard`/`TaskDetailScreen` rendered `{street}, {city}, {state} {pincode}` → e.g.
"…Mumbai, , 400001". **FIX:** shared `src/utils/formatTaskAddress.ts` — comma-joins the non-empty
street/city/state then appends a space-separated pincode (Indian convention; matches pre-ADR-0054). Unit-
tested 5 edge cases. On-device: "42 MARINE DRIVE, CHURCHGATE, MUMBAI 400020 400001" / "12 MG ROAD, FORT,
MUMBAI 400001" — no stray commas (UI-dump text confirmed).

### R0054-2 · Cross-user wipe threw on `user_session` (whitelist gap) — ✅ FIXED (2026-06-20)
`clearAllData failed during user-change wipe` (the device-smoke toast): `MaintenanceRepository.clearAllTables`
threw on `user_session` because it was missing from `CLEARABLE_TABLES`, aborting the wipe mid-loop (partial
wipe). Root cause was the whitelist gap (pre-existing, commit `5eca463`) — **NOT** the v19→v20 migration the
memory hypothesized. **FIX:** added `user_session` to the whitelist. Statically proven: all StorageService
wipe tables ⊆ `CLEARABLE_TABLES`. Schema/FK/open-timing throw paths ruled out (CTO). **Device-verified**
(R0054-R1): real cross-user login swap → `All local data cleared`, no throw.

### R0054-3 · Cross-user wipe left prior-user PII (notifications + projections) — ✅ FIXED (Security BLOCKER, 2026-06-20)
Even with R0054-2, `StorageService.clearAllData`'s 8-table list omitted `notifications`,
`task_list_projection`, `task_detail_projection`, `dashboard_projection`, `form_templates` — all read
**UNSCOPED** by the UI. Login sync only does incremental `rebuildTask`, never `rebuildAll`, so User A's
tasks/notifications render to User B on first launch (this is exactly the original "stale data didn't clear"
finding). **FIX:** added the 5 tables to the wipe list (all already whitelisted; no FKs → order-free). The
fix completes the wipe; the leak is closed. **Device-verified** (R0054-R1): smokefb saw 0 assigned tasks,
no smokefa cases in Recent Activity, and the notification badge gone after the cross-user swap.

### R0054-4 · TaskInfoModal dropped the pincode / 3 address surfaces diverged — ✅ FIXED + device-verified (2026-06-20)
`TaskInfoModal` used `addressStreet || [...]` → dropped the pincode whenever street was present (always, for
v2), while card/detail showed it — same task, different address per screen (Design). **FIX:** all 3 surfaces
now call `formatTaskAddress(task)`. On-device: the modal shows "…MUMBAI 400020 400001" (pincode present),
identical to the card.

### R0054-5 · versionCode 73 → 10073 — ✅ FIXED + device-verified (2026-06-20)
Stale code 73 vs the `10000+minor` release scheme. **FIX:** `android/gradle.properties` versionCode=10073
(versionName stays 1.0.73). `dumpsys package` on the rebuilt debug APK confirms `versionCode=10073`
(mitigation #4 identifiable build).

### R0054-R1 · on-device cross-user wipe repro — ✅ FIXED + device-verified (2026-06-20)
Closed same day. Seeded a 2nd FIELD_AGENT via the real admin API path (`admin`/`admin123` on local
`:4000`/`crm2_dev` → `POST /users` → `smokefb`/`Field@12345`, CRM-00003) and ran the User-A→User-B login
swap on the real device (RZ8M813301M). Logcat proves the path: `User changed on this device
(4e51…[smokefa] → ae16…[smokefb]); wiping local data` → `[StorageService] All local data cleared` (fires
only after `clearAllTables` returns) → `Login successful` — **no `clearAllData failed`** (the old
`user_session` throw is gone). Visual: smokefb's dashboard shows ASSIGNED/IN-PROGRESS/COMPLETED/SAVED **all
0**, RECENT ACTIVITY has **no** smokefa cases, and the notification bell badge (was "1") is **gone** — i.e.
R0054-3's notifications + projections + dashboard tables were all cleared, zero cross-user leak. (Observed
but pre-existing + dev-only: a background `/auth/refresh` 401 `INVALID_REFRESH` surfaces in the RN LogBox —
appeared for smokefa too [no wipe], invisible in release builds; not a regression.)

### R0054-6 · Cross-user wipe is two independent hardcoded lists (drift) — 🟡 DEFERRED (2026-06-20)
`StorageService.clearAllData`'s wipe list and `MaintenanceRepository.CLEARABLE_TABLES` are separate literals;
a future table added to one and not the other re-introduces R0054-2's partial-wipe bug. A subset-guard test
can't load under the dependency-free `node --experimental-strip-types` runner (native `react-native-fs`
import). **Follow-up:** hoist the wipe list to an exported constant + assert `wipeList ⊆ CLEARABLE_TABLES`,
or derive one from the other.

### R0054-7 · Cross-user wipe non-transactional + failure swallowed — 🟡 DEFERRED (2026-06-20)
`clearAllTables` runs per-table `DELETE` with no transaction, and `AuthService` catches a wipe failure and
**continues login** onto possibly-stale cross-user data. Acceptable now (R0054-2/3 remove the known throw),
but the right cross-user boundary is all-or-nothing + fail-closed (block login on wipe failure). Behavioural
change → its own reviewed change next cycle.

### Process / pre-release checklist
TEMP smoke repoint (`src/config/index.ts` dev → `http://localhost:4000`) **reverted** to the prod HTTPS URL
(it was `__DEV__`-only so could not ship in a release, but a landmine). Owner gate before distribution
(CEO): **staged/canary rollout** (a few field agents first, incl. the R0054-R1 cross-user swap) before
fleet-wide, and confirm the "no other live v2 app" freeze (mitigation #5) still holds at distribution time.

## Section R0056 — ADR-0056 field-rate-type auto-derive: pre-push 4-agent review gate (2026-06-21)

Verdict: **Security GO · CTO GO (conditional) · Design GO · CEO GO.** One blocker (B-1) FIXED; the rest DEFERRED.

### R0056-1 · Derive drops `tat_band` → could stamp a band that resolves ₹0 at submit — ✅ FIXED (2026-06-21)
CTO blocker. The two derive helpers (`cases/repository.ts` `deriveFieldRateTypeForTask`/`…ForNewTask`)
mirror `COMMISSION_LATERAL` minus the `field_rate_type` equality (we derive it) and minus `tat_band`. Among
same-specificity/same-location rows differing by both `field_rate_type` AND `tat_band`, `id DESC` could pick
a tat-band-specific band (e.g. `OGL@4`) that, at submit (completing in another band), resolves ₹0 via
`COMMISSION_LATERAL` (which DOES filter `tat_band`). **FIX:** added a tie-break `(cmr.tat_band IS NULL) DESC`
(after specificity+location, before `id DESC`) so the derive prefers an always-resolvable (tat-band-universal)
band + a test (`rate-preview.api.test.ts` "prefers a tat_band-universal band … (B-1)"). Security confirmed the
worst case was always ₹0, never over-payment, and it is **not a regression** (the old manual-pick model had the
same assign-time→submit-time band drift). **Residual** (the cross-*specificity* case — the most-specific row is
itself tat-band-specific) → 🟡 **DEFERRED**: inherent to any assign-time stamp; band is unknowable until submit;
prod commission rows are overwhelmingly `tat_band=NULL` so this is latent.

### R0056-2 · Save/Add not disabled despite a known-bad preview — ✅ FIXED (2026-06-21, owner-requested)
Design major. **Add-Tasks** now disables the Add button when any submittable FIELD row's chosen executive has
no commission (each `TaskRowEditor` reports its blocked state up by stable row id via `reportBlocked`); the
case-detail **AssignForm** disables Save when `ratePreview.fieldRateTypes.length === 0`. (Pipeline **bulk**
keeps the post-assign per-row `NO_FIELD_COMMISSION` summary — a pre-check across N locations isn't feasible.)

### R0056-3 · Surface WHICH dependency is missing + where to fix it — ✅ FIXED (2026-06-21, owner-requested)
Owner: "user cannot create case/task without the whole dependency map; show a proper message of what's missing."
Each gate now shows an actionable inline message naming the admin page: **CPV** ("map them in Admin → CPV
Mapping"), **client rate** ("set it in Rate Management; bill ₹0 until then"), **field-exec territory** ("assign
one this territory in Admin → User Management"), **commission** ("add one in Commission Rates for this client or
Universal, with a rate type — assignment blocked until then"). All derived from existing UI data (available-units
/ eligible-assignees / rate-preview) — no new endpoint. Applies to Add-Tasks + AssignForm; bulk uses its summary.

### R0056-4 · Case-detail preview passes only `locationId=areaId`, not the full ladder — 🟢 WONTFIX
CTO minor. `CaseDetailPage` AssignForm's preview uses `task.areaId` only, while the server derive checks
`IN (task.area, task.pincode, case.area, case.pincode)`. The warning hint can be a false +/- when pincode/case
location differ; **no money impact** (server is authoritative). AddTasksForm is consistent (area=pincode).

### R0056-5 · Pre-seed commissions before go-live — 🟡 OPS launch-checklist (CEO)
The hard block means FIELD assignment is impossible until an exec has commission at the location. **Pre-seed at
least one Universal LOCAL/OGL `commission_rates` row per active field exec per dispatch territory** before
go-live, else dispatch is blocked fleet-wide. Brief dispatchers on the inline warning.

### Verified PASS (no finding)
Security: no money-leak (derive keys on `cmr.user_id`=assignee; explicit-band hatch can't conjure commission →
₹0 not over-pay), no SQL injection (uuid-validated + `$5::uuid` bound), no IDOR (rate-preview gated `CASE_CREATE`,
FIELD_AGENT excluded; types-only response). CTO: 4 write paths complete + correct; OFFICE auto-stamp intact;
bulk per-row status correct; tx rollback clean; no migration. CEO: delivers the owner's ask (picker removed,
exec-first, auto-derive, block); mobile unaffected (additive). `pnpm verify` GREEN.

## Section R0055-R0056-SHIP — open follow-ups after the combined prod ship (2026-06-22, origin/main `80d95ce`)

ADR-0055 (revoke-before-reassign) + ADR-0056 (field-rate auto-derive) shipped together; deploy gate green.
Three deferred follow-ups, owner-acknowledged:

### SHIP-1 · Bulk-assign bypasses the revoke-before-reassign gate — ✅ FIXED (2026-06-24)
Single-assign (`cases/service.assignTask`) is now PENDING-only, but pipeline **bulk-assign**
(`tasks/service.ts:266`) still admits `ASSIGNED` rows and re-points them in place via
`caseRepository.assignTask`, bypassing the gate. Flagged by BOTH the revoke + field-rate sessions as a
coordinated follow-up (the file is the field-rate session's). Restrict bulk to PENDING-only for full
ADR-0055 consistency.
**FIXED 2026-06-24 (= A2026-0623-10):** `tasks/service.ts` bulk guard changed from
`status !== 'PENDING' && status !== 'ASSIGNED'` → `status !== 'PENDING'`, so a live `ASSIGNED` row now
returns `NOT_ASSIGNABLE` (never reaches `caseRepository.assignTask`) — mirrors the single-assign
`TASK_NOT_ASSIGNABLE` rule. TDD: `tasks.api.test.ts` asserts the ASSIGNED row is `NOT_ASSIGNABLE` and the
live assignment is never re-pointed. (Independently re-implemented in the 2026-06-23 cross-check session —
identical one-line gate — but the upstream fix landed first, so the cross-check's SHIP-1 commit was dropped
on rebase.)

### SHIP-2 · "Bill count" is an inconsistent billing multiplier — ✅ FIXED (2026-06-23) — input removed (every task ×1); see §X-CHECK
**Owner decision 2026-06-23: REMOVE the input** (CRM2 is export-only — see the billing-scope WONTFIX in
§X-CHECK). The operator-set bill_count box is gone from the inline Assign form (`CaseDetailPage`) + Pipeline
bulk-assign (`PipelinePage`); both now send `billCount: 1`. The `case_tasks.bill_count` column + the billing
`× bill_count` math are unchanged (always 1 now) — full retirement of the column/multiplier + the read-only
"Bills" display columns is a later cleanup. Web gate green.

### SHIP-3 · Stranded location-less PENDING tasks after "remove Assign later" — 🟡 DEFERRED (going-forward fix)
ADR-0056's "remove Assign later" (require visit type + FIELD location at create) is **going-forward** — any
pre-existing bare/location-less PENDING task can't be FIELD-assigned (the inline Assign form has no location
picker; that was the rejected Option B). **Pre-deploy/post-deploy check:** `SELECT count(*) FROM case_tasks
WHERE status='PENDING' AND area_id IS NULL` on prod — if non-zero, revoke/recreate them or revisit the
inline-assign location fix.

## Section AUDIT-2026-06-22 — verification-form field-mapping audit (9 FIELD_VISIT types × 4 layers)

Read-only multi-agent audit. Nothing changed. Full report: `docs/audit-2026-06-22/` (README + per-layer
files). Mobile capture, backend storage, frontend raw-field display, and the field-photo
lat/long→reverse-geocoded-address chain all **PASS** for all 9 types. The break is the **FIELD_REPORT
narrative generator** only — and raw captured fields always still display, so no data is lost.

### AUDIT-1 · FIELD_REPORT narrative renders empty — outcome-vocabulary mismatch — ✅ FIXED (ADR-0057 `098f409`; verified at HEAD 2026-06-23 — see §X-CHECK)
Default templates branch (strict `===`) on v1 verbose labels (`"Positive & Door Open"`, `"ERT"`,
`"Untraceable"`, …); the v2 app submits 5 uppercase CODES in `verificationOutcome`
(`POSITIVE`/`SHIFTED`/`NSP`/`ENTRY_RESTRICTED`/`UNTRACEABLE`, `FormSubmissionService.ts:81`,
`VerificationFormScreen.tsx:80`). No backend code→label normalization (`fieldReports/repository.ts:52`
verbatim), so no `{{#eq outcome …}}` branch ever matches → empty body, all 9 types. Tests are green
because `defaults.*.render.test.ts` feed the v1 label, not the device code. Real v1 dump confirms the
labels were the historical vocabulary; the v2 mobile rewrite (`LegacyFormTemplateBuilders.normalizeOutcome`)
collapsed them to codes. **Latent until an admin activates a FIELD_REPORT layout prefilled from the
defaults** (`ReportLayoutsPage.tsx:374-378` one-click). Evidence: `docs/audit-2026-06-22/layer4-template-mapping.md`.

### AUDIT-2 · FIELD_REPORT tenure clauses empty — composite period-key arity — ✅ FIXED (ADR-0057 period recombination `098f409`; verified at HEAD 2026-06-23 — see §X-CHECK)
Templates read a single `<period>` ref; the app emits split `<period>Value` + `<period>Unit` (~20
instances, 8 types) → empty "for the last … years" clauses. No `concat` helper, so needs a real resolver/
helper, not a rename. Tests mask it by feeding the combined string.

### AUDIT-3 · Secondary per-field ref drifts — ✅ RESOLVED (no live drift in crm2 templates at HEAD 2026-06-23 — see §X-CHECK)
`applicantStayingFloor` vs mobile `addressFloor` (floor clause), `callConfirmation` absence for
BUILDER/NOC, `finalStatusNegative` captured-but-never-printed (APF), `businessExistance` misspelled twin.
Isolated; raw view still shows them; fix after AUDIT-1/2. Confirm each against the exact mobile form.

### AUDIT-4 · Test debt masks the whole class — ✅ FIXED (canonicalize.render.test.ts device-blob contract + RED regression; verified 2026-06-23 — see §X-CHECK)
`defaults.*.render.test.ts` feed v1-shaped fixtures (verbose-label outcome + combined period) the v2
device never sends → `pnpm verify` stays green while real reports are blank. Add a contract test that
renders a default template from a **real captured device blob** and asserts a non-empty body.

### Open verification (needs prod/dev DB — not done in this audit)
`SELECT verification_type, is_active FROM report_layouts WHERE template_type='FIELD_REPORT'` on prod →
decides AUDIT-1/2 **live vs latent**. Then one real device submission per type → diff rendered `narrative`.

### Verified PASS (no finding)
Backend verbatim jsonb round-trip + uniform across all 9 slugs (`cases/repository.ts:1413-1418`);
generic raw-field display, no per-type gating, nothing dropped (`fieldReports/sections.ts`,
`CaseDetailPage.tsx:1783-1792`); field-photo lat/long + reverse-geocoded-address full chain with
graceful null fallback, all 9 types (`platform/geocode/*`, `case_attachments.geo_location` +
`reverse_geocoded_address`, `CaseDetailPage.tsx:1860-1906`).

## Section IE-2026-06-22 — Excel/CSV import-export coverage audit & fix (admin/master-data first)

Multi-agent audit (7 page-groups × field matrix) of `.xlsx`/`.csv` import+export coverage so every
add/edit field is importable + exportable, lossless, RBAC-correct, escaped (CWE-1236/G-9), case-correct
(ADR-0058). Full matrices: `docs/audit-2026-06-22/import-export/A1..A7.md` + `README.md`. No frozen
decision changed → **no ADR**; all fixes additive (export manifests + import columns + route guards).
Confirmed platform-wide: imports reuse the SDK Create schema (ADR-0058 transforms run on import, no
bypass); `.xlsx` + `.csv` both accepted; forbidden-import history surfaces expose no import.

### IE-1 · Users export gated by bare `data.export` (PII export wider than read) — ✅ FIXED (2026-06-22)
`GET /users/export` required only `data.export`, held by MANAGER/TEAM_LEADER/BACKEND_USER, none of
which hold `page.users` (SUPER_ADMIN-only) — so they could export every user's name/phone/employeeId
(PII) without being able to open the list. Re-gated `USER_VIEW`, mirroring the in-repo
`/scope/export` + billing `/cases/export` precedent (export never wider than read). The test that
*codified* the hole (`BACKEND_USER … can export (200)`) was flipped to assert 403. `users/routes.ts`.

### IE-2 · Field-Monitoring export gated by bare `data.export` — ✅ FIXED (2026-06-22)
`GET /field-monitoring/export` (FIELD-agent roster: name/phone/employeeId PII + territory) was
exportable by BACKEND_USER (holds `data.export`, not `page.field_monitoring`). Re-gated
`FIELD_MONITORING_VIEW`. `field-monitoring/routes.ts`.

### IE-3 · Roles export gated by bare `data.export` (RBAC topology disclosure) — ✅ FIXED (2026-06-22)
`GET /roles/export` dumped every role's permission set + scope wiring to roles lacking `page.access`.
Re-gated `ACCESS_VIEW`. `roles/routes.ts`.

### IE-4 · Report-Templates export gated by bare `data.export` — ✅ FIXED (2026-06-22)
`GET /report-templates/export` was exportable by roles that 403 on the template list (`page.templates`).
Re-gated `TEMPLATE_VIEW`; the `BACKEND_USER can export (200)` test flipped to 403. `reportTemplates/routes.ts`.

### IE-5 · Commission-rate export dropped the resolution dimensions — ✅ FIXED (2026-06-22)
`COMMISSION_RATE_EXPORT_COLUMNS` emitted user/client/rateType/amount only — dropping `location` (a
REQUIRED key for LOCAL/OGL), `product`, `verificationUnit`, `tatBand`, `currency` (all on
`CommissionRateView`). Two differently-dimensioned rows exported identically and could not round-trip
(the required location was gone). Added all five (grid-aligned ids). `commissionRates/service.ts`.

### IE-6 · Verification-Unit export lossy (9 of ~23 fields); KYC import impossible — ✅ FIXED (2026-06-22)
Export now mirrors the 19 import columns (same headers) + read-only audit cols → an export re-imports
losslessly. Added the `Required Attachments` import column with a `TYPE[:MIN]` round-trip parser/formatter
— KYC_DOCUMENT units (which require ≥1 attachment) could **never** import before. `verificationUnits/service.ts`.

### IE-7 · Rates/Users/CPV round-trip + completeness gaps — ✅ FIXED (2026-06-22)
Rates export `+currency` (importable) `+effectiveTo` (history window). Users export `+Email`; users
import `+Phone`. CPV-Mapping export split the combined `"CODE — Name"` cell into separate
`Client/Product Code` (the import key) + `Name` columns → re-importable (round-trip test: export→preview
= 0 errors). `rates/service.ts`, `users/service.ts`, `cpv/service.ts`.

### IE-DEFER-1 → ✅ FIXED (2026-06-22, owner pulled forward) · Users + Designations FK import (department/designation)
Both departments and designations are **name-keyed (unique)**, so no new code surface was needed —
the per-request import builder resolves the FK by NAME via the existing `options()` ({id,name}). Added a
`Department` column to the designation import (matches the export header) + `Department`/`Designation`
columns to the user import (match the export headers); both refactored to file-schema + async `resolve`
builders (`buildDesignationImportSpec` / `buildUserImportSpec`, mirroring cpv/commission). The user file
schema = `CreateUserSchema.omit({departmentId,designationId}).extend({departmentName,designationName})`
so ALL preview validation (username/email/phone/role/password) is preserved; an unknown name → per-row
error against the Department/Designation column (no silent null). A designation/user export now re-imports
losslessly (round-trip tests assert 0 errors). `designations/service.ts`, `users/service.ts`.

### IE-DEFER-2 · CPV unit-enablement leg (`client_product_verification_units`) import/export — ✅ FIXED (2026-06-23, §X-CHECK)
The unit-enablement leg now has bulk **export + import** mirroring the sibling `client_products` leg:
`GET /cpv-units/export` (DATA_EXPORT), `GET /cpv-units/import-template` + `POST /cpv-units/import`
(MASTERDATA_MANAGE). The export emits the resolvable client/product/unit **codes** so a downloaded file
re-imports losslessly (round-trip test green); the import resolves codes→ids via the existing options/link
maps. Web: "Import Units" + "Export Units" controls in the CPV page header (the enablements span all links
→ a global import/export, not per-row in the sub-table). `cpv.api.test.ts` covers export 200/403/401 +
import preview/confirm/round-trip. Full `pnpm verify` green.

### IE-DEFER-3 · Case Creation bulk import (DEFERRED) · Bulk Assignment file import (WONTFIX) · Cases grid export (✅ FIXED 2026-06-23)
- **Cases grid export → ✅ FIXED (2026-06-23, IE-DEFER-3c, §X-CHECK):** added `GET /cases/export`
  (DATA_EXPORT; holders ⊆ CASE_VIEW so not wider-than-read; FIELD/KYC excluded from bulk export) reusing the
  SAME scope-filtered cases `list` query (the export inherits the actor's case scope; the 413 is computed on
  the SCOPED count so it can't leak out-of-scope existence) + the CASES_EXPORT_COLUMNS manifest + web
  `exportFn` on the Cases DataGrid (gated `has('data.export')` so the button hides for KYC). `cases.api.test.ts`
  covers 200 / 403 (FIELD+KYC) / 401 + a scope test. Full `pnpm verify` green.
- **Bulk Assignment file import → 🟢 WONTFIX:** it is an in-grid JSON action (`POST /tasks/bulk-assign`),
  not a spreadsheet import surface; correct as-is (no import endpoint by design).
- **Case-creation bulk import → 🟡 DEFERRED (IE-DEFER-3a):** does not exist (import-mandatory §4) and needs
  its own ADR (ADR-0059, Proposed) — must reuse `CreateCaseSchema` + honour ADR-0053 (multi-applicant batch
  dedupe) + ADR-0056 (visit-type + FIELD location + derived field-rate) + the dedupe gate. A feature, not a
  coverage patch; build on ADR-0059 greenlight (depends on the universal import-engine B-14).

### IE-DEFER-4 · MIS/Billing/Field-Monitoring ≥10k export → background job — 🟡 DEFERRED
`mode:all` ≥10k returns 413 `EXPORT_TOO_LARGE` instead of enqueuing a job (standard §2); only
`locations` registers an async export builder. Incremental rollout — register builders per surface.

### IE-DEFER-5 · Policies export — ✅ FIXED (2026-06-23, §X-CHECK)
Added `GET /policies/export` **gated `POLICY_VIEW`** (SA-only — NOT bare `data.export`, which MANAGER/TL/
BACKEND_USER hold but cannot read policies → would be wider-than-read, the IE-1..4 class) + the
POLICY_EXPORT_COLUMNS manifest (the large `content` legal blob is deliberately excluded) + web `exportFn`
on the Policies DataGrid. `policies.api.test.ts` covers 200 (SA) / 403 (BACKEND_USER) / 401. Policies
*content* stays non-importable (versioned legal blob — WONTFIX). Full `pnpm verify` green.

### IE-DEFER-6 · Scope-assignments export honours filters + emits codes + web surface — ✅ FIXED (2026-06-23, §X-CHECK)
The `/users/scope/export` now emits the **codes** the import resolver parses (PINCODE → bare pincode, AREA →
`PINCODE:AREA`, CLIENT/PRODUCT/VERIFICATION_TYPE → catalog code, STATE/CITY → raw value; username + dimension
were already round-trippable) so a downloaded file re-imports — a round-trip test feeds the export back to the
import preview with 0 errors. A separate `Label` column keeps operator context (the importer ignores unknown
headers). The web "Export Scope" button already exists (UsersPage). (Filter/sort honouring stays the existing
whole-topology dump — the primary fix was codes for round-trip; not over-engineered.) Full `pnpm verify` green.

### IE-8 · Departments + Designations export gated wider than their list — ✅ FIXED (2026-06-22, review-panel)
The Security reviewer caught a miss in the IE-1..4 gate sweep: `GET /departments/export` and
`GET /designations/export` were gated bare `data.export` (SA+MGR+TL+BE) while their LIST is `page.users`
(SUPER_ADMIN-only) — so MANAGER/TEAM_LEADER/BACKEND_USER could export the org's department/designation
structure they cannot read. Same export-wider-than-read class as IE-1..4. Low impact (no PII/money/secret
— name/description/dates/status only) but real. Re-gated both `/export` → `USER_VIEW`; the
`BACKEND_USER can export (200)` tests flipped to 403. `departments/routes.ts`, `designations/routes.ts`.

### IE-9 · Review-panel hardening (parser + template discoverability + export consistency) — ✅ FIXED (2026-06-22)
- **CTO P2:** `parseAttachmentList` accepted a blank-type token (`":2"` → `{type:'',min:2}`); now filters
  empty-type tokens. `verificationUnits/service.ts`.
- **Design P2-1:** the VU import template shipped a blank `Required Attachments` sample → the `TYPE[:MIN]`
  grammar was undiscoverable; added a worked sample (`DOCUMENT,PAN:2`) so the template self-documents.
- **Design P3-1:** commission export rendered "applies to any" three ways (`Universal` for client, blank
  for the other dims); now renders `Universal` for all Universal-able dimensions (no blank-vs-missing ambiguity).

### IE-DEFER-7 · Commission-rate export ⇏ commission import template (round-trip shape mismatch) — 🟢 WONTFIX (owner 2026-06-23: keep export analysis-only; bulk-load via the import template — see §X-CHECK)
The Design reviewer noted commission rates have BOTH export and import, but the export is display-oriented
(combined `Location` "411001 Fort", `Product` code+name, `Unit` name, `User` display name, `TAT` "24h")
while the import template is code/pincode-keyed (`Username`, `Location Pincode`+`Area`, `Product Code`,
`Unit Code`, integer `TAT Band`) — so an exported file does not re-import cleanly (unlike CPV/VU/Users/Rates,
which were aligned). The IE-5 P0 (dropped required dimensions / ambiguity) IS fixed; full export↔import
alignment (split Location, emit codes, bare TAT) is a follow-up that conflicts with the FE grid `cols`
ids and so warrants its own pass. Export is documented in-code as read-for-analysis, not a re-import source.

### IE-DEFER-8 · Report Layouts export — ✅ FIXED (2026-06-23, §X-CHECK)
Added `GET /report-layouts/export` **gated `TEMPLATE_MANAGE`** (the module's list read perm — export shares
the list audience) + the REPORT_LAYOUT_EXPORT_COLUMNS manifest (name/kind/client/product/status/dates; the
large designer body/columns JSON is excluded) + web `exportFn` on the Report Layouts DataGrid.
`reportLayouts.api.test.ts` covers 200 / 403 (BACKEND_USER) / 401. The layout *designer artifact* (template
body / column-row builder) stays non-importable by design (WONTFIX). Full `pnpm verify` green.

### Review-panel verdicts (4-agent, 2026-06-22)
CTO: NO BLOCKING ISSUES (reuse + additive + contract-safe + tests genuine; round-trip + RBAC traced to
seed). Security: no P0/P1 in the change; the four (now six) gates correctly close real export-wider-than-read
exfils; no secret leak (password_hash is not a UserView field); CWE-1236 guard covers every new cell; the
attachment parser is injection/ReDoS/DoS-safe. CEO: **ACCEPT round-1 (master-data + security)**; two owner
asks — (a) name **Case Creation bulk import** (IE-DEFER-3) the round-2 headliner (highest daily-value admin
workflow), (b) consider pulling **users/designations dept+designation FK import** (IE-DEFER-1) forward — same
code→id resolve pattern this change already proves for CPV/commission. Design: no P1 blockers; P2/P3 above
FIXED or dispositioned (IE-DEFER-7). Pre-existing P3 (not introduced here, logged for a follow-up):
`requiredAttachments` element `{type,min}` shape is unvalidated by the SDK schema (`z.array(z.unknown())`);
constrain `type` to an enum when the field gets a server-side consumer.

### WONTFIX (justified)
Report Templates content blob, Report Layouts designer artifact, Saved Views (per-user opaque state),
System (read-only health), Reference (seeded lookup), Policies content (legal blob) — non-importable by
design. Audit/Billing/Commission/Notification/System-log history — forbidden import (§4), correctly
exposing no import endpoint. MIS money-drop (G-4) verified applied on BOTH `/rows` and `/export`.

## Section H — Frontend design-compliance audit (2026-06-19) — dispositions

The authorized 2026-06-19 `apps/web` design audit (deliverable `docs/design-audit-2026-06-19/`, plan
`docs/plans/2026-06-20-frontend-design-compliance-fix-plan.md`) found **0 P0 · 25 P1 · 56 P2 · 45 P3** —
all *consistency of primitive adoption* on newer/bespoke pages (no architectural breaks). Remediation is
additive (adopt existing primitives) under **[ADR-0051](./adr/ADR-0051-inline-grid-editing-no-modal-forms.md)**
(inline-grid + record-page add/edit) and **[ADR-0052](./adr/ADR-0052-button-action-emphasis-system.md)**
(button affordance). Foundation + Wave 1 + button-migration + Wave 4 (D3/D4) **shipped to prod**
(`origin/main 522d5ac`, 2026-06-23). Wave K / D5 closeout dispositioned below.

### H-1 · RBAC-UI client-gating leaks (write controls shown without `useAuth().has()`) — ✅ FIXED
Foundation F1 centralized `has()` in `useAuth()`; Wave-1 A1 gated Cases `+New`, Rate-Management writes,
and Templates/RBAC/Policies actions on the server perms. The D4 record-page routes (Policies/ReportLayouts/
Roles/CommissionRates/Users/VerificationUnits) each **self-guard** (`if (!has('<perm>')) return <Navigate/>`),
closing the create/edit leak structurally. Shipped `522d5ac`. Server remains authoritative.

### H-2 · Bespoke dialogs/popovers not focus-trapped — ✅ FIXED
A3 focus-trapped the (then) Commission-Rates dialog; A4/F4 moved the header Jobs/Bell/Account popovers to a
shared focus-trapped `Popover`. The Commission-Rates add/edit dialog is now moot (D4 record page). Shipped
`522d5ac`. The RBAC "cannot deactivate" alert gained `role=dialog`+`aria-modal`+`useFocusTrap` (Wave K).

### H-3 · Non-standard loading/error states — ✅ FIXED
A5 standardized Dashboard/Security/Notifications/CPV/Policies on `HexagonLoader` + error/Retry (no
silent-empty; MFA no false-OFF pre-load). Shipped `522d5ac`.

### H-7 · Token slips (`text-st-completed` dead, `text-amber-600` raw) — ✅ FIXED
A2 replaced both with frozen tokens; F5 source-scan guard (`lib/tokens.guard.test.ts`) prevents
regressions. Shipped `522d5ac`.

### H-9 · Add/edit inconsistency (modal forms) → inline-grid + record-page (ADR-0051) — ✅ FIXED (converted set)
**Flat → editable DataGrid per-cell inline + add-row:** Departments, Designations, Clients, Products,
Locations. **Complex → record-page route** `/admin/<entity>/new|:id`: Policies, ReportLayouts, Roles,
CommissionRates, Users (2-tab), VerificationUnits (3 with additive `GET /:id`). All add/edit `*Dialog`s
deleted; shipped `522d5ac`. A regression guard (`apps/web/src/lib/adr0051-no-modal-forms.guard.test.ts`)
fails if any converted entity re-introduces an add/edit modal. Standards updated (`DATAGRID_STANDARD.md §21`,
`MANAGEMENT_LIST_STANDARD.md`). Kept overlays (ConflictDialog/ImportModal/ResetPasswordDialog/Assign) are
not add/edit forms.
- **CPV — 🟡 DEFERRED:** bespoke master-detail accordion (client↔product link + per-unit reschedule); keys
  immutable, only `effectiveFrom` is reschedulable via a tiny single-date dialog + a sanctioned
  `renderExpanded` sub-table. ADR-0051's flat-grid model does not fit; left as-is (documented scope).
- **Templates + Rate-Management — ✅ FIXED (this branch, 2026-06-23):** the last two popup surfaces, both
  converted to record-page routes (backend-additive D4, mirroring Policies + CommissionRates). **Templates:**
  added `GET /api/v2/report-templates/:id` (TEMPLATE_VIEW, reuses `repo.findById`, +integration tests) +
  `TemplateRecordPage` (`/admin/templates/new|:id`); `TemplateDialog` deleted. **Rate-Management:** added
  `GET /api/v2/rates/:id` returning the joined `RateView` (MASTERDATA_VIEW, new `repo.findViewById` factored
  from the list select, +integration tests) + `RateRecordPage` (`/new` create cascade + `/:id` revise =
  amount+effFrom, dims read-only, `POST /:id/revise`); the inline AddRateForm + Revise modal deleted, the
  read-only `HistoryDialog` kept, `SearchableSelect` extracted to `components/ui/`. OpenAPI regenerated;
  the no-modal-form guard test now scans `features/templates` + `features/rateManagement` (HistoryDialog
  whitelisted as a read-only view). Browser-verified create/edit navigation + `GET /:id` hydration; e2e
  `templates.spec` + `rateManagement.spec` added (+ idempotent seed rows, verified on an empty DB). **Only
  CPV remains unconverted** (above) — every other entity is now inline-grid or record-page.

### H-10 · Keyboard navigation (D15) — ✅ FIXED (P1/P2); 🟡 DEFERRED (P3 tail)
- **K1 (P1) — ✅ FIXED:** DataGrid sortable headers + `onRowClick` rows are keyboard-operable
  (tabIndex + Enter/Space, focus-visible ring, `aria-sort` retained) — fixes every grid (Playwright
  e2e in `datagrid.spec.ts`).
- **K2/K3 — ✅ FIXED:** `.input` focus ring restored; RateManagement `SearchableSelect` keyboard combobox;
  skip-to-content link; RBAC deactivate-alert focus-trap (shipped `522d5ac`); MustAcceptPolicies scroll
  region keyboard-focusable (`role=region`/`tabIndex`, this branch).
- **DataGrid `role=menu` arrow-key roving — 🟡 DEFERRED (P3):** the column/export/filter menus are already
  keyboard-operable (focus-trap + Tab + Enter + Escape; axe-green) — arrow-roving is an ARIA best-practice
  enhancement, not an axe-failing violation. Deferred to avoid destabilizing the critical 1.4k-line shared
  grid (40 passing grid e2e) for a P3.

### H-11 · Button affordance / action-emphasis (ADR-0052) — ✅ FIXED
Shared `<Button>` variant system (primary/secondary-tonal/destructive/ghost/link + loading/iconOnly +
Export ↓ / Import ↑ glyphs), AA-contrast in light+dark, ~130 `.btn` + 21 text-link sites migrated, `.btn`
CSS retired, dark-mode toggle. Shipped `522d5ac`.

### H-B2 · Bespoke tables a11y/responsive contract — ✅ FIXED (this branch)
Bespoke (non-DataGrid) tables adopt the keyboard-focusable `<ScrollRegion>` (CaseDetail ×3, CaseCreate,
MIS, Import, Profile, UserRecord), `scope="col"` on every bespoke `<th>`, and `.rtable`/`data-label` so
Profile + UserRecord policy-acceptance tables collapse to labelled mobile cards. Browser-verified
`/cases/:id` (not in the e2e gate); a11y + viewport green.

### H-B3 · Export/pagination contract — ✅ FIXED (the deferred endpoints landed 2026-06-23, §X-CHECK)
- **Users "Export Scope" → `apiExport`** (design-build): was a bare `apiBlob` download; now routes through
  the job-aware helper so a ≥-threshold export returns a 202 background job (toast) instead of a sync blob.
- **`exportFn` where the backend `/export` exists:** all admin/master-data DataGrids wire it. The three
  DataGrids that previously LACKED a list-export endpoint now have additive ones (2026-06-23 cross-check):
  **Cases** (`GET /cases/export`, IE-DEFER-3c), **Policies** (`GET /policies/export`, IE-DEFER-5),
  **ReportLayouts** (`GET /report-layouts/export`, IE-DEFER-8) — each gated by its list's read perm, with the
  `exportFn` now wired on the page.
- **CaseDetail task/attachment lists** = array-by-design (per-case bounded sets returned with the case, not
  separately paginated, like `/cases/available-units`); no DataGrid export — documented, not a gap.

### H-C2 · URL-state column filters on the remaining lists — ✅ FIXED (server-whitelisted) + 🟡 N/A (no server filter)
The DataGrid already persists search/sort/page to the URL on every list; C2 exposes the column filters the
server `*_PAGE_SPEC.filterMap` already whitelists (the `f_<id>` contract): **CommissionRates** (+`user`,
`client`, `fieldRateType` text filters; dates already wired), **ReportLayouts** (+`client`/`product`/`name`
text, `kind` Excel multi-select, `createdAt`/`updatedAt` date filters — was 0). **Roles** + **RateManagement**
already exposed their full filterMap (no change). **CaseDetailPage** task-bucket tab now persists to `?tab=`
(bookmarkable). Only filters the server whitelists were added (an unwhitelisted `f_*` is silently dropped, so
none were invented). **FieldMonitoring + Dedupe — 🟡 N/A:** field-monitoring has NO `filterMap` (no column
filter is server-supported → would need an additive backend spec), and Dedupe's filter surface IS its
search form (name/PAN/mobile/company), not per-column grid filters — both left as-is by design.

### H-B1 · Record-page form validation → canonical @crm2/sdk zod (no new dep) — ✅ FIXED (this branch)
Owner-decided (no `react-hook-form`: it isn't in the frozen stack, and OCC `ConflictDialog` is already wired
on every record page). A small pure helper `apps/web/src/lib/zodForm.ts` `zodFieldErrors(schema, values)`
(unit-tested) runs the same `Create<X>`/`Update<X>` schema the server enforces and returns field→message;
the 6 record-page forms (Policy, Role, CommissionRate [create only — Revise has no create-shaped schema],
User [Profile tab], VerificationUnit, ReportLayout) validate-before-mutate and render inline per-field
errors. Browser-verified (an invalid amount blocks the submit + shows the inline error) + the 6 entity e2e
specs confirm valid create/edit is not false-blocked. CaseCreate/CaseDetail/Locations already had rich
inline validation — left as-is.

### Design-build status (this branch — all fix-plan items dispositioned)
Foundation + Wave 1 + button-migration + Wave 4 (D3/D4) shipped to prod (`522d5ac`). The follow-up branch
completed the remainder: **K1/K3** (keyboard), **D5** (guard + standards), **B2** (tables), **C3**
(consistency), **B3** (export), **C2** (URL filters), **B1** (form validation), and the **last two popup
conversions — Templates + Rate-Management** (record-page routes + additive `GET /:id`, H-9 above) — all FIXED.
**ADR-0051 is now complete for every entity except CPV** (bespoke master-detail accordion, intentionally
left). Remaining DEFERRED (documented): CPV inline-grid; DataGrid `role=menu` arrow-roving (P3);
Cases/Policies/ReportLayouts/FieldMonitoring additive backend export+filter endpoints (IE-DEFER-3/5/8, H-C2).

## Section RT-RM — Retire the Report Templates module (2026-06-25, ADR-0063)

### RT-RM-1 · Report Templates (`/admin/templates`, `report_templates` mig 0008) is dead/superseded — ✅ FIXED (removed)
- **Severity:** MEDIUM (dead-code / misleading authoring surface; no security impact)
- **Finding (owner-asked read-only investigation, 6 disjoint agents incl. an adversarial reader-hunt):**
  `report_templates` was the type-only (FIELD_NARRATIVE/KYC_DOCUMENT) authoring surface for a render
  engine that was instead built on `report_layouts` (ADR-0037 MIS → ADR-0039 FIELD_REPORT → ADR-0041
  CASE_REPORT → ADR-0049 MIS gen). At HEAD **nothing reads `report_templates`** — the render engines
  (`fieldReports`/`caseReports`/`mis`/`caseDataEntries`) read only `report_layouts`/`report_layout_columns`;
  `reportTemplates/repository.ts hasDependents()` returned `false`. An admin authoring a template changed
  nothing → an inert, misleading screen. It is a **pre-freeze** module (mig 0008 shipped 2026-06-04, one
  day before the ADR-0015 reporting freeze).
- **Decision (owner 2026-06-25):** REMOVE via superseding **ADR-0063**.
- **Fix applied (this branch):** dropped the `report_templates` table (**mig 0091**, re-run-safe
  `DROP TABLE IF EXISTS … CASCADE` — verified by a double full-migration pass + `migrations.rerun.test.ts`);
  removed the api module (`/api/v2/report-templates`), SDK client+contracts, web pages + 3 routes + nav
  entry, the `page.templates` (`TEMPLATE_VIEW`) permission + its meta, the system-health `reportTemplates`
  count, the e2e seed row + `templates.spec.ts`, and the `/admin/templates` references in a11y/datagrid/
  viewport e2e route lists. OpenAPI regenerated (249 paths, 0 report-templates).
- **Preserved (MIS Layout designer unaffected — the owner's explicit constraint):** `report_template.manage`
  (`TEMPLATE_MANAGE`) — the RBAC + nav-visibility anchor for the `reportLayouts` designer (key kept for
  live `role_permissions` compatibility; only its display label changed to "MIS Layouts — Manage"); and
  `REPORT_TEMPLATE_TYPES` + `verification_units.report_template_type` (the VU registry's own enum, not an FK).
- **`/api/v2` narrowing note:** removing `/api/v2/report-templates` + the admin-only `counts.reportTemplates`
  field is non-additive but consumer-safe — only the admin web pages (updated in lockstep) consumed them;
  **the mobile `/api/v2` surface is not touched at all** (no mobile route/role references report_templates).
- **Reconciles:** the stale "extends/superseded by `report_templates` 0008" text on **B-16 / B-18 / B-19**
  (the engine was built on `report_layouts`, not by extending 0008).
- **Date:** 2026-06-25
- **Evidence:** ADR-0063; mig `0091`; full `pnpm verify` green on an isolated `:5433` DB (incl. the
  MIS-Layout proof: `reportLayouts.api.test.ts` 14 + `reportLayouts.test.ts` 29); Playwright e2e 151
  passed (incl. "MIS Layouts is responsive" + `reportLayouts.spec`); browser-verified (sidebar has no
  Templates / has MIS Layouts; `/admin/report-layouts` works; `/admin/templates` no longer renders the
  Templates UI; `GET /api/v2/report-templates` → 404). Branch `feat/remove-report-templates` (NOT pushed —
  owner-gated; push→main auto-deploys).

## Section SCOPE-RBAC — RBAC + data-scope audit (2026-06-25)

Owner-asked read-only audit of the complete RBAC/scope system (6 disjoint agents + an adversarial verify
+ completeness critic), triggered by "BACKEND_USER cannot create a case/task for their assigned client+
product." Route×permission coverage came back solid (286 routes, 237 permission-gated, rest documented
identity-scoped/public; only a dead `BILLING_GENERATE` perm). Reads are clean (no IDOR). The real defects
were a write-side scope cluster + a role-grant gap. All 7 dimensions are genuinely wired (the
"assignable-but-inert" hypothesis was disproven).

| id | sev | finding | disposition |
|----|-----|---------|-------------|
| SR-1 | HIGH | `POST /cases` accepted any caller-supplied client/product (FK-only, no scope) — cross-tenant create | ✅ **FIXED** (ADR-0065, `888666c`) — `assertClientProductInScope` → 400 |
| SR-2 | HIGH | `addTasks` mutated a case without a scope check (bare `clientProductOf`) | ✅ **FIXED** (ADR-0065) — `caseVisible` gate → 404 |
| SR-3 | HIGH | `addApplicant` mutated a case without a scope check | ✅ **FIXED** (ADR-0065) — `caseVisible` gate → 404 |
| SR-4 | HIGH | BACKEND_USER (+ TEAM_LEADER) lacked `case.create` → the reported bug (403 + FE hides controls) | ✅ **FIXED** (ADR-0065, mig 0095) — granted to both; FE surfaces by perm |
| SR-5 | MED | `GET /cases/available-units` un-scoped (enumerates any client's CPV catalog) | ✅ **FIXED** (ADR-0065) — portfolio guard |
| SR-6 | MED | `GET /cases/rate-preview` un-scoped (leaks rate metadata) | ✅ **FIXED** (ADR-0065) — portfolio guard |
| SR-7 | MED | TEAM_LEADER could not create cases (intent gap) | ✅ **FIXED** (owner 2026-06-25: TLs may create) — granted (ADR-0065, mig 0095) |
| SR-8 | MED | VERIFICATION_TYPE in RESTRICT mode under-filters at CASE grain (admits the whole case if any one task matches; doesn't hide sibling tasks) | ✅ **FIXED** (ADR-0072, mig 0099) — the VERIFICATION_TYPE dimension is removed from the scope catalog (it was wired to no role); the under-filtering footgun no longer exists. |
| SR-9 | LOW | `BILLING_GENERATE` permission is granted to MANAGER but enforced by no route (dead) | 🟡 **DEFERRED** — harmless; remove or implement when the billing-generate endpoint is built. |
| SR-10 | LOW | STATE/CITY/VERIFICATION_TYPE dimensions are selectable but wired to no system role (functional, untested in prod) | ✅ **FIXED** (ADR-0072, mig 0099) — the three unwired dimensions are removed from the scope catalog (deactivated, zero access change); the surface is now exactly the wired CLIENT/PRODUCT + PINCODE/AREA. |
| SR-11 | LOW | Web has no per-route permission guard + some write controls render without a `useAuth().has()` wrap | 🟡 **DEFERRED** — all are backend-gated (`authorize`), so cosmetic/info-leak, not privilege escalation. |
| SR-12 | LOW | `caseDataEntries` repo methods carry no scope predicate (safe today via the service gate) | 🟡 **DEFERRED** — defense-in-depth; push the predicate into the repo or assert the service-gate invariant. |

Owner picked (AskUserQuestion): fix the HIGH cluster SR-1..6 + grant TEAM_LEADER (SR-7) + build the navbar
selector; the MED/LOW items SR-8..12 were not selected → DEFERRED above (flagged, not dropped). Built on
branch `feat/rbac-scope-cluster` (`888666c` cluster + `9238a3c` navbar), full `pnpm verify` + e2e 152 green,
browser-verified. ADR-0065 (case-create grant + write scope) + ADR-0066 (navbar selector). NOT pushed —
owner-gated; push→main auto-deploys.

## Section RTA-0067 — Rate-Type Assignment (ADR-0067, Phase B) review dispositions (2026-06-25)

3-agent adversarial review (Security · Architecture+DB · Design+Spec) of the per-combination assignment
layer — all three returned **PASS**. Built on branch `feat/rate-type-assignment` (off origin/main
`b2cdcf7`); full `pnpm verify` (api 987) + Playwright e2e 157 green; browser-verified persist on `crm2_dev`.
**SHIPPED + LIVE on prod 2026-06-25** (origin/main `0f9be26`, deploy `28175316817` + ci green; mig 0093 applied, routes 401-live).

| id | sev | finding | disposition |
|----|-----|---------|-------------|
| RTA-1 | LOW | `BulkSetRateTypeAssignmentsSchema.rateTypeIds` had no `.max()` length cap nor element `.max(MAX_PG_INT)` (sole outlier vs the sibling array schemas) — mild authed-admin DoS / unclean 400 on a huge id | ✅ **FIXED** — `z.array(posInt.max(MAX_PG_INT)).max(MAX_BATCH)` (no `.min` — empty array clears the combo) + a cap test |
| RTA-2 | INFO | `listForCombo` (admin list) shows assignments whose rate type is itself deactivated; the resolver `available` correctly excludes them | ⚪ **WONTFIX (by design)** — the admin must see a stale assignment to clear it; the consumer path (`available`) is safe |
| RTA-3 | LOW | RBAC self-guard sits after the hooks + `<Navigate to="/">` (sibling record pages guard before their hooks → list page) | ⚪ **WONTFIX** — rules-of-hooks-clean (no `:id` to fetch first), functionally equivalent; reviewer said not required |
| RTA-4 | LOW | "Saved." confirmation lives in the remounting `MatrixEditor` → lost on a set-changing save (shown only on no-op re-saves) | 🟡 **DEFERRED** — cosmetic; persistence itself is correct + visible via the checkboxes |
| RTA-5 | INFO | `posIntParam` shared via a `rateTypes/service` import (boundaries-legal); the per-id INSERT loop is N+1 (bounded to a checkbox set) | ⚪ **WONTFIX** — acceptable; promote `posIntParam` to `platform/` if a 3rd consumer appears |

Next: Phase C (ADR-0068, mig 0094) = FK conversion (`rate_type_id` onto rates/commission_rates/case_tasks) + picker wiring.

## Section RTA-C — Rate-Type FK conversion (ADR-0068, Phase C) dispositions (2026-06-25)

Phase C FK-converts the 3 rate-type columns to `rate_type_id` (mig 0094) + DROPs the old string columns;
resolution byte-identical; contracts keep emitting code strings (mobile/SDK unaffected). Built on branch
`feat/rate-type-fk-conversion` (off origin/main `9ca1832`); full `pnpm verify` GREEN (api **987**, money path
SAME amounts; sdk 230; the **3× `migrations.rerun.test`** proves re-run safety) + Playwright **e2e 157**;
mig 0094 applied to `crm2_dev` (backfill confirmed). NOT pushed (owner-gated).

| id | sev | finding | disposition |
|----|-----|---------|-------------|
| RTC-1 | **HIGH** | **Latent prod data-loss bug** (pre-existing, Phase A/B): `0013` re-runs every deploy and unconditionally `DROP COLUMN rates.rate_type_id` (line 41) + `DROP TABLE rate_types CASCADE` (line 49) → wiped the managed catalog (id-reset + admin edits) + CASCADE-wiped `rate_type_assignments` every deploy. Latent only because prod had no persisted catalog edits/assignments yet; Phase C's FK would make it FATAL (dangling/reset FK ids). | ✅ **FIXED** — guarded 0013's catalog DROP on `rate_types.category` (managed-catalog marker), the `rate_type_id` drop on the transient `rates.rate_type`, the `client_rate_type` block on `category`; +0011/0058/0079/0084 guarded on `NOT EXISTS rate_type_id`; +0014 seeds `name` (the now-persistent table has `name NOT NULL`). Proven by the 3× re-run test (FKs/ids/assignments survive). |
| RTC-2 | LOW | `commissionRates/import.ts` enum-validated bulk-import `fieldRateType` against `COMMISSION_RATE_TYPES` while single-create now accepts any catalog code → import rejected admin-defined codes (LOCAL1/OUTSTATION2) the create API + DB accept | ✅ **FIXED 2026-06-25** (owner fast-follow) — relaxed the import row validator to `z.string().trim().min(1).max(40).transform(toUpper)` (mirrors `CreateCommissionRateSchema`); import now accepts any active catalog code (resolves code→id; unknown → NULL id, same as single-create — **money-SAFE**: NULL never matches `COMMISSION_LATERAL` → ₹0, no over-pay). Test added (a `local1` row imports + round-trips as `LOCAL1`). **OPTIONAL remaining** (owner-optional, NOT done): a hard 400 `UNKNOWN_RATE_TYPE` catalog-existence check in `commissionRateService.create` (covers both paths) — silent-NULL is consistent + money-safe today, so left as a data-quality hardening choice. |
| RTC-3 | INFO | Post-conversion, a NEW rate/commission created via the raw API with a free-text code loses the label (→ NULL id), unlike pre-conversion verbatim-string storage; 0094 auto-promote only rescued rows existing at migration time | ⚪ **WONTFIX (intended)** — the FK design retires free-text rate labels; the catalog is now the only label source and the pickers enforce catalog codes. |

**Adversarial review (Principal+DB+Security, migration re-run + money-path equivalence) — ✅ PASS** (2026-06-25): "migration re-run safety CORRECT and COMPLETE" (every guard traced — fresh-DB pass-1 + post-conversion re-run both correct, no migration missed [0036/0083 safe as-is]) + "money-path resolution IDENTICAL" (both LATERALs, derive, writes, history equivalent; KYC-null + OFFICE-id preserved). All findings LOW/INFO + money-safe → RTC-2 deferred fast-follow, RTC-3 wontfix. **"Nothing blocks the push."**

## Section X-CHECK-2026-06-23 — Compliance-gaps cross-check & close-out

Read-only multi-agent cross-check of EVERY open/DEFERRED/RATCHET/🔴 finding against live code at HEAD
`1b8c547`, then an owner-approved build of the closeable subset (branch
`worktree-compliance-gaps-crosscheck`). Method: 7 read-only verifier agents (disjoint registry sections)
→ triage A/B/C/D → owner sign-off on scope + the 3 product decisions → build. Every finding carries a
disposition below; none dropped.

### Already FIXED by parallel sessions — registry was STALE (verified at HEAD, no build)
- **AUDIT-1 / AUDIT-2 / AUDIT-4 → ✅ FIXED (ADR-0057, `098f409`/`836fed3`, in HEAD).** The FIELD_REPORT
  outcome code→label + split-period recombination shim `apps/api/src/modules/fieldReports/canonicalize.ts`
  is wired in `service.ts` before `renderNarrative`; `canonicalize.render.test.ts` (29 device-blob tests +
  a RED regression proving raw CODE → empty body) closes the test-debt (AUDIT-4). The "🔴 owner-decision-
  pending" framing was pre-fix; the owner chose option-3 (preserve the 8-way labels, derive on the backend)
  and it shipped + deployed 2026-06-22.
- **AUDIT-3 → ✅ RESOLVED (no live drift).** Re-verified `packages/sdk/src/fieldReportDefaults.ts` +
  canonicalize: `applicantStayingFloor`/`addressFloor` both present (no drift), `callConfirmation` present
  for BUILDER+NOC, `finalStatusNegative` handled in canonicalize, no `businessExistance` misspelling. (A
  final exact-mobile-form confirm remains a mobile-repo check, but the crm2 templates are correct.)
- **G-8 → ✅ FIXED (ADR-0048, `87f5f88`).** `RATE_LATERAL` (and the `cases/repository.ts` rate_type mirror)
  use the single `CASE` rank (match > location-less > non-matching), NOT the FALSE>NULL `DESC NULLS LAST`
  ladder. The superseding ADR §G-8 said was needed was written + shipped; §G-8 above is now stale.
- **B-7 → ✅ FIXED.** Background-job UX is live: `apps/web/src/components/JobsTray.tsx` (determinate
  HexagonLoader %, download on SUCCEEDED, error/cap display) + realtime `useJobs`.
- **B-19 → ✅ FIXED.** Admin Template Designer = `apps/web/src/features/reportLayouts/ReportLayoutRecordPage.tsx`
  (per-client+product, kind-branched designer; ADR-0037 + the ADR-0051 D4 record-page conversion).
- **ADR-0047 two-stage handoff → ✅ DONE.** Commission snapshot is stamped at the SUBMIT transition
  (`submitTaskByDevice` → `stampCommissionSnapshot`; mig 0081 `submitted_at`/`submitted_elapsed_minutes`;
  the billing read-model gate includes SUBMITTED).
- **C-9 → ✅ effectively COMPLETE.** `apps/web/e2e/viewport.spec.ts` (4 bands) + `.rtable`/`data-label`
  table→card + the axe gate 29 are all live across the app (the F-3 "next-wave" items all landed).

### Owner decisions (2026-06-23) on the confirmed-bug / mismatch findings
- **SHIP-1 → FIX (owner: yes).** Restrict pipeline bulk-assign to PENDING-only so a live ASSIGNED task can
  only move off an agent via Revoke-with-reason (ADR-0055 consistency). [owner-approved; building this session]
- **SHIP-2 → REMOVE the bill_count input (owner: every task ×1).** Drop the bill_count field from the inline
  Assign + Pipeline bulk-assign forms; create never collected it. The `case_tasks.bill_count` column +
  billing `× bill_count` math stay (always 1; full retirement is a later cleanup). [owner-approved; building this session]
- **IE-DEFER-7 → 🟢 WONTFIX (owner: keep export analysis-only).** The commission-rate export stays a
  read-for-analysis file; bulk-load uses the code/pincode-keyed import template. Already documented in-code.
- **BILLING SCOPE → 🟢 WONTFIX (owner 2026-06-25): CRM2 never invoices/GST/pays.** Billing & commission
  are **export-only** — the shipped `/billing` read-model (`/cases`·`/cases/:id/tasks`·`/breakdown`·
  `/export`) + the MIS export ARE the final deliverable. Invoice generation + GST live externally (Tally);
  commission is **exported and paid outside the CRM**. So ADR-0036 §4–5's `invoice + GST + PDF` and the
  `commission payout run (PENDING→APPROVED→PAID)` are **removed from the backlog (NOT a gap)** — see
  ADR-0036 §4, `OPEN_ITEMS_2026-06-17` billing row, and the slice-5 plan banner. Optional-only leftovers:
  billed-marker + double-bill guard + a case-detail financial-summary card.

### Approved for build this session (small additive, IMPORT_EXPORT_STANDARD pattern)
**IE-DEFER-5** Policies list export · **IE-DEFER-8** Report Layouts list export · **IE-DEFER-2** CPV
unit-enablement leg import/export · **IE-DEFER-3c / H-B3** Cases list export · **IE-DEFER-6** scope-export
round-trip (emit codes) · **R0050-6** design nit (`text-border`→`text-muted-foreground`). Each = additive
route + manifest + SDK `.export()` + web `exportFn`, **gated by the list's read perm** (export never wider
than read — IE-1..4 rule: Policies=`POLICY_VIEW`, ReportLayouts=`TEMPLATE_MANAGE`, Cases=`DATA_EXPORT`,
CPV-units=`DATA_EXPORT`/import=`MASTERDATA_MANAGE`), OpenAPI regen + contract test, full `pnpm verify`.
Each flips to FIXED in its own log line as it lands.

### Confirmed DEFERRED at HEAD (big ops-phase / product / ratchet — NOT auto-built; owner-flagged)
- **Operations features:** B-13 (cases PDF/≥10k job tier — note PDF/DOCX/XLSX rendering already exists via
  `platform/pdf` + `caseReports`; the gap is the cases-list export [closed via IE-DEFER-3c] + the ≥10k async
  tier) · B-14 universal import-engine (blocks ADR-0059) · IE-DEFER-3a case-creation bulk import (ADR-0059
  Proposed) · IE-DEFER-4 MIS/Billing/Field-Monitoring ≥10k async export builders · B-16 report templating
  (Handlebars + CPV-scoped overrides; rendering done) · B-18 unified per-client+product reporting engine
  (MIS + CASE_REPORT exist independently) · B-17 Verification Workspace (keystone, not started).
- **C-10 → mostly DONE:** `cases.version` (mig 0052) + `case_tasks.version` (mig 0036) exist; finalize/
  assign/complete/recordResult are OCC-guarded. Residual = general non-finalize case mutations unguarded
  (cases are largely immutable post-create) → low-risk DEFERRED.
- **Ops/product follow-ups:** SHIP-3 (stranded location-less PENDING — needs a prod `count(*)`), R0050-4
  (₹0-silent indicator), R0050-5 (office relay export/state), R0056-5 (pre-seed commissions), R0056-1
  residual (cross-specificity derive vs lateral `tat_band` — intentional, latent).
- **Standing/by-design:** G-5 currency RATCHET, H-9-CPV (deferred by design), H-10 DataGrid menu arrow-roving
  (P3, risk on the shared grid), E-1..E-4 coverage ratchets (ratchet up only when coverage rises).

### Mobile repo (`crm-mobile-native`, SEPARATE) — flagged for a mobile session, NOT built here
- **R0054-6** cross-user wipe = two drifting hardcoded lists (`StorageService.clearAllData` vs
  `MaintenanceRepository.CLEARABLE_TABLES`) — the critical partial-wipe bug is fixed (`88c6114`); hoisting to
  a shared constant + a subset assertion remains. **R0054-7** wipe is non-transactional + swallows failure.
  Both verified still-open in the mobile repo; they need the mobile build/device-verify workflow.

---
*Governance ledger. Update — never overwrite — as findings change state. Linked from
`CRM2_MASTER_MEMORY.md`, `PROJECT_INDEX.md`, `docs/ARCHITECTURE_GOVERNANCE.md`,
`FREEZE_LOCK_REPORT.md`.*

---

## Section AUDIT-2026-06-23 — Mobile Verification Round-Trip Audit

> Merged into this registry 2026-06-24 (audit close-out). Source of truth: `docs/audit-2026-06-23/findings.json` (153 raw confirmed findings, 12 tracks) + `README.md` (80-row deduped table). One line per **deduped** finding (`A2026-0623-NN`), each ended **FIXED / DEFERRED / RATCHET / WONTFIX**. Default for anything not yet fixed = **DEFER(RED)** with a one-line rationale. Severity/hop in brackets; affected track(s) in parens; `src:` lists the raw finding ids + lens (C=CEO, T=CTO, D=Designer, S=Security).
>
> **UPDATE 2026-06-24 (supersedes the original "audit-only / none applied" framing):** the crm2-side findings were **fixed + shipped to prod** this day — report-render cluster (mig 0088) + `A2026-0623-05/06/07/09/10/16/17` ✅ FIXED and `04` split (KYC ✅ FIXED, FIELD WONTFIX/by-design), via **[ADR-0061]**(adr/ADR-0061-kyc-scoped-by-assignment-not-territory.md) + **[ADR-0062]**(adr/ADR-0062-verification-routing-and-evidence-integrity.md) and migrations `0088`/`0089`/`0090`. **See each finding's own line for its current ✅ FIXED / WONTFIX disposition — the per-finding lines are the source of truth.** Remaining **open = the mobile repo only** (`A2026-0623-02` outcome-sync, `A2026-0623-11` masked revoke — `crm-mobile-native`, separate gate, owner-release-gated). **UPDATE 2026-06-25:** both mobile findings `A2026-0623-02` + `A2026-0623-11` are now ✅ **FIXED** on the `crm-mobile-native` branch `feat/v2-native-sync` (TDD, full mobile gate green — typecheck + eslint + 7 contract tests; real Metro bundle verified) — **committed branch-only, NOT released** (ADR-0054 owner-release-gated: needs a signed build + staged canary). **All 80 §AUDIT-2026-06-23 findings are now dispositioned; the whole audit campaign is closed pending the owner's mobile release.**

**Disposition rollup (ORIGINAL audit-time snapshot — superseded by the 2026-06-24 update above + the per-finding lines):** FIX 33 · DEFER 35 · RATCHET 1 · WONTFIX 11 (of 80 deduped). Cross-references: **A2026-0623-** entry `10` (bulkAssign) ≈ registry **SHIP-1**; `01`/`02` partially overlap stale registry **AUDIT-1/2/3** (re-disposition those FIXED/open per `RESI-F4`).

- **A2026-0623-01** [HIGH/report] (BUILDER,BUSINESS,DSA_CONNECTOR,NOC,OFFICE,RESIDENCE,RESIDENCE_CUM_OFFICE) — Raw report SECTIONS view never recombines split tenure (<base>Value/Unit) → named period rows empty, value+unit dumped to 'Additional Detai… _(src: BUILDER/BUILDER-1(C); BUILDER/BUILDER-UX-1(D); BUILDER/CEO-BUILDER-1(C); BUSINESS/BIZ-2(C); BUSINESS/BIZ-F2(C); BUSINESS/BIZ-UX-2(D); DSA_CONNECTOR/DSA-CEO-1(C); DSA_CONNECTOR/DSA-UX-1(D); NOC/NOC-F1(C); NOC/NOC-UX-2(D); OFFICE/OFFICE-1(C); OFFICE/OFFICE-UX-1(D); RESIDENCE/RES-CEO-2(C); RESIDENCE/RESI-F2(C); RESIDENCE/RESI-UX-1(D); RESIDENCE_CUM_OFFICE/RCO-CEO-1(C); RESIDENCE_CUM_OFFICE/RCO-UX-1(D))_ → **FIX** — Single root cause in apps/api/.../fieldReports/{service.ts:28 buildSections raw, sections.ts:117 no recombine, canonicalize.ts:107-113 narrative-only}. Lift PERIOD_BASES recombine into buildSections.
- **A2026-0623-02** [HIGH/down-sync] (BUILDER,CROSSCUT,OFFICE,PROPERTY_INDIVIDUAL) — Server-driven outcome set/label/order sync is permanently inert on ALL 9 field types — mobile setOutcomesFromSync keys on SHORT codes (RV/O… _(src: BUILDER/BUILDER-2(C); BUILDER/CEO-BUILDER-2(C); CROSSCUT/CC-1(C); CROSSCUT/CROSSCUT-CEO-1(C); CROSSCUT/UX-CROSSCUT-1(D); OFFICE/OFFICE-2(C); PROPERTY_INDIVIDUAL/PI-UX-1(D))_ → ✅ **FIXED (2026-06-25, mobile branch `feat/v2-native-sync`, owner-release-gated)** — `LegacyFormTemplateBuilders.ts` `setOutcomesFromSync` now resolves `r.verificationTypeCode` via `resolveFormTypeKey` (formTypeKey.ts — maps the LONG codes RESIDENCE…PROPERTY_APF + name fallbacks for all 9 types); the dead SHORT-code map `FORM_TYPE_KEY_BY_VTYPE_CODE` (was :154-164) is deleted. Confirmed the v2 reference feed (crm2 mig 0069) only ever emits long codes — it was deliberately re-keyed off the v1 short codes — so removing the short map loses nothing. TDD: `setOutcomesFromSync.contract.test.ts` (3 checks: all 9 long codes populate synced label; APF picker driven by feed, sorted, no phantom NEGATIVE — closes the DEDUP-05/A2026-0623-07 enabler once sync drives the picker; unknown code skipped). Branch only — NOT released.
- **A2026-0623-03** [HIGH/report] (BUSINESS) — BUSINESS 'Approx Area' empty in BOTH section + narrative — device emits `officeApproxArea`, report reads `approxArea` (masked by a wrong-ke… _(src: BUSINESS/BIZ-1(C); BUSINESS/BIZ-F1(C); BUSINESS/BIZ-UX-1(D))_ → **FIX** — BUSINESS-only crossed ref vs office/builder/dsa which read officeApproxArea correctly. Fix sectionMap.ts:238 + fieldReportDefaults.ts:503.
- **A2026-0623-04** [HIGH/report] (BUSINESS) — FIELD_AGENT/KYC EXPAND (PINCODE/AREA) broadens case.view to other agents' case PII — case-view path lacks the assigned_to=self hard filter that… _(src: BUSINESS/SEC-BUS-1(S))_ → **SPLIT (owner-decided 2026-06-24).** Re-verified REAL (Explore agent): the cases case-view predicate (`cases/repository.ts caseScopePredicate`) ORs the EXPAND territory legs, so a user assigned a pincode/area sees other agents' cases (full PII) there. **FIELD_AGENT half → ✅ WONTFIX / by-design:** mig `0031` deliberately added `cases.pincode_id/area_id` so a field agent "sees cases in their assigned pincodes/areas even when unassigned" — territory visibility is intended for ADDRESS verification (ADR-0022). **KYC_VERIFIER half → ✅ FIXED (ADR-0061, mig `0089`):** KYC verifies DOCUMENTS at a desk (OFFICE pool = territory-less, ADR-0024), so its PINCODE/AREA wiring (`0034_scope_dimensions.sql:62-63`) never fit and leaked case PII by geography. Mig 0089 removes the two KYC EXPAND rows → KYC falls back to assignment/hierarchy (SELF) visibility; `resolveScope` intersects assignments with active wiring so existing KYC pincode assignments go inert, and the scope-assignment API now rejects new ones (`DIMENSION_NOT_ALLOWED_FOR_ROLE`). TDD: scope.test.ts. Distinct from A2026-0623-09 (per-task fieldReports route, separately fixed).
- **A2026-0623-05** [HIGH/report] (KYC) — No binding between verification unit kind/worker_role and operator-chosen visitType at create OR assign -> a KYC_DOCUMENT unit can be route… _(src: KYC/KYC-1(C))_ → ✅ **FIXED (2026-06-24, owner: strict binding — kind decides visit type)** — re-verified REAL (Explore agent). The chain kind→worker_role→pool is 1:1 (DB CHECK `0001` + `assignment_pool_roles` `0039`); new SDK `visitTypeForKind(kind)` (FIELD_VISIT⇒FIELD, else OFFICE) is enforced server-side at **create** (`cases/service.addTasks` via `repo.unitKindByIds`), **single-assign** (`cases/service.assignTask` via `repo.taskUnitKind`), and **bulk-assign** (`tasks/service.bulkAssign` via `tasksForAssignment.unitKind` → per-row `NOT_ASSIGNABLE`); a mismatch is 400 `VISIT_TYPE_UNIT_MISMATCH`. TDD: cases.api.test.ts (create+assign, both directions) + sdk verificationUnit.test.ts. Test fallout (the suite encoded the decoupling — ~13 desk-finalize tests assigned a FIELD_VISIT unit OFFICE): reworked to KYC units + document evidence (parameterized seed helpers + `attachDoc`; shared `driveToAwaitingCompletion`/`settle` doc the desk task) across cases/billing/dashboard suites. Full `pnpm verify` GREEN. **Recorded in [ADR-0062](adr/ADR-0062-verification-routing-and-evidence-integrity.md)** (with A2026-0623-16/17/07).
- **A2026-0623-06** [HIGH/cross-cutting] (KYC) — IDOR: case-level KYC documents (PAN/Aadhaar/passport, pii_sensitive) are served and deletable cross-scope via the attachment URL/delete rou… _(src: KYC/SEC-KYC-1(S))_ → ✅ **FIXED (2026-06-24)** — re-verified REAL (read-only Explore agent): `attachmentForAccess`'s task-leg is satisfied by `ca.task_id IS NULL` alone, so a case-level doc bypassed all scope. `cases/service.ts` `attachmentUrl` + `deleteAttachment` now call `repo.caseVisible(caseId, scope)` first (CASE-invisible ≡ `ATTACHMENT_NOT_FOUND`, IDOR-safe), mirroring `listAttachments`/`listFieldPhotos`. TDD: new `cases.api.test.ts` IDOR test (out-of-scope KYC_VERIFIER `/url` 404 + out-of-scope MANAGER DELETE 404 + doc survives).
- **A2026-0623-07** [HIGH/cross-cutting] (PROPERTY_APF) — PROPERTY_APF NEGATIVE is offered as a top-level field outcome (server catalog → device picker) but has no APF form and no canonicalize/narr… _(src: PROPERTY_APF/APF-1(C); PROPERTY_APF/APF-3(C); PROPERTY_APF/APF-UX-1(D))_ → ✅ **FIXED (2026-06-24, owner: keep v1 routing + align server catalog)** — re-verified (2 Explore agents incl. v1): the finding was OVER-STATED on the backend (canonicalize.ts:60-62 + APF_BODY fieldReportDefaults.ts:1104 already render the negative VERDICT). v1 has NO separate APF NEGATIVE form — it routes negative via `constructionActivity` (SEEN→positive, STOP/VACANT→negative) inside the one form, and the current mobile app already matches this. The only real (latent) defect: the reference feed (mig 0069) advertised a phantom `NEGATIVE` APF outcome with no device form (would surface once the outcome-sync A2026-0623-02 is fixed). **Mig 0090** drops PROPERTY_APF NEGATIVE from `verification_unit_outcomes` (re-numbered) so the feed = `[POSITIVE, ENTRY_RESTRICTED, UNTRACEABLE]`, matching the device + v1. No mobile change; backend still renders a negative verdict from `finalStatus`. TDD: reference.api.test.ts (43→42 rows; APF set).
- **A2026-0623-08** [HIGH/report] (RESIDENCE,RESIDENCE_CUM_OFFICE) — RESIDENCE/RCO narrative+sectionMap read `applicantStayingFloor` but device emits `addressFloor` → floor clause empty / renders '0th floor' … _(src: RESIDENCE/RES-CEO-1(C); RESIDENCE/RESI-F1(C); RESIDENCE/RESI-F3(C); RESIDENCE/RESI-UX-4(D); RESIDENCE_CUM_OFFICE/RCO-1(C); RESIDENCE_CUM_OFFICE/RCO-UX-2(D))_ → **FIX** — Report side reads applicantStayingFloor; v2 device emits addressFloor (fieldReportDefaults.ts:128/700, sectionMap.ts:50/323). RESIDENCE is LIVE (active layout); RCO latent. Same fix family as registry AUDIT-3.
- **A2026-0623-09** [HIGH/report] (RESIDENCE_CUM_OFFICE) — FIELD_REPORT route is case-grain scoped, not task-grain — a field agent reads a sibling task's full PII form_data (cross-agent IDOR) _(src: RESIDENCE_CUM_OFFICE/SEC-1(S))_ → ✅ **FIXED (2026-06-24)** — re-verified REAL (NOT covered by the refuted SEC-PI-2/A2026-0623-76, which only examined the attachment routes; the fieldReports route is separate). `fieldReports/repository.ts` predicate changed from case-grain (`EXISTS any task in the case assigned to me`) to **task-grain** (`cs.created_by = ANY OR ct.assigned_to = ANY`, where `ct` is the requested task) — renamed `caseScopePredicate`→`taskScopePredicate`. ALL-scope desk/admin unaffected (empty pred); case creator + the task's own assignee/hierarchy retain access; a co-assigned sibling FIELD_AGENT now gets 404. TDD: new `fieldReports.api.test.ts` task-grain test.
- **A2026-0623-10** [HIGH/cross-cutting] (REVOKE) — bulkAssign re-points a LIVE ASSIGNED task in place with no revoke + no mandatory reason (ADR-0055 invariant bypass; assignTask UPDATE guard… _(src: REVOKE/REVOKE-1(C); REVOKE/REVOKE-2(C); REVOKE/SEC-REVOKE-2(S); REVOKE/UX-REVOKE-6(D))_ → ✅ **FIXED (2026-06-24)** — `tasks/service.ts` bulk guard now `status !== 'PENDING'` (was `!== 'PENDING' && !== 'ASSIGNED'`), so a live ASSIGNED row returns `NOT_ASSIGNABLE` and never reaches `caseRepository.assignTask`; mirrors single-assign. = registry **SHIP-1** (see Section SHIP). TDD test in `tasks.api.test.ts`. REVOKE-1(CEO) is bulkAssign; REVOKE-1(CTO) is the SEPARATE masked-revoke (DEDUP-10, A2026-0623-11, still open).
- **A2026-0623-11** [HIGH/down-sync] (REVOKE) — Mobile down-sync masks a server REVOKED status when local has queued/fresher edits (is_revoked=1 but status=IN_PROGRESS) → justRevoked PII-… _(src: REVOKE/REVOKE-1(C); REVOKE/SEC-REVOKE-1(S))_ → ✅ **FIXED (2026-06-25, mobile branch `feat/v2-native-sync`, owner-release-gated)** — extracted the pure status merge to `resolveTaskState.ts` with a revoked short-circuit at the top: whenever the backend status is REVOKED OR the server `isRevoked` flag is set, the task resolves to REVOKED with the device-only saved state cleared, BEFORE the queued-changes/fresher-edits branches that masked it (SyncConflictResolver now delegates). The PII wipe was extracted to `revokeWipe.ts` (`isJustRevoked` + `purgeRevokedTaskPii`); `SyncDownloadService` gates the wipe on the SERVER revoked signal (`task.isRevoked === true || mergedState.status === 'REVOKED'`), idempotent once REVOKED — so the is_revoked column and the wipe can't diverge and photos+form drafts are always purged. TDD: `resolveTaskState.contract.test.ts` (5 checks incl. revoke under queued/fresher edits + divergence guard + non-revoke regression) + `revokeWipe.contract.test.ts` (5 checks: isJustRevoked gating/idempotency + in-memory-sqlite purge of photos+drafts, returns unlink paths, FK-clean, sibling untouched). Note: this is the CTO REVOKE-1 (distinct from the CEO bulkAssign REVOKE-1 in DEDUP-08). Branch only — NOT released.
- **A2026-0623-12** [MEDIUM/up-sync] (BUILDER,CROSSCUT,PROPERTY_APF,RESIDENCE) — Field-photo upload idempotency-replay lookup is unscoped (global operation_id, no actor/case/task filter) → cross-user leak of victim's pho… _(src: BUILDER/SEC-BUILDER-1(S); CROSSCUT/SEC-CROSSCUT-1(S); PROPERTY_APF/SEC-APF-1(S); RESIDENCE/SEC-RES-1(S))_ → **FIX** — verification-tasks/service.ts:211-212 + cases/repository.ts:1571-1579 fieldAttachmentsByOperation; scope the replay lookup to the actor/case/task. Severity HIGH per RES/BUILDER/APF, MEDIUM-LOW per CROSSCUT; reconciled to MEDIUM.
- **A2026-0623-13** [MEDIUM/up-sync] (BUSINESS,CROSSCUT,NOC,OFFICE,PROPERTY_APF,PROPERTY_INDIVIDUAL,RESIDENCE,RESIDENCE_CUM_OFFICE) — Attachment transit-tamper signal (hash_verified/client_sha256) is computed + stored but NEVER read/surfaced on any web/report/sync path — t… _(src: BUSINESS/SEC-BUS-2(S); CROSSCUT/SEC-CROSSCUT-2(S); NOC/SEC-NOC-1(S); OFFICE/SEC-OFFICE-1(S); PROPERTY_APF/SEC-APF-2(S); PROPERTY_INDIVIDUAL/SEC-PI-1(S); RESIDENCE/SEC-RES-2(S); RESIDENCE_CUM_OFFICE/SEC-2(S))_ → **DEFER** — Cross-cutting all 9 FIELD types. Surface a 'tamper-check failed' chip on Field Photos card/report. Severity mixed HIGH(OFFICE/PI-FIX)→LOW; reconciled MEDIUM, default DEFER (v1-parity, observability gap).
- **A2026-0623-14** [MEDIUM/report] (BUSINESS) — addressLocatable (4 of 5 outcomes) and addressStatus (POSITIVE) are never placed in a named report section — they fall into Additional Deta… _(src: BUSINESS/BIZ-UX-3(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-15** [MEDIUM/report] (CROSSCUT) — property-individual report: the door field `flatStatus` is missing from sectionMap → renders in the trailing 'Additional Details' dump inst… _(src: CROSSCUT/UX-CROSSCUT-2(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-16** [MEDIUM/create] (KYC) — KYC required_attachments (>=1 DOCUMENT) is never enforced at completion -- a KYC verification can be finalized with zero document evidence _(src: KYC/KYC-2(C))_ → ✅ **FIXED (2026-06-24)** — re-verified REAL (Explore agent: required_attachments never read anywhere; completeTask checked only result/remark/status). `cases/service.ts completeTask` now calls new `repo.taskDocumentRequirement(taskId)` and rejects with 400 `DOCUMENTS_REQUIRED` when the unit's required_attachments DOCUMENT min isn't met by the task's non-deleted `OFFICE_REF` attachments. Naturally KYC-only: FIELD_VISIT units have required_attachments `[]` (requiredDocs 0 → never blocks a field submission). TDD: cases.api.test.ts.
- **A2026-0623-17** [MEDIUM/form] (KYC) — Web 'Field Report' card renders KYC desk tasks unfiltered under a FIELD-only header ('No field submission yet') -- KYC-vs-FIELD label drift _(src: KYC/KYC-3(C))_ → ✅ **FIXED (2026-06-24)** — re-verified REAL (Explore agent). Exposed `unitKind` on `CaseTaskView` (`TASK_VIEW_COLS` + SDK type), and the case-detail `MobileReportSection` now filters via new pure `fieldVisitTasks()` (unit-kind `FIELD_VISIT` only — assignment-independent, unlike visitType which is null pre-assignment); empty state reworded to 'No field tasks on this case'. Desk (KYC/DESK_DOCUMENT) tasks no longer appear under 'Field Report' (ADR-0039 defers KYC report-gen). TDD: web fieldReportTasks.test.ts; **live-browser-verified** on dev (seeded a PAN_CARD KYC task beside a RESIDENCE field task → Tasks table showed both, Field Report card showed only RESIDENCE).
- **A2026-0623-18** [MEDIUM/create] (KYC) — Add-Task Visit Type free pick, no KYC-must-be-OFFICE guard _(src: KYC/KYC-UX-2(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-19** [MEDIUM/report] (NOC) — NOC field report's two surfaces disagree on the outcome label: sections show raw uppercase CODE ('POSITIVE'), narrative shows v1 verbose la… _(src: NOC/NOC-1(C))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-20** [MEDIUM/report] (NOC) — NOC has NO usable narrative report path in production — no active FIELD_REPORT layout for NOC, so every NOC report renders 'No report templ… _(src: NOC/NOC-2(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-21** [MEDIUM/report] (NOC) — addressLocatable (required, all NOC outcomes) and businessExistance (NSP) absent from noc sectionMap → mis-grouped into 'Additional Details… _(src: NOC/NOC-UX-1(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-22** [MEDIUM/report] (PROPERTY_APF) — Report sectionMap omits addressLocatable, tpcConfirmation1/2 and finalStatusNegative -> they fall to 'Additional Details' with malformed au… _(src: PROPERTY_APF/APF-UX-2(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-23** [MEDIUM/report] (PROPERTY_INDIVIDUAL) — flatStatus (PI visit-status field) dropped from named report column + section — v1 parity regression, demoted to 'Additional Details' catch… _(src: PROPERTY_INDIVIDUAL/PI-1(C))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-24** [MEDIUM/report] (RESIDENCE_CUM_OFFICE) — RCO has no usable narrative report path on prod-dev — rich 8-branch RCO_BODY never reaches runtime (no seed/activation) _(src: RESIDENCE_CUM_OFFICE/RCO-CEO-2(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-25** [MEDIUM/form] (REVOKE) — Revoke reason is free-text end-to-end (no enum vs the 9 canonical revoke_reasons), stored raw in case_tasks.remark (un-joinable to revoke_r… _(src: REVOKE/REVOKE-2(C); REVOKE/REVOKE-3(C); REVOKE/SEC-REVOKE-3(S); REVOKE/UX-REVOKE-1(D))_ → **DEFER** — REVOKE-2(CEO) canonicalization loss + REVOKE-3(CEO/CTO) free-text + SEC-REVOKE-3 + UX-REVOKE-1. SEC-REVOKE-3 suggests FIX; reconciled DEFER (needs schema + dual-surface work).
- **A2026-0623-26** [LOW/report] (BUILDER,BUSINESS,DSA_CONNECTOR,NOC,RESIDENCE) — Raw 'Verification Outcome' section row shows the uppercase device CODE while the narrative shows the v1 verbose label, and the DB Title-cas… _(src: BUILDER/BUILDER-3(C); BUSINESS/BIZ-3(C); BUSINESS/BIZ-UX-4(D); DSA_CONNECTOR/DSA-F2(C); DSA_CONNECTOR/DSA-UX-4(D); NOC/NOC-F2(C); NOC/NOC-UX-3(D); RESIDENCE/RES-CEO-3(C); RESIDENCE/RESI-UX-3(D))_ → **DEFER** — Intentional per code comments (raw=as-captured, narrative=label) but a UX consistency wrinkle across all field types. Optionally show display_label or label the row 'Outcome Code'.
- **A2026-0623-27** [LOW/report] (BUILDER) — NSP BUILDER 'Business Existence' value is unmapped in the report and renders misspelled — drops into 'Additional Details' as 'Business Exis… _(src: BUILDER/BUILDER-UX-2(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-28** [LOW/report] (BUILDER) — ENTRY_RESTRICTED BUILDER: 'feedbackFromNeighbour' is mislabeled 'Neighbour Feedback' in the report though the agent answered a met-person q… _(src: BUILDER/BUILDER-UX-3(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-29** [LOW/report] (BUSINESS) — Two captured BUSINESS POSITIVE fields (addressStatus, addressLocatable) have no named-section or narrative home — always dumped to 'Additio… _(src: BUSINESS/BIZ-4(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-30** [LOW/report] (BUSINESS) — BUSINESS POSITIVE device fields `addressLocatable` + `addressStatus` (premises-held) are in NO business section and NO narrative column -> … _(src: BUSINESS/BIZ-F3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-31** [LOW/up-sync] (CROSSCUT) — verificationOutcome naming collision can leak an OFFICE KYC result into the FIELD outcome on a form-upload retry _(src: CROSSCUT/CC-2(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-32** [LOW/cross-cutting] (CROSSCUT) — verificationOutcome name collision across the boundary: down-sync top-level field carries the office KYC result but feeds the field form's … _(src: CROSSCUT/CROSSCUT-CEO-2(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-33** [LOW/form] (CROSSCUT) — Mobile pre-selects the form outcome from task.verificationOutcome (the OFFICE KYC result, not a field code) → a NEGATIVE office result sile… _(src: CROSSCUT/UX-CROSSCUT-3(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-34** [LOW/report] (DSA_CONNECTOR) — Two meaningful DSA device fields (addressLocatable, businessExistance) have no curated SECTION_MAP home and fall to 'Additional Details' _(src: DSA_CONNECTOR/DSA-CEO-3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-35** [LOW/up-sync] (DSA_CONNECTOR) — NSP DSA field 'businessExistance' (misspelled, required) is unmapped in sectionMap and the narrative template — drops out of named sections… _(src: DSA_CONNECTOR/DSA-F1(C))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-36** [LOW/report] (DSA_CONNECTOR) — NSP 'businessExistance' (misspelled field name) is unmapped in sectionMap → surfaces to the desk report as 'Business Existance' (typo on a … _(src: DSA_CONNECTOR/DSA-UX-2(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-37** [LOW/report] (DSA_CONNECTOR) — 'addressLocatable' (required in 4 of 5 DSA outcomes) is not in the dsa-connector sectionMap → always rendered in the 'Additional Details' c… _(src: DSA_CONNECTOR/DSA-UX-3(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-38** [LOW/create] (KYC) — REFUTED: Title-case result_set vs UPPERCASE completion enum is latent (display/admin-only, no completion-path consumer) _(src: KYC/KYC-4(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-39** [LOW/report] (KYC) — KYC desk task under Field Report header showing No field submission yet _(src: KYC/KYC-UX-1(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-40** [LOW/cross-cutting] (KYC) — result_set unwired to completion picker; KYC docs in generic attachments card _(src: KYC/KYC-UX-3(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-41** [LOW/up-sync] (KYC) — KYC reference documents are stored under the generic OFFICE_REF kind with no required-document / mime-binding to the unit, so a wrong or em… _(src: KYC/SEC-KYC-3(S))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-42** [LOW/report] (NOC) — addressLocatable — a REQUIRED NOC device field for POSITIVE/SHIFTED/NSP — is never surfaced in any named report section or the narrative (o… _(src: NOC/NOC-3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-43** [LOW/form] (NOC) — Hardcoded mobile fallback display labels for NOC SHIFTED/NSP contain doubled-word typos ('Shifted & Door Locked Shifted', 'NSP & NSP Door L… _(src: NOC/NOC-4(C))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-44** [LOW/form] (NOC) — NOC outcome dropdown labels carry doubled-word typos ('Shifted & Door Locked Shifted', 'NSP & NSP Door Locked') — display-only, does not co… _(src: NOC/NOC-F4(C))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-45** [LOW/form] (NOC) — Mobile SHIFTED outcome display label is the doubled-word 'Shifted & Door Locked Shifted' _(src: NOC/NOC-UX-4(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-46** [LOW/report] (OFFICE) — Mobile stores verification_type = display NAME ('Office Verification'), not the CODE — consistency-only _(src: OFFICE/OFFICE-3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-47** [LOW/report] (OFFICE) — 'Generated Report' section always renders an empty 'No report template configured for OFFICE' placeholder on every OFFICE field report _(src: OFFICE/OFFICE-UX-2(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-48** [LOW/up-sync] (OFFICE) — Form-submit slug is not checked against the task's verification unit — a buggy/malicious owned device can store OFFICE form_data under a di… _(src: OFFICE/SEC-OFFICE-2(S))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-49** [LOW/report] (PROPERTY_APF) — finalStatusNegative (STOP/VACANT path) is declared in neither sectionMap nor SDK APF_COLUMNS — sections surface labels it 'Final Status Neg… _(src: PROPERTY_APF/APF-2(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-50** [LOW/report] (PROPERTY_APF) — Duplicate metPersonName entry in property-apf sectionMap is dead config (second 'Name of Met Person (ERT)' row never renders) _(src: PROPERTY_APF/APF-UX-4(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-51** [LOW/form] (PROPERTY_APF) — Mobile APF capture labels for the TPC pair are swapped vs their field semantics (report self-corrects by ref) _(src: PROPERTY_APF/APF-UX-5(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-52** [LOW/report] (PROPERTY_INDIVIDUAL) — PI NSP narrative branch has zero render-test coverage (canonicalize derives + PI_BODY branches exist, but never asserted) _(src: PROPERTY_INDIVIDUAL/PI-2(C))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-53** [LOW/report] (PROPERTY_INDIVIDUAL) — PI sectionMap duplicate metPersonName ref makes the 'Name of Met Person (ERT)' label dead — ERT name renders under non-ERT label _(src: PROPERTY_INDIVIDUAL/PI-3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-54** [LOW/report] (PROPERTY_INDIVIDUAL) — PI status field flatStatus + required addressLocatable are demoted to the unlabeled "Additional Details" catch-all — every other field type… _(src: PROPERTY_INDIVIDUAL/PI-UX-2(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-55** [LOW/report] (PROPERTY_INDIVIDUAL) — Dead duplicate sectionMap row (metPersonName listed twice) — ERT label "Name of Met Person (ERT)" can never render; PI NSP narrative branch… _(src: PROPERTY_INDIVIDUAL/PI-UX-3(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-56** [LOW/form] (RESIDENCE_CUM_OFFICE) — TPC field labels drift between outcomes inside the RCO mobile form — SHIFTED/NSP mislabel the relation-select as "Third Party Confirmation"… _(src: RESIDENCE_CUM_OFFICE/RCO-UX-3(D))_ → **FIX** — confirmed defect, fix scoped
- **A2026-0623-57** [LOW/form] (REVOKE) — Mobile offline FALLBACK_REASONS exposes only 5 of 9 canonical revoke_reasons (missing ADDRESS_NOT_WORKING/CUSTOMER_LEFT_AREA/WRONG_ADDRESS/… _(src: REVOKE/REVOKE-4(C); REVOKE/REVOKE-5(C); REVOKE/SEC-REVOKE-5(S); REVOKE/UX-REVOKE-2(D))_ → **DEFER** — REVOKE-5(CEO), REVOKE-4(CTO down-sync fallback), SEC-REVOKE-5, UX-REVOKE-2. UX-REVOKE-2 suggests FIX; reconciled DEFER (fresh-install-offline edge). REVOKE-4(CEO)=revoke-history is SEPARATE (DEDUP-12).
- **A2026-0623-58** [LOW/down-sync] (REVOKE) — revokedByName / revokedAt are proxied from updated_by / updated_at (not dedicated revoke columns) -> a later non-revoke UPDATE mis-attribut… _(src: REVOKE/SEC-REVOKE-4(S))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-59** [LOW/down-sync] (REVOKE) — Mobile revoke banner's 'Revoked on {date}' and revoker name are proxied from generic updated_at / updated_by, not a real revoke timestamp/a… _(src: REVOKE/UX-REVOKE-4(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-60** [LOW/report] (REVOKE) — No consolidated task-level revoke-history view on web — reason shows only as an inline remark suffix; repeated revokes of a lineage are not… _(src: REVOKE/UX-REVOKE-5(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-61** [INFO/report] (BUILDER) — Dead duplicate sectionMap entry: 'metPersonName' is listed twice in BUILDER 'Met Person Details' — the second ERT label can never render _(src: BUILDER/BUILDER-UX-4(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-62** [INFO/report] (BUILDER) — BUILDER report sectionMap 'Telephonic Confirmation' refs a dead field (callConfirmation) the device never captures _(src: BUILDER/CEO-BUILDER-3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-63** [INFO/report] (BUILDER) — BUILDER narrative report is fully latent (no active FIELD_REPORT layout) — verifier gets section view only, no generated prose report _(src: BUILDER/CEO-BUILDER-4(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-64** [INFO/down-sync] (BUSINESS) — HOP 2 down-sync and HOP 4 up-sync verified CLEAN for BUSINESS — no field renamed/dropped/reshaped at those boundaries _(src: BUSINESS/BIZ-F4(C))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-65** [INFO/cross-cutting] (BUSINESS) — verification_units.pii_sensitive is a decorative admin flag — no enforcement in any access/masking/logging/retention path _(src: BUSINESS/SEC-BUS-3(S))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-66** [INFO/down-sync] (CROSSCUT) — Falsy-zero coercion drops a literal 0 latitude/longitude during down-sync (geographically immaterial for India) _(src: CROSSCUT/CC-3(C))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-67** [INFO/down-sync] (CROSSCUT) — Falsy-zero coercion of latitude/longitude on upsert → a literal 0 coordinate is dropped to null, losing the GPS pin and static-map inset _(src: CROSSCUT/UX-CROSSCUT-4(D))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-68** [INFO/report] (DSA_CONNECTOR) — DSA NSP & Door Locked narrative branch reads 'current_company_period', a field the NSP form never collects — latent degraded narrative clau… _(src: DSA_CONNECTOR/DSA-F3(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-69** [INFO/report] (DSA_CONNECTOR) — Entire DSA narrative + ADR-0057 canonicalize chain is latent (no active DSA report_layout) — only the raw sections render today _(src: DSA_CONNECTOR/DSA-UX-5(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-70** [INFO/up-sync] (DSA_CONNECTOR) — Field-photo evidence hash is computed over server-STRIPPED bytes while client_sha256 is over the device file — the persisted integrity pair… _(src: DSA_CONNECTOR/SEC-DSA-1(S))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-71** [INFO/create] (DSA_CONNECTOR) — DSA_CONNECTOR verification_units.pii_sensitive=false and the flag drives no runtime masking despite the 'DPDP masking' UI label — applicant… _(src: DSA_CONNECTOR/SEC-DSA-2(S))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-72** [INFO/down-sync] (NOC) — Device-submitted NOC outcome does not round-trip via down-sync (verificationOutcome stays NULL until office-complete) — confirmed INTENTION… _(src: NOC/NOC-F3(C))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-73** [INFO/up-sync] (NOC) — Stored NOC photo evidence hash is sha256(EXIF-stripped) while client_sha256 is sha256(raw capture) — the two hashes are intentionally non-c… _(src: NOC/SEC-NOC-2(S))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-74** [INFO/report] (OFFICE) — Latent: OFFICE SHIFTED narrative label would render 'Shifted & Door Locked' (canonicalize) vs v1 device label 'Shifted & Door Locked Shifte… _(src: OFFICE/OFFICE-4(C))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending
- **A2026-0623-75** [INFO/form] (PROPERTY_INDIVIDUAL) — Mobile PI builder silently coerces any 'SHIFTED'-containing outcome to NSP — latent (DB has no SHIFTED for PI) _(src: PROPERTY_INDIVIDUAL/PI-4(C))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-76** [INFO/report] (PROPERTY_INDIVIDUAL) — REFUTED: report/photo/download routes are IDOR-safe and scope-guarded — no cross-user/cross-type leak _(src: PROPERTY_INDIVIDUAL/SEC-PI-2(S))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-77** [INFO/down-sync] (PROPERTY_INDIVIDUAL) — REFUTED: mobile clearAllData covers all PII tables on user-change — no prior-user PROPERTY_INDIVIDUAL PII leak _(src: PROPERTY_INDIVIDUAL/SEC-PI-3(S))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-78** [INFO/report] (RESIDENCE) — Registry AUDIT-1 / AUDIT-2 are STALE — outcome-code→label and split-period narrative gaps already remediated by canonicalize.ts (ADR-0057);… _(src: RESIDENCE/RESI-F4(C))_ → **RATCHET** — add test/coverage floor; ratchets up only
- **A2026-0623-79** [INFO/up-sync] (RESIDENCE) — Field-path verification_outcome correctly bypasses chk_case_task_outcome — no field code can violate the column CHECK (NULL-only on field p… _(src: RESIDENCE/RESI-F5(C))_ → **WONTFIX** — by-design / refuted-as-defect; recorded for traceability
- **A2026-0623-80** [INFO/report] (RESIDENCE_CUM_OFFICE) — RCO has no active FIELD_REPORT layout, so the canonicalized v1 narrative (RCO_BODY) never renders — the raw sectioned view is the whole rep… _(src: RESIDENCE_CUM_OFFICE/RCO-UX-4(D))_ → **DEFER** — deferred — confirmed, owner decision / scheduling pending


### Fix log — report-render cluster (2026-06-24)

Built TDD against the mobile builder (`LegacyFormTemplateBuilders.ts` = source of truth: every form field per type×outcome is mandatory, so an empty report row is a report-side key/mapping bug). Full `DATABASE_URL=… pnpm verify` GREEN; `fieldReports` suite 83 tests. Verified per-type via a `report-render-mapping-gaps` workflow (mobile field set vs `sectionMap`/SDK, each gap adversarially re-checked).

**✅ FIXED (raw-sections view; narrative where live):**
- **A2026-0623-01** split-tenure recombine — `sections.ts` `recombinePeriods` + `canonicalize.ts` `PERIOD_BASES` export (every `<base>Value`+`Unit` now recombines into the named period row; split keys no longer leak to Additional Details).
- **A2026-0623-03** BUSINESS area reads device `officeApproxArea` — `sectionMap.ts` + SDK `fieldReportDefaults.ts`.
- **A2026-0623-08** residence/RCO floor reads device `addressFloor` (was `applicantStayingFloor`; killed the `ordinal('')→"0th floor"` fabrication) — `sectionMap.ts` ×2 + SDK ×2.
- **A2026-0623-14** BUSINESS `addressLocatable` + `addressStatus` mapped.
- **A2026-0623-21** NOC `addressLocatable` + `businessExistance` (NSP) mapped.
- **A2026-0623-22** PROPERTY_APF `addressLocatable` + `tpcConfirmation1/2` mapped. *(`finalStatusNegative` part DEFERRED → entangled with A2026-0623-07 APF-NEGATIVE owner decision.)*
- **A2026-0623-23 / -15** PROPERTY_INDIVIDUAL `flatStatus` (+ `addressLocatable`) mapped.
- **A2026-0623-27** BUILDER `businessExistance` (NSP) mapped.
- **A2026-0623-35 / -37** DSA_CONNECTOR `businessExistance` (NSP) + `addressLocatable` mapped.

**✅ NEW siblings found during the fix (same SoT class, were unregistered) — FIXED:**
- **A2026-0623-03b** RCO business area read `approxArea` but the RCO device emits `officeApproxArea` (mobile builder line 2570; the mapping-gap workflow's RCO agent missed it, confirmed by direct grep) — `sectionMap.ts` + SDK fixed.
- **A2026-0623-21b** RCO `documentType` + `addressLocatable`, PI `addressLocatable`, BUSINESS/NOC/BUILDER/DSA `businessExistance` (NSP) — all unmapped device keys, now mapped.

**WONTFIX (intentional, documented):**
- **A2026-0623-50 / -53 / -55 / -61** dead-duplicate `metPersonName` rows — `sectionMap.ts:13-15` documents the ERT-duplicate transcription as deliberate spec parity; `buildSections` dedupes (first-wins) so the second never renders by design. Removing deviates from spec for zero functional gain. (The PI duplicate was also adversarially **refuted**.)

**REFUTED (audit error, no change):**
- **A2026-0623-62** + the NOC equivalent — claimed `callConfirmation` is a dead field the device never captures; the BUILDER/NOC device **does** emit `callConfirmation`. Verified false.

**DEFERRED:**
- **A2026-0623-28** BUILDER `feedbackFromNeighbour` ERT-only mislabel — cosmetic; per-slug labels aren't outcome-aware and the value renders correctly.
- **SDK narrative columns** for the newly-mapped fields — the narrative view is latent for all 8 affected types (no active `FIELD_REPORT` layout) and a column without a template-body reference renders nothing; add when a layout is activated. The live fix is the raw-sections `sectionMap`.

**✅ Live E2E verification (2026-06-24):** drove the full workflow on `crm2_dev` (seed case+task → assign smokefa → submit form + 5 photos + selfie → office-complete) for residence×POSITIVE. Verified: `case_tasks.form_data['residence']` captured every key (`addressLocatable`, `addressFloor`, split `stayingPeriodValue/Unit`); raw report sections render each field with correct grammar — **"Staying Period = 5 Years"** (split-tenure recombine), **"Applicant Staying Floor = 3"** (no "0th floor" fabrication), no "Not provided"; 6 attachments (5 photos + selfie) stored; **commission ₹50 frozen @SUBMIT + bill_count 1**, **client bill ₹1100 resolved @COMPLETE** (ADR-0047 two-stage), case rollup `billTotal 1100 / commissionTotal 50`. The run **caught + FIXED a NEW gap**: RESIDENCE + OFFICE `addressLocatable` (device emits it, 4 outcomes each, mobile builder lines 1512/1785/1970/2141 + 3312/3532/3736/3896) was unmapped → now in 'Verification Outcome & Status'. `fieldReports` 85 tests + `pnpm verify` green.

**✅ Full 43-pair E2E matrix (2026-06-24):** drove every field `verification_type × outcome` (9 types × 4–5 outcomes) through the complete workflow on `crm2_dev` (seed→assign smokefa→submit form→5 photos+selfie→office-complete) — **43/43 OK**: form_data captured, report renders 6–8 named sections **with zero "Additional Details" leaks**, 6 attachments each, billing resolves per type (₹1100–1900) + commission ₹50 + bill_count 1. The matrix **caught + FIXED a real gap**: PROPERTY_APF omitted its structure fields (`addressStructure`, `addressStructureColor`, `doorColor`, `addressFloor` — device emits all 4 at builder lines 7170/7182/7187/7176) → added a 'Property / Structure & Nameplate' section. Note: `finalStatusNegative` is **NOT emitted** by the APF device builder (audit A2026-0623-22's finalStatusNegative sub-item + finding 07 — the device sends `finalStatus` for the negative path; re-scope that part). `fieldReports` 86 tests + `pnpm verify` green.

**✅ Active-layout staleness — FIXED (2026-06-24, mig 0088 + catalog guard):** FIELD_REPORT layouts render with their OWN snapshotted columns (`fieldReports/service.ts` renderNarrative(layout.columns)), so any layout created before the 2026-06-24 device-key fixes carries the OLD keys (`applicantStayingFloor`; business/RCO `approxArea`) → empty/wrong values for v2 device submissions. **Migration `0088_field_report_layout_device_keys`** remaps the known drifts on existing stored `report_layout_columns` (floor → `addressFloor` for residence/RCO; area → `officeApproxArea` for business + residence-cum-office; residence `approxArea` left untouched) — UPDATE-only, slug-scoped, idempotent + re-run-safe (device-tested: stale→fixed, re-run no-op). **Guard:** `fieldReportDefaults.test.ts` asserts no default column reads `applicantStayingFloor` and BUSINESS/RCO area reads `officeApproxArea` (prevents catalog regression). **Scope:** prod `report_layouts` is empty (per audit) so the default-template fix already covers prod — 0088 is the safety net for any pre-fix active layout. **Residual (not migratable):** a stale layout's `template_body` (omitted clauses — e.g. the dev fixture id1 drops the floor clause) is admin/author content; regen the layout from the current default to restore omitted clauses. Render-time catalog resolution (so column source_refs auto-track the catalog) would prevent future snapshot drift but is an architecture change → ADR if owner wants a systemic guarantee.

## Section SEC-AUDIT-2026-06-27 — 6-point production-readiness security review (ADR-0076)

Owner-requested audit across Authorization · Rate Limiting · Secrets · Access Control · Token
Security · Resilience. 4 read-only audit passes + 1 adversarial design review. **Authorization &
Access Control verified SOUND (no change).** Edge gaps → ADR-0076, phased. Topology fact that shaped
the fix: **prod is single-instance, Redis/Valkey is unset** (compose comment) — so fixes are
in-memory / durable-DB, not Redis-backed.

**✅ VERIFIED SOUND (no finding):**
- **Authorization** — scope predicate fails closed; applied on list, detail-by-`:id`, sub-resources,
  exports, aggregates. No IDOR. Field tasks ownership-bound (`WHERE id=$1 AND assigned_to=$2`).
- **Access control** — Zod allowlists (no mass-assignment); role/permission/scope writes
  SUPER_ADMIN-only; assignment re-validated server-side; KYC grant fail-closed (ADR-0073).
- **Secrets hygiene** — no committed secrets; gitleaks in CI; GitHub-Secrets-only deploy; error
  handler returns bare `{error:'INTERNAL'}`; web bundle has zero embedded secrets.

**🟢 FIXED in Phase 1 (ADR-0076, branch `feat/security-hardening`):**
- **SEC-1 (CRITICAL)** No rate limiting → per-IP brute-force/spray/scrape. FIX: `express-rate-limit`
  on `/auth/login` + `/auth/refresh` (in-memory, config-driven) + nginx `limit_req` floor. The
  existing DB per-account lockout remains the credential-stuffing control.
- **SEC-2 (CRITICAL)** Login scrypt (~2s) on default 4-thread libuv pool → API-wide stall. FIX:
  `UV_THREADPOOL_SIZE=16` + the login rate limit removes the trigger.
- **SEC-3 (HIGH)** `req.ip` = edge IP (no `trust proxy`) → per-IP limiting impossible + wrong audit
  IPs. FIX: `app.set('trust proxy', 1)`.
- **SEC-4 (HIGH)** Prod can boot on the public dev `JWT_SECRET`/`MFA_ENC_KEY` default. FIX:
  `loadEnv` `.superRefine` throws in production on the known default.
- **SEC-5 (HIGH)** No pg pool / HTTP timeouts → one expensive query or slowloris stalls the system.
  FIX: pool `statement_timeout`/`connectionTimeoutMillis`/`idle_in_transaction_session_timeout`/`max`
  + server `requestTimeout`/`headersTimeout` (120s, matching nginx).
- **SEC-6 (MEDIUM)** Username-enumeration timing oracle (unknown user fails before scrypt). FIX:
  dummy-hash scrypt on the unknown-user path.
- **SEC-7 (LOW)** `x-test-auth` seam gated only by mount-time `NODE_ENV`. FIX: middleware no-ops in
  production (double-guard).

**🟢 FIXED in Phase 2 (ADR-0076, mig 0102, branch `feat/security-hardening` — built + gate GREEN):**
- **SEC-8 (HIGH)** Stolen/re-issued access token unrevocable for ≤15 min; deactivation/password
  change didn't kill live access tokens or the realtime socket. FIX: durable per-user
  `tokens_valid_after` column (mig 0102) + `iat` check in `authenticate` (strict `<`, whole-second so
  a same-second re-login isn't self-killed) + socket-handshake check + force-disconnect, wired into
  logout-all / password-change / deactivate (single+bulk). Read fail-CLOSED (DB-backed), cached 5s with
  bust-on-revoke. SEC-12-adjacent: `setActive(false)` now actually revokes (was a no-op before).
- **SEC-9 (MEDIUM)** Refresh-token reuse not treated as a breach. FIX: replaying a rotated token →
  family revoke (all sessions + access kill + socket drop) **only beyond a 60s grace window**; within
  grace it's a benign 401 (mobile lost-response retry / multi-tab race) so jitter never mass-logs-out.

**🟢 FIXED in follow-ups (ADR-0076 — branches `feat/security-followups` + `feat/refresh-cookie`):**
- **SEC-10 (MEDIUM)** Web stored access **+ refresh** in `localStorage` (XSS → durable takeover). FIX:
  the refresh token moved to an httpOnly / SameSite=Lax / path-scoped cookie (Secure in prod); the web
  keeps only the access token + the non-secret refresh-token jti (returned in the login/refresh body)
  for its sessions list + idle-logout. MOBILE unchanged (still body-based). `http/refreshCookie.ts` +
  web `tokenStore`/`sdk`/`AuthContext`. (Server cookie contract test-covered; web browser flow shipped
  without a human browser pass — owner-accepted.)
- **SEC-11 (LOW)** `@crm2/logger` had no redaction denylist. FIX: `redact()` masks sensitive-named
  fields (password/token/secret/authorization/cookie/jwt/apikey/mfa/credential) in every log record.
- **SEC-12 (INFO)** `admin` seed (`admin123`) had no force-rotate flag. FIX: migration 0103 sets
  `password_must_change=true` gated on the exact seed hash (no-op once admin rotates → live prod admin
  untouched; a fresh DB is forced to rotate on first login).
- **SEC-REGRESSION** Phase-1's `loginLimiter()`/`refreshLimiter()` called `loadEnv()` at module load,
  crashing the OpenAPI CLI (no DATABASE_URL) and reddening main's drift gate. FIX: build the limiters
  lazily (first request, cached). Also: gitleaks-action given `GITHUB_TOKEN` for pull_request scans.

## Section FIELD-COMMISSION-EXPORT-2026-07-01 (audit `docs/engineering/FIELD_COMMISSION_EXPORT_AUDIT_2026-07-01.md`)

Field-user commission calculation + export/period coverage audit (v1 + Zion cross-check). Calculation
verified SOUND/read-derived; the gaps were all on the export/aggregation side. Dispositions:

- **FC-1** Periodic commission export (weekly/monthly/quarterly presets + bucketing) — ✅ **FIXED (ADR-0081,
  no migration)** — new Billing read-model `GET /billing/commission-summary` (+ `/export`), `period ∈
  {week,fortnight,month,quarter}`, gated `billing.view`. SQL period bucket in `platform`-shared
  `billing/repository.ts` `PERIOD_SQL`. TDD'd (`billing.commission.test.ts` ADR-0081 cases).
- **FC-2** Per-field-user aggregation/export (assignee was absent from the billing export) — ✅ **FIXED
  (ADR-0081)** — the summary is grained per field-user × period, `groupBy=agent|agentClientProduct`. Export
  columns: Agent · [Client · Product ·] Period · Tasks · Billable Units · Commission Total.
- **FC-5** Period filter anchored on `completed_at` while commission freezes at `submitted_at` (SUBMITTED rows
  dropped; cross-period misattribution) — ✅ **FIXED (ADR-0081)** — the summary buckets + ranges on the
  earned-at anchor `COALESCE(ct.submitted_at, ct.completed_at)`. (The per-case Billing list/breakdown keep
  `completed_at` — those are client-bill, billed-at-COMPLETE views — unchanged by design.)
- **FC-3** 15-day / fortnightly — was DEFERRED (no v1/Zion precedent); shipped anyway under ADR-0081 as
  `fortnight` = twice-monthly **1st–15th (H1) / 16th–EOM (H2)**. ⚠️ Owner to confirm the pay cycle is
  twice-monthly (vs rolling-14) at push; swappable in one `PERIOD_SQL` fragment. → ✅ **FIXED (assumption-flagged)**.
- **FC-4** field-user × client × product pivot — ✅ **FIXED** via `groupBy=agentClientProduct` (the audit had
  it DEFERRED; it fell out of the same read-model for free).
- **FC-6** OFFICE/desk task earns silent ₹0 when no OFFICE rate configured — 🟢 **WONTFIX (known)** — by-design
  fail-soft; tracked as the CEO launch-checklist "pre-seed OFFICE rates".
- **FC-7** Invoice generation + GST + commission payout engine — 🟢 **WONTFIX** — billing/commission is
  export-only (owner 2026-06-25); paid externally (Tally/manual).
- **FC-8** `bill_count` multiplier vestigial (every task ×1 since SHIP-2) — 🟢 **WONTFIX (note)** — harmless;
  full retirement is a later cleanup.

## Section AUDIT-2026-07-01 — Enterprise security & production audit (19 areas → independent re-verification → 4-wave remediation)

Full audit trail: `docs/audit/01-authentication.md` … `19-mobile-api-compatibility.md` (original
findings) → `docs/audit/MASTER_REPORT.md` (synthesis, Risk Score 18/100, READY FOR PRODUCTION) →
`docs/audit/FINDING_VERIFICATION.md` (independent adversarial re-check: 54 TRUE_POSITIVE/
ACCEPTED_RISK, 3 FALSE_POSITIVE retracted, 4 duplicate clusters merged) → `docs/audit/
REMEDIATION_PLAN.md` (4-phase plan) → this section (actual disposition after execution).
Commits: `955ca91` (Wave 1/High), `987f01f` (Wave 2/Medium), `db87685` (Wave 3/Low), `ed8ec86`
(Wave 4/Informational). `pnpm verify` green after every wave.

**🔴→🟢 FIXED — High (1/1):**
- **LOGGING-03** No Docker log-rotation on any prod service (repeat of the 2026-06-26 disk-exhaustion
  outage's failure mode, different source). FIX: `logging:` cap (20m×10 files) on all 6 services.

**🟡→🟢 FIXED — Medium (7/8):**
- **AUTHENTICATION-01** Wrong TOTP/MFA codes didn't count toward lockout. FIX: same counter as wrong
  passwords; a missing code (normal MFA prompt) still doesn't count.
- **FILE_UPLOAD-01** No malware scanning, magic-byte check only. FIX: `platform/av.ts` — a clamd
  INSTREAM client (plain `node:net`, no new dependency), wired at all 3 upload call sites, inert
  unless `AV_SCAN_HOST` is set (matches the codebase's existing optional-integration pattern);
  docker-compose scaffolding included, commented out until a clamd sidecar is provisioned.
- **INFRASTRUCTURE-01** Containers ran as root. FIX: apps/api's Dockerfile now runs as the non-root
  `node` user (build+boot+Chromium-launch verified); nginx already ran workers non-root by design.
  `no-new-privileges` added to every prod service.
- **INFRASTRUCTURE-03** deploy.sh only checked the TLS cert exists, never renewed it. FIX:
  `infra/prod/renew-cert.sh` (one-shot certbot/certbot container against the existing webroot volume),
  documented as a cron/systemd-timer install step (not part of the CI-gated deploy path).
- **PERFORMANCE-04** `case_tasks.completed_at`/`submitted_at` unindexed despite being the MIS/Billing/
  Commission-Summary hot filter key. FIX: migration 0105.
- **MOBILE_API_COMPATIBILITY-03** The mobile-contract CI step's `|| echo` swallowed real test failures,
  not just the "not wired" case. FIX: `contract:mobile` is now unconditional (243 tests, green).
- **MERGED-SECURITY-HEADERS** (canonical merge of **XSS-01 / API_SECURITY-01 / FRONTEND_SECURITY-02 /
  INFRASTRUCTURE-02** — 4 audits independently found the same gap) No CSP/HSTS/X-Frame-Options
  anywhere. FIX: `nosniff`/`frame-deny`/referrer-policy/CSP on every API response (Express); a strict
  same-origin CSP + HSTS + Permissions-Policy on the SPA edge (nginx, incl. the two locations that
  break `add_header` inheritance).

**🟡 DEFERRED — Medium (1/8):**
- **DATABASE-04** `case_applicants.name/mobile/pan` stored+indexed in plaintext despite a
  `pii_sensitive` flag implying intent. **Why deferred, not fixed:** `cases/repository.ts` does
  exact-match dedupe checks cross-scope on these raw columns AND a separate ILIKE substring search on
  applicant name (both live, deliberately-designed features) — naive encryption (deterministic or
  otherwise) breaks one or both. Needs a real searchable-encryption design decision (deterministic
  encryption / blind indexing / accept losing substring search) + a superseding ADR before touching
  it, not a mechanical patch. Tracked here as the concrete next step when prioritized.
  **NB (2026-07-07):** RDS **storage/volume** encryption at rest is now ON (ADR-0091, §AWS-HARDENING-2026-07-07)
  — that is a *different, complementary* control at the disk layer and does **not** close this
  field-level (column plaintext + index) finding, which remains DEFERRED.

**🟢 FIXED — Low (22/33):**
AUTHENTICATION-03 (secret entropy floor beyond the literal dev-default check) · AUTHORIZATION-04
(USER_MANAGE could assign SUPER_ADMIN — new `assertCanAssignRole()`, actor must already hold
grantsAll to grant it; 4 tests) · INPUT_VALIDATION-01 (`safeDecodeURIComponent` — malformed
%-sequence no longer 500s) · INPUT_VALIDATION-02 (`page` ceiling, `PAGE_TOO_LARGE`) ·
INPUT_VALIDATION-03 (`.max()` on login/refresh schema fields) · CSRF-01 (`verifySameOrigin` — Origin/
Referer cross-check on `/auth/refresh`, the one cookie-authenticated endpoint) · API_SECURITY-02
(rate limiter on change-password/MFA endpoints, same as login/refresh) · DATABASE-01 (index on
`case_tasks.verification_unit_id`, migration 0106) · DATABASE-02 (refresh-token rotation is one
atomic transaction via `repo.rotateRefresh()`, kept inside the repository layer per the
`db-access-only-in-repositories` boundary) · DATABASE-03 (doc-corrected: "query plan reviewed" is a
manual practice, not a CI gate) · DATABASE-05 (doc-corrected: `DATA_RETENTION_POLICY.md`'s
`legal_hold`-exists-day-1 claim was false, marked PLANNED) · REDIS_CACHE-01 (dev Valkey now requires
auth + binds loopback-only) · REDIS_CACHE-02 (the inert future prod Valkey block gained a
`--maxmemory` ceiling + resource limits) · REDIS_CACHE-03 (rewrote the outage runbook, which
described a two-node topology and a Redis-aware health check that don't exist) · INFRASTRUCTURE-04
(`cpus` limits on all 4 long-running services + `mem_limit`/`cpus` on the 2 one-shot services that
had neither) · INFRASTRUCTURE-05 (explicit ECDHE-only cipher allowlist, Mozilla Intermediate) ·
LOGGING-01 (`redact()` now recurses into nested objects/arrays, depth-capped) · LOGGING-02
(doc-corrected: audit-log hash-chaining/partitioning claimed day-1, actually deferred per migration
0017's own comment) · PERFORMANCE-01 (`addTasks()` caches the eligible-assignee pool per unique
location/unit tuple instead of re-querying per task) · CODE_QUALITY-02 (extracted
`platform/istTime.ts` — the IST-midnight formula was duplicated verbatim across 3 services) ·
BUSINESS_LOGIC-02 (`/dedupe-search/export` now gates on `dedupe.view`, matching its view sibling,
not the generic `data.export`) · MOBILE_API_COMPATIBILITY-01 (doc-corrected: the compatibility matrix
referenced the superseded `/auth/accept-policies`; real endpoint is `/consents/accept`).

**🟡 DEFERRED — Low (7/33):**
- **AUTHORIZATION-01** `case:updated` realtime broadcast reaches every office-role socket regardless
  of client/product/territory scope (case number + status only, no PII — REST reads stay properly
  scoped). Real fix needs scope-aware socket rooms; a rushed retrofit risks destabilizing the scope
  system the Authorization audit itself verified sound. Deferred, not declined.
- **DATABASE-06** API runtime shares the schema-owning DB role with migrations (no privilege
  separation against the audit-log trigger). Needs live DB-admin access to create + test a
  least-privilege role without risking the actual prod database — out of scope for this pass.
- **CODE_QUALITY-01** 19 unused exports + 14 unused exported types (knip). Zero functional/security
  impact; mechanical but individually-verifiable cleanup better suited to a dedicated follow-up than
  bundled into a security remediation pass. Full list captured in the knip output at audit time.
- **CODE_QUALITY-03** `CaseDetailPage.tsx`, a 2332-line God-component. The finding's own text concedes
  zero security exploitability — pure velocity/maintainability debt; a multi-day decomposition, not a
  fix-in-pass item.
- **CODE_QUALITY-05** Oversized, multi-responsibility functions in `cases/repository.ts`. Working,
  tested, parameterized-query code — refactoring it carries real behavior-change risk for a
  non-security finding; deferred rather than rushed.
- **MOBILE_API_COMPATIBILITY-02** `forms`/`telemetry` modules have zero test coverage. Both are
  trivial non-persisting stubs today (low blast radius); genuine test-writing effort, not a quick fix.
- **MOBILE_API_COMPATIBILITY-04** Idempotency dedupe is `operation_id`-only, doesn't compare replay
  body against the documented "method+body+key" contract. Touches a LOCKED mobile contract
  (`crm-mobile-native`, separate repo, never-break-mobile rule) — needs more care/coordination than
  this pass allows, not a same-repo mechanical fix.

**⚪ ACCEPTED_RISK, untouched by design (4/33 Low)** — independently re-verified as already
knowingly accepted by the team (not unacknowledged gaps): **MERGED-ACCESS-TOKEN-LOCALSTORAGE**
(AUTHENTICATION-02 + FRONTEND_SECURITY-03 — ADR-0076 SEC-10's deliberate scoping, refresh token
alone moved to httpOnly cookie) · **FRONTEND_SECURITY-01** (this registry's own SR-11 entry, already
deferred at LOW citing backend `authorize()` gating) · **PERFORMANCE-02** (`docker-compose.yml`'s own
comment + ADR-0030 — in-process job tier is an intentional, config-gated design property) ·
**BUSINESS_LOGIC-01** (ADR-0078 lines 49-50 explicitly names the function and states it deliberately
stays hierarchy-scoped). Reversing any of these needs a superseding ADR + CTO + domain-owner
sign-off per governance, not a remediation-pass code change.

**🟢 FIXED — Informational (6/12):**
- **MERGED-SOCKETIO-CORS** (AUTHORIZATION-02 + CSRF-02) `origin: true` reflected any origin. FIX:
  explicit allowlist (prod hostname / dev localhost); latent, not actively exploitable (handshake
  already requires a bearer JWT), but now a real second factor.
- **INPUT_VALIDATION-04** `CreateCaseSchema.applicants` had no ceiling. FIX: `.max(10)`.
- **MERGED-UNUSED-VITEST-DEPS** (DEPENDENCY_AUDIT-01 + CODE_QUALITY-04) Unused root `vitest`/
  `@vitest/coverage-v8`. FIX: removed; knip's unused-devDependency section is now empty.
- **DEPENDENCY_AUDIT-04** No Dependabot. FIX: `.github/dependabot.yml` (weekly, npm + github-actions).
- **API_SECURITY-04** No ADR recorded the deliberate same-origin/no-CORS decision. FIX: ADR-0082.
- **FRONTEND_SECURITY-04** ADR-0009 (feature flags) claimed Accepted with no implementation-status
  caveat. FIX: status corrected to "Accepted (design) · NOT IMPLEMENTED", verified zero code hits.

**⚪ NO ACTION — Informational (5/12), already correct or non-issues:**
AUTHORIZATION-03 (verification note only — confirms a working control, not a gap) ·
INFRASTRUCTURE-06 (gzip-on-JSON BREACH precondition, no concrete exploit path — track only) ·
DEPENDENCY_AUDIT-02 (license-sweep scope note, spot-checked clean) · BUSINESS_LOGIC-03 (YAGNI — zero
scope-sensitive export builders registered today) · CODE_QUALITY-06 (`location` vs `locations`
naming-clarity nit, no functional bug — optional rename, opportunistic only).

**⚪ ACCEPTED_RISK, no action (1/12):**
- **PERFORMANCE-03** XLSX export buffers the full workbook in memory. Already an explicit,
  pre-existing RATCHET (`docs/agents/performance.md`, filed 2026-06-07, reaffirmed 2026-06-15) with a
  sized upgrade trigger — not a new finding to act on.

**⚫ RETRACTED — false positives (3, excluded from the 54 above):** independent re-verification
found these did not hold up against the live code — **SSRF-01** (the bound-check the finding claimed
missing is actually enforced downstream in the shared `geocodeService.reverse()`), **API_SECURITY-03**
(self-disclosed by the original finding as "not actually a problem"), **DEPENDENCY_AUDIT-03**
(contradicted by pnpm v9's default-blocked lifecycle scripts — no such postinstall hook runs).

**Net:** 0 Critical, 1 High (fixed), 8 Medium (7 fixed, 1 deferred), 33 Low (22 fixed, 7 deferred, 4
accepted-risk), 12 Informational (6 fixed, 5 no-action, 1 accepted-risk). Nothing silently dropped.

---

## Section MIS-2026-07-01 — MIS rebuild design review (ADR-0084, pre-build)

> Adversarial design review (3 reviewers: security / architecture / domain) of the MIS rebuild design
> ([ADR-0084](adr/ADR-0084-mis-report-model.md) + [spec](specs/2026-07-01-mis-rebuild-design.md)). The
> approach (code-owned allow-list + reused laterals + scope-append) was upheld — **no SQL-injection path
> survived**. Confirmed defects were fixed **in the design** before any code; dispositions below. These are
> design-stage; the FIXED-IN-DESIGN items become enforceable tests at their build slice.

### MIS-1 · Operational report inherited billing's `status IN ('SUBMITTED','COMPLETED')` WHERE — ✅ FIXED-IN-DESIGN
- **Finding (domain, CRITICAL):** reusing the billing read-model WHERE would hide PENDING/ASSIGNED/IN_PROGRESS
  — a "state of all work" report that structurally can't show open work.
- **Fix:** spec §4 — reuse the **laterals for money only**, base predicate = all in-scope; status is a user
  filter; open rows show `—` for money. Verified at S1a.

### MIS-2 · Money-gating leaked via summary sums / sort / filter / group-by + empty-cols fallback — ✅ FIXED-IN-DESIGN
- **Finding (security, HIGH×3 + arch):** money is net-new code (no reusable drop-primitive); hidden money
  reconstructable via `/summary` sums, `sort=commission_amount` (ordering oracle), `f_bill_amount_gte`
  (bisection oracle), `group=` bucketing, and `selectColumns` empty→full-manifest fallback.
- **Fix:** spec §3/§6 — gate by **omitting the laterals from FROM**; money keys excluded from catalog,
  projection, **sort/filter/group**, and **summary sums** without `billing.view`; one shared
  `assertNoMoneyWithout` guard + a money-keys × {rows,summary,export,sort,filter,group} test matrix; manifest
  built already-money-stripped. `bill_total`/`commission_total` are summary/case-grain only.

### MIS-3 · Grain mixing + 1-to-many fan-out (double-counted rows/money) — ✅ FIXED-IN-DESIGN
- **Finding (all three):** case-level columns/counts on task-grain rows mislead when summed; `task_assignment_history`,
  co-applicants, `photo_count` are 1-to-many joins that multiply rows and double-sum money.
- **Fix:** spec §4/§8 — **split into two report types** (`TASK_OPERATIONAL`, `CASE_OPERATIONAL`); 1-to-many
  columns excluded or computed as correlated subqueries; conditional 1:1-join composition; summary FROM stays
  1:1 + `LATERAL … LIMIT 1` so sums are exact. Row-count-stability + summary==`/billing` tests at S1a/S2.

### MIS-4 · Advertised columns that don't exist / wrong grain — ✅ FIXED-IN-DESIGN
- **Finding (domain):** `device_outcome` is a `form_data` jsonb extract (not a column; legitimately blank);
  `tat_days`, the `*_tasks` counts, `completed_tat_band` are case-level/derived, not task columns.
- **Fix:** spec §8 — relabelled `agent_field_note` (fixed `form_data` key, no user-supplied path); case-level
  rollups moved to `CASE_OPERATIONAL`; each column carries a `grain` + `kind` (scalar/subquery/money).

### MIS-5 · ≥10k async export tier would leak scope/money (activates BUSINESS_LOGIC-03) — 🟡 DEFERRED
- **Finding (security CRITICAL + arch):** `ExportBuild(query, actorId, cols, format)` passes no role/scope;
  the only builder is `locations` (no scope/money). MIS registering one would export unscoped, money-included
  data — the latent gap BUSINESS_LOGIC-03 flagged, made live.
- **Disposition:** MVP is **sync export + honest 413 at ≥10k** (matches billing/tasks). A real async slice
  (re-applying `resolveScope` + `billing.view` inside `exportAllForJob`, with a leak test) is deferred until
  >10k MIS exports are needed. Spec §5.

### MIS-6 · Bulk PII export (PAN / mobile / GPS / geocoded address) — 🟢 ACCEPTED (owner-signed 2026-07-01)
- **Finding (security, MED):** MIS newly enables bulk export of plaintext PII; `pii_sensitive` masks nothing
  (no masking machinery); extends the deferred DATABASE-04 (PII-at-rest) to bulk exfil.
- **Disposition:** **ACCEPTED** — owner chose full PII export to `mis.export` holders, no extra gate/masking
  (2026-07-01). Documented risk, not mitigated. Revisit if a DPDP control (searchable encryption / masking)
  is adopted. Spec §3/§6.

### MIS-7 · Bank-format MIS identifiers absent from the data model — 🟡 DEFERRED
- **Finding (domain, HIGH):** LOS/LAN application id, case type (FRESH/CREDIT-REFER/RE-VERIFICATION/RENEWAL),
  CPC/region/zone, sampling-TAT + bank-initiation timestamps, and the ~45-col doc-count matrix are **not in
  the CRM2 schema** — so MIS cannot produce a bank-format export.
- **Disposition:** v1 is explicitly an **internal operational MIS** (owner). Bank-format = a **separate
  project**: schema columns + case-creation capture + its own ADR. Spec §14.

### MIS-8 · Minor design hardening — ✅ FIXED-IN-DESIGN
Strict unknown/duplicate/wrong-type key rejection (MIS-owned, not the lenient `resolveFilters`) · `mis.view`
on `/report-types` · missing `assignee` + completed/submitted date-range filters added · S1 split into
S1a/S1b · `pnpm openapi` as an explicit gated step (not in `verify`) · `field_report_narrative` blob export
ceiling noted (PERFORMANCE-03 RATCHET) · status enums sourced from the DB CHECK. Spec §3/§5/§9/§13.

**Net (design review):** approach upheld; 4 FIXED-IN-DESIGN clusters, 2 DEFERRED (async export, bank
data-model), 1 ACCEPTED (PII export, owner-signed). Nothing silently dropped; FIXED-IN-DESIGN items are
enforced by tests at their build slice.

### Post-ship CEO/CTO/security/code-quality audit (2026-07-01, 4-lens, on the SHIPPED code)
Security **GO** (no injection/money-leak/IDOR path survived; PII matches the accepted set) · CTO/architecture
**GO** (conforms to ADR-0084 + governance; zero new deps; additive API; mig 0109 parity) · CEO/product **GO**
(all owner asks met; 50 task / 25 case columns; simpler than the removed engine) · code-quality initially
**NO-GO** → fixed. Dispositions:
- **MIS-9 · `unitKind` → dropped `verification_units.kind` (HIGH runtime 500) — ✅ FIXED.** `reportTypes.ts`
  had a `col('unitKind', … 'vu.kind')` referencing the column dropped by ADR-0070/mig 0097; not
  default-visible so `verify` shipped green, but selecting/filtering "Unit Kind" would 500 on prod. Removed
  the column (`worker_role` is the ADR-0070 discriminator) + added an **all-columns rows/export guard test**
  (both report types) so any dropped/renamed column now fails CI. Fixed post-ship, re-verified.
- **MIS-10 · Doc-integrity (2 LOW) — ✅ FIXED.** (a) ADR-0084 + spec claimed "a test asserts MIS summary ==
  /billing" — that value-equality test was never written; softened the claim to reality (money SQL copied
  verbatim from the billing laterals; money-gate + all-columns SQL-validity tests shipped) and logged the
  equality test as a tracked follow-up (**MIS-11**, below). (b) spec §4/§13 said "conditional 1:1-join
  composition" — the repo uses a fixed always-on 1:1 FROM (safe, no fan-out); corrected the wording. Also
  removed the stale `unit_kind` from spec §8a.
- **MIS-11 · Summary money-value equality test vs `/billing` — 🟡 DEFERRED (LOW).** Differing group grains
  (MIS group-by-dimension vs billing field-user×period) make a literal endpoint-equality assertion
  non-trivial; the money SQL is verbatim-copied from the shared laterals + the money-gate/all-columns tests
  cover it. Add a seeded rated-task money-value test when convenient.

**Audit verdict: GO** — one HIGH (dead column) found + fixed post-ship with a regression guard; remainder LOW
doc-integrity (fixed) + one DEFERRED LOW test. Feature is sound.

## Section KYC-EXPORT-2026-07-02 — KYC-verifier export workflow (ADR-0085, mig 0110)

Audit + design: [docs/specs/2026-07-02-kyc-verifier-workflow-audit.md](./specs/2026-07-02-kyc-verifier-workflow-audit.md) ·
[docs/specs/2026-07-02-kyc-verifier-export-design.md](./specs/2026-07-02-kyc-verifier-export-design.md) ·
[ADR-0085](./adr/ADR-0085-kyc-verifier-export-workflow.md). Owner-approved 2026-07-02; built S1–S4.

| Item | Disposition |
|---|---|
| KYC-EXPORT-1 — **PII in the verifier's export file** (applicant name/PAN/mobile + document number/holder/details leave plaintext in XLSX/CSV to the `kyc_tasks.export` holder) | **ACCEPTED (owner-signed 2026-07-02)** — the verifier's job requires the identifiers; extends the ADR-0084 §MIS-2026-07-01 acceptance. Accountability: every export/re-export is an immutable `task_export_events` row (who/when/format/reason). |
| KYC-EXPORT-2 — mobile down-sync lacks a `visit_type <> 'OFFICE'` predicate (`sync/repository.ts` — a verifier logging into the mobile app would receive OFFICE tasks on-device; ADR-0025 carry-over) | **DEFERRED** — defense-in-depth only; verifiers are web-only today (no FCM tokens, mobile role-gate deferred with it). |
| KYC-EXPORT-3 — no task document-field edit endpoint (a wrong document number after create = revoke → recreate) | **DEFERRED** — small additive `PATCH` when ops friction shows up. |
| KYC-EXPORT-4 — async ≥10k export tier (413 is the honest ceiling, same as ADR-0084) | **DEFERRED** — mirrors §MIS deferral; a verifier's personal queue approaching 10k is not a real workload. |
| KYC-EXPORT-5 — exported-state column on the shared Pipeline grid (ops oversight beyond the CaseDetail chip) | **DEFERRED** — the CaseDetail chip covers the per-case question; add a Pipeline column if ops asks. |

### KYC-EXPORT post-ship adversarial review (2026-07-02, 4 agents: security / correctness / frontend / governance)

Security + governance: SHIP-OK, zero must-fix (18 attack surfaces verified; contracts/migration/RBAC-parity/docs all pass).

| Finding | Disposition |
|---|---|
| R-1 (correctness, graded HIGH by reviewer) — count-then-claim TOCTOU: the 413 pre-check and the claim are separate statements, so the claimed set can drift from the counted set by concurrent assign/revoke in the window | **ACCEPTED (re-graded LOW)** — the count exists only for the 413 ceiling; the FILE always contains exactly the claimed rows (post-claim fetch by claimed ids), so "fewer rows" = correct reality at claim time, and "more rows than the ceiling" is bounded by ms-window assignment volume on a personal queue. Same shape as the MIS export pre-check (ADR-0084). |
| R-2 (correctness, MODERATE) — documentDetails labels that collapse after trim+uppercase silently dropped a value (last-wins) | **FIXED** — zod superRefine rejects post-normalization duplicates (`duplicate detail labels`) + SDK test. |
| R-3 (frontend, graded HIGH by reviewer) — "rules-of-hooks violation: early return after hooks" in KycQueuePage | **REFUTED** — every hook runs before the permission return on every render (hook order is branch-invariant); identical to the MisPage/CasesPage/PipelinePage gate pattern the same review passed. |
| R-4 (frontend, MED) — re-export dialog lacked focus-trap/Escape (app dialog pattern) | **FIXED** — `useFocusTrap` + Escape-to-close wired. |
| R-5 (frontend, MED) — tab switch clears grid filters; header export buttons bypass the DataGrid Export menu | **WONTFIX (documented by-design)** — independent tab states (different column sets) + export-as-claim needs a controlled refresh; noted in the design spec §6. |
| R-6 (correctness, LOW) — `Number()` on bigint event ids for the filename export№ | **ACCEPTED** — precision loss needs >2^53 export events. |

### KYC-verifier separate dashboard + RBAC re-audit (2026-07-02)

Owner: the shared ops dashboard is wrong for the verifier (pipeline-centric; its tiles link into /pipeline he can't open). Built a KYC-specific dashboard (branch in DashboardPage: `kyc_tasks.view && !page.operations` → `<KycDashboard>`), reusing the shipped `/kyc-tasks` counts — no new API/route/migration/RBAC. A full RBAC audit of the verifier's reachable pages/routes ran alongside.

| Finding | Disposition |
|---|---|
| DASH-1 (UX, real) — shared dashboard tiles (counter bar + Out-of-TAT + Oldest-Unassigned) link to `/pipeline`, dead for the verifier (page.operations-gated) | **FIXED** — verifier now gets `KycDashboard` (To Export / Exported / Total / Oldest-waiting cards, all → `/kyc-queue`); his `/dashboard/stats` call is suppressed (`enabled:false`). |
| DASH-2 (auditor graded CRITICAL) — "`/api/v2/tasks` exposes cross-role FIELD tasks to the verifier via case.view" | **REFUTED (empirically)** — verifier is pure SELF (`assigned_to = me`) after mig 0089 dropped his PINCODE/AREA wiring (ADR-0061). Live test on dev: `/api/v2/tasks` returns 2 rows, BOTH OFFICE + his own, out of 103 total (101 FIELD); `/api/v2/cases` returns 1 (his own). The auditor missed mig 0089 and assumed territory EXPAND was active. No leak. |
| DASH-3 (auditor graded HIGH) — "`/api/v2/cases` lists all cases in scope" | **REFUTED** — same SELF-scope; the verifier sees only the case his task belongs to (1 row, live-verified). |
| DASH-4 (pre-existing, MED) — billing/mis/field-monitoring/dedupe pages lack a page-level `has()` guard (they 403 on the data call, not the page) | **DEFERRED (not KYC-specific)** — those pages aren't in the verifier's nav and 403 safely on data; a page-guard sweep is a separate cleanup, out of scope for this task. |
| DASH-5 (verified safe) — `/dashboard/portfolio` scope for the verifier | **NO-OP** — `caseScopePredicate` limits it to his own cases (SELF); confirmed safe. |

### KYC detail-label consistency (2026-07-02, from live cases 20/21)

Owner exported CASE-000020/021 and found the details unreadable: operators had free-typed the bank
NAME into the detail LABEL ("BANK OF INDIA", "ICICI BANK"), so the one-column-per-label export made
each bank its own header with a sparse blank matrix — "can't tell whose bank". Requirement text was
also duplicated between the Trigger column and detail values.

| Finding | Disposition |
|---|---|
| DETAIL-1 — free-text detail label lets operators type VALUES (bank names) as KEYS → sparse per-bank export columns | **FIXED** — the "Add detail" label is now a code-owned pick-list (BANK NAME / ACCOUNT NUMBER / IFSC / BRANCH / STATEMENT PERIOD / TRANSACTION DATE / TRANSACTION DETAILS / REMARK) + "Other…" fallback. Consistent labels → stable export columns (BANK NAME column, bank as the VALUE). No export-code change; no per-type schema. Live-verified: 2 tasks → one BANK NAME column with ICICI BANK / BANK OF INDIA as values. |
| DETAIL-2 — the Trigger column was already present + populated with the requirement; owner chose to KEEP the name "Trigger" (not rename to "Requirement") | **NO-OP (owner decision)** — Trigger stays; operators should put the requirement there, not in a detail value. |
| DETAIL-3 — existing prod cases 20/21 hold bank-name-as-key data (pre-fix) | **OPEN (owner to decide)** — auto-migration is ambiguous (value is sometimes a date, sometimes a requirement); offer to re-map {bank: x} → {BANK NAME: bank} on request, else re-create. |

### KYC verifier — full case/task lockdown (2026-07-02, owner)

Owner: clicking a KYC queue row opened the full Case Detail page — the verifier should never reach case/task detail. Locked it fully (mig 0111): removed case.view from KYC_VERIFIER + removed the queue row-click; his own-task reference attachments moved to a kyc_tasks.view-gated endpoint (he keeps "see + download HIS attachments only").

| Finding | Disposition |
|---|---|
| LOCK-1 — KYC queue row-click navigated to /cases/:id (full case detail) | **FIXED** — `onRowClick` removed; the queue is terminal (export is the action). |
| LOCK-2 — verifier held case.view → could reach /cases, /cases/:id, /tasks (SELF-scoped, no leak, but more than his job) | **FIXED** — mig 0111 drops case.view from KYC_VERIFIER (constant + seed byte-consistent; roles.parity green). His perms now: page.dashboard, kyc_tasks.view, kyc_tasks.export. /cases + /tasks + case detail → 403. |
| LOCK-3 — attachment access was via /cases/:id/attachments (case.view) — closed by LOCK-2 | **REPLACED** — new GET /api/v2/kyc-tasks/:taskId/attachments + /:attachmentId/url (kyc_tasks.view), row-scoped to the verifier's OWN OFFICE task (foreign task → [] / 404, IDOR-safe). Web: the queue's Attachments count is a button → dialog → presigned download. Live-verified end-to-end; another verifier → [] + 404; no kyc_tasks.view → 403. |

## Section FE-CONSOLE-2026-07-02 — Frontend console/network audit (SoT `docs/audit/frontend-console-2026-07-02/CONSOLE_AUDIT.md`)

Per-page console-error/failed-network audit (29 routes × SUPER_ADMIN + KYC_VERIFIER role + full interaction pass). App was **exceptionally clean** — zero console errors/warnings anywhere. 4 findings:

| Finding | Disposition |
|---|---|
| FE-CONSOLE-1 (F-001) — prod nginx CSP `style-src 'self'` (no `'unsafe-inline'`) blocks Sonner's runtime-injected `<style>` → toasts invisible on prod | **FIXED** — `infra/prod/nginx.conf` (×3 headers) → `style-src 'self' 'unsafe-inline'`. Confirmed on LIVE prod via curl (header + blast-radius = Sonner only, the sole CSS-in-JS dep; app CSS ships as `<link>`, React `style={{}}`=CSSOM). Loosens the ADR-0082 CSP on **style-src only** — `script-src` stays strict `'self'` (cannot execute JS); owner-approved 2026-07-02. |
| FE-CONSOLE-2 (F-002) — `GET /users/me/photo-url → 404` once per page (no-photo state) | **WONTFIX** — by-design existence check; `UserMenu`/`UserPhoto` both catch 404→null (no console error, initials fallback). Mobile uploads/reads via this endpoint → changing it risks mobile for zero benefit. |
| FE-CONSOLE-3 (F-003) — global-header `ActiveSelectionSelector` fired masterdata `/clients\|products/options` (require `page.masterdata`) unconditionally → 403 retry-storm on every page for KYC_VERIFIER/FIELD_AGENT | **FIXED** — `ActiveSelectionSelector.tsx`: both `useQuery`s + `clientProducts` gated on `enabled: has('page.masterdata')`. Every `page.operations` role that uses the selector also holds `page.masterdata`, so no regression. Verified: KYC 0 calls, SA selector still works. |
| FE-CONSOLE-4 (F-004) — `/admin/*` routes rendered full page chrome + fired forbidden data calls for unauthorised roles (manual-URL, API-enforced so no leak) instead of the ops pages' clean "no access" state | **FIXED** — new `RequirePerm` wrapper in `App.tsx` on all 29 `/admin/*` routes (perm mirrors `Layout.tsx`); blocks mount ⇒ page never renders, no forbidden queries fire. Verified: KYC→admin = "no access", 0 forbidden calls; SA renders. |

## Section UPPERCASE-2026-07-03 — UPPERCASE/capital-letter consistency audit (ADR-0058, SoT `docs/audit/uppercase-consistency-2026-07-03/UPPERCASE_AUDIT.md`)

Exhaustive both-direction audit of ADR-0058 across every FE field × form/grid/record-page input × import column × export column × the display CSS (6 parallel reader agents + adversarial re-check + real API round-trips incl. a real CSV import). **Verdict: mechanism very well implemented — 0 live Direction-B violations, no CRITICAL/HIGH. ✅ **SHIPPED + LIVE 2026-07-03** (origin/main `e7e4e1c`; deploy `28639683915` SUCCESS, health 200) — UA-1/OD-1/OD-4/UB-2/UB-3 + tests; `pnpm verify` green (api 1056). Deferred: OD-2/OD-3/UA-3/UA-4. Evidence:** direct create `acme test bank ltd`→`ACME TEST BANK LTD`; user email `MixedCase@Example.COM`→verbatim + name→UPPER same request; CSV import `zeta imported bank`→`ZETA IMPORTED BANK`.

| Finding | Direction | Disposition |
|---|---|---|
| UPPERCASE-UA-1 — `tatPolicies.label` (create+revise) missing `.transform(toUpper)` (whole module zero `toUpper`); no web CRUD but the API contract exists → direct-API/seed stores mixed-case. Short display label, not prose. | A · LOW | **FIX** (Cluster 1) — add `.trim().transform(toUpper)` at `packages/sdk/src/tatPolicies.ts:35,42`. |
| UPPERCASE-UA-2 — `rates.clientRateType` has no SDK transform | A · INFO | **WONTFIX/optional** — non-issue: create+revise resolve the code → `rate_types.id` via `WHERE code = UPPER($5)` (`rates/repository.ts:130,182`); the string is never stored as display text. Optional `.transform(toUpper)` for contract honesty. |
| UPPERCASE-UA-3 — `UserAccessSection.tsx:304` ValuePicker bare `<input>` (VALUE-kind scope grant) not uppercased on type | A · LOW (latent) | **DEFER** — VALUE dims (CITY/STATE) removed from the scope catalog (ADR-0072) → dead branch; server-validated. Swap to `<Input>` only if re-added. |
| UPPERCASE-UA-4 — legacy pre-ADR-0058 rows show mixed-case in exports/PDF (no CSS layer there) | A · LOW | **WONTFIX** — ADR-0058 §6 no-backfill by design; new writes are normalized. One-time `UPDATE` if verbatim historical exports are ever mandated. |
| UPPERCASE-UA-5 — MIS export filename slug `mis-<type.toLowerCase()>` | A · INFO | **WONTFIX** — cosmetic lowercasing of a code-owned report-type enum in the filename; not a user value/identifier. |
| UPPERCASE-UB-1 — predicate phone blind-spot: `CASE_SENSITIVE_NAME_TOKENS` has no phone/mobile/tel token → a TEXT-typed phone field would uppercase. Harmless today (every phone `<Input>` sets `uppercase={false}` + digit-filter). | B · LOW (latent) | **TESTS now** (pin behavior, `uppercase.test.ts`) + **OD-4** (owner: add phone tokens). |
| UPPERCASE-UB-2 — Tailwind `.uppercase` utility (`@layer utilities`) out-layers the `.font-mono` verbatim carve-out (`@layer base`) → `.font-mono` not guaranteed verbatim. Today only co-occurs on already-uppercase rate-type enum codes → no live corruption. | B · LOW (footgun) | **FIX** (Cluster 2) — drop the redundant `uppercase` from the ~6 mono code-spans. |
| UPPERCASE-UB-3 — `[contenteditable='true']` carve-out matches only the literal `="true"`; bare/`=""`/`plaintext-only` not exempted. No contenteditable in the app today. | B · LOW (latent) | **FIX** (Cluster 2) — broaden to `[contenteditable]:not([contenteditable='false'])`. |
| UPPERCASE-OD-1 — remark/reason prose casing. **Corrected finding:** mobile ALSO uppercases remarks on type (`crm-mobile-native` `installUppercaseDefaults.ts` + `UppercaseTextInput`; `remarks` not excluded) → web + mobile already agree, **no live inconsistency** (only a raw direct-API write bypassing both apps stores mixed-case). | A/B · OWNER | ✅ **FIXED (owner 2026-07-03: keep uppercase + add server net)** — `.transform(toUpper)` on the 6 web/office remark/reason fields (`packages/sdk/src/cases.ts`: Complete/RecordResult/CaseFinalize/Revoke/Rework/Reassign). Idempotent for web + mobile (already upper); normalizes any direct-API write. Mobile evidence path (verification-tasks `FormSubmissionSchema` jsonb) untouched (ADR-0054). cases API 107/107. |
| UPPERCASE-OD-2 — `verificationUnit.resultSet[]` outcome labels are Title-Case (`'Positive'`); uppercasing risks device outcome matching (canonical = separate `outcomeCode`). | A · OWNER | **OWNER-DECISION** — rec: **WONTFIX** (keep Title-Case). |
| UPPERCASE-OD-3 — `savedViews.name` private per-user view label (web uppercases on type, SDK verbatim) | A · OWNER | **OWNER-DECISION** — rec: **WONTFIX** (private artifact, low stakes). |
| UPPERCASE-OD-4 — add `phone`/`mobile`/`tel` to the frozen `CASE_SENSITIVE_NAME_TOKENS` (closes UB-1) | B · OWNER | **OWNER-DECISION** (exclusion-set change) — rec: **add the 3 phone tokens.** |

**Clusters safe to ship without owner input:** 1 (tatPolicies.label), 2 (CSS UB-2/UB-3), 3 (predicate regression tests — behavior-preserving). **Owner-gated:** OD-1 (remark/reason), OD-4 (predicate tokens).

## Section KEYBOARD-NAV-2026-07-03 — Keyboard-navigation & focus-management audit (WCAG 2.1 AA + DATAGRID_STANDARD §19/§20 + axe gate 29, SoT `docs/audit/keyboard-nav-2026-07-03/KEYBOARD_NAV_AUDIT.md`)

Exhaustive keyboard/focus audit of the whole FE (6 parallel reader agents: shared primitives · DataGrid · overlays · pages/mouse-only · CSS/skip-link/Layout · Playwright coverage → merge/dedupe by WCAG SC → **live browser keyboard verification**). **Verdict: app in excellent keyboard shape — no High/Critical, no unreplaced `outline:none`, 21/22 overlays correctly `useFocusTrap`, 245 `onClick` sites with zero mouse-only handlers.** Re-verifies prior sweep **H-10** holds (DataGrid header/row keys, `.input` ring, skip-link, combobox all intact) and the H-10 P3 menu-roving deferral is re-affirmed. The one real cluster is the **inline-cell-edit** path (ADR-0051, postdates H-10). Live evidence: `/admin/locations` 150 editable cells all `tabIndex=-1` (keyboard cannot open editor); `/mis` tabs both `tabIndex=0`, `aria-controls=null`, ArrowRight inert; mobile sidebar backdrop a focusable `<button>` w/o `aria-hidden`.

| Finding | WCAG | Sev | Disposition |
|---|---|---|---|
| KN-1 — DataGrid editable cell opens on **mouse-click only** (`<td tabIndex=-1>`, no `onKeyDown`); 5 inline-edit grids. *Live-confirmed.* | 2.1.1 | Med | **FIX** (Cluster A, shared `DataGrid.tsx`) |
| KN-2 — focus lost to `<body>` after cell commit/cancel (no restore) | 2.4.3 | Med | **FIX** (Cluster A, with KN-1) |
| KN-3 — `UsersPage:250` "Export failed" alert un-trapped bare `<div>` (twin `RolesPage:231` correct) | 2.1.2/4.1.2 | Med | **FIX** (Cluster B, mirror RolesPage) |
| KN-4 — expander-only rows not row-level keyboard-reachable (chevron works → partial) | 2.1.1 | Low | **FIX** (Cluster A, gate `onRowClick\|\|renderExpanded`) |
| KN-5 — Tabs no roving/Arrow/Home-End, no `aria-controls`/`tabpanel`; operable via Tab+Enter. *Live-confirmed.* | 4.1.2 | Low | ✅ **FIXED** — roving `tabIndex` + Arrow(L/R)/Home/End + wrapping + auto-activation (`Tabs.tsx`); optional `aria-controls` via new `panelId` prop. Call-site `role="tabpanel"` wiring **DEFERRED** (panels are conditional swaps — needs persistent render for valid ARIA; marginal benefit). |
| KN-6 — `useFocusTrap` backdrop-close orphans focus + sidebar backdrop `<button>` missing `aria-hidden`; Escape-close fine. *Live-confirmed.* | 2.4.3 | Low | ✅ **FIXED** — sidebar backdrop → `aria-hidden` + `tabIndex=-1` (mirrors DataGrid menu backdrops), so mouse-close no longer moves focus onto it (root cause; hook restore logic unchanged). Live-verified: backdrop-close restores focus to the hamburger. |
| KN-7 — `onRowClick` `<tr>` no `role="button"` | 4.1.2 | Low | **WONTFIX (reconsidered)** — `role="button"` on a `<tr>` strips its table-row semantics (AT stops reading it as a row of cells) — net-negative for a Low nicety; the row is already keyboard-operable (2.1.1 ✓). |
| KN-8 — `SearchableSelect` missing Home/End + blur race | 4.1.2 | Low | ✅ **FIXED** — Home/End added to the combobox `onKeyDown` (`SearchableSelect.tsx`). Blur-close race left as-is (functional). |
| KN-9 — `MisPage:199` Popover omits `panelLabel` (other 3 consumers pass it) | 4.1.2 | Low | ✅ **FIXED** — `panelLabel="Columns"` added (`MisPage.tsx:200`). |
| KN-10 — `role="menu"` popovers Tab-not-Arrow (**= H-10 P3 deferral**) | 4.1.2 | P3 | ✅ **FIXED (owner reversed the deferral)** — opt-in `arrowKeys` on `useFocusTrap` (Arrow/Home/End roving, guarded off in text fields); enabled on Columns/Export/filter-select/SavedViews menus. Live + Playwright verified. |
| KN-L1..L5 — `offsetParent`/`fixed` latent, nested-Escape, `tabIndex=-1` cleanup, no bg-`inert`, no route-change focus | — | Info | **NOTE / WONTFIX / DEFER** (no live bug) — unchanged. |
| KN-T1 — Playwright regression cover | — | — | ✅ **FIXED (behavioral)** — new specs: inline-edit keyboard entry+return (`locations.spec.ts`), menu roving (`datagrid.spec.ts`), Tabs roving (`tabs.spec.ts`). axe-route expansion (`/kyc-queue`,`/mis`) **DEFERRED** (needs per-role storage-state / could surface unrelated pre-existing violations — separate follow-up). |
| KN-T2 — doc drift: `CI_CD_STANDARDS.md:45,91` "gates CRITICAL" but code gates serious+critical | — | — | ✅ **FIXED** — both spots → "gates SERIOUS + CRITICAL". |

**Status: ✅ SHIPPED + LIVE on prod 2026-07-03 (`56d264b`; deploy `28642530658` + ci `28642530668` both SUCCESS, health `ok`) — owner chose "Compliance + APG roving (A–E)".** Root-cause fixes at the shared source (DataGrid / `useFocusTrap` / Tabs / Popover / Layout), no per-call-site patching. `pnpm verify` FE subset green (typecheck·format·no-suppressions·boundaries·web vitest 69·web build) + Playwright a11y suite green (26, incl. all 22 axe scans + 2 overlay scans) + 3 new keyboard specs green + **real-browser key-press verified** (inline-edit Enter-opens/Escape-returns; menu Arrow/Home/End+Escape-restore; Tabs roving+wrap; backdrop-close focus-restore). No design-token change; standard WCAG keys only. **Reconsidered during build:** KN-7 WONTFIX (role=button degrades row semantics); KN-1 uses a focusable cell + `title` hint (NOT `role="button"`+`aria-label`, which would hide the cell value from AT). **Deferred:** KN-5 tabpanel call-site wiring, KN-T1 axe-route expansion, KN-L* latent.

## Section BILLING-COMMISSION-SPLIT-2026-07-03 — Separate Billing from Commission + redesign the Billing page (ADR-0086, mig 0112)

Frozen-area **structural refactor + redesign** (billing/commission data-model · RBAC · routes · nav · UI): owner wanted Billing and Commission fully separated + the Billing page rebuilt. **DISCUSS → ADR-0086 (owner-signed §3.5 a–d) → build in 2 slices** (5 parallel reader agents mapped the exact change-sites first). Key finding that de-risked it: **`billing.view` is the platform-wide MONEY-GATE** — Pipeline + MIS + the mobile-facing tasks read-model include bill AND commission ₹ only for `billing.view` holders; `billing.commission_summary.view` gated ONLY the commission page/endpoints. So the split **leaves `billing.view` untouched → zero money-gate regression**, proven.

| Finding | Disposition |
|---|---|
| BCS-1 — commission mixed into the `/billing` page (Commission column + line-totals + ADR-0046 §6 breakdown panels) | ✅ **FIXED (slice 1)** — removed from the billing surface: SDK DTOs (`commissionTotal`/`commissionAmount` dropped), repo `listCases`/`caseTasks`/`breakdown` SELECTs, `BillingPage` UI; billing **export** now bill-only. Commission math re-pointed to the Commission surface (`/commission-detail` + `/commission-summary`) — SAME numbers, coverage preserved (verified diff: no expected number changed). |
| BCS-2 — Commission Summary hung off the `/billing/commission-summary` sub-route | ✅ **FIXED (slice 1)** — promoted to top-level **`/commission-summary`** + own Operations nav item (`App.tsx` route + the page's inline perm check, consistent with sibling Operations routes). Nav "Billing & Commission" → **"Billing"**; a perm-gated Billing→Commission link added. |
| BCS-3 — commission perm namespaced under `billing.` | ✅ **FIXED (slice 1, mig 0112)** — renamed `billing.commission_summary.view` → **`commission_summary.view`** (triple-write: `@crm2/access` catalog value+key + META group 'Commission' + `ROLE_PERMISSIONS` mirror; **mig 0112** in-place `UPDATE role_permissions` = **grant-carry**, no role loses access, idempotent/re-run-safe). `billing.view` untouched; Commission Rates stays on `masterdata.manage`. Dev-DB verified: MANAGER+BACKEND_USER carried, 0 stale, `billing.view` intact. |
| BCS-4 — RBAC money-gate regression risk (Pipeline/MIS/mobile) | ✅ **NONE (re-audited)** — `billing.view` money-gates in `modules/tasks` + `modules/mis` untouched; roles-parity test green; api 1056 tests green. Mobile does NOT consume `/billing/*` (contract:mobile module list + ADR-0054 scope) — `/api/v2` additive-safe. |
| BCS-5 — Billing page redesign (owner c, brief refined 2026-07-03 on seeing the decoupled page) | ✅ **BUILT (slice 2)** — owner rejected breakdown panels + per-case rollup → **flat Salesforce/Twenty list view**: one row per COMPLETED billable task, all detail columns (Case·Client·Product·Verification Unit·Assignee·Rate Type·TAT Band·Location·Units·Bill·Completed), search + client/date + column filters + export + row-click→case; NO accordion, NO panels. New flat `GET /billing/lines` (+`/lines/export`) **replaces** `/billing/cases`, `/cases/:id/tasks`, `/breakdown` (web-only, mobile-unaffected). Derived / export-only (owner 2026-06-25) — no new DB. |

**Review (2026-07-03): 5 adversarial reviewers (CEO / CTO / Designer / Security / Code-Quality) → 4 SHIP + 1 SHIP-WITH-FIXES; 0 blocker, 0 critical/high-security, 0 correctness bug.** Independently verified in code: `billing.view` money-gate untouched (Pipeline/MIS/mobile), no SQL-injection (sort/filter whitelisted, values bound), IDOR-safe scope + export gate, RBAC rename exact + grant-carry, and the test reshape preserved every number with no weakened assertions. **Post-review fix cluster applied:** filter-aware **bill-total footer** (`GET /billing/lines/summary`, reuses the same WHERE) via an opt-in DataGrid `footerSummary` slot; **per-column filters** (Client/Product/Verification Unit/Rate Type) + a **TAT-band** enum filter on the derived band; the search placeholder now names pincode; 2 stale doc-comments fixed; API tests added for the summary + column/TAT-band filters + the JOINed columns. Deferred (known ceilings, not regressions): perf partial `status='COMPLETED'` index (100k+ scale), ISO-validate the legacy date params, an "unrated task" flag.

**Status: ✅ SHIPPED + LIVE on prod 2026-07-03 (`8c17afa`; deploy `28651050050` + ci `28651050177` both SUCCESS; prod-verified — `/billing/lines`+`/lines/summary`+`/commission-summary` 401-live, old `/billing/cases`+`/breakdown` 404-removed; mig 0112 grant-carry applied via `migrate.sh`).** Both slices + the fix cluster: `pnpm verify` green (typecheck·lint·format·no-suppressions·boundaries·api·sdk·web·build) + API integration green (`:5433`, `LC_ALL=C`) + Playwright e2e 29 + browser-verified (flat Billing grid + bill-total footer + column filters; `/commission-summary` promoted route; nav relabeled; dev-DB perm grant-carry). SoT: [ADR-0086](adr/ADR-0086-billing-commission-separation.md) + [kickoff](plans/2026-07-03-billing-commission-separation-kickoff-prompt.md). **Next mig = 0113, next ADR = 0087.**

## Section MOBILE-ATTACHMENT-PHOTO-LEAK-2026-07-03 — Device Attachments view: FIELD_PHOTO leak + doc download failure (CASE-000024)

Owner-reported on CASE-000024: (1) field verification photos appeared under the mobile **Attachments** button; (2) the task-creation attachment did not load. **Diagnose-first session** (systematic-debugging): reproduced against prod data read-only (CASE-000024 = 1 OFFICE_REF doc + 6 FIELD_PHOTOs, all task-linked) + a faithful local repro (dev stack, real MinIO); both root causes verified BEFORE fixing; failing tests written first.

| Finding | Disposition |
|---|---|
| MAP-1 — `attachmentsForDeviceTask` (`cases/repository.ts`) was the ONLY attachment reader with no `kind` filter → `GET /verification-tasks/:id/attachments` returned FIELD_PHOTO rows into the device Attachments list (attachment ⟂ photo invariant broken) | ✅ **FIXED** — `AND ca.kind = 'OFFICE_REF'` guard at the shared query (every sibling already discriminates); regression test: task with doc+photos returns ONLY the doc. |
| MAP-2 — the doc row WAS returned but could not download: the app fetches the presigned `url` with its Bearer header → S3/MinIO **400 "multiple authentication types"** (verified empirically on MinIO), and both of the app's fallback URLs (`/attachments/:id/content`, `GET /verification-tasks/:id/attachments/:id`) were 404 in v2 | ✅ **FIXED (server-side, additive)** — new `GET /verification-tasks/:id/attachments/:attachmentId` (task.execute, ownership + OFFICE_REF + case-level-or-this-task, IDOR-safe 404) streams the bytes; the installed app's existing 3rd fallback candidate now succeeds → **no mobile release needed**. Edge-side `Authorization`-strip rejected (API's own S3 calls ride the same `/crm2-prod/*` path with header auth). |
| MAP-3 — durable mobile-side root cause: `AttachmentService.downloadAndCache` sends `Authorization: Bearer` on presigned URLs | ⏸ **DEFERRED (separate repo, owner-release-gated per ADR-0054)** — fix = skip the Authorization header when the URL carries `X-Amz-Signature`; until then the server fallback route carries the load (2 dead attempts per open: 400 + 404). |
| MAP-4 — test gap: the device-attachments test seeded only OFFICE_REF rows, so the leak was invisible | ✅ **FIXED** — mixed-kind list test + content-route test (owner 200+bytes, case-level doc 200, photo-id 404, other-task doc 404, non-assignee 404). |
| MAP-5 — the TaskCard **Attachments badge** ALSO leaked (owner screenshot: badge "7" on CASE-000024 = 1 doc + 6 photos): the sync download's `attachment_count` subquery (`sync/repository.ts`) had the same missing `kind` filter; a full `case_attachments` reader sweep found one more count without a kind predicate (KYC queue `attachmentCount` column — no live leak possible on OFFICE tasks, guarded for consistency) | ✅ **FIXED** — `AND ca.kind = 'OFFICE_REF'` in the sync count (badge now matches the list it opens); KYC column count → `kind IS DISTINCT FROM 'FIELD_PHOTO'` (mirrors its own list query). Sync test extended: photos don't count. NOTE: delta sync watermarks on task/case `updated_at`, so an already-synced device shows the corrected badge only after a full sync or the next task update. |

**Status: ✅ SHIPPED + LIVE on prod 2026-07-03 (`e64d868`; containers `crm2_api`/`crm2_edge` on tag `e64d868` healthy, health 200, no rollback). Deploy run `28671779425` shows red ONLY because its final external-smoke step hit a GitHub-runner DNS outage (`curl: (6) Could not resolve host` — gate + build + blue-green all succeeded); ci run `28671779427` red = stale committed `openapi.json` (contract test needs DATABASE_URL, so local `pnpm verify` skips it) — regenerated (+ new route, 268 paths) in the follow-up commit. Mobile repo `feat/v2-native-sync` (LOCAL, release-gated ≥1.0.75): `e2caeb9` = MAP-3 presigned-header fix BUILT; `4839de4` = Submitted tab/tile keeps office-COMPLETED history (owner 2026-07-03).** `pnpm verify` green + API integration green (`:5433`, `LC_ALL=C`; verification-tasks 19 + cases 107 + kycTasks 8) + real-stack round-trip verified (dev DB + real MinIO + running API as a FIELD_AGENT: list=doc-only; presigned+Bearer reproduces the 400; content route streams exact bytes; photo-id 404). Web/case attachment, field-photo, and KYC OFFICE_REF surfaces untouched and re-run green. No migration, no ADR (additive endpoint + guard on an existing contract). SoT: [kickoff](plans/2026-07-03-mobile-attachment-photo-leak-diagnosis-kickoff-prompt.md).

---

## Section AWS-HOSTING-2026-07-04 — AWS production hosting + two-branch deploys (ADR-0087)

| Item | Disposition |
|---|---|
| Full-platform 2026-07-02 **MON-1 / shortlist #3 (DATA-LOSS: no DB or file backups)** — backup half | ✅ **FIXED by the hosting move** — RDS `crm2-prod` 7-day point-in-time recovery + daily EC2 EBS snapshots (DLM `policy-07205285092f6cf77`, 03:30 IST, keep 7) + S3 eleven-nines durability replace the zero-backup single box. The alerting + health-depth halves of the monitoring cluster remain PENDING with the rest of the full-platform dispositions. |
| Old-box certbot renewal for `crm.allcheckservices.com` would fail forever post-DNS-move (webroot challenges now land on the ALB) | ✅ **FIXED** — cert deleted from the staging box (`certbot delete`); staging has its own `staging.crm.allcheckservices.com` cert (expires 2026-10-01, auto-renews via the existing webroot+timer); prod TLS is ACM-managed (auto-renew, no certbot). |
| Legacy `pg`-driver RDS gotcha (`sslmode=require` treated as verify-full) | ✅ **FIXED** — `DATABASE_URL` carries `sslrootcert=/run/secrets/rds-ca.pem`; the RDS CA bundle is mounted into both db-touching containers (`docker-compose.aws.yml`), giving CA-verified TLS to RDS (stronger than the old plaintext-in-compose-network posture). |

**Status: ✅ SHIPPED + LIVE 2026-07-04** — prod deploy run `28680980243` + staging run `28681075451` both SUCCESS; `https://crm.allcheckservices.com` serves from AWS (ACM cert, 301 HTTP→HTTPS), `https://staging.crm.allcheckservices.com` from the old box. Data cut over under freeze with exact per-table `count(*)` parity. SoT: [ADR-0087](adr/ADR-0087-aws-production-hosting.md).

---

## Section AWS-HARDENING-2026-07-07 — RDS at-rest encryption + S3 image lifecycle (ADR-0091; AWS-side, no app code)

Two independent AWS-side fixes surfaced in the 2026-07-07 cost/capacity review at real ~25k-cases/mo
volume. No application code, no schema/migration. Fix 1 needed a brief write-freeze (done in a
zero-traffic, owner-authorized window); Fix 2 is additive config, zero downtime.

| Item | Disposition |
|---|---|
| **RDS at-rest storage encryption OFF** (`crm2-prod` launched `StorageEncrypted=false` under ADR-0087; the deferred watch-item) | ✅ **FIXED (ADR-0091)** — snapshot → `copy-db-snapshot --kms-key-id alias/aws/rds` (free AWS-managed key) → restore as new **`crm2-prod-enc`** (mirrors db.t4g.medium / param group `crm2-pg18` / db SG `sg-031b15b6166bed497` / `default` subnet / gp3 20 GB / private / single-AZ / port 5432; retention 7 + deletion-protection + copy-tags set post-restore) → cutover under an api write-freeze. Verified before flip: exact per-table `count(*)` parity (51 tables / 157,546 rows), `SHOW timezone`=Asia/Kolkata, TLS in use; after flip: `StorageEncrypted=true`, migrate no-op, api healthy, external ALB `/api/v2/health` 200 + DB-path login probe 401. `DATABASE_URL` host `crm2-prod`→`crm2-prod-enc` in the box `.env.prod` (CA/query unchanged). Old `crm2-prod` instance, its automated snapshots, and the unencrypted `crm2-prod-preenc-<stamp>` snapshot **deleted same day** (owner: pre-production, no rollback window needed); encrypted `crm2-prod-enc-<stamp>` snapshot kept as cutover anchor; 2 RDS CloudWatch alarms repointed to `crm2-prod-enc`. |
| **DATABASE-04** (field-level `case_applicants.name/mobile/pan` plaintext + index) — does this close it? | 🟡 **STILL DEFERRED** — storage/volume encryption is a *different layer* than field-level column encryption; it neither closes nor conflicts with DATABASE-04, which still needs its own searchable-encryption ADR. Cross-noted on the DATABASE-04 entry. |
| **S3 image storage compounding** (`crm2-prod-824826126880`, no lifecycle rules; ~310 GB/mo new at 25k cases/mo in Standard) | ✅ **FIXED (config, no ADR)** — lifecycle → **S3 Intelligent-Tiering** on `field-photos/`, `case-reports/`, `attachments/` (owner chose Option A over Glacier-IR: no retrieval fees, millisecond/presigned access always, auto-tiers by real access; only a small monitoring fee). `users/` avatars left in Standard by design. Added abort-incomplete-multipart-uploads-after-7d (whole bucket). Public-access-block confirmed ON; SSE-S3 (AES256) default already on. Verified: `get-bucket-lifecycle-configuration` shows 4 rules; presigned GET on a live object returns 206 (access unbroken). |

**Status: ✅ SHIPPED + LIVE 2026-07-07** — prod RDS encrypted at rest (`crm2-prod-enc`, KMS `aws/rds`), prod S3 on Intelligent-Tiering. AWS-side only; no deploy, no app change. SoT: [ADR-0091](adr/ADR-0091-rds-storage-encryption.md). Owner follow-up CLOSED same day — old instance + ALL unencrypted snapshots deleted (pre-production call), incl. `crm2-pre-cleanup-20260704`; **zero unencrypted RDS artifacts remain** (only `crm2-prod-enc` + its encrypted snapshots).

---

## Section ADMIN-MASTERDATA-UX-2026-07-07 — Admin master-data configuration UX audit (AUDIT-ONLY)

Owner-requested full FE+BE+DB+ADR review of the admin config chain (clients → products → CPV →
rate types → rate-type assignments → rates → commission rates, incl. XLSX/CSV import-export).
SoT: [docs/audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md](audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md).

**Dispositions (updated 2026-07-08):**
- **✅ FIXED — Batch 1 shipped** (branch `feat/masterdata-ux-quickwins`, commits `f7c1a0e..fb0176d`; every task TDD + reviewer-gated [2 fix loops] + browser-verified; full `pnpm verify` exit 0; final 3-lens whole-branch review MERGE_READY ×3, 0 Critical/Important): **UX-3** two-state gating messages + deep-links · **UX-4** friendly `RATE_EXISTS`/`COMMISSION_RATE_EXISTS` copy · **UX-5** rate-types import/export (engine clone) · **UX-9** Field/Office toggle guard **+ Clear-fields recovery** (review catch: disable-guard alone was a dead-end vs SearchableSelect's missing clear) · **UX-11** RTA `POST /bulk-deactivate` + ids dedup at the shared validator · **UX-12** lock affordance on immutable code cells · **UX-13** rate-history CSV export (web-local CWE-1236 guard, byte-parity with the api engine).
- **✅ FIXED — Batch 3 shipped (UX-1 + UX-2, ADR-0092)** (branch `feat/client-setup-hub` merged → `main` @ `8d38e44`, **LIVE on staging + prod 2026-07-08**; commits `32d7675..8ec2616` + follow-ups `bda9dd0` picker-gating / `433dd8f` nav groups; 15 tasks, each TDD + reviewer-gated [7 fix loops, 2 opus-reviewed write paths]; per-slice `pnpm verify` exit 0 ×6; browser/live-API verified per slice incl. a full workbook round-trip on crm2_dev [6 `import_log` rows proven]; Playwright journeys A+B; final 3-lens whole-branch review **MERGE_READY ×3** [CTO/arch · Design/governance · Security/RBAC] + accepted-fix cluster `8ec2616`):
  **UX-1** → `/admin/client-setup` hub (client picker + 4-step stepper embedding CpvPage/RTA/Rates/Commission via one controlled `clientId?` prop; `?returnTo=`/`?clientId=` on the record pages via the `safeReturnTo` open-redirect guard; completeness checklist w/ blocked/incomplete/complete/skipped states, commission count `masterdata.manage`-gated, "—" for unknown).
  **UX-2** → onboarding workbook (`GET /clients/:id/onboarding-template` 5-sheet pre-filled XLSX + `POST /clients/:id/onboarding-import?mode=preview|confirm`; cross-sheet pending projections [codes/pairs/tuples incl. same-sheet CPV phase-1→2]; ordered rebuild-and-confirm; CPV two-phase = 2 audit rows; per-sheet AND total 10k caps + `NOT_XLSX` 400; workbook-only CPV `unitCode` Universal delta — standalone CPV import unchanged).
- **✅ IMPLEMENTED — UX-8 (b)-for-workbook** (owner pick 2026-07-08, ADR-0092): `CLIENT_MISMATCH` / `CPV_LINK_MISSING` / `RATE_TYPE_NOT_ASSIGNED` / `UNKNOWN_RATE_TYPE` refuse dead rows at BOTH preview and confirm on the workbook surface only; **(a) unchanged for existing endpoints**. **Named residuals (accepted):** direct-API create + per-module single-sheet imports + the §4.7 huge-catalog fallback can still create operationally-dead rows; option (c) `warnings[]` on per-module imports = named future tightening.
- **📎 Batch-3 registry residuals** (final-review triage 2026-07-08, all non-blocking): **fast-follow (named):** workbook runner re-parses the buffer per sheet (~11×/request, sequentialized post-review — single-`Workbook`-load refactor + decompressed-size bound is the real fix; SA-only surface). **Watch-seam:** ADR-0067 availability now lives in 2 places (`rateTypes/repository.available` SQL + workbook `wildcardCovers` — cross-referenced in code; future changes must touch both). **Cosmetic/latent:** hub deep-link loading flash; embedded-CpvPage raw-id label while options load; double h1 inside embeds (reuse-unchanged tradeoff); UX-3 CPV link inside RTA record page exits the hub (pre-existing copy); a real unit coded `UNIVERSAL` is unreachable from the workbook (spec-mandated blank/'UNIVERSAL'→NULL); phase-1 link `effectiveFrom` is earliest-vs-now; workbook re-run cannot reschedule an existing link (create-only, matches standalone); co-occurring product error surfaces on the next round-trip; guard codes are message prefixes (no structured `ImportRowError.code`); `wildcardCovers` skips `rt.is_active` re-check (safe direction); e2e nits (empty-DB skip branch unexercised; RTA nav clientId asserted implicitly).
- **⏳ Batch 2 built (pending merge) — UX-6/7/10**: CPV bulk unit-enable (`POST /cpv-units/bulk`, SAVEPOINT reactivate-on-conflict — the audit-era "idempotent single-create" claim was wrong, single-create 409s and stays untouched) + paginated sub-table · pincode-not-found message (**live on Commission's free-type input; structurally unreachable on the Rate page's suggestion-fed SearchableSelect — accepted, documented**) · commission User/Client filters (params pre-existed server-side) + OFFICE optgroup/location-less hygiene + TAT via unpaginated `/options`.
- **❌ RETRACTED — UX-14** (2026-07-08): "import is XLSX-only" was FALSE — CSV import shipped in the repo's first commit (engine magic-byte-sniffs; `format.ts:159/147/110-142`; ImportModal accepted `.csv`). The stale `format.ts:6` doc comment ("XLSX only for now") misled the audit and two of its agents. Batch 2 T10 = 11 pinning tests + dual-format browser proof; doc-comment fix spun out as its own task.
- **UX-15** stays DEFERRED (documented, owner later).
- Side-artifacts: RTA deactivate audit-gap spun out as its own task (chip `task_0fcb13e5`); audit's CPV "blank unit = Universal" import claim corrected 2026-07-08 (Universal CPV is UI-only today).

**Original audit summary (15 findings UX-1…UX-15, 0 security-critical).** Headlines:
onboarding one minimal client ≈ 27 page visits / 35 submissions with the dependency order invisible
(UX-1); six separate imports for one client's bulk setup (UX-2); misleading picker-gating messages +
generic 409 overlap errors (UX-3/4); Rate Types is the only master-data page without import/export
(UX-5); rate-type availability + CPV linkage are UX-gated only — the 0012 DB eligibility trigger was
dropped in mig 0013 and nothing server-side replaced it (UX-8, decision item). Recommended sequencing
in the report: quick-win message/parity batch (no ADR) → bulk-entry batch → strategic Client-Setup
hub + single onboarding-workbook import (needs ADR). No code changed in this audit.
