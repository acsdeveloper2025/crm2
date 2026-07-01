# CRM2 — Architecture Inventory

> Read-only snapshot. No code was modified to produce this document.
> Generated 2026-07-01 from the `crm2` repo (`/Users/mayurkulkarni/Downloads/crm2`, git `acsdeveloper2025/crm2`, live on `https://crm.allcheckservices.com`). Source: `package.json` files, `db/v2/migrations`, `infra/`, `.github/workflows`, `packages/config/src/index.ts` (the env schema), and direct source reads — not the project's own docs (those are cross-checked, not assumed). Architecture/stack are **FROZEN** per `CLAUDE.md`; this is an inventory, not an audit.

---

## 1. Frontend (`apps/web` — `@crm2/web`)

| Item | Value |
|---|---|
| Framework | React 19 (`react` `^19.2.7`, `react-dom` `^19.2.7`) |
| Language | TypeScript `^6.0.3`, strict, `tsc -b` for builds (no Babel) |
| UI library | None (no MUI/AntD/Chakra/shadcn). Hand-built component set in `apps/web/src/components/ui/` (Button, Tabs, Popover, SearchableSelect, HexagonLoader, etc.), styled with Tailwind tokens from `@crm2/ui-theme` |
| State management | No Redux/Zustand/MobX. Server state via **TanStack Query** (`@tanstack/react-query` `^5.101.0`); local/app state via React context (`AuthContext`, `ActiveSelectionContext`) |
| Routing | **React Router** `^7.18.0` (`BrowserRouter`) |
| Build tool | **Vite** `^8.0.16` (dev server on port 5273) |
| CSS framework | **Tailwind CSS v4** (`^4.3.1`, `@tailwindcss/postcss`) via the `@crm2/ui-theme` tailwind preset + design-token CSS variables (`docs/COLOR_SYSTEM_FREEZE.md`) |
| Form library | **None** — deliberately. `apps/web/src/lib/zodForm.ts` runs the server's own `@crm2/sdk` Zod schema against form values for inline errors, structurally typed so the web app needs no direct `zod` dependency (comment cites ADR-0051: "WITHOUT adding a react-hook-form dependency to the frozen stack") |
| Validation library | **Zod** (`^3.25.76`), but only indirectly — schemas live in `@crm2/sdk` (shared with the API); web has no direct `zod` package dependency |
| Authentication method | JWT access token in memory (`tokenStore`) + httpOnly-cookie refresh (web) with single-flight silent-refresh-and-retry on 401 (`apps/web/src/lib/sdk.ts`, `AuthContext.tsx`) |
| HTTP client | Native `fetch()` — no axios/ky. Thin wrapper in `apps/web/src/lib/sdk.ts` (`ApiError`, 401 refresh-and-retry, typed against `@crm2/sdk`) |
| Package manager | **pnpm** `9.0.0` (pinned via `packageManager` field), pnpm workspaces |
| Realtime | `socket.io-client` `^4.8.3` |
| Tables | **TanStack Table** `^8.21.3` — the sole "Universal DataGrid" (`apps/web/src/components/ui/data-grid/`), no other table implementation permitted (`docs/DATAGRID_STANDARD.md`, FROZEN) |
| Fonts | Self-hosted via `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` |
| Testing | Vitest (unit), Playwright `^1.61.0` + `@axe-core/playwright` (e2e + a11y) |
| Toasts | `sonner` `^2.0.7` |

## 2. Backend (`apps/api` — `@crm2/api`, plus `apps/worker`, `apps/report-worker`)

