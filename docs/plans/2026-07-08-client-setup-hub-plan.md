# Client Setup Hub + Onboarding Workbook — Implementation Plan (ADR-0092, Batch 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two ADR-0092 deliverables — the `/admin/client-setup` hub (stepper embedding the
existing pages via a controlled `clientId?` prop + completeness checklist) and the 5-sheet onboarding
workbook import (`GET /clients/:id/onboarding-template` + `POST /clients/:id/onboarding-import`) —
exactly per the signed spec [2026-07-07-client-setup-hub-design.md](../specs/2026-07-07-client-setup-hub-design.md)
(Revision 1) and [ADR-0092](../adr/ADR-0092-client-setup-hub-onboarding-workbook.md) (Accepted,
UX-8 = option (b)-for-workbook only).

**Architecture:** Six slices S1–S6 (spec §8). Hub = pure composition (new route + nav + thin shell;
4 existing pages gain one additive controlled prop; 3 record pages + Clients/Products gain additive
`?returnTo=`/`?clientId=` params). Workbook = one new runner module composing the 5 existing
per-module ImportSpecs through 3 named additive engine seams (sheet selector, `buildWorkbookTemplate`,
ImportModal workbook variant) + 1 named spec delta (CPV-unit `unitCode` optional, workbook-only).
**No migration (next mig stays 0117). No new package. Next ADR = 0093 (none expected here).**

**Tech stack:** existing only — React 19 + shared DataGrid/ImportModal/SearchableSelect, Express
modules, `@crm2/sdk` zod, `platform/import` engine (ExcelJS 4.4.0), TanStack Query, Playwright e2e.

## Global constraints (every task inherits these)

- `/api/v2` **additive-only**; never break mobile. Neither new endpoint is mobile-consumed; keep it that way.
- FE→API via `@crm2/sdk` types + the `api()`/`apiBlob()`/`apiUpload()` helpers only; one DataGrid;
  tokens-only styling; no new picker component.
- Every existing page/route is **behaviour-identical when the new prop/param is absent** — that claim
  is a test obligation, not prose.
- Import gated `MASTERDATA_MANAGE`; hub route gated `page.masterdata` (`PERMISSIONS.MASTERDATA_VIEW`).
- Any route change ⇒ `pnpm --filter @crm2/api openapi` regen (contract test `contract.test.ts`
  diff-gates the committed `apps/api/openapi.json`).
- No `any`/suppressions/`console.*`; raw SQL only in repositories; web tests are **export-style
  Vitest only** (exported constants/functions; NO RTL/jsdom — ADR-gated); page modules are imported
  in tests with a `.js` extension (`./ClientSetupPage.js`).
- Gates: per-task tests green → per-slice full `pnpm verify`
  (`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C`, run in
  `/tmp/crm2-hub`) → browser-verify the actual action on crm2_dev (:54329, admin/admin123; launch
  entries `web-hub`/`api-hub`) → commit per task (author Mayur, conventional, NO AI trailer) →
  **owner OK before any push**.
- Worktree/branch: `/tmp/crm2-hub`, branch `feat/client-setup-hub` off `main@8828cc5`.
- Registry §ADMIN-MASTERDATA-UX-2026-07-07: UX-1/UX-2 flip to FIXED (and UX-8 to its (b)-for-workbook
  disposition + named residual) only at S6 ship.

## Verified facts this plan builds on (checked 2026-07-08 against the real code — not assumptions)

**Web:**
- `App.tsx:53-57` `RequirePerm({ perm, children })`; `/admin/*` routes are plain non-lazy
  `<Route path element>` entries, lines 89–320. Commission routes use perm `masterdata.manage`
  (App.tsx:193-216); the rest of the family uses `page.masterdata`.
- `Layout.tsx:52-68` `ADMINISTRATION: { label; to; perm }[]`; first item today = Verification Units (L53).
- `SearchableSelect.tsx:13-29` — controlled `{ value, onChange, options: Opt[], placeholder?, onQueryChange?, disabled?, width? }`; `Opt = { value: string; label: string }` (L4).
- `CpvPage.tsx` — `export function CpvPage()` no props; `clientId` at L111 is **create-form state**
  (native `<select>` L296-308); DataGrid L348-368 has **no `filters` prop**, `queryKey="client-products"`,
  `renderExpanded={(l) => <UnitManager link={l} />}`; two ImportButtons (Links + Units) L264-290.
- `RateTypeAssignmentsPage.tsx` — no client filter at all today; grid `filters={{ active }}` (L201),
  `queryKey="rate-type-assignments"`; `+ New Assignment` → `/admin/rate-type-assignments/new` (L189).
- `RateManagementPage.tsx` — `clientId` filter state L97, grid `filters={{ clientId, productId }}`
  (L257), `queryKey="rates"`; toolbar has client+product `SearchableSelect`s (L270-283);
  `+ Add rate` → `/admin/rates/new` (L238).
- `CommissionRatesPage.tsx` — `masterdata.manage` early-return L180-181; grid
  `filters={{ active, userId, clientId }}` (L211-215), `queryKey="commission-rates"`;
  `+ New Commission Rate` → `/admin/commission-rates/new` (L202).
