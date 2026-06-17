# Next session — finish the major-version dependency upgrade

## State at handoff

CRM2 (`acsdeveloper2025/crm2`) is **live** on `https://crm.allcheckservices.com`, runtime
**Node 24**, `ci.yml` fully green (incl. Playwright e2e). The dependency upgrade to latest is
**partly done** — completed clusters are committed + pushed:

- ✅ tooling: dependency-cruiser 17, knip 6, lint-staged 17
- ✅ eslint 10 (+ `@eslint/js` 10) — fixed one new `no-useless-assignment`
- ✅ in-range latest for everything else + Node 24 + `@types/node` pinned `^24`
- ✅ +genuine test coverage added (logger trace/fatal, sdk read endpoints, SyncDownloadQuery)

> **vitest 4 was attempted and REVERTED**: vitest 4 needs vite's `./module-runner` export,
> which only exists in **vite 6** — `@crm2/web`'s test runs vitest *with* vite (currently 5),
> so vitest 4 fails `ERR_PACKAGE_PATH_NOT_EXPORTED`. **vitest 4 must be bumped together with
> vite 6 / @vitejs/plugin-react 6** (i.e. inside the frontend cluster). Node-only test packages
> (api/sdk/logger) pass on vitest 4 alone, which masks this — don't be fooled.

**Remaining majors to bump (one cluster at a time):**

| Package | From → To | Area |
|---|---|---|
| typescript | 5 → 6 | all (typecheck) |
| express + @types/express | 4 → 5 | `@crm2/api`, `@crm2/access` |
| nodemailer + @types/supertest | 8→9 / 6→7 | `@crm2/api` |
| react + react-dom + @types/react(-dom) | 18 → 19 | `@crm2/web` |
| react-router-dom | 6 → 7 | `@crm2/web` |
| **vite 6 + @vitejs/plugin-react 6 + vitest 4 + @vitest/coverage-v8 4** | 5→6 / 4→6 / 2→4 | `@crm2/web` (do together) |
| **tailwindcss** | 3 → 4 | `@crm2/web` + `@crm2/ui-theme` |

**Do NOT bump `@types/node` to 25** — keep `^24` to match the Node 24 runtime (types must not
float ahead of the runtime major). It's pinned in api/config/logger/test-utils.

## Method (proven this session)

One major per cluster: bump → fix breakages → `pnpm verify` green → commit. Recommended order
(lowest-risk first, Tailwind last):

1. **TypeScript 6** — `pnpm add -Dw typescript@latest` (+ in each pkg). Then `pnpm typecheck`.
   *Known gotcha:* TS 6's stricter default `types` resolution drops Node globals — packages that
   use `process`/Node APIs (api, config, logger, test-utils, worker) showed
   `TS2591: Cannot find name 'process'`. Fix by adding `"types": ["node"]` to those packages'
   tsconfigs (NOT the base — `@crm2/web` must keep DOM, `@crm2/sdk` already sets
   `lib:["ES2022","DOM"], types:[]` and must stay that way).
2. **Express 5** (`@crm2/api`, `@crm2/access`) + nodemailer 9 + @types/supertest 7. Then
   `DATABASE_URL=… pnpm --filter @crm2/api test`. *Gotchas:* path-to-regexp v8 (route wildcards
   `*` → named `:splat*` / `{*splat}`, optional `:p?` syntax changed), middleware error handling,
   removed `app.del`/`res.redirect('back')`. Grep routes for `*`/`?` params. **Runtime-verify** a
   few endpoints after (blue-green + smoke only checks `/health`).
3. **React 19** + @types/react(-dom) 19 + @vitejs/plugin-react 6. Try `npx codemod@latest react/19/migration-recipe`.
   Then `pnpm --filter @crm2/web build`. Gotchas: ref-as-prop, removed `defaultProps` on function
   components, removed string refs.
4. **react-router-dom 7** — library mode is mostly compatible with v6; some types/exports moved.
   Check `App.tsx` router setup + `useNavigate`/`Outlet` imports.
5. **Tailwind 4** — the big one. v4 is CSS-first: `@tailwind base/components/utilities` →
   `@import "tailwindcss"`; `tailwind.config.js` + `packages/ui-theme/tailwind-preset.js` migrate
   to `@theme {}` in CSS; PostCSS uses `@tailwindcss/postcss`. The **frozen color tokens**
   (`docs/COLOR_SYSTEM_FREEZE.md`, `packages/ui-theme/src/tokens.css`) must be ported to `@theme`.
   **This changes rendered output → REQUIRES browser validation** at all 4 e2e viewports; a visual
   regression will pass `pnpm verify` + the deploy smoke. Consider a superseding ADR (frozen-stack).

## vitest 4 precedent (already applied — reuse the pattern)

vitest 4's AST-aware v8 coverage recounts unchanged code slightly stricter. If a package dips below
its floor: first add a genuine test for the now-flagged lines (e.g. logger trace/fatal); only if the
residual is pure measurement drift, lower that one threshold by ~1pt with a comment (see
`packages/sdk/vitest.config.ts` — statements 90→89). Do not blanket-lower.

## Run locally

```bash
pnpm install
docker compose up -d   # dev + test DBs
pnpm --filter @crm2/api exec puppeteer browsers install chrome   # PDF render tests need it
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test pnpm verify   # 100% before pushing
```

## Rules

Author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional commits, **no AI trailer**, never
`--no-verify`, direct commits to `main` OK (it's the deploy line — each push rebuilds + blue-green
deploys with rollback). Done when every major is at latest and `pnpm verify` + `ci.yml` are 100% green.