| Item | Value |
|---|---|
| Language | TypeScript `^6.0.3`, ESM (`"type": "module"`) |
| Framework | **Express** `^5.2.1` |
| Runtime version | Node **≥22** (root `package.json` `engines`); installed/CI/prod use Node **24** (`.github/workflows` `NODE_VERSION: '24'`; `node --version` on this machine → v24.3.0) |
| API type | REST (`/api/v2/...`), versioned and additive-only per `CLAUDE.md`. OpenAPI surface generated and drift-checked in CI (`pnpm openapi`, `apps/api/openapi.json`) — spec generation, not GraphQL |
| Authentication | JWT (`jose` `^6.2.3`) — short-lived access token (`AUTH_ACCESS_TTL_S`, default 900s) + rotating refresh token (`AUTH_REFRESH_TTL_S`, default 2,592,000s/30d) with reuse-detection family-revoke (60s grace) and a durable access-token kill-switch (`tokens_valid_after` + iat check). Password hashing: **scrypt** (`PASSWORD_SCRYPT_N`, prod default 16384) with timing-safe dummy-hash on unknown users. MFA: **TOTP**, secret encrypted at rest with `MFA_ENC_KEY` (AES-256-GCM) |
| Authorization | Custom RBAC — `@crm2/access` package. 6 fixed roles (`SUPER_ADMIN`, `MANAGER`, `TEAM_LEADER`, `BACKEND_USER`, `FIELD_AGENT`, `KYC_VERIFIER`) × permission-code catalog (`page.*`, `*.manage`, `*.view`, `case.assign`, etc.), `authorize.ts` middleware, scope/territory-gated queries layered on top (see ADR-0072/0078) |
| ORM | **None** — raw SQL only, via `pg` (`^8.21.0`) connection pool. Enforced as a frozen rule ("raw SQL only in repositories + migrations") and machine-checked (`.dependency-cruiser.cjs` boundaries) |
| Queue system | **BullMQ** `^5.78.1` (Redis-backed), currently configured to run **in-process** inside the `api` container in prod (`REDIS_QUEUE_URL` unset). Out-of-process `worker` (general jobs) and `report-worker` (PDF/report-tier) targets exist as separate workspace packages but are placeholder builds ("Implemented in a later build step") — same Docker image as `api`, switched via `ROLE=worker`/`ROLE=report` |
| Scheduler | No external scheduler (no cron daemon/Temporal) — recurring work is driven through BullMQ job scheduling inside the API process |
| File storage | S3-compatible object storage via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; backed by **MinIO** in dev/prod (`STORAGE_BACKEND=minio`), real S3 is a supported alternate backend, presigned URLs for reads |
| Logging library | **`@crm2/logger`** — in-house, internal workspace package; centralized, no `console.*` calls allowed anywhere else (machine-enforced) |
| Validation library | **Zod** `^3.25.76` — request/response schemas live in `@crm2/sdk` shared between API and clients (43 files reference `zod` directly in `apps/api/src` + `packages`) |
| Realtime transport | **socket.io** `^4.8.3` (+ `@socket.io/redis-adapter` `^8.3.0` for multi-instance fan-out, conditional on `REDIS_CACHE_URL`) — required because the existing mobile app is a locked socket.io consumer |
| Push notifications | **Firebase Admin SDK** `^14.0.0` (FCM), inert no-op if `FIREBASE_SERVICE_ACCOUNT_PATH` unset |
| Documents/exports | `exceljs` (XLSX), `docx` (Word), `archiver` (zip), `handlebars` (templating), `puppeteer` `^25.1.0` (HTML→PDF rendering) |
| Image processing | `sharp` `^0.35.1` (field-photo GPS/watermark overlays) |
| Mail | `nodemailer` `^9.0.1`, inert unless `SMTP_HOST` set |
| Rate limiting | `express-rate-limit` `^8.5.2`, in-memory store (single-instance prod), tunable via env (`RATE_LIMIT_LOGIN_*`, `RATE_LIMIT_REFRESH_MAX`); nginx also rate-limits at the edge (`limit_req_zone`, 10r/s + burst 20) |
| Upload handling | `multer` `^2.2.0` |

## 3. Database

