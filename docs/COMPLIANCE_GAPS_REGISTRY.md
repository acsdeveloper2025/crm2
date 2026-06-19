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
| B-7 | Background-job UX | DEFERRED | `docs/PAGINATION_AND_LOADING_STANDARDS.md` §10–11 | Exports / workers phase |
| B-8 | Skeleton loading | ✅ **FIXED** (2026-06-09, Slice 9) — skeleton now band-gated to 300 ms–1 s (§6); 0–300 ms renders nothing (no flicker) | `docs/PAGINATION_AND_LOADING_STANDARDS.md` §6/§9 | Full §6 time-band ladder live in the DataGrid (`>8s`=background job stays DEFERRED → B-7) |
| B-9 | Hexagon loader (real %) | ✅ **FIXED** (2026-06-09, Slice 9) — `components/ui/HexagonLoader.tsx`; geometric hexagon, determinate (real % for staged jobs) + indeterminate (single-stage waits); reduced-motion-safe | `UI_STANDARDS.md`, `docs/PAGINATION_AND_LOADING_STANDARDS.md` §7/§8 | Indeterminate wired to the list-fetch now; determinate-% path awaits the operations/worker jobs (reports/MIS/export) |
| B-10 | Playwright E2E + axe a11y | DEFERRED | `docs/CI_CD_STANDARDS.md` (19/29) | First UI flow; CI step already stubbed |
| B-11 | OpenAPI generation | ✅ **FIXED (phase 1)** (2026-06-15, ADR-0031) — `platform/openapi` derives an OpenAPI 3.1 doc from the LIVE app (paths/methods/tags/security, zero new deps); committed `apps/api/openapi.json` via `pnpm openapi`. Request/response **schemas = phase 2** (zod single source) | `DOCUMENTATION_AS_CODE.md` (ADR-0011/0031) | Surface contract shipped; schema bodies deferred to the responses-into-zod migration |
| B-12 | SDK drift detection | ✅ **FIXED** (2026-06-15, ADR-0031) — **validate-don't-replace** (hand-written SDK stays authoritative). Two gates: (1) CI Part 21 re-emits + `git diff --exit-code openapi.json` (every route); (2) contract test asserts committed spec is current AND every `@crm2/sdk` path resolves to a real route (SDK→route, 0 violations). Reverse not asserted (FE uses `api()` for import/bulk/export/dashboard → would rot an allowlist; git-diff covers them) | `docs/CI_CD_STANDARDS.md` (21), ADR-0031 | Response-shape drift caught in phase 2; request drift already prevented by shared zod |
| B-13 | Universal export (current view / selected / all-matching; XLSX/CSV/PDF; `≥10k`=job) | 🟡 **PARTIAL — current-view + all-matching + `selected` DONE on ALL 7 ADMIN LISTS** (XLSX/CSV, `<10k` sync; `selected` mode added 2026-06-09 with row-select); see progress log | `docs/IMPORT_EXPORT_STANDARD.md` + `docs/DATAGRID_STANDARD.md` | Remaining: ops **cases** export · PDF · ≥10k report-worker job tier (streaming builders). Ops **tasks** (Pipeline) export shipped with the list itself (2026-06-11, current/all/selected, scope-honoring). |
| B-23 | Row selection + bulk actions (DATAGRID_STANDARD §15) | ✅ **FIXED** (2026-06-09) — shared DataGrid selection (checkbox col + select-all-page + "select all N matching" banner + bulk bar) on all 7 admin lists; built-in **Export Selected** (B-13 mode 2) + **bulk Activate/Deactivate** (per-row OCC per CONCURRENCY_AND_EDITING_STANDARD §1, per-row OK/CONFLICT/NOT_FOUND result) | `docs/DATAGRID_STANDARD.md` §15, `docs/CONCURRENCY_AND_EDITING_STANDARD.md` §1/§7 | Selection captures row `version` (Map) for OCC; `allMatching` disables versioned bulk (export still works). DON'T-REGRESS: scoped-resource bulk must enforce scope inside the per-row apply fn. |
| B-14 | Universal import engine (`@crm2/import-engine`: template/validator/mapper/processor + flow + validation report + import audit) | DEFERRED | `docs/IMPORT_EXPORT_STANDARD.md` | First import need (Clients/Products/Rates/Pincode/Users…) |
| B-15 | Authentication (login / JWT-pair + refresh / password set, web) — **SHIPPED** (ADR-0014, mig `0009_auth.sql`): scrypt passwords + `jose` HS256, `/api/v2/auth/{login,refresh,logout}`+`/me`, web login + Bearer + single-flight 401→refresh; dev `x-test-auth` seam is backend-test-only now. | ✅ **FIXED** (ADR-0014) | ADR-0014, ADR-0012 | Remaining: mobile rebase to `/api/v2/auth` (separate repo) + refresh-revoke-on-password-change — tracked, short access TTL mitigates. |
| B-16 | Report rendering engine (Handlebars/text → PDF) + CPV-scoped template overrides (client+product+vtype) | DEFERRED | BLUEPRINT report-engine section | Reports/operations phase. Superseded/absorbed by B-18 (ADR-0015). |
| B-17 | Verification Workspace — single page (Zion NewDataQC): per-task data-entry/MIS · assignment · FE-mobile images+data · report entry · auto-gen · Final Status + Case Report | DEFERRED | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §1, ADR-0015 | Operations phase — reuse `/cases/:id` behind a flag. Keystone. |
| B-18 | Per-client+product Reporting Engine — two kinds (MIS_EXCEL + CASE_REPORT), formats PDF/WORD/EXCEL, field/column mapping (FE data+images+seal), 200+ formats config-driven; extends `report_templates` 0008 | DEFERRED | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §2, ADR-0015 | Operations phase — generation via report-worker (PDF) + export engine (Excel); seed 200+ via import-engine. |
| B-19 | Admin Template Designer (design/upload MIS-Excel + Case-Report templates per client+product[+type]; versioned, immutable-once-used) | DEFERRED | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §2.2, ADR-0015 | Administration — extends the shipped Report Templates module. |
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

