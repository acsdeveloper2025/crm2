# BUILD_GUIDE.md — building a new module end-to-end

CRM2 (v2) greenfield monorepo. This is the step-by-step recipe for shipping a new module,
using the **Verification Units** module as the reference implementation. Read those files alongside
this guide — they are the canonical example:

- API: `apps/api/src/modules/verificationUnits/{repository,service,controller,routes}.ts` + `__tests__/verificationUnits.api.test.ts`
- Platform: `apps/api/src/platform/{db,errors,http}.ts`, mount in `apps/api/src/http/app.ts`
- Contracts: `packages/sdk/src/verificationUnit.ts` (+ `index.ts`, `client.ts`)
- Tests harness: `packages/test-utils/src/helpers/testDb.ts`
- Web: `apps/web/src/features/verificationUnits/*`
- Migration: `db/v2/migrations/0001_verification_unit_registry.sql`

Authoritative rules: `AGENT_RULES.md`, `docs/ENGINEERING_STANDARDS.md`, `docs/CI_CD_STANDARDS.md`,
`db/v2/BUILD_GATE_REGISTRY_LOCK.md`, and the final `CTO_RULES.md` gate.

> Naming: `snake_case` in SQL, `camelCase` in TS, `kebab-case` in routes. The DB layer
> (`platform/db.ts` `query<T>`) auto-camelizes snake rows — repos return camelCase, never alias in SQL.

---

## The recipe (ordered)