| Item | Value |
|---|---|
| Database engine | **PostgreSQL** |
| Version | **18-alpine** in dev and prod (`docker-compose.yml`, `infra/prod/docker-compose.yml` both pin `postgres:18-alpine`). CI's ephemeral test Postgres uses **17** (`.github/workflows/ci.yml: image: postgres:17`) — a version skew between CI and dev/prod worth noting |
| Extensions | `btree_gist`, `pg_trgm`, `pgcrypto` (declared via `CREATE EXTENSION IF NOT EXISTS` in migrations) |
| Connection pooling | `pg.Pool` (node-postgres built-in pool), tuned via env: `DB_POOL_MAX` (default 10), `DB_STATEMENT_TIMEOUT_MS` (60s), `DB_CONNECTION_TIMEOUT_MS` (5s), `DB_IDLE_IN_TX_TIMEOUT_MS` (30s). No external pooler (no PgBouncer) found |
| Migration tool | **Custom tracked runner** — `db/v2/migrate.sh` (POSIX shell) + a `schema_migrations` table (filename + `cksum` checksum). Applies only new/edited `.sql` files, in order, then idempotent data seeds (`db/v2/seed/`). 103 migration files at time of this report. No Prisma/Knex/node-pg-migrate — fully hand-rolled |
| Timezone | `Asia/Kolkata` pinned at the Postgres container level in prod (`TZ`/`PGTZ`) |

## 4. Cache

| Item | Value |
|---|---|
| Redis or other | **Valkey** (Redis-compatible fork) `valkey/valkey:8-alpine` — explicitly chosen over Redis (per repo memory: "frozen Redis, MASTER_MEMORY §3") |
| Usage | (a) BullMQ job queue backing store, (b) socket.io Redis adapter for multi-instance realtime fan-out. **Not deployed in prod today** — the prod `docker-compose.yml` has the `valkey` service fully commented out; `REDIS_QUEUE_URL`/`REDIS_CACHE_URL` are unset, so jobs run in-process and socket.io uses its in-memory adapter (single API instance) |
| Session storage | No server-side session store — auth is stateless JWT (access token) + DB-tracked refresh-token rows (`auth` repository), not Redis-backed sessions |
| Cache strategy | No general-purpose app-data cache layer found (no read-through/write-through cache, no `cache-manager`). Caching is limited to: TanStack Query's client-side cache (frontend), and a small in-process revoked-token cache with a 5s bust-on-revoke window (per repo memory, security hardening ADR-0076) |

## 5. Mobile App

The mobile client (`crm-mobile-native`) is a **separate repository**, not part of this `crm2` monorepo and not present in this environment (only `/Users/mayurkulkarni/CRM-MOBILE.zip` exists on disk, unopened — out of scope for a code-level audit from here). The facts below are everything determinable from this repo's API contract, docs, and project memory; anything mobile-internal is listed in §13.

| Item | Value |
|---|---|
| Framework | React Native (per `CLAUDE.md` / project memory: "crm-mobile-native, separate repo, first-class `/api/v2` consumer") |
| Native or Cross Platform | Cross-platform (React Native) |
| Android version | Unknown — not in this repo |
| iOS version | Unknown — not in this repo |
| Push notifications | **FCM** via Firebase — confirmed server-side: `apps/api/src/platform/push/` issues pushes through `firebase-admin`, env comment requires the `caseflow-mobile` Firebase project to match the device's |
| Local storage | Per project memory: `op-sqlite` + **SQLCipher** (encrypted on-device SQLite) — not verifiable from this repo, carried over from prior-session memory only |
| Encryption | Per project memory: SQLCipher at-rest DB encryption on-device. Transport security is standard HTTPS/TLS to the same `/api/v2` surface as web; no mobile-specific crypto code is visible from this repo |
| API contract | Mobile is a first-class, locked consumer of `/api/v2` (REST) + the same socket.io realtime channel as web (ADR-0011/0012 contract tests run in CI: `pnpm run contract:mobile` against a fixed module subset — `verification-tasks`, `location`, `users`, `notifications`, `sync`, `auth`, `consents`, `reference`) |

## 6. Infrastructure

