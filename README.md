# CRM2

Field-verification & KYC case-management platform — a modular-monolith TypeScript
monorepo (pnpm + turbo). One API process (HTTP + jobs), a React SPA, and a shared
typed SDK contract.

## Layout

```
apps/
  api/    @crm2/api   Express + Socket.IO; ROLE=api|worker|report selects the process
  web/    @crm2/web   React 18 + Vite SPA (talks to the API same-origin, /api/v2/*)
  worker/ report-worker   out-of-process job tiers (run the api image with ROLE set)
packages/
  sdk/        @crm2/sdk        typed request/response contract (web + mobile)
  config/     @crm2/config     fail-fast zod env schema (single source of truth)
  access/     @crm2/access     RBAC / scope resolution
  logger/  ui-theme/  test-utils/
db/v2/migrations/   idempotent SQL migrations (applied in order, re-appliable)
infra/              Dockerfiles + production compose / nginx / deploy script
```

## Local development

Requires Node 22, pnpm 9, Docker.

```bash
pnpm install
docker compose up -d                 # dev Postgres (:54329 crm2_dev), test PG (:5433), MinIO, Valkey
for f in db/v2/migrations/*.sql; do psql postgresql://postgres@127.0.0.1:54329/crm2_dev -f "$f"; done
pnpm dev:api                         # API on :4000
pnpm dev:web                         # SPA on :5273
```

Migration `0009` seeds a `SUPER_ADMIN` (`admin` / `admin123`) for local login only —
production rotates it to a strong password on first deploy.

## Quality gates

```bash
pnpm verify    # typecheck · lint · prettier · no-suppressions · boundaries · test · build
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) enforces the same gates plus a
secret scan, coverage, migration idempotency, and Playwright e2e on every push/PR.

## Deployment (push → deploy)

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) — on push to `main`:

1. **gate** — typecheck + lint + build. A red gate blocks everything.
2. **build-images** — build & push `crm2-api` + `crm2-web` to GHCR, tagged by commit SHA.
3. **deploy** (when `DEPLOY_ENABLED=true`) — SSH to the host and run
   [infra/prod/deploy.sh](infra/prod/deploy.sh): pull images → run migrations → bring up
   the stack → health-gate the live HTTPS endpoint → **auto-rollback to the previous
   image on a red gate**.

Production stack (`infra/prod/docker-compose.yml`): `db` (Postgres 18) · `minio`
(object storage) · `migrate` (one-shot) · `api` · `edge` (nginx + TLS + static SPA),
behind a single hostname.

## Secrets

Secrets are **never committed**. `.env*` is gitignored; only `*.example` templates live
in the repo, and CI runs `gitleaks`. Runtime configuration lives in two places only:

- **Host:** `/opt/crm2/secrets/.env.prod` (mode 600) — DB / JWT / MFA / storage creds,
  generated on the host with `openssl rand`. See [infra/prod/.env.prod.example](infra/prod/.env.prod.example).
- **CI:** GitHub Actions secrets (SSH key, host, known-hosts pin) for the deploy job.

No secret value appears in the repo, in image layers, or in logs.