### G-4 · MIS Layout `RATE_AMOUNT`/`COMMISSION_AMOUNT` column types ungated at generation — 🔵 IN PROGRESS → being FIXED by the MIS build (ADR-0049, 2026-06-19)
- **Severity:** LOW (no live leak today). **Finding:** these are bindable column *types* in the
  report-layout catalog (`packages/sdk/src/reportLayouts.ts:36-37`); **no generation endpoint exists**
  that turns them into money. No runtime exposure now.
- **Disposition:** The MIS generation/export build (ADR-0049, `docs/specs/2026-06-19-mis-page-design.md`)
  enforces **per-column `billing.view` gating at BOTH generation and export** — when `!billing.view`,
  `RATE_AMOUNT`/`COMMISSION_AMOUNT` columns are dropped server-side from the resolved column set, the
  SQL, and the `ExportColumn[]` manifest (the laterals are omitted entirely). Mark ✅ FIXED when the
  build ships + verifies (a non-`billing.view` actor's MIS + export carry no money).

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

### G-8 · `RATE_LATERAL` location ladder ranks a non-matching scoped rate above the location-less default — 🟡 DEFERRED (discovered 2026-06-19 during ADR-0046)
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

### G-9 · `toXlsx` omits the formula-injection escape that `toCsv` applies — 🔵 IN PROGRESS → being FIXED by the MIS build (ADR-0049, 2026-06-19)
- **Severity:** MEDIUM (latent across **all** XLSX exports; CWE-1236). **Finding:** `escapeCsvCell`
  (`apps/api/src/platform/export/format.ts:40-45`) prefixes a leading `= + - @ \t \r` with `'` and is
  applied by `toCsv` (`:47-52`), but **`toXlsx` (`:55-69`) writes raw cell values** — so a cell starting
  with `=`/`+`/`-`/`@` is a live formula when the XLSX is opened in Excel. Existing exports (billing,
  locations, tasks) carry mostly system-controlled text, so the leak was latent. The **MIS export**
  carries attacker-influenceable free text — `form_data` (`FORM_DATA_PATH`), `DATA_ENTRY_FIELD` values,
  `remark`/`address` — making it exploitable (`=HYPERLINK(...)`, `=cmd|...`).
- **Disposition:** The MIS build hardens the **platform XLSX path** to neutralize formula-leading values
  (apply the same leading-char guard, or write cells as text) — a platform-wide fix benefiting every
  XLSX consumer. Mark ✅ FIXED when shipped + covered by a `platform/export` unit test.

### Verified PASS (no finding)
- RBAC: commission config = `masterdata.manage` = SUPER_ADMIN-only; `billing.view` = MANAGER +
  BACKEND_USER + SA; no role accidentally sees amounts (server-nulled fail-safe). A location dimension
  needs **no new permission** (scope-dimension registry). Matches ADR-0036 §3 + the 6-role model.
- The geography substrate (locations, `case_tasks`/`cases` area/pincode, `RATE_LATERAL` cascade) is
  fully live for rates and reusable as the reference model for commission.

---
*Governance ledger. Update — never overwrite — as findings change state. Linked from
`CRM2_MASTER_MEMORY.md`, `PROJECT_INDEX.md`, `docs/ARCHITECTURE_GOVERNANCE.md`,
`FREEZE_LOCK_REPORT.md`.*