| Item | Value |
|---|---|
| Hosting provider | Unbranded VPS, reachable at `crm.allcheckservices.com` (per `CLAUDE.md` / repo memory: single box, root SSH access, `/opt/crm2`) |
| VPS or Cloud | Single VPS (not a managed cloud platform — no AWS/GCP/Azure compute, though S3-compatible object storage is used) |
| Docker | Yes — `docker compose` for both dev (`docker-compose.yml`) and prod (`infra/prod/docker-compose.yml`); two `Dockerfile`s (`infra/Dockerfile.api`, `infra/Dockerfile.web`) |
| Reverse proxy | **nginx** (`infra/prod/nginx.conf`), baked into the `crm2-web` image as the `edge` container — TLS termination, `/api/`→api proxy, `/socket.io/`→api proxy (WS upgrade), `/crm2-prod/`→MinIO proxy, SPA static serving |
| SSL provider | **Let's Encrypt** (certbot) — certs mounted read-only from `/etc/letsencrypt`; ACME HTTP-01 challenge served at `/.well-known/acme-challenge/` |
| CDN | None found |
| Object storage | **MinIO** (S3-compatible, self-hosted, `minio/minio:latest`), bucket auto-created by a one-shot `minio-init` container; real AWS S3 supported as an alternate `STORAGE_BACKEND` |
| DNS | Not determinable from this repo (no DNS-as-code / Terraform found) |
| Firewall | Not determinable from this repo — no firewall-as-code (no `ufw`/`iptables`/cloud security-group config checked in) |
| Backup system | Not determinable from this repo — no backup script/cron found in `infra/` or `runbooks/`. `runbooks/db-outage.md` exists (operational runbook) but does not constitute an automated backup system |
| Container registry | **GHCR** (`ghcr.io/acsdeveloper2025`) — images `crm2-api`, `crm2-web`, tagged by commit SHA + `latest` |
| Deploy topology | Single box, **blue-green with automatic rollback** (`infra/prod/deploy.sh`), `docker compose` orchestration, one-shot `migrate` service runs the tracked DB-migration runner before `api` starts |
| Disk management | `deploy.sh` prunes Docker images (`docker image prune -af --filter until=72h`) after a 2026-06-26 incident where un-pruned tagged images filled the disk and crashed Postgres (per repo memory) |

## 7. CI/CD

| Item | Value |
|---|---|
| Git provider | **GitHub** (`acsdeveloper2025/crm2`) |
| Deployment process | Push to `main` → `.github/workflows/deploy.yml`: **gate** (typecheck/lint/build) → **build-images** (build+push both images to GHCR) → **deploy** (SSH to the box, run `infra/prod/deploy.sh` for blue-green+rollback, then smoke-test `https://crm.allcheckservices.com/_edge_health`). Deploy job is gated behind a `DEPLOY_ENABLED` repo variable |
| Branch strategy | Trunk-based — `main` only; CI runs on push-to-`main` and PRs targeting `main`; repo memory confirms "direct-to-`main` OK" as the accepted workflow, with short-lived feature branches/worktrees for in-flight work |
| Testing pipeline | `.github/workflows/ci.yml`, sequential gated jobs: **secret-scan** (Gitleaks) → **static** (typecheck, ESLint, Prettier, no-suppressions check, dependency-cruiser boundaries, knip dead-code report) → **test** (Vitest unit+integration against an ephemeral Postgres 17 service, plus a migration-runner-idempotency proof) → **build** (turbo build + OpenAPI-drift check + mobile/web contract tests) → **e2e** (Playwright responsive + axe-core a11y against a fully booted API+web stack with seeded fixtures) |
| Quality gates | `pnpm verify` = `typecheck → lint → format → no-suppressions → boundaries → test → build`, documented as a 40-rule enforcement matrix in `docs/CI_CD_STANDARDS.md` |
| Monorepo tooling | **Turborepo** (`turbo` `^2.9.18`) for task orchestration/caching across the pnpm workspace |

## 8. Security

