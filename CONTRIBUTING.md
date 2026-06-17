# Contributing to CRM2

A greenfield pnpm + turbo monorepo. The architecture is **frozen** — see "Architecture is frozen" below before proposing any structural change.

## Prerequisites

- **Node 22 LTS** (`engines.node` requires `>=20`; standardize on 22).
- **pnpm 10** (`package.json` currently pins `packageManager: "pnpm@9.0.0"` — use 10 locally; the pin will be bumped).
- **PostgreSQL 17** — only needed to run integration tests. Use a throwaway/ephemeral database; the harness owns its schema. CI runs a `postgres:17` service.
- **Docker** — optional (convenient for spinning up the throwaway Postgres).

## Setup

```bash
pnpm install
```

To run integration tests, point `DATABASE_URL` at a reachable Postgres:

```bash
export DATABASE_URL="postgres://user:pass@localhost:5432/crm2_dev"
pnpm test
```

Integration tests **skip silently** when `DATABASE_URL` is unset. When set, the ephemeral harness applies `db/v2/migrations/*` top-to-bottom against the target DB — see `packages/test-utils/src/helpers/testDb.ts`. Always use a disposable database; the harness manages and resets schema.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | `turbo run typecheck` (tsc per package) |
| `pnpm lint` | `eslint .` |
| `pnpm format` / `pnpm format:write` | prettier check / write |
| `pnpm no-suppressions` | `scripts/check-suppressions.mjs` — bans eslint/ts-ignore suppressions |
| `pnpm boundaries` | dependency-cruiser (`.dependency-cruiser.cjs`) — enforces package boundaries |
| `pnpm deadcode` | knip (`knip.json`) — unused files/exports |
| `pnpm test` | `turbo run test` (vitest). Set `DATABASE_URL` so integration tests run |
| `pnpm build` | `turbo run build` |
| `pnpm verify` | full local gate chain: typecheck → lint → format → no-suppressions → boundaries → test → build |

Dev servers:

```bash
pnpm dev:api   # @crm2/api
pnpm dev:web   # @crm2/web
```

Run `pnpm verify` before opening a PR; it mirrors the local gate chain.

## Pre-commit hook

Husky runs `lint-staged` (eslint `--max-warnings=0` + prettier) then `no-suppressions` — see `.husky/pre-commit`. **Do not bypass** (`--no-verify`).

## CI gates

The full CI gate order is documented in `docs/CI_CD_STANDARDS.md`. **Any failing gate blocks merge.**

## Dependencies

- **Never** `pnpm add` a package without first adding an entry (purpose / owner / approval) to `ALLOWED_DEPENDENCIES.md`.
- Banned packages are listed there (e.g. Prisma, moment, wholesale lodash, axios in the frontend, …). Check before reaching for a library.

## Commits

- Commit author **MUST** be `Mayur Kulkarni <mayurkulkarni786@gmail.com>`.
- Use **conventional-commit** messages: `feat|fix|chore|docs|refactor(scope): summary`.
- **NEVER** include a `Co-Authored-By` trailer or any "Generated with …" / AI attribution trailer.
- Secret-sweep before pushing — gitleaks runs in CI against `.gitleaks.toml`.
- **Never push or deploy without explicit human approval.** `main` is the deploy line.

## Branch model

**Direct commits to `main` are permitted — no PR required.** `main` is the deploy
line: a push to `main` runs the CI gate, builds the images, and (when
`DEPLOY_ENABLED=true`) deploys. Keep `main` green; never push or deploy without
explicit human approval.

## Pre-push checklist

- [ ] Tests added (unit **and** integration)
- [ ] `pnpm verify` is green locally
- [ ] Coverage thresholds met
- [ ] OpenAPI / SDK regenerated if the API changed
- [ ] No new dependency without an `ALLOWED_DEPENDENCIES.md` entry
- [ ] Docs updated if a rule or standard changed
- [ ] No suppressions (eslint-disable / ts-ignore)
- [ ] Conventional-commit message with the correct author (no AI trailer)

## Architecture is frozen

The data model and architecture are frozen — see `ACS_CRM_2.0_MASTER_MEMORY.md`, `AGENT_RULES.md`, and `docs/DESIGN_AND_STACK_FREEZE.md`. **Build only.** If a change appears to require an architecture, data-model, or design change, **open a discussion first — do not redesign.**
