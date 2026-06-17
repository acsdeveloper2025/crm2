# CRM2 — CI/CD Standards & Enforcement Matrix (FROZEN, machine-enforced)
**Status:** PERMANENT. Every rule below is enforced by a tool, not by convention. Config is the source of truth; this doc maps rule → mechanism → file.

## CI gate order (Part 19) — any failure blocks merge
`.github/workflows/ci.yml`:
1. **Type Check** — `pnpm typecheck` (tsc, all strict flags)
2. **ESLint** — `pnpm lint`
3. **Prettier** — `pnpm format` (`--check`)
4. **Unit tests** — `pnpm test` (vitest)
5. **Integration tests** — `pnpm test` against Postgres 17 service (ephemeral)
6. **Build** — `pnpm build`
7. **OpenAPI surface + drift** — `pnpm openapi` re-emits `apps/api/openapi.json` from the live app; CI `git diff --exit-code`s it (ACTIVE, ADR-0031, Part 21)
8. **SDK↔route contract** — the contract test (`platform/openapi/__tests__/contract.test.ts`) asserts the committed spec is current AND every `@crm2/sdk` path resolves to a real route (runs in step 5; validate-don't-replace — the SDK is hand-written, NOT generated)
9. **E2E** — Playwright (activates when screens ship)
Plus, gating jobs: **secret-scan** (gitleaks), **boundaries+circular** (dependency-cruiser), **no-suppressions** (scripts/check-suppressions.mjs), **dead-code report** (knip), **migration re-apply idempotency** (Part 22).

Local equivalent: `pnpm verify` (typecheck → lint → format → no-suppressions → boundaries → test → build). Pre-commit: husky + lint-staged (`.husky/pre-commit`).

## Enforcement matrix (rule → mechanism → where)
| Part | Rule | Mechanism | File |
|---|---|---|---|
| 2 | TS strict + noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noPropertyAccessFromIndexSignature | tsc | `tsconfig.base.json` |
| 2 | no `any` / no `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error` | eslint `no-explicit-any`, `ban-ts-comment` + grep | `eslint.config.js`, `scripts/check-suppressions.mjs` |
| 3 | no `eslint-disable*` (inert + fails CI) | eslint `noInlineConfig` + grep | `eslint.config.js`, `scripts/check-suppressions.mjs` |
| 3 | no `console.*` | eslint `no-console` | `eslint.config.js` |
| 4 | Prettier formatting | `prettier --check` | `.prettierrc.json` |
| 5 | centralized logger only | `@crm2/logger` + `no-console` | `packages/logger`, `eslint.config.js` |
| 6 | no TODO/FIXME/HACK/TEMP | eslint `no-warning-comments` | `eslint.config.js` |
| 7 | no commented-out code | review + (Git is history) | DEVELOPMENT_WORKFLOW |
| 8 | no magic numbers (business layer) | eslint `no-magic-numbers` (service/controller/repository) | `eslint.config.js` |
| 9 | DB access only in repositories | dependency-cruiser `db-access-only-in-repositories` | `.dependency-cruiser.cjs` |
| 10 | controllers thin (validate/authorize/call/return) | review + Part 28 boundary | CTO_RULES |
| 11 | React: TanStack Query, hooks, no useEffect-fetch, no giant components | review + frontend standards | DESIGN_AND_STACK_FREEZE Part 7 |
| 12 | FE uses @crm2/sdk — no raw fetch/axios | eslint `no-restricted-globals`/`no-restricted-imports` (features/components) | `eslint.config.js` |
| 18 | coverage ENFORCED (coverage.enabled:true + @vitest/coverage-v8) at honest floors, ratcheting up | vitest thresholds (always-on) | api-v2 lines/stmts 85·funcs 90·branch 58 · sdk 90/90/65 · logger 95/80/80 |
| 20 | dependency control | review against register | `ALLOWED_DEPENDENCIES.md` |
| 21 | API↔SDK contract drift (ADR-0031, validate-don't-replace) — OpenAPI surface re-emit + git-diff, and the SDK→route contract test; **web & mobile contract tests** (ADR-0011/0012) | `pnpm openapi` + `git diff --exit-code openapi.json` + `platform/openapi` contract test; `contract:web`/`contract:mobile` (CI) | `.github/workflows/ci.yml`, `docs/adr/ADR-0031-*.md`, `MOBILE_API_COMPATIBILITY_MATRIX.md` |
| 22 | migration applies clean + idempotent | CI re-apply loop | `.github/workflows/ci.yml` |
| 23 | N+1 / query-count protection | query-count test harness (per hot list) | added with each list endpoint |
| 24 | secret detection | gitleaks | `.gitleaks.toml`, CI |
| 25 | no circular deps | dependency-cruiser `no-circular` | `.dependency-cruiser.cjs` |
| 26 | dead-code report | knip | `knip.json` |
| 27 | feature boundary (no cross-feature internals) | dependency-cruiser `no-cross-feature-internals` | `.dependency-cruiser.cjs` |
| 28 | controller → service → repository | dependency-cruiser + eslint `no-restricted-imports` | `.dependency-cruiser.cjs`, `eslint.config.js` |
| 29 | accessibility automation | axe in Playwright (`e2e/a11y.spec.ts`) — gates CRITICAL, reports SERIOUS (E-5 ratchet) | CI `e2e` job |
| 30 | UTC everywhere; TIMESTAMPTZ | migrations use `timestamptz`; backend UTC | migrations + review |
| 31 | structured domain errors | `AppError` + `ErrorCode`; no bare `throw new Error` in domain | `platform/errors.ts` + review |
| 32 | soft delete (`deleted_at`/`deleted_by`) | schema + review | migrations |
| 33 | audit records for assignment/review/approval/billing/commission/master-data | audit tests | per-module tests |
| 34 | transactions for case/task/assignment/billing/commission | repository transactions + tests | repositories |
| 35 | feature flags for workspace/billing/reporting/assignment | flag module + review | (build phase) |
| 36 | observability: request id/duration/status/user; job start/finish/retry/failure | `requestObservability` + logger | `apps/api/src/http/app.ts` |
| 37 | naming convention freeze | review + SQL/lint conventions | ENGINEERING_STANDARDS Part 6.5 |
| 38 | uppercase display (visual-only) | CSS in @crm2/ui-theme | `UPPERCASE_DISPLAY_STANDARD.md` |
| 39 | tooling enforced (TS/ESLint/Prettier/Husky/lint-staged/Vitest/Playwright/deps/secrets/circular/boundaries/a11y/coverage) | all of the above | this matrix |

**Gaps that activate later (wired, not yet exercised — no surface yet):** OpenAPI/SDK gen (Part 21), Playwright E2E + axe a11y (19/29), N+1 harness (23), per-domain audit/transaction/soft-delete/feature-flag tests (32–35). Each lands with its module; the CI step + standard already exist so they cannot be skipped silently.

## Pagination & loading enforcement (FROZEN 2026-06-05) — SoT `PAGINATION_AND_LOADING_STANDARDS.md`
Per-endpoint CI gates (activate as each list endpoint adopts the standard; the step + standard
exist now so they cannot be skipped silently):
| # | Rule | Mechanism | Where |
|---|---|---|---|
| 40 | list endpoints accept `page/limit/search/sortBy/sortOrder/filters` + return `{items,totalCount,page,pageSize,totalPages,sort,filters}` | pagination-contract test | per-module `__tests__` |
| 41 | `limit > 500` rejected; no unbounded result set | contract test | per-module |
| 42 | bounded query count per list request (count + page) — no N+1 | query-count assertion (Part 23) | per-module |
| 43 | perf budgets (§12) hold on a large seeded dataset; tables render skeleton, not spinner | perf + large-dataset test | per-module + Playwright |
| 44 | `>8s` operations are background jobs (not inline request) | job-contract test | worker/report-worker |
Fail CI on violation once active. Pre-freeze list endpoints (VU/Clients/Products/CPV/Rates/Locations) are non-compliant → retrofit obligation in MASTER_MEMORY §8.

## Universal DataGrid enforcement (FROZEN 2026-06-05) — SoT `DATAGRID_STANDARD.md`
| # | Rule | Mechanism | Where |
|---|---|---|---|
| 45 | data lists use the one DataGrid; no custom/raw `<table>` for data | review + lint (no raw table in features) | `apps/web/src/features/**` |
| 46 | grid does server search/filter/sort/pagination (no client-side ops on operational data) | grid integration tests | data-grid `__tests__` |
| 47 | global+column search · header filters · multi-col filters · column visibility · saved views · export-current-view · URL-state persistence work | grid feature tests | data-grid `__tests__` |
| 48 | loading(skeleton)/empty/error/permission states + row-select/bulk + keyboard nav + a11y (axe) | grid + Playwright/axe | data-grid + e2e |
Activate as the DataGrid + paginated endpoints land. Pre-freeze bespoke tables retrofit (MASTER_MEMORY §8).

## Responsive-First enforcement (FROZEN 2026-06-05) — SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`
| # | Rule | Mechanism | Where |
|---|---|---|---|
| 49 | every page has no horizontal overflow + nav & primary action reachable at 320/768/1024/1440 | Playwright viewport spec | `apps/web` e2e |
| 50 | no bare `grid-cols-N` (responsive prefix required) · no unwrapped wide `<table>` · no fixed page width · responsive nav (hamburger/Sheet `<lg`) | review + lint rule | `apps/web/src/**` |
**Harness landed 2026-06-06** (`apps/web/playwright.config.ts` + `e2e/`, commits `63e6681`/`8dc57b8`):
gate 49 = `e2e/viewport.spec.ts` (4 viewport projects 375/768/1280/1440; no-overflow + nav + primary on all 11
pages + mobile card transform on the 8 list pages) + `e2e/login.spec.ts`; gate 50 = `.rtable` card pattern + the
0-bare-`grid-cols-N` sweep. Run `pnpm --filter @crm2/web test:e2e` — the harness now **boots the API + web itself** (`webServer:[api,web]`,
`reuseExistingServer:!CI`). **CI ACTIVATED 2026-06-06** (commit `f91a414`): dedicated **`e2e` job** in `ci.yml`
(`needs: build`) — postgres:17 → apply migrations (seeds dev admin) → install browser → `test:e2e` (gates 49-50
+ gate 29 axe) → upload html report. NOT wired into `pnpm verify`/turbo `test` (vitest-only). gate 29 gates
CRITICAL a11y, reports SERIOUS (E-5 ratchet = color-contrast on frozen tokens). 59 passed / 0 critical locally.

## Concurrency & editing enforcement (FROZEN 2026-06-05) — SoT `docs/CONCURRENCY_AND_EDITING_STANDARD.md`
| # | Rule | Mechanism | Where |
|---|---|---|---|
| 51 | update guarded by `version` → stale write returns **409 STALE_UPDATE**; success bumps version by 1; missing version → 400 VERSION_REQUIRED; bad id → 404 | OCC contract test (read v1 · update A→v2 · update B@v1→409) | per-module `__tests__` |
| 52 | every create/update/deactivate appends exactly one **immutable** audit/history row (never updated/deleted) | audit-row test | per-module + `platform` |
| 53 | bulk edit = per-row OCC partial-success (no all-or-nothing silent overwrite); large bulk = background job | bulk-partial test | per-module + worker |
Activate per module as the OCC + audit retrofit lands (COMPLIANCE C-10). Editable tables need a `version` column.