| Item | Value |
|---|---|
| JWT | Yes — `jose` library. Access token TTL 15 min default (`AUTH_ACCESS_TTL_S`), HMAC-signed with `JWT_SECRET` (fail-fast in prod if left at the insecure dev default — enforced by a Zod `superRefine` in `packages/config`) |
| Sessions | No server-side session store; refresh-token rows tracked in Postgres (rotatable, revocable per-device) |
| Refresh tokens | Yes — 30-day TTL default (`AUTH_REFRESH_TTL_S`), rotated on use, **reuse-detection with family-revoke** (60s grace window for benign client retries before treating replay as theft). Web delivery is an **httpOnly cookie**; mobile keeps the token in the response body (preserves its existing contract) |
| MFA | Yes — **TOTP** (RFC 6238), enroll/verify flow in `auth` module (`generateTotpSecret`, `verifyTotp`, `otpauthUri`), secret encrypted at rest (`MFA_ENC_KEY`, AES-256-GCM), recovery codes supported, per-user `mfa_required` admin flag |
| RBAC | Yes — `@crm2/access`, 6 fixed roles × permission-code catalog (~180-line `permissions.ts`), enforced via Express middleware (`authorize.ts`) plus scope/territory-level data filtering in repositories |
| Audit logs | Yes — `apps/api/src/platform/audit.ts`, plus dedicated import/export job audit logging routed through `@crm2/logger` |
| Encryption | TLS in transit (Let's Encrypt at the edge); AES-256-GCM for MFA secrets at rest; scrypt (not reversible) for password hashes; no full-disk/column-level DB encryption found beyond that |
| Secrets management | File-based — `.env.prod` (mode 600) on the box at `/opt/crm2/secrets/`, never committed; Firebase service-account JSON mounted as a Docker secret; CI/deploy secrets live in GitHub Actions Secrets; `.gitleaks.toml` + a CI Gitleaks job catch accidental commits |
| Other hardening (from env schema + repo memory) | Per-IP login/refresh rate limits (app + nginx layers), `UV_THREADPOOL_SIZE=16` (prevents scrypt from starving the event loop under concurrent logins), account lockout after 5 failed logins, timing-safe dummy-hash on unknown-username login attempts, an access-token kill-switch (`tokens_valid_after` + iat check, durable revoke independent of token TTL), pg pool guards (statement/connection/idle-in-tx timeouts) |

## 9. Third-Party Services

External dependencies that call out to (or are consumed from) the internet:

- **Firebase Cloud Messaging** (`firebase-admin`) — push notifications to the mobile app
- **Google Geocoding API** (`GOOGLE_GEOCODING_API_KEY`, optional) — reverse-geocoding field-photo GPS coordinates
- **Let's Encrypt** — TLS certificates (via certbot, external CA)
- **GitHub** — source control, Actions (CI/CD runner), Container Registry (GHCR)
- **GHCR** (`ghcr.io`) — Docker image hosting
- **AWS S3** — supported as an alternate `STORAGE_BACKEND` (`s3`) to MinIO; not the prod default but wired via `@aws-sdk/*`
- **Gitleaks Action** — third-party GitHub Action for secret scanning in CI
- **SMTP relay** (unnamed, configured via `SMTP_HOST`) — optional, transactional mail; inert unless configured

No analytics, error-tracking (e.g. Sentry), or payment-processor SDKs were found in any `package.json`.

## 10. Environment Variables

Enumerated from `packages/config/src/index.ts` (the single Zod schema shared by `api`/`worker`/`report-worker`) and `infra/prod/.env.prod.example`. **All values below are masked** — none of these are real secrets, only variable names.

```
NODE_ENV=********                          # development|test|production
ROLE=********                              # api|worker|report
PORT=********                              # default 4000

# --- Database ---
DATABASE_URL=********
DB_STATEMENT_TIMEOUT_MS=********           # default 60000
DB_CONNECTION_TIMEOUT_MS=********          # default 5000
DB_IDLE_IN_TX_TIMEOUT_MS=********          # default 30000
DB_POOL_MAX=********                       # default 10
POSTGRES_USER=********                     # (compose-level, prod only)
POSTGRES_PASSWORD=********
POSTGRES_DB=********

# --- Redis / Valkey (future out-of-process job tier; unset in prod today) ---
REDIS_QUEUE_URL=********
REDIS_CACHE_URL=********

# --- Auth ---
JWT_SECRET=********
MFA_ENC_KEY=********
AUTH_ACCESS_TTL_S=********                 # default 900
AUTH_REFRESH_TTL_S=********                # default 2592000
PASSWORD_SCRYPT_N=********                 # default 16384

# --- Object storage ---
STORAGE_BACKEND=********                   # minio|s3|local
S3_BUCKET=********
S3_REGION=********                         # default ap-south-1
S3_ACCESS_KEY_ID=********
S3_SECRET_ACCESS_KEY=********
S3_ENDPOINT=********
S3_SIGNED_URL_TTL_S=********               # default 900

# --- Mail (optional) ---
SMTP_HOST=********
SMTP_PORT=********                         # default 587
SMTP_USER=********
SMTP_PASSWORD=********
SMTP_SECURE=********
MAIL_FROM=********

# --- Reverse geocoding (optional) ---
GOOGLE_GEOCODING_API_KEY=********

# --- FCM push (optional) ---
FIREBASE_SERVICE_ACCOUNT_PATH=********

# --- Import/Export job thresholds ---
EXPORT_JOB_THRESHOLD=********               # default 10000
EXPORT_JOB_MAX_ROWS=********                 # default 200000
IMPORT_JOB_THRESHOLD=********                 # default 10000
IMPORT_JOB_MAX_ROWS=********                  # default 200000

# --- Rate limiting ---
RATE_LIMIT_LOGIN_WINDOW_MS=********         # default 900000
RATE_LIMIT_LOGIN_MAX=********                # default 30
RATE_LIMIT_REFRESH_MAX=********              # default 60

# --- Future out-of-process job tier (commented out in prod compose) ---
VALKEY_PASSWORD=********
```

Additionally, `infra/prod/docker-compose.yml` references `IMAGE_REGISTRY`, `IMAGE_TAG`, `ENV_FILE`, `FIREBASE_SECRET_FILE` as deploy-time shell variables (not application env).

## 11. Folder Structure

```
crm2/
├── apps/
│   ├── api/                  # @crm2/api — Express REST backend
│   │   └── src/
│   │       ├── modules/      # ~45 domain modules (auth, cases, tasks, billing,
│   │       │                 #   verification-tasks, rates, users, mis, ...)
│   │       ├── platform/     # cross-cutting: db, jwt, password, totp, encryption,
│   │       │                 #   realtime (socket.io), push (FCM), export/import,
│   │       │                 #   audit, openapi, tokenRevocation
│   │       ├── http/         # express app wiring, rate-limit middleware
│   │       └── types/
│   ├── web/                  # @crm2/web — React 19 + Vite SPA
│   │   └── src/
│   │       ├── components/   # shared UI (ui/, data-grid/, ...)
│   │       ├── features/     # ~24 feature areas (cases, billing, pipeline,
│   │       │                 #   commissionSummary, fieldMonitoring, ...)
│   │       └── lib/          # sdk client, auth, sessionManager, zodForm, socket
│   ├── worker/                # BullMQ general-job runner (ROLE=worker; placeholder)
│   └── report-worker/         # PDF/report job runner (ROLE=report; placeholder)
├── packages/
│   ├── access/                # RBAC: roles, permissions, authorize middleware
│   ├── config/                # zod env schema (loadEnv) — shared by api/worker/report-worker
│   ├── logger/                # @crm2/logger — centralized logging
│   ├── sdk/                   # @crm2/sdk — shared zod schemas + typed API client contracts
│   ├── test-utils/             # test DB harness, factories, helpers
│   └── ui-theme/              # design tokens, Tailwind preset
├── db/v2/
│   ├── migrations/             # 103 tracked, checksum-verified SQL migrations
│   └── seed/                   # idempotent data seeds
├── infra/
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   └── prod/
│       ├── docker-compose.yml  # db · minio(+init) · migrate · api · edge(nginx)
│       ├── nginx.conf
│       ├── deploy.sh           # blue-green deploy + rollback + image prune
│       └── .env.prod.example
├── docs/                       # frozen-decision docs, ADRs, governance, runbooks-adjacent
│   ├── adr/                    # architecture decision records (ADR-0001 .. ADR-0081)
│   ├── governance/
│   └── engineering/
├── runbooks/                   # operational incident runbooks (db/api/redis/storage outage, etc.)
├── scripts/                    # check-suppressions.mjs (CI gate)
├── docker-compose.yml           # local dev: dev-db, test-db, minio(+init), valkey
├── turbo.json
├── pnpm-workspace.yaml
└── package.json                 # root scripts: verify, dev, openapi, contract:mobile
```

(`node_modules/`, `.turbo/`, `dist/`, `coverage/`, and `.claude/worktrees/` — local in-progress git worktrees — omitted.)

## 12. Dependency Inventory

Counted across all 8 workspace packages (`apps/web`, `apps/api`, `apps/worker`, `apps/report-worker`, and the 5 `packages/*`, deduplicated by name). `apps/worker`/`apps/report-worker` declare no real dependencies (placeholder builds).

**Production dependencies — 34 unique packages.** By workspace:

- `apps/web` (11): `@crm2/sdk`, `@crm2/ui-theme`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, `@tanstack/react-query`, `@tanstack/react-table`, `react`, `react-dom`, `react-router-dom`, `socket.io-client`, `sonner`
- `apps/api` (24): `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@crm2/access`, `@crm2/config`, `@crm2/logger`, `@crm2/sdk`, `@socket.io/redis-adapter`, `archiver`, `bullmq`, `docx`, `exceljs`, `express`, `express-rate-limit`, `firebase-admin`, `handlebars`, `ioredis`, `jose`, `multer`, `nodemailer`, `pg`, `puppeteer`, `sharp`, `socket.io`, `zod`
- `packages/config` (1): `zod`
- `packages/sdk` (1): `zod`
- `packages/test-utils` (1): `pg`
- `packages/access`, `packages/logger`, `packages/ui-theme`: 0 production deps (internal-only packages)

**Development dependencies — 23 unique packages** (root + per-workspace), notably: `typescript` `^6.0.3`, `eslint` `^10.5.0` + `typescript-eslint` `^8.61.1`, `prettier` `^3.8.4`, `vitest`/`@vitest/coverage-v8` `^4.1.9`, `turbo` `^2.9.18`, `dependency-cruiser` `^17.4.3`, `knip` `^6.17.1` (dead-code detection), `husky` `^9.1.7` + `lint-staged` `^17.0.7`, `@playwright/test` `^1.61.0` + `@axe-core/playwright`, `tsx` `^4.22.4`.

**Deprecated packages:** none of the 57 unique direct dependencies are themselves deprecated on npm. Versions are current-generation: React 19, Express 5, Zod 3 (not yet migrated to Zod 4), TypeScript 6, Vite 8, Tailwind 4.

**Vulnerable packages (`pnpm audit --prod`, run during this inventory):**

| Severity | Package | Issue | Path |
|---|---|---|---|
| Moderate | `uuid` (transitive, `<11.1.1`) | Missing buffer bounds check in `v3`/`v5`/`v6` when a `buf` is supplied ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) | Via `exceljs@4.4.0 → uuid@8.3.2`, and `firebase-admin@14.0.0 → @google-cloud/storage → gaxios → uuid@9.0.1` (7 paths total) |

