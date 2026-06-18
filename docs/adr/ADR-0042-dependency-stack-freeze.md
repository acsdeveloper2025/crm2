# ADR-0042: Dependency stack freeze — latest majors, lockfile-enforced

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

On 2026-06-17 the entire dependency stack was upgraded to its latest major
versions, one cluster at a time (TypeScript, Express + mail/test deps, React +
React Router, the Vite/Vitest toolchain, and Tailwind CSS), each gated on a
green `pnpm verify` and a green `ci.yml` before pushing. The application is
live (`crm.allcheckservices.com`) on the Node 24 runtime, and every push to
`main` rebuilds and blue-green deploys.

After that effort we need a durable, single answer to two recurring questions:

1. **What versions are we on, and how are they held in place** so a future
   install — local, CI, or the production image — cannot silently drift?
2. **Which non-obvious code exists *because of* a major upgrade**, so it is not
   "cleaned up" by someone who does not know why it is there, and so the
   upgrade work is not re-litigated.

The forcing constraint on versions is the runtime: the app runs on **Node 24**,
so `@types/node` must track the runtime major and must **not** float ahead of
it.

## Decision

We freeze the dependency stack at the latest majors below and **lock it via the
committed `pnpm-lock.yaml`**, enforced with `pnpm install --frozen-lockfile` in
every CI job (`.github/workflows/ci.yml`) and in deploy
(`.github/workflows/deploy.yml`). The lockfile — not the `package.json` ranges
— is the lock: a build fails rather than resolving a different tree if a
manifest and the lockfile ever disagree.

- We will **keep caret (`^`) ranges** in `package.json` and rely on the
  lockfile for exactness. We will **not** pin exact versions in `package.json`.
- We will **not** regenerate `pnpm-lock.yaml` (`pnpm update` / re-resolve)
  except as a **deliberate, reviewed upgrade**; any lockfile change is reviewed
  as a diff in a PR.
- `@types/node` is **pinned to `^24`** to match the Node 24 runtime and must not
  be bumped to 25+ while the runtime is Node 24.
- No dependency change lands unless `pnpm verify` **and** the full `ci.yml`
  (including the `e2e` Playwright job) are green.

### Locked versions (latest majors as of 2026-06-17)

| Package | Version | Area |
| --- | --- | --- |
| node (runtime) | 24 | all |
| typescript | 6 | all |
| express (+ `@types/express`) | 5 | `@crm2/api`, `@crm2/access` |
| nodemailer | 9 | `@crm2/api` |
| `@types/supertest` | 7 | `@crm2/api` |
| react / react-dom (+ `@types`) | 19 | `@crm2/web` |
| react-router-dom | 7 | `@crm2/web` |
| vite | 8 (rolldown) | `@crm2/web` |
| `@vitejs/plugin-react` | 6 | `@crm2/web` |
| vitest / `@vitest/coverage-v8` | 4 | all |
| tailwindcss (+ `@tailwindcss/postcss`) | 4 | `@crm2/web` |
| eslint (+ `@eslint/js`) | 10 | all |
| dependency-cruiser / knip / lint-staged | 17 / 6 / 17 | tooling |
| `@types/node` | **^24 (pinned to runtime)** | api, config, logger, test-utils |

### Major-upgrade load-bearing code (do not "clean up" without understanding)

- **TS 6** no longer auto-loads `@types/node` globals (`process`, `NodeJS`)
  unless a node builtin is imported. `@crm2/config` and `@crm2/logger` reference
  them ambiently → their tsconfigs set `"types": ["node"]`. TS 6 also reports
  `TS2882` on side-effect imports of untyped CSS-only packages → the
  `@fontsource-variable/*` modules are declared in `apps/web/src/vite-env.d.ts`.
- **Express 5** types `req.params[x]` as `string | string[]` → reads go through
  `apps/api/src/http/paramStr()`. Express 5's router no longer exposes a mount
  `regexp`, so `createApp`'s `mount()` helper stamps `__mountPrefix` on each
  router and the OpenAPI introspector (`platform/openapi/document.ts`, ADR-0031)
  reads that instead of parsing router internals.
- **React 19**: `useRef<T>(null)` returns `RefObject<T | null>` → `useFocusTrap`'s
  return type is widened to match.
- **react-router-dom 7** wraps navigations in `React.startTransition` by default,
  which defers URL/searchParam updates and made URL-controlled DataGrid
  checkboxes revert to their pre-click value. `apps/web/src/main.tsx` sets
  `<BrowserRouter useTransitions={false}>` to restore v6 synchronous navigation.
- **Vitest 4** v8 coverage recounts statements more strictly; genuine tests were
  added rather than lowering thresholds. Vitest 4 requires Vite ≥ 6
  (`./module-runner`), so it was bumped together with Vite 8.
- **Tailwind 4** keeps the FROZEN v3 color preset (ADR-0008, the COLOR SYSTEM
  FREEZE) verbatim via the v4 legacy-config bridge: `@import 'tailwindcss'` +
  `@config '../tailwind.config.js'`, with `@tailwindcss/postcss` replacing the
  v3 `tailwindcss`/`autoprefixer` PostCSS pair. The frozen tokens render
  identically; do not re-express them as `@theme` without re-validating output.

## Consequences

### Positive

- The production image installs a **byte-identical** dependency tree to local
  and CI; "works on my machine" drift is structurally impossible.
- A single authoritative record of the stack and the *why* behind the
  upgrade-driven code, removing the need to re-derive it from chat or git.
- Security **patch** updates remain trivial (carets + a deliberate lockfile
  refresh) without loosening the lock day-to-day.

### Negative

- Staying on the latest majors means future upgrades are again deliberate,
  cross-cutting efforts (the work this ADR records), not incremental drift.
- `pnpm verify` does **not** run the Playwright e2e suite — only the CI `e2e`
  job does (4 viewports). A frontend regression can pass local verify and the
  deploy smoke yet fail CI e2e (this is exactly how the react-router-7 checkbox
  regression surfaced). After a frontend change, the CI `e2e` job — not just
  `deploy` success — is the gate.

## Alternatives Considered

- **Pin exact versions in `package.json` (drop carets).** Rejected: the lockfile
  is already the enforced lock, so exact pins add maintenance churn and block
  easy security patches for no real safety gain over `--frozen-lockfile`. Exact
  pins are a library concern, not a deployed-app one.
- **Automated dependency bots (Dependabot / Renovate).** Rejected for now:
  they would open continuous bump PRs against an intentionally frozen stack;
  upgrades here are deliberate, reviewed, cross-cutting efforts.
- **Stay on the previous majors.** Rejected: the upgrade to latest was the
  explicit goal (currency, security, and support windows).

## Related ADRs

- ADR-0003 — PostgreSQL 17 (the other runtime-version pin).
- ADR-0008 — Design system / color freeze (preserved verbatim under Tailwind 4).
- ADR-0013 — Governance & engineering standards (how frozen decisions change).
- ADR-0031 — OpenAPI surface & SDK drift gate (the introspector adapted for
  Express 5).