- Record pages: **none read query strings** (`useParams` only; no `useSearchParams` anywhere).
  Hard exits: RTARecordPage navigates to `/admin/rate-type-assignments` at L56/72/148/159/244;
  RateRecordPage to `/admin/rates` at L100/237/285/453/501; CommissionRateRecordPage to
  `/admin/commission-rates` at L94/221/253/492/542. **CPV has NO record page** (inline create on
  CpvPage) — so "the 4 record pages" resolves to: the 3 record pages above **+ ClientsPage/ProductsPage
  back-links** (the hub's only other link-outs).
- `DataGrid.tsx:405-413` — page `filters` merge into `mergedFilters` → `fetchPage(queryInput)`;
  cache key `[queryKey, {…filtersKey}]` (L471) so a controlled filter refetches under the same root.
- `pageQueryToParams` (`sdk/pagination.ts:37-48`) flattens `filters` to top-level `?key=value`.
- `ImportModal.tsx` — `ImportConfig { basePath; queryKey; entityLabel }` (L18-25);
  `Stage = 'idle'|'previewing'|'preview'|'confirming'|'done'` (L57); accept attr L190; preview =
  stacked errors-table + sample-table panels; uploads via `apiUpload(…/import?mode=…)`.
- e2e: `viewport.spec.ts` PAGES loop asserts `documentElement.scrollWidth - clientWidth ≤ 1`;
  `auth.setup.ts` logs in as `admin`/`admin123` → storageState. Web unit tests: export-style Vitest
  (`RateManagementPage.test.ts` is the copy source).

**API:**
- **All four list endpoints already accept `?clientId=`** — cpv/service.ts:82-98,
  rateTypeAssignments/service.ts:77-91, rates/service.ts:91-111, commissionRates/service.ts:96-114
  (verified by grep 2026-07-08). Step-1 unit counts: `GET /cpv-units` filters by `clientProductId`
  only (`sdk/cpv.ts:97-100`) → sum `ClientProductView.unitCount` (sdk/cpv.ts:30) instead.
- Engine (`platform/import/index.ts`): `ImportSpec{resource,columns,schema,uniqueKey?,sample?,resolve?}`
  (L45-55); `runImportPreview(buffer, spec, opts?)` L198-216; `runImportConfirm(buffer, spec, process,
  ctx{userId,fileName?}, opts?)` L223-274 — **records the `import_log` row itself** (L255-263) with
  `spec.resource`; `resolveImportMode` L68-73; `assertImportable(rowCount, max = importThreshold())`
  L80-91 throws 413 `IMPORT_TOO_LARGE` "too many rows to import — split the file"; `buildTemplate`
  L96-98 + `writeTemplate(res, buffer, filenameBase)` L101-105.
- `format.ts`: `parseImportFile(buffer, columns)` L161-164 (PK magic-byte sniff);
  `parseImportXlsx` reads `wb.worksheets[0]` at **L94**; `countImportRows` reads `worksheets[0]` at
  **L175**; `buildImportTemplate(columns, sample?)` L187-198; header match = case-insensitive trimmed
  (L29, L59-84); blank rows skipped; data starts row 2.
- CPV import (`cpv/import.ts`): `CpvUnitImportFileSchema` L95-100 (**`unitCode: z.string().min(1)` —
  required**); `CPV_IMPORT_COLUMNS` L103-108; `buildCpvUnitSpec()` L132-187 — id-keyed `linkMap`
  `` `${clientId}:${productId}` `` L143; "no usable client-product link" L162-167;
  `cpRepo.linkOptionsForImport()` = USABLE-only (repository.ts:99-105). Link leg: `CP_TEMPLATE_SPEC`
  L35-40 + `buildClientProductSpec()` L48-85 (resource `client_products`).
- RTA import: blank/`toUpper` Universal→null pattern at import.ts:15-21 + 99-100 (the delta's mirror).
- Rates import: `RATE_IMPORT_COLUMNS` L29-39 (clientCode/productCode/unitCode **required**);
  `clientRateType` passes through as string L115 — unknown code → NULL happens downstream in
  `rateService.create`. CommissionRates import: `fieldRateType` required + silent-NULL note L23-26;
  `COMMISSION_RATE_IMPORT_COLUMNS` L39-52; `clientCode` **optional** there.
- Products sheet = `masterDataImportSpec` (`shared/masterDataImport.ts:24-32`), columns
  `Code | Name | Effective From` — **no Client Code column** (products are global).
- Routes pattern (clients/routes.ts:19-26): `GET /import-template` + `POST /import` w/
  `raw({ type: () => true, limit: '10mb' })`, MASTERDATA_MANAGE, declared before `/:id`; controller
  reads `x-filename`. Mounts (app.ts): `/api/v2/clients` L121, `/client-products` L123, `/cpv-units`
  L124, `/rates` L125, `/rate-type-assignments` L127, `/commission-rates` L128.
- **No SDK client methods for import** (contract test allows it) — FE uses `apiUpload`/`apiBlob`.
  SDK carries only the result types (`sdk/import.ts:10-52`).
- openapi regen: `pnpm --filter @crm2/api openapi`; contract test asserts committed == generated.
- API import test pattern: `cpv/__tests__/cpv.api.test.ts:486-577` (`createTestDb`, `mkXlsx` via
  dynamic exceljs, supertest upload w/ `x-filename`, import_log assert, 403/401 legs).
- Config: `IMPORT_JOB_THRESHOLD` default 10000 (config/src/index.ts:95), via `importThreshold()`.

---

# SLICE S1 — Hub shell + client picker + routing/nav (branch start)

### Task 1: ClientSetupPage shell + route + nav + hub-state helpers

**Files:**
- Create: `apps/web/src/features/clientSetup/hubState.ts`
- Create: `apps/web/src/features/clientSetup/hubState.test.ts`
- Create: `apps/web/src/features/clientSetup/ClientSetupPage.tsx`
- Modify: `apps/web/src/App.tsx` (import + one route beside the other `/admin/*` routes)
- Modify: `apps/web/src/components/Layout.tsx:53` (insert nav item FIRST in `ADMINISTRATION`)

**Interfaces (later tasks rely on these exact names):**
- `hubState.ts` exports:
  - `export const HUB_PATH = '/admin/client-setup';`
  - `export interface StepDef { id: number; key: 'cpv' | 'rateTypes' | 'rates' | 'commission'; label: string; }`
  - `export const STEP_DEFS: StepDef[]` — 4 steps: 1 "Products & CPV units", 2 "Rate types", 3 "Rates", 4 "Commission rates".
  - `export function parseStep(raw: string | null): number` — int 1–4, anything else → 1.
  - `export function hubReturnTo(clientId: string, step: number): string` — returns
    `` `${HUB_PATH}?clientId=${encodeURIComponent(clientId)}&step=${step}` ``.
  - `export function safeReturnTo(raw: string | null): string | null` — returns `raw` only when it
    **starts with `HUB_PATH`** (open-redirect guard: rejects `//`, `http…`, and any non-hub path); else `null`.
- `ClientSetupPage.tsx`: `export function ClientSetupPage()` — reads `?clientId=&step=` via
  `useSearchParams` (URL is the ONLY state store — deep-linkable), renders: client `SearchableSelect`
  (options from `GET /api/v2/clients/options`, queryKey `['client-options']`, mapped to `Opt[]`) +
  "＋ New client" `<Link to={`/admin/clients?returnTo=${encodeURIComponent(hubReturnTo(...))}`}>` +
  stepper rail (4 `STEP_DEFS` buttons; active = URL step) + step body **placeholder card** per step
  (S2 replaces with embeds). No client selected → disabled stepper + single prompt
  "Pick or create a client to begin." Unknown `clientId` (options loaded, id not present) → same
  empty state + existing toast helper.

- [ ] Step 1: Write failing `hubState.test.ts` (export-style Vitest): `parseStep(null)===1`,
  `parseStep('3')===3`, `parseStep('9')===1`, `parseStep('x')===1`; `hubReturnTo('12',2)` exact
  string; `safeReturnTo` accepts `hubReturnTo` output, rejects `null`, `'/admin/rates'`,
  `'https://evil.com/admin/client-setup'`, `'//evil.com'` (must start with `/admin/client-setup`);
  `STEP_DEFS` has ids 1–4 with the labels above.
- [ ] Step 2: Run `pnpm --filter @crm2/web test hubState` — FAIL (module missing).
- [ ] Step 3: Implement `hubState.ts`; test PASS.
- [ ] Step 4: Implement `ClientSetupPage.tsx` (shell as specified; responsive: stepper rail
  `flex flex-wrap` chips on `<lg`, horizontal rail `lg+`; `min-w-0` main region; tokens-only classes
  copied from existing pages). Wire route in `App.tsx`:
  `<Route path="/admin/client-setup" element={<RequirePerm perm="page.masterdata"><ClientSetupPage /></RequirePerm>} />`
  and nav in `Layout.tsx` (insert `{ label: 'Client Setup', to: '/admin/client-setup', perm: 'page.masterdata' }`
  ABOVE Verification Units at L53).
- [ ] Step 5: `pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test` — PASS.
- [ ] Step 6: Commit `feat(web): client-setup hub shell + nav + hub-state helpers (ADR-0092 S1)`.

### Task 2: S1 e2e — hub smoke + responsive band

**Files:**
- Create: `apps/web/e2e/clientSetup.spec.ts`
- Modify: `apps/web/e2e/viewport.spec.ts` (add hub to `PAGES`)

**Interfaces:**
- Consumes: Task 1's route/nav/labels; `auth.setup.ts` storage state; `viewport.spec.ts` `PageSpec`.

- [ ] Step 1: `clientSetup.spec.ts`: (a) "Client Setup" is the FIRST link in the Administration nav
  group and navigates to `/admin/client-setup`; (b) empty state shows "Pick or create a client to
  begin." and the 4 step chips render disabled; (c) picking a client via the SearchableSelect puts
  `clientId` in the URL and enables the stepper; (d) deep-link `?clientId=999999&step=2` renders the
  empty state (no crash). (e) A viewport loop at **320/768/1024/1440** asserting
  `documentElement.scrollWidth - clientWidth ≤ 1` on the hub with a client selected.
- [ ] Step 2: Add `{ name: 'Client Setup', path: '/admin/client-setup' }` to `viewport.spec.ts` PAGES.
- [ ] Step 3: Run locally against the dev stack:
  `cd apps/web && CI= pnpm exec playwright test e2e/clientSetup.spec.ts` — PASS. (CI runs the full set.)
- [ ] Step 4: Commit `test(e2e): client-setup hub smoke + responsive band (ADR-0092 S1)`.

### S1 gate
- [ ] Full `pnpm verify` GREEN in `/tmp/crm2-hub` (`DATABASE_URL=…5433/crm2_test LC_ALL=C`).
- [ ] Browser-verify on crm2_dev (launch `api-hub` + `web-hub`): nav item first, pick client,
  deep-link, empty state, 320px no overflow.
- [ ] Owner OK before push (per standing rule; push = staging deploy).

---

# SLICE S2 — Steps embed the existing pages (controlled prop + returnTo)

### Task 3: `withClientFilter` helper + CpvPage controlled `clientId?` prop

**Files:**
- Create: `apps/web/src/features/clientSetup/embed.ts`
- Create: `apps/web/src/features/clientSetup/embed.test.ts`
- Modify: `apps/web/src/features/cpv/CpvPage.tsx`

**Interfaces:**
- `embed.ts` exports:
  - `export interface EmbeddedPageProps { clientId?: string }` — the ONE controlled prop (spec §3.2).
  - `export function withClientFilter(filters: Record<string, string | undefined>, controlledClientId?: string): Record<string, string | undefined>` —
    returns `{ ...filters, clientId: controlledClientId || filters['clientId'] || undefined }`
    (controlled wins; absent = passthrough unchanged).
- `CpvPage` signature becomes `export function CpvPage({ clientId: controlledClientId }: EmbeddedPageProps = {})`.

- [ ] Step 1: Failing `embed.test.ts`: `withClientFilter({}, '7')` → `{ clientId: '7' }`;
  `withClientFilter({ clientId: '3' }, '7')` → controlled wins (`'7'`);
  `withClientFilter({ clientId: '3' }, undefined)` → `{ clientId: '3' }`;
  `withClientFilter({}, undefined)` → `{ clientId: undefined }` (behaviour-identical when absent).
- [ ] Step 2: Implement `embed.ts`; PASS.
- [ ] Step 3: CpvPage: (a) grid gains `filters={withClientFilter({}, controlledClientId)}` (today it
  has no filters prop — adding `clientId: undefined` when uncontrolled is a no-op because
  `pageQueryToParams` skips undefined); (b) when `controlledClientId` set: the create-form's client
  `<select>` (L296-308) is replaced by a read-only display of the controlled client and the form's
  `clientId` state is forced to the prop (link creation targets the hub's client); (c) when absent:
  byte-identical behaviour.
- [ ] Step 4: `pnpm --filter @crm2/web typecheck && test` PASS (existing `CpvPage.test.ts` must stay
  green untouched — that's the behaviour-identical pin for its exported helpers).
- [ ] Step 5: Commit `feat(web): CpvPage controlled clientId prop for the client-setup hub (ADR-0092 S2)`.

### Task 4: Controlled prop on RTA / RateManagement / CommissionRates pages

**Files:**
- Modify: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx`
- Modify: `apps/web/src/features/rateManagement/RateManagementPage.tsx`
- Modify: `apps/web/src/features/commissionRates/CommissionRatesPage.tsx`

**Interfaces:**
- Consumes: `EmbeddedPageProps` + `withClientFilter` from `features/clientSetup/embed.ts` (Task 3).
- Produces: all three pages accept `EmbeddedPageProps`; when controlled they (a) add/override
  `clientId` in their grid `filters` via `withClientFilter`, (b) hide their own client picker
  (Rate Mgmt + Commission toolbars — RTA has none), (c) pass through unchanged when absent.

- [ ] Step 1: `RateTypeAssignmentsPage({ clientId }: EmbeddedPageProps = {})`: grid filters →
  `withClientFilter({ active: active || undefined }, clientId)`. (No picker to hide.)
- [ ] Step 2: `RateManagementPage`: filters → `withClientFilter({ clientId: clientId状态…, productId }, controlled)`
  — concretely `withClientFilter({ clientId: clientIdState || undefined, productId: productId || undefined }, controlledClientId)`;
  when controlled, the client `SearchableSelect` (L270-283) is not rendered (product select stays).
- [ ] Step 3: `CommissionRatesPage`: filters → `withClientFilter({ active, userId, clientId: clientIdState }, controlled)`;
  hide the client `SearchableSelect` when controlled. Keep the `masterdata.manage` early-return —
  the hub renders this step as a locked card for non-SA (Task 7), so the embed is never mounted
  without the perm anyway.
- [ ] Step 4: typecheck + web tests PASS (all three pages' existing export-style tests untouched).
- [ ] Step 5: Commit `feat(web): controlled clientId prop on RTA/rates/commission list pages (ADR-0092 S2)`.

### Task 5: `?returnTo=` + `?clientId=` on the 3 record pages

**Files:**
- Modify: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentRecordPage.tsx`
- Modify: `apps/web/src/features/rateManagement/RateRecordPage.tsx`
- Modify: `apps/web/src/features/commissionRates/CommissionRateRecordPage.tsx`
- Test: extend each page's colocated export-style test file

**Interfaces:**
- Consumes: `safeReturnTo` from `features/clientSetup/hubState.ts` (Task 1).
- Produces: each page exports `export function exitPath(returnToRaw: string | null, fallback: string): string`
  — ONE shared implementation is fine if placed in `hubState.ts` instead
  (`export function exitPath(raw: string | null, fallback: string): string { return safeReturnTo(raw) ?? fallback; }`)
  — put it in `hubState.ts`, import in all three (DRY).
- Behaviour: every hard exit (`onSuccess`, Cancel, back link, error-back, ConflictDialog `onDiscard`
  — exact sites: RTA L56/72/148/159/244; Rate L100/237/285/453/501; Commission L94/221/253/492/542)
  navigates to `exitPath(searchParams.get('returnTo'), '<today's hard-coded list path>')`.
  Create mode additionally seeds the client field from `?clientId=` when present
  (`useState(searchParams.get('clientId') ?? '')` for the client picker's initial value only —
  edit/revise mode ignores it).

- [ ] Step 1: Failing test additions: `exitPath('/admin/client-setup?clientId=1&step=3', '/admin/rates')`
  returns the hub URL; `exitPath('https://evil.com', '/admin/rates')` and `exitPath(null, …)` return
  the fallback (test lives in `hubState.test.ts`).
- [ ] Step 2: Implement `exitPath` in `hubState.ts`; PASS.
- [ ] Step 3: Wire all exit sites in the 3 record pages through `exitPath` + seed create-mode client
  from `?clientId=`. Both params absent ⇒ identical navigation to today (fallback = the same literal).
- [ ] Step 4: typecheck + web tests PASS.
- [ ] Step 5: Commit `feat(web): record pages honor ?returnTo/?clientId from the client-setup hub (ADR-0092 S2)`.

### Task 6: ClientsPage + ProductsPage return-to-hub banner

**Files:**
- Modify: `apps/web/src/components/MasterDataCrud.tsx` OR the two pages — **decision: put the
  banner in the page wrappers** (`apps/web/src/features/clients/ClientsPage.tsx`,
  `apps/web/src/features/products/ProductsPage.tsx`), NOT in MasterDataCrud (ADR-0051 guard test
  scans `features/clients` + `MasterDataCrud` for modal patterns — a `<Link>` banner is safe, but
  keep the shared component untouched).

**Interfaces:**
- Consumes: `safeReturnTo` (Task 1). When `?returnTo=` is a valid hub URL, render one line above the
  grid: `← Back to Client Setup` as a `<Link to={returnTo}>`. Absent/invalid ⇒ nothing (identical page).

- [ ] Step 1: Add the banner to both pages (3 lines each; reuse existing muted-text + link classes).
- [ ] Step 2: typecheck + tests PASS; ADR-0051 guard test still green.
- [ ] Step 3: Commit `feat(web): back-to-hub banner on Clients/Products via ?returnTo (ADR-0092 S2)`.

### Task 7: Hub mounts the embeds

**Files:**
- Modify: `apps/web/src/features/clientSetup/ClientSetupPage.tsx`

**Interfaces:**
- Consumes: `CpvPage`/`RateTypeAssignmentsPage`/`RateManagementPage`/`CommissionRatesPage` with
  `EmbeddedPageProps` (Tasks 3–4); `hubReturnTo` (Task 1).
- Step body per `STEP_DEFS`: 1 → `<CpvPage clientId={clientId} />`; 2 → `<RateTypeAssignmentsPage clientId={clientId} />`
  + a "＋ New Assignment" affordance note: the embedded page's own button navigates WITHOUT hub params,
  so the hub renders its OWN `+ New Assignment` link `` `/admin/rate-type-assignments/new?clientId=${clientId}&returnTo=${encodeURIComponent(hubReturnTo(clientId, 2))}` ``
  above the embed (same pattern steps 3/4: `/admin/rates/new?…step=3`, `/admin/commission-rates/new?…step=4`);
  3 → `<RateManagementPage clientId={clientId} />`; 4 → `has('masterdata.manage')`
  ? `<CommissionRatesPage clientId={clientId} />` : a **locked card** ("Commission rates are managed
  by a super admin." — neutral, no error styling, no request fired).

- [ ] Step 1: Replace the S1 placeholder cards with the embeds + the per-step hub create-links + the
  locked card branch.
- [ ] Step 2: typecheck + web tests PASS.
- [ ] Step 3: Commit `feat(web): client-setup hub embeds the four step pages (ADR-0092 S2)`.

### S2 gate
- [ ] Full `pnpm verify` GREEN.
- [ ] Browser-verify on crm2_dev: (1) hub step 1 shows ONLY the chosen client's CPV links; (2) create
  a link inside the embed → lands on the hub's client; (3) `+ Add rate` from step 3 → RateRecordPage
  with client pre-selected → Save → **returns to the hub at step 3** (the UX-1 kill shot — verify
  persisted); (4) `/admin/rates` standalone unchanged (picker present, save returns to `/admin/rates`);
  (5) non-SA admin (create a MANAGER test user) sees the locked Commission card, no 403 in console.
- [ ] Owner OK before push.

---

# SLICE S3 — Completeness checklist

### Task 8: Checklist counts + step-state derivation

**Files:**
- Create: `apps/web/src/features/clientSetup/checklist.ts`
- Create: `apps/web/src/features/clientSetup/checklist.test.ts`
- Modify: `apps/web/src/features/clientSetup/ClientSetupPage.tsx`

**Interfaces:**
- `checklist.ts` exports (pure — all testable without React):
  - `export interface SetupCounts { cpvLinks: number | null; cpvUnits: number | null; rateTypeAssignments: number | null; rates: number | null; commissionRates: number | null; }`
    (`null` = unknown/not-fetchable → chip renders "—", never a fabricated 0).
  - `export type StepState = 'blocked' | 'incomplete' | 'complete' | 'skipped';`
  - `export function deriveStepStates(c: SetupCounts, canManage: boolean): Record<1 | 2 | 3 | 4, StepState>` —
    rules (spec §3.2): step 1 never blocked; step 2 blocked when `cpvLinks === 0`; step 3 blocked when
    `cpvUnits === 0`; step 4 `skipped` when `!canManage`, else blocked when `cpvLinks === 0`;
    non-blocked steps: `complete` when their count(s) `> 0` (step 1 needs BOTH `cpvLinks > 0` and
    `cpvUnits > 0`), else `incomplete`; any `null` count involved ⇒ `incomplete` (unknown, honest).
  - `export function sumUnitCounts(items: { unitCount: number }[]): number`.
- ClientSetupPage queries (TanStack, enabled only when a client is selected; roots SHARED with the
  embedded grids so their mutations invalidate the checklist for free — DataGrid key root is the
  first element):
  - `['client-products', 'setup-checklist', clientId]` → `GET /api/v2/client-products?clientId=&page=1&limit=500`
    → links = `totalCount`, units = `sumUnitCounts(items)` (spec §3.3: large pageSize, one call).
  - `['rate-type-assignments', 'setup-checklist', clientId]` → `…?clientId=&page=1&limit=1` → `totalCount`.
  - `['rates', 'setup-checklist', clientId]` → same.
  - `['commission-rates', 'setup-checklist', clientId]` → same, **`enabled: canManage` — a non-SA
    fires NO request** (403-storm rule), count stays `null` → "—".

- [ ] Step 1: Failing `checklist.test.ts`: table-drive `deriveStepStates` — all-zero counts →
  `{1:'incomplete',2:'blocked',3:'blocked',4:'blocked'}`; links=2/units=0 → step1 incomplete, step3
  blocked; links+units>0 → step1 complete, 2–4 unblocked-incomplete; everything>0 → all complete;
  `canManage=false` → step4 `skipped` regardless; `cpvUnits: null` → step1 incomplete + step3
  incomplete (null never blocks — unknown ≠ zero); `sumUnitCounts([])===0`, `[{2},{3}]→5`.
- [ ] Step 2: Run — FAIL; implement; PASS.
- [ ] Step 3: Wire the 4 queries + render: per-step chip `links · units` / count / "—", step buttons
  get state styling (existing token classes: amber dot incomplete, green check complete, muted+lock
  blocked/skipped) and blocked step body shows "Complete [prior step] first" + jump link (spec §3.2).
- [ ] Step 4: typecheck + web tests PASS.
- [ ] Step 5: Commit `feat(web): client-setup completeness checklist + step states (ADR-0092 S3)`.

### S3 gate
- [ ] `pnpm verify` GREEN; browser-verify: counts match reality for a seeded client; create a rate
  inside step 3 → checklist chip updates without reload (shared-root invalidation); non-SA sees "—"
  + zero commission requests in the network tab.
- [ ] Owner OK before push.

---

# SLICE S4 — Workbook template endpoint

### Task 9: `buildWorkbookTemplate` + `GET /clients/:id/onboarding-template` + hub download button

**Files:**
- Modify: `apps/api/src/platform/import/format.ts` (additive `buildWorkbookTemplate`)
- Create: `apps/api/src/modules/clients/onboarding.ts` (sheet catalog; grows the runner in S5)
- Modify: `apps/api/src/modules/clients/{routes,controller,service}.ts`
- Modify: `apps/api/openapi.json` (regen)
- Modify: `apps/web/src/features/clientSetup/ClientSetupPage.tsx` (download button)
- Test: `apps/api/src/modules/clients/__tests__/onboarding.template.test.ts` (new)
- Test: extend `apps/api/src/platform/import/__tests__/` format spec

**Interfaces:**
- `format.ts`: `export async function buildWorkbookTemplate(sheets: { name: string; columns: ImportColumn[]; sample?: Record<string, string | number> }[]): Promise<Buffer>` —
  one worksheet per entry (in order, `wb.addWorksheet(name)`), bold header row + optional sample row
  (exact same cell logic as `buildImportTemplate` — extract the shared per-sheet body into a private
  helper both call).
- `onboarding.ts`:
  - `export const ONBOARDING_SHEET_NAMES = ['Products', 'CPV', 'RateTypeAssignments', 'Rates', 'CommissionRates'] as const;`
  - `export function onboardingTemplateSheets(clientCode: string)` → the 5 `{name, columns, sample}`
    entries: Products = `MASTER_IMPORT_COLUMNS`/`MASTER_IMPORT_SAMPLE`; CPV = `CPV_IMPORT_COLUMNS`
    with sample `{ clientCode, productCode: 'HOME_LOAN', unitCode: 'UNIVERSAL' }` (UNIVERSAL
    documents the delta); RTA = `RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS` sample w/ `clientCode`;
    Rates = `RATE_IMPORT_COLUMNS` sample w/ `clientCode`; CommissionRates =
    `COMMISSION_RATE_IMPORT_COLUMNS` sample w/ `clientCode` (spec §4.5: every `Client Code` sample
    cell pre-filled with the real client's code; Products has no such column — global).
- Route: `clientRoutes.get('/:id/onboarding-template', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.onboardingTemplate)`
  (multi-segment — no clash with `GET /:id`); controller loads the client (404 `CLIENT_NOT_FOUND`),
  streams via `writeTemplate(res, buffer, \`client-${client.code}-onboarding\`)`.
- FE: hub toolbar button "Download workbook" → `apiBlob(\`/api/v2/clients/${clientId}/onboarding-template\`)`
  (rendered only when `has('masterdata.manage')`).

- [ ] Step 1: Failing API test: SUPER_ADMIN GET for a seeded client returns XLSX (`PK`, spreadsheetml
  content-type, `client-<CODE>-onboarding-import-template.xlsx` disposition) whose **5 worksheets have
  the exact names `ONBOARDING_SHEET_NAMES` and header rows byte-equal to each module's template
  columns** (open with exceljs in-test); every `Client Code` sample cell === the client's code;
  unknown id → 404; viewer role → 403.
- [ ] Step 2: Run — FAIL (404). Implement `buildWorkbookTemplate` + `onboarding.ts` + wiring.
- [ ] Step 3: Regen openapi (`pnpm --filter @crm2/api openapi`); api tests + contract test PASS.
- [ ] Step 4: Add the FE button; typecheck + web tests PASS.
- [ ] Step 5: Commit `feat(api): 5-sheet onboarding workbook template for a client (ADR-0092 S4)`.

### S4 gate
- [ ] `pnpm verify` GREEN; browser-verify: download from the hub for a real client, open the file —
  5 tabs, client code pre-filled.
- [ ] Owner OK before push.

---

# SLICE S5 — Workbook import (runner + guards + FE)

### Task 10: Engine seam — optional sheet selector

**Files:**
- Modify: `apps/api/src/platform/import/format.ts` (`parseImportXlsx`/`parseImportFile`/`countImportRows` + new `listImportSheets`)
- Modify: `apps/api/src/platform/import/index.ts` (`runImportPreview`/`runImportConfirm` opts)
- Test: extend the platform import format/engine specs

**Interfaces:**
- `format.ts`: all three parse/count fns gain `opts?: { sheet?: string }` — when `sheet` is set the
  XLSX branch reads `wb.worksheets.find(w => w.name === opts.sheet)` (missing sheet ⇒ `[]` rows / 0
  count — the caller decides what missing means); CSV branch ignores `sheet` (single-sheet by nature).
  New `export async function listImportSheets(buffer: Buffer): Promise<string[]>` — worksheet names
  for XLSX, `['Sheet1']` for CSV.
- `index.ts`: `runImportPreview(buffer, spec, opts?: { maxRows?: number; sheet?: string })` and
  `runImportConfirm(…, opts?: { maxRows?: number; sheet?: string })` thread `sheet` into
  `parseImportFile`. **Default (no opts) = worksheets[0] — existing callers byte-identical.**

- [ ] Step 1: Failing tests: a 2-sheet workbook (sheet "A" 2 rows, sheet "B" 1 row) — no opts parses
  sheet A (2 rows, pins today's behaviour); `{sheet:'B'}` parses 1 row; `{sheet:'Missing'}` → `[]`;
  `listImportSheets` → `['A','B']`; `countImportRows(buf, {sheet:'B'})` → 1.
- [ ] Step 2: Implement; all platform + module import tests PASS untouched.
- [ ] Step 3: Commit `feat(import): optional named-sheet selector through the shared engine (ADR-0092 S5)`.

### Task 11: CPV-unit workbook Universal delta spec

**Files:**
- Modify: `apps/api/src/modules/cpv/import.ts` (additive exports only)
- Test: extend `apps/api/src/modules/cpv/__tests__/cpv.api.test.ts` or a new colocated unit spec

**Interfaces (mirrors rateTypeAssignments/import.ts:15-21,99-100 exactly):**
- `export const WORKBOOK_CPV_IMPORT_COLUMNS: ImportColumn[]` — same 4 columns as `CPV_IMPORT_COLUMNS`
  but `unitCode` **not** `required`.
- `export const WorkbookCpvUnitImportFileSchema` — same as `CpvUnitImportFileSchema` but
  `unitCode: z.string().optional()` (blank = Universal).
- `export async function buildCpvUnitWorkbookSpec(): Promise<ImportSpec<WorkbookCpvUnitImportFile, CreateCpvUnitInput>>` —
  same loads/maps as `buildCpvUnitSpec`; `resolve` treats blank or literal `'UNIVERSAL'`
  (case-insensitive) `unitCode` as `verificationUnitId: null` (create-input already `nullish()`,
  sdk/cpv.ts:68) and only consults `unitMap` for a concrete code. `resource` stays
  `'client_product_verification_units'` (verified — cpv/import.ts:118,181).
- **`buildCpvUnitSpec`/`CpvUnitImportFileSchema`/`CPV_IMPORT_COLUMNS` untouched** — the standalone
  single-sheet CPV import keeps strict `required` (pinning test).

- [ ] Step 1: Failing tests: workbook spec resolves `{clientCode, productCode, unitCode: ''}` and
  `'UNIVERSAL'`/`'universal'` to `verificationUnitId: null`; concrete `unitCode: 'RESI'` still
  resolves the id; unknown concrete code still errors. Pinning: the STRICT spec still rejects a
  blank `unitCode` as a row error (existing behaviour, now pinned).
- [ ] Step 2: Implement; PASS.
- [ ] Step 3: Commit `feat(cpv): workbook-only Universal-unit import spec delta (ADR-0092 S5)`.

### Task 12: Onboarding runner — preview (`?mode=preview`) with projections + workbook-strict guards

**Files:**
- Modify: `apps/api/src/modules/clients/onboarding.ts` (the runner)
- Modify: `apps/api/src/modules/clients/{routes,controller,service}.ts`
- Modify: `packages/sdk/src/import.ts` (additive result types)
- Modify: `apps/api/openapi.json` (regen)
- Test: `apps/api/src/modules/clients/__tests__/onboarding.import.test.ts` (new)

**Interfaces:**
- SDK (`packages/sdk/src/import.ts`, additive):
  - `export interface OnboardingSheetPreview { name: string; totalRows: number; validRows: number; pendingRows: number; errorRows: number; errors: ImportRowError[]; }`
  - `export interface OnboardingPreviewResult { sheets: OnboardingSheetPreview[]; }`
  - `export interface OnboardingSheetConfirm extends ImportConfirmResult { name: string; }`
  - `export interface OnboardingConfirmResult { sheets: OnboardingSheetConfirm[]; }`
- Route: `clientRoutes.post('/:id/onboarding-import', authorize(PERMISSIONS.MASTERDATA_MANAGE), raw({ type: () => true, limit: '10mb' }), c.onboardingImport)`;
  controller = the standard import controller shape (resolveImportMode / Buffer check / `x-filename`),
  404 on unknown client.
- Runner (in `onboarding.ts`): `export async function onboardingPreview(clientId: number, buffer: Buffer): Promise<OnboardingPreviewResult>`.
  Mechanics (spec §4.3, all inside this module — the per-module specs stay untouched):
  1. **Caps first:** `countImportRows(buffer, { sheet })` per sheet; `assertImportable(count)` per
     sheet AND `assertImportable(total)` across sheets (both default `importThreshold()` ⇒ 413).
  2. Sheets parse by NAME (`ONBOARDING_SHEET_NAMES`); a workbook missing a sheet ⇒ that sheet reports
     zeros (not an error) — `listImportSheets` distinguishes missing vs empty if needed for copy.
  3. Per sheet in order run the module's normal machinery (`runImportPreview(buffer, spec, { sheet })`)
     with the spec for that sheet (Products = `PRODUCT_IMPORT_SPEC` — export it from
     `modules/products/service.ts:41` (`masterDataImportSpec('products', CreateProductSchema)`,
     currently module-private); CPV = `buildCpvUnitWorkbookSpec` (Task 11); RTA/Rates/Commission =
     their `build*Spec()`s — resource strings verified: `rate-type-assignments`, `rates`,
     `commission-rates`, `client_products`, `client_product_verification_units`, `products`).
  4. **Projections + salvage (code-level, no error-message parsing):** the runner loads once:
     the target client row; DB code-sets it needs (product codes via `productService.options()`, unit
     codes, active rate-type codes, USABLE link pairs as `clientCode:productCode` — derive from
     `linkOptionsForImport()` joined to the options maps; the client's rate-type assignments as
     wildcard tuples). It computes pending projections from each sheet's valid rows: `pendingProductCodes`
     (Products sheet), `pendingLinkPairs` (CPV sheet's own rows — phase-1→2), `pendingAssignmentTuples`
     (RTA sheet). A row the module spec rejected is **salvaged to `valid-pending`** iff its raw codes
     fully resolve at code level against DB-sets ∪ projections (e.g. CPV row: product ∈ DB ∪ pending
     AND unit blank/'UNIVERSAL'/∈ DB — the link comes from its own phase-1; Rates row: product/unit ∈
     DB ∪ pending AND pair ∈ links ∪ pendingPairs AND …guards below). Rows valid against DB alone stay
     `valid`.
  5. **Workbook-strict guards (UX-8(b) — this NEW surface only):**
     - `CLIENT_MISMATCH`: on the CPV/RTA/Rates/CommissionRates sheets, any **non-blank** `Client Code`
       ≠ target client's code ⇒ row error `` `CLIENT_MISMATCH: row is for client ${code}, this import is for client ${target}` ``
       (column `Client Code`). Products sheet has no client column. CommissionRates blank clientCode
       = universal ⇒ allowed, no mismatch.
     - Rates sheet: `CPV_LINK_MISSING` when the row's (client, product) pair ∉ USABLE links ∪
       `pendingLinkPairs`; `RATE_TYPE_NOT_ASSIGNED` when the row HAS a `Rate Type` and no assignment
       (DB wildcard-match: client + (product|NULL) + (unit|NULL) + rateType, per ADR-0067 availability)
       ∪ `pendingAssignmentTuples` (same wildcard semantics) covers the combo.
     - CommissionRates sheet: `Rate Type` not in the **active rate_types catalog** ⇒ row error
       (`UNKNOWN_RATE_TYPE`) — catalog-existence only (closes the silent-NULL for this surface;
       ADR-0050 unassigned-combo semantics untouched).
     - **Future-`Effective From` honesty rule:** a Products/CPV row with `effectiveFrom > now` whose
       code/pair is referenced by a LATER sheet ⇒ the REFERENCING rows are row errors (message names
       the not-yet-usable prerequisite), not pending — they cannot resolve at confirm (USABLE-only maps).
  6. Response: per-sheet `{ name, totalRows, validRows, pendingRows, errorRows, errors[] }`; errors
     keep the module's verbatim messages, `rowNumber` is the row within its sheet.

- [ ] Step 1: Export `PRODUCT_IMPORT_SPEC` from `modules/products/service.ts` (it exists at L41,
  module-private today — additive export, no behavior change).
- [ ] Step 2: Failing API tests (build multi-sheet workbooks in-test with exceljs, one `addWorksheet`
  per name; upload helper = the cpv.api.test.ts pattern against `/api/v2/clients/:id/onboarding-import?mode=preview`):
  1. cross-sheet code resolve: product only in Products sheet → CPV/RTA/Rates rows referencing it =
     `pendingRows`, 0 errors;
  2. same-sheet CPV pair projection: CPV sheet for a brand-new (client,product) link + concrete unit
     → pending (its own phase-1), not "no usable client-product link";
  3. RTA-tuple → Rates: rate row whose assignment exists only in the RTA sheet → pending; without the
     RTA row → `RATE_TYPE_NOT_ASSIGNED` error;
  4. `CPV_LINK_MISSING` on a rates row for an unlinked pair not in the CPV sheet;
  5. `CLIENT_MISMATCH` on a CPV row with another client's code (and: blank commission clientCode OK);
  6. `UNKNOWN_RATE_TYPE` on the commission sheet for a typo'd code;
  7. future-`effectiveFrom` product referenced by a rates row → the rates row errors in preview;
  8. per-sheet 413 (one sheet ≥10k) and total 413 (5×2001-row sheets w/ threshold env pinned low via
     `IMPORT_JOB_THRESHOLD` env in-test if needed — or build 10k rows, it's fast in-memory);
  9. 403 viewer / 401 unauth / 404 unknown client / 400 bad mode.
- [ ] Step 3: Implement runner preview + SDK types + controller/route; regen openapi; PASS.
- [ ] Step 4: Commit `feat(clients): onboarding workbook preview — cross-sheet projections + workbook-strict guards (ADR-0092 S5)`.

### Task 13: Onboarding runner — confirm (`?mode=confirm`), ordered rebuild + CPV two-phase

**Files:**
- Modify: `apps/api/src/modules/clients/onboarding.ts`
- Test: extend `onboarding.import.test.ts`

**Interfaces:**
- `export async function onboardingConfirm(clientId: number, buffer: Buffer, ctx: { userId: string; fileName?: string }): Promise<OnboardingConfirmResult>`.
  Mechanics (spec §4.3 confirm — **no overlay at confirm**; caps re-asserted same as preview):
  1. Sheets run strictly in `ONBOARDING_SHEET_NAMES` order; each sheet's spec is **built fresh**
     (`await build*Spec()`) AFTER the prior sheet committed, so its maps see the prior sheet's rows
     from the real DB.
  2. Products / RTA / Rates / CommissionRates sheets: one `runImportConfirm(buffer, spec, process, ctx, { sheet })`
     each — unchanged partial-import semantics, and the engine writes their 4 `import_log` rows itself.
  3. **CPV sheet = two phases, two `import_log` rows:** phase 1 loops the sheet's DISTINCT resolved
     (client, product) pairs through `clientProductService.create` (existing idempotent create;
     per-row 409 CONFLICT = "already linked" is a SUCCESS for onboarding purposes — count it created-or-existing,
     real failures recorded as row errors) and manually records ONE `import_log` row
     (`importLogRepository.record({ resource: 'client_products', … })` with the phase's counts);
     phase 2 = `runImportConfirm(buffer, await buildCpvUnitWorkbookSpec(), …, { sheet: 'CPV' })`
     (engine records the units row). Workbook total = **6 audit rows**.
  4. **The workbook-strict guards run at confirm too** (CLIENT_MISMATCH / RATE_TYPE_NOT_ASSIGNED /
     CPV_LINK_MISSING / UNKNOWN_RATE_TYPE): wrap each sheet's spec `resolve` with the same guard fn
     used in preview (DB-state-only now — no projections) so a guard-failing row is a reported row
     error, never a write. A sheet with zero committable rows does NOT abort later sheets.
  5. Confirm-time misses (e.g. prerequisite row 409'd away) surface as ordinary per-sheet row errors —
     partial import, never silent mis-write.
- Controller: `mode=confirm` → `onboardingConfirm`, else preview (Task 12).

- [ ] Step 1: Failing API tests:
  1. **the happy 5-sheet onboarding**: one workbook (2 products, CPV link+Universal unit + 1 concrete
     unit, 2 RTA rows, 1 rate, 1 commission rate for a seeded user+location) → every resource exists
     afterwards (SELECT each table), per-sheet successRows correct, **exactly 6 import_log rows** with
     resources `['products', 'client_products', 'client_product_verification_units', 'rate-type-assignments', 'rates', 'commission-rates']` (all verified against each import.ts);
  2. partial failure: 1 bad product row → its dependent CPV/rate rows fail with row errors on THEIR
     sheets, siblings commit;
  3. re-run the same workbook → link phase idempotent (no dup links), unit/RTA/rate dup rows surface
     as per-row errors, nothing explodes;
  4. guard at confirm: a rates row w/ no assignment anywhere → row error, no rate written;
  5. `CLIENT_MISMATCH` row skipped at confirm w/ row error.
- [ ] Step 2: Implement; regen openapi if the confirm response shape changed anything; PASS.
- [ ] Step 3: Commit `feat(clients): onboarding workbook confirm — ordered rebuild-and-commit, CPV two-phase audit (ADR-0092 S5)`.

### Task 14: FE — workbook import modal (5-panel) on the hub

**Files:**
- Modify: `apps/web/src/components/import/ImportModal.tsx` (additive workbook variant)
- Create: `apps/web/src/components/import/workbook.test.ts` (export-style)
- Modify: `apps/web/src/features/clientSetup/ClientSetupPage.tsx` ("Import workbook" button)

**Interfaces:**
- `ImportModal.tsx` additive exports:
  - `export interface WorkbookImportConfig { basePath: string; queryKeys: string[]; entityLabel: string; }`
    (basePath = `` `/api/v2/clients/${clientId}/onboarding` `` → the modal calls
    `${basePath}-import?mode=…` and template via the S4 button, not this modal; on done it
    invalidates EVERY root in `queryKeys` — the 4 grid roots + checklist).
  - `export function WorkbookImportButton({ config, label }: { config: WorkbookImportConfig; label?: string })` —
    reuses the same Stage machinery/dialog internals (extract shared bits, don't fork the file);
    file input **accept=".xlsx" only** (spec §4.4); preview renders **one stacked panel per sheet**:
    header `✓ N valid · ⧗ M pending · ✗ K errors` + that sheet's error table (same columns/CSV
    download as today); Confirm enabled iff `workbookConfirmEnabled(preview)`; Result = per-sheet
    confirm counts.
  - `export function workbookConfirmEnabled(p: OnboardingPreviewResult): boolean` —
    `p.sheets.some(s => s.validRows + s.pendingRows > 0)` (≥1 committable row across the workbook).
  - `export function sheetSummary(s: OnboardingSheetPreview): string` — the exact chip copy
    (`"✓ 3 valid · ⧗ 2 pending · ✗ 1 error"`, singular/plural on error only — keep dead simple).
- Hub: "Import workbook" button beside "Download workbook" (both `masterdata.manage`-gated), config
  `queryKeys: ['client-products','cpv-units','rate-type-assignments','rates','commission-rates']`.

- [ ] Step 1: Failing `workbook.test.ts`: `workbookConfirmEnabled` false for all-error sheets, true
  with one pending row; `sheetSummary` exact strings for {3,2,1} and {0,0,0}.
- [ ] Step 2: Implement helpers + modal variant + hub button; typecheck + web tests PASS.
- [ ] Step 3: Commit `feat(web): onboarding workbook import modal on the client-setup hub (ADR-0092 S5)`.

### S5 gate
- [ ] Full `pnpm verify` GREEN.
- [ ] Browser-verify on crm2_dev: download the template for a fresh client → fill 2 products + CPV
  Universal + RTA + 1 rate in the file → upload → preview shows pending rows resolving across sheets
  → confirm → every step's checklist flips as the grids refresh → `import_log` has the 6 rows
  (query dev DB). Then a deliberately-bad workbook (wrong client code, typo'd rate type) → row errors
  in the right sheet panels, nothing written.
- [ ] Owner OK before push.

---

# SLICE S6 — e2e + docs + ship

### Task 15: Playwright end-to-end journeys

**Files:**
- Modify: `apps/web/e2e/clientSetup.spec.ts` (extend)

- [ ] Step 1: Journey A (hub): create client (via link-out + returnTo round-trip) → step 1 link a
  product + enable a unit → step 2 assign a rate type → step 3 add a rate (record page round-trips
  back to hub) → checklist all green. Journey B (workbook): download template request 200; upload a
  fixture workbook via the modal → preview panels → confirm → step counts > 0. Use unique codes per
  run (existing e2e convention) and the seeded admin.
- [ ] Step 2: `cd apps/web && CI= pnpm exec playwright test e2e/clientSetup.spec.ts` — PASS.
- [ ] Step 3: Commit `test(e2e): client onboarding via hub + workbook (ADR-0092 S6)`.

### Task 16: Docs, registry, memory, final review, ship gate

**Files:**
- Modify: `PROJECT_INDEX.md` (link the plan + spec already linked; add hub docs pointer)
- Modify: `CRM2_MASTER_MEMORY.md` §8 (new row: hub+workbook)
- Modify: `docs/COMPLIANCE_GAPS_REGISTRY.md` §ADMIN-MASTERDATA-UX-2026-07-07 — UX-1 FIXED, UX-2 FIXED,
  UX-8 → its (b)-for-workbook disposition **naming the 3 loose residual surfaces** (direct API,
  per-module imports, §4.7 fallback) per the ADR.
- Modify: Claude memory `project_admin_masterdata_ux_audit_2026_07_07.md` (Batch 3 shipped note)

- [ ] Step 1: Final whole-branch 3-lens adversarial review (CTO/arch · Design/governance ·
  Security/RBAC subagents on the full `main..feat/client-setup-hub` diff); fix loop until MERGE_READY×3.
- [ ] Step 2: Docs + registry + memory edits; full `pnpm verify` GREEN one last time.
- [ ] Step 3: Commit `docs: client-setup hub + onboarding workbook shipped (ADR-0092)` .
- [ ] Step 4: **Owner ship gate:** merge worktree branch → `main`, push = STAGING deploy; owner
  browser-checks staging; prod promotion is the owner's separate call. **Never push without the OK.**

---

## Sequencing & effort

| Slice | Tasks | Est. | Parallelism |
|---|---|---|---|
| S1 | T1–T2 | 0.5 session | T2 after T1 |
| S2 | T3–T7 | 1 | T3→(T4∥T5∥T6)→T7 (T4-6 disjoint files after embed.ts exists) |
| S3 | T8 | 0.5 | — |
| S4 | T9 | 0.5 | independent of S2/S3 (can start any time after S1) |
| S5 | T10–T14 | 1.5–2 | T10∥T11 → T12 → T13; T14 after T12 |
| S6 | T15–T16 | 1 | last |

Known agent gotchas (from Batches 1–2): implementers stall on "waiting for background test run" —
instruct **synchronous-only** and nudge via SendMessage; they die at usage limits AFTER finishing —
controller verifies + commits; web tests are export-style ONLY; e2e runs in CI, not `pnpm verify`.

## Self-review (spec-coverage check)

- Spec §3.1 route/RBAC/nav ✅ T1 · §3.2 embed mechanic + returnTo ✅ T3–T7 · §3.2 stepper states ✅ T8 ·
  §3.3 checklist decision (client-side counts, commission gated, no aggregator) ✅ T8 · §3.4
  empty/error/responsive ✅ T1/T2/T8 · §4.1 sheets + CPV delta + CLIENT_MISMATCH + unknown-rate-type
  ✅ T9/T11/T12 · §4.2 order + pre-existing locations/users ✅ T12/T13 (template guidance in T9 sample
  rows) · §4.3 projections/two-phase/honesty/engine seams ✅ T10/T12/T13 · §4.4 modal ✅ T14 · §4.5
  template ✅ T9 · §4.6 endpoints/perms/openapi ✅ T9/T12 · §4.7 caps ✅ T12 · §5 UX-8(b) workbook-only ✅
  T12/T13 (existing endpoints untouched — no task touches their specs' required-ness or services) ·
  §8 slices ✅ 1:1.
- Deliberate deviations from the spec's letter (recorded): "the 4 record pages" = 3 real record pages
  + Clients/Products banners (CPV has no record page — verified); step-1 unit counts use summed
  `unitCount` (spec Rev 1's own correction).
- No placeholders: every task names exact files, exported symbols, assertable copy/errors, and the
  verified clone-source. Two named read-before-code steps (T12 Step 1) honor the no-guessing rule for
  files this plan didn't open.