2 vulnerabilities total, both this one moderate-severity transitive `uuid` issue (not a direct dependency choice; not exploitable through this app's own code paths since `crm2` never calls the affected `uuid` `v3/v5/v6` overload itself — flagging for awareness, not claiming exploitability here).

## 13. Unknown Items

Could not be determined from this repository alone:

- **Mobile app internals** — exact React Native version, Android `minSdkVersion`/`targetSdkVersion`, iOS deployment target, whether Expo (managed/bare) or plain RN CLI, exact local-storage/encryption library versions (`op-sqlite`+SQLCipher are referenced only in this session's carried-over project memory, not verifiable from any file in this repo). The mobile repo (`crm-mobile-native`) is not checked out in this environment.
- **DNS** — registrar, DNS provider, record management (no infra-as-code for DNS found).
- **Firewall** — no firewall/security-group configuration is checked into this repo; box-level `ufw`/`iptables`/cloud-provider rules are not visible from here.
- **Backup system** — no automated DB/object-storage backup job, cron, or script was found in `infra/`, `db/`, or `runbooks/`. `runbooks/db-outage.md` is an incident runbook, not a backup mechanism — whether backups exist (and how) is unconfirmed from code.
- **Hosting provider identity** — the box is reachable via SSH per deploy scripts/docs, but no provider name (DigitalOcean/Hetzner/AWS EC2/etc.) is recorded in this repo.
- **CDN** — none found; if static assets are fronted by a CDN, it isn't configured in this repo's nginx/DNS-adjacent files.
- **`pnpm audit` exploitability** of the `uuid` transitive advisory in this app's specific call paths — flagged, not deeply investigated (out of scope for an inventory).
- **CI/prod Postgres version skew** — CI tests against Postgres 17 while dev/prod run Postgres 18; whether this is intentional or an oversight isn't stated anywhere in the repo.