**1. Migration** → `db/v2/migrations/NNNN_<name>.sql`
Raw SQL, forward-only, idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT`), `timestamptz` for all
time columns, `CHECK`/constraints for invariants, snake_case names (`idx_`, `uq_`, `fk_`, `chk_`).
Source-only until the schema set is cohesive — the test harness applies all migrations top-to-bottom to
an ephemeral DB. Mirror cross-field invariants here as `CHECK`s (see `chk_vu_field_visit` in 0001).
**Gate:** applies cleanly in order; idempotent on re-run.

**2. Contracts** → `packages/sdk/src/<entity>.ts`
zod schemas + TS types (camelCase) mirroring the migration column-for-column. Put cross-field invariants
in one `superRefine` shared by Create + Update (see `applyInvariants`). Export from `packages/sdk/src/index.ts`.
**Gate:** schema CHECKs == DB CHECKs (defence in depth).

**3. Repository** → `apps/api/src/modules/<domain>/repository.ts`
Raw parameterized pg via `query<T>` from `platform/db.ts`. Typed camelCase returns. Map PG error codes
to `AppError` (`23505` → `AppError.conflict(...)`, 409). Use a transaction for multi-statement writes.
Reporting reads → `<entity>-report.repository.ts`; view reads → `<entity>-view.repository.ts`.
**Gate:** no business logic; only data access + error mapping.

**4. Service** → `apps/api/src/modules/<domain>/service.ts`
zod `.parse()` on input (throws `ZodError` → 400) + business rules (e.g. `code` immutable, version bump).
Calls repositories only. **Gate:** all rules covered by unit tests.

**5. Controller** → `controller.ts`
Validate/authorize/call-service/return. No business logic. Use `HTTP_STATUS` constants and `AppError`,
forward errors with `next(e)`. Index-signature access via brackets: `req.params['id']`, `req.query['active']`.
**Gate:** thin; every branch traces to the service.

**6. Routes** → `routes.ts`
One `authorize(PERMISSIONS.X)` per route, default-deny. Annotate the export: `export const xRoutes: Router = Router();`.
Reads use the view permission, writes the manage permission (see `MASTERDATA_VIEW` vs `VERIFICATION_UNIT_MANAGE`).

**7. Mount** → `apps/api/src/http/app.ts`
`app.use('/api/v2/<kebab>', <domain>Routes);`

**8. RBAC** → `@crm2/access` (`packages/access/src/permissions.ts`)
Add/confirm permission codes and the role → permission map. Default-deny: a role only gets what is listed.

**9. Tests (same change)** → `apps/api/src/modules/<domain>/__tests__/<entity>.api.test.ts`
Integration over ephemeral PG using `createTestDb` + `setPool` + factories/`authHeaderForRole` from
`@crm2/test-utils`. Cover: success, validation (400), RBAC (401 unauth + 403 wrong role), not-found (404),
conflict (409). Plus unit tests for the schema invariants. Coverage ≥90% on repos/services.
Pattern: `const RUN = !!process.env['DATABASE_URL']; describe.skipIf(!RUN)(...)`, `beforeEach` truncates.

**10. Frontend** → `apps/web/src/features/<domain>/`
Page + dialog. Data via TanStack Query (`useQuery`/`useMutation`, invalidate on success) through `@crm2/sdk`
(currently the `api()` wrapper in `src/lib/sdk.ts`). `@crm2/ui-theme` tokens only — no raw colors
(use `bg-st-*`, `text-muted-foreground`, etc.). Render loading / empty / error / permission states.
Uppercase display is automatic via CSS — do not `.toUpperCase()` in code.

**11. SDK methods** → `packages/sdk/src/client.ts`
Add the typed methods to `createSdk` (list/get/create/update/activate…), mirroring the routes.

**12. Verify** → `pnpm verify`
Runs typecheck → lint → format → no-suppressions → boundaries → test → build (see root `package.json`).
Confirm coverage. Then pass the **CTO gate** in `CTO_RULES.md` before the next build-order phase.

---

## Gotchas

- **DATABASE_URL reaches tests only because `turbo.json` declares it in `test.env`.** Without that, turbo
  caches across DB changes and the var is invisible to the test process.
- **Integration tests skip without `DATABASE_URL`** (`describe.skipIf(!RUN)`). Green-with-skips ≠ tested —
  CI must provide a throwaway DB.
- **Controllers must not import repositories** — controller → service → repository only. The
  `boundaries` step (dependency-cruiser) fails the build on a violation.
- **No magic numbers** in service/controller/repository — use named constants (`HTTP_STATUS.*`,
  PG codes like `'23505'` belong in a named helper, e.g. `isUniqueViolation`).
- **Never `console.*`** — use `@crm2/logger` (`req.log` / `logger`). The no-suppressions / lint gates flag it.
- **Repos return camelCase already** (db.ts camelizes). Don't `SELECT col AS "camelCase"`; select snake columns.
- **Migrations stay source-only** until the schema set is cohesive; the harness — not a runner — applies them.
---

## Long-Term Governance & Operations (2026-06-04 freeze)

Full map: `CRM2_MASTER_MEMORY.md` §7.6. **Decisions** → `docs/adr/` (ADR-0001..0019; change a frozen decision only via a superseding ADR + CTO + domain-owner sign-off — `LONG_TERM_PROTECTION.md`). **Business rules** → `BUSINESS_RULES.md` (no rule lives only in code). **API/contract** → `API_VERSIONING_POLICY.md`, `DOCUMENTATION_AS_CODE.md`. **DB change** → `DATABASE_CHANGE_PROCESS.md`. **Security** → `SECURITY_STANDARDS.md`, `SECURITY_GUIDE.md`. **Resilience** → `DISASTER_RECOVERY.md` (quarterly restore drill), `DATA_RETENTION_POLICY.md`. **Ownership** → `DOMAIN_OWNERSHIP.md`. **Quality/ops** → `TEST_DATASET_STRATEGY.md`, `PERFORMANCE_STANDARDS.md`, `OBSERVABILITY_STANDARDS.md`, `MONITORING_STRATEGY.md`, `OPERATIONS_GUIDE.md` + `runbooks/`, `RELEASE_GUIDE.md` + `RELEASE_CHECKLIST.md`, `UPGRADE_POLICY.md`, `TECH_DEBT_POLICY.md`.

---

## List endpoints: pagination recipe (FROZEN 2026-06-05) — SoT `docs/PAGINATION_AND_LOADING_STANDARDS.md`
When a module exposes a list (`GET /api/v2/<kebab>`):
1. **Contract** (`@crm2/sdk`): a shared `Paginated<T> = { items: T[]; totalCount; page; pageSize; totalPages; sort; filters }` and a `ListQuery { page; limit; search?; sortBy?; sortOrder?; filters? }`. Validate `limit ∈ {25,50,100,200,500}` (default 25), reject `>500`.
2. **Repository:** one parameterized `count` + one `page` query (`ORDER BY <whitelisted sortBy> <sortOrder> LIMIT $n OFFSET $m`); select only needed columns (no `SELECT *`); index the sort/filter columns.
3. **Service/controller:** parse+clamp paging, whitelist `sortBy`/filters, return the envelope.
4. **Web:** TanStack Query keyed by the paging state; **skeleton rows** while loading; search/filter/sort controls; page-size selector (25/50/100/200[/500 MIS]). Loading bands + Hexagon loader per `UI_STANDARDS.md`.
5. **Tests:** pagination-contract (envelope + `limit>500` rejected), query-count/N+1, large-dataset.
Exports are NOT list endpoints — they are background jobs (no pagination).

---

## Responsive-First (FROZEN 2026-06-05) — SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`
Build every screen mobile-up: works at 320/768/1024/1440, no horizontal overflow, no desktop-only flow.
Grids `grid-cols-1 md:…`; nav → hamburger/Sheet `<lg`; dialogs `w-full`+scroll/Sheet; filters `flex-wrap`;
tables desktop-grid → tablet-condensed → mobile card/list (interim tables `overflow-x-auto`). Add a
Playwright viewport spec (320/768/1024/1440) per page (CI gates 49–50).

## Editing a record: Optimistic Concurrency Control (FROZEN 2026-06-05) — SoT `docs/CONCURRENCY_AND_EDITING_STANDARD.md`
Every module's update path (recipe steps 3–4, 9–11) uses OCC, not last-write-wins:
1. **Migration:** the table has `version integer NOT NULL DEFAULT 1`.
2. **Repo:** guarded update `… SET …, version = version + 1, updated_at = now(), updated_by = $actor
   WHERE id = $id AND version = $expected RETURNING …`; 0 rows → existence check → `AppError.notFound`
   (404) or `AppError.conflict('STALE_UPDATE', …, { current })` (409). Multi-statement → `withTransaction`.
3. **Service/SDK:** Update schema **requires** `version` (missing → 400 VERSION_REQUIRED); reads return version.
4. **Audit:** append an immutable history row on create/update/deactivate.
5. **Web:** capture `version` on dialog open, send on save; on 409 show the Conflict dialog (reload & re-apply
   / discard) — never silently overwrite. **Bulk** = per-row OCC partial-success; large = background job.

## Building a list UI: use the Universal DataGrid (FROZEN 2026-06-05) — SoT `docs/DATAGRID_STANDARD.md`
Frontend step (§10 of the recipe) for any list is **always** the DataGrid
(`apps/web/src/components/ui/data-grid/`, TanStack Table) — never a bespoke table:
1. Define columns (id, header, accessor, `sortable`, `searchable`, `filter` kind, `hideable`).
2. Wire to the paginated endpoint via `@crm2/sdk` + TanStack Query; URL holds search/filters/sort/
   page/pageSize/columns/view. Server does all search/filter/sort/pagination.
3. Provide global search, per-column search, Excel-style header filters, column visibility, saved
   views, row selection + bulk actions, export-current-view (background job, XLSX/CSV).
4. States: skeleton rows (loading) · empty · error · permission. Hexagon loader for >1s.
5. Tests (gates 45–48): pagination/search/filter/sort/export/saved-views/URL-persistence/a11y.
The component is built once (first operational list) then imported everywhere; do not re-implement.

---

## Import / Export: never per-module (FROZEN 2026-06-05) — SoT `docs/IMPORT_EXPORT_STANDARD.md`
- **Export:** wire it through the DataGrid only (Export Current View / Selected Rows / All Matching).
  Do NOT add a module export button/endpoint. `<10k` immediate; `≥10k` → background job.
- **Import (import-enabled domains only):** implement the four plug-in pieces for the `@crm2/import-engine`
  — **Template · Validator (reuse the domain zod contract) · Mapper · Processor (idempotent batch via the
  repository)** — never the flow itself (the engine owns template/upload/validate/preview/confirm/job/
  report/audit). Forbidden import: audit/billing/commission/system/notification surfaces.
