# CRM2 — Allowed Dependencies (Part 20, FROZEN process)

**Rule:** no package is installed without an entry here. Every dependency states **purpose · owner · approval reason**. Adding a dependency = a PR that updates this file; reviewers reject installs not listed. Prefer the platform/stdlib before adding a package.

## Runtime — backend (`apps/api`, packages)
| Package | Purpose | Owner | Approved because |
|---|---|---|---|
| `express` | HTTP server | CTO | frozen API stack |
| `pg` | PostgreSQL driver (raw SQL, repository layer ONLY) | CTO | Prisma rejected; raw pg is the frozen data layer |
| `zod` | boundary validation + shared contracts | CTO | frozen contract layer |
| `jose` | JWT sign/verify (HS256) for authentication | CTO (ADR-0014) | audited, zero native deps; reuse over hand-rolled JWT. Passwords use built-in `crypto.scrypt` (no dep) |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | object storage (profile photos) via the `StorageProvider` interface — lazy-imported, only loaded when `STORAGE_BACKEND='s3'`/`'minio'` + `S3_*` env present | CTO (ADR-0021) | correct SigV4 signing + presigned URLs; reuse over hand-rolled. Config-gated; unconfigured = clean 503 |
| `nodemailer` | transactional email (one-time-password / reset mail) via the `Mailer` interface — only used when `SMTP_HOST` set | CTO (ADR-0021) | correct SMTP+TLS+MIME; reuse over hand-rolled. Best-effort send; disabled = logged skip |
| `socket.io` | real-time transport (`platform/realtime`) — the LOCKED mobile contract is a socket.io consumer (`user:<id>` room, `location:request`); reproducing it byte-compatibly forces socket.io over native ws/SSE | CTO (ADR-0027) | mobile first-class consumer (ADR-0012); JWT-handshake + scope-correct rooms |
| `@socket.io/redis-adapter` | multi-instance socket.io pub/sub over Valkey — config-gated via `REDIS_CACHE_URL` (in-memory adapter when absent; dev/tests need no Valkey) | CTO (ADR-0027) | the official socket.io HA adapter; reuse over hand-rolled fan-out |
| `ioredis` | Valkey/Redis client backing the socket.io adapter (and the BullMQ workers) | CTO (ADR-0027) | the adapter's required client; Valkey is the frozen Redis (MASTER_MEMORY §3) |
| `bullmq` | background-job queue on Valkey — config-gated via `REDIS_QUEUE_URL` (in-process runner when absent; dev/tests need no Valkey); lazy-imported. The `ROLE=worker` process runs jobs out-of-process. | CTO (ADR-0030) | the standard Redis-backed queue; reuse over a hand-rolled queue |
| `firebase-admin` | FCM push to the unchanged device (`platform/push`) — byte-compatible silent `LOCATION_REQUEST` + token register; config-gated, service account from `caseflow-mobile` only, never committed | CTO (ADR-0027) | the only supported FCM Admin SDK; disabled no-op when unconfigured |
| `multer` | multipart/form-data parser for the device FIELD-PHOTO upload (`/api/v2/verification-tasks/:id/attachments`) — the LOCKED v1 mobile contract posts `files[]` + form fields, which `express.raw()` (octet-stream) cannot parse. memoryStorage only (bytes go to the ADR-0021 storage seam, never disk), bounded count + size. | CTO (ADR-0034) | the standard Express multipart parser; reproducing the locked multipart contract byte-compatibly forces it over a hand-rolled busboy. ADR-0012 mobile compat |
| `sharp` | server-side image processing for FIELD photos — defensive EXIF/metadata strip + auto-orient + thumbnail (200×200) + bounded decode (`limitInputPixels`). Lazy-imported in `platform/photo`; only loaded on a field-photo upload. | CTO (ADR-0034) | the standard high-performance image lib (libvips); v1 parity (sharp thumbnails); reuse over hand-rolled pixel work |
| `@crm2/*` (workspace) | internal packages (logger/access/config/sdk/ui-theme/test-utils) | CTO | first-party |

## Runtime — frontend (`apps/web`)
| Package | Purpose | Owner | Approved because |
|---|---|---|---|
| `react`, `react-dom` | UI runtime | CTO | frozen stack (⚠ pinned 18.3 — see MASTER_MEMORY React-19 deviation) |
| `react-router-dom` | routing | CTO | frozen stack (RR7 target) |
| `@tanstack/react-query` | server-state (Part 11) | CTO | frozen stack; the only data-fetch mechanism |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | self-hosted fonts (no runtime CDN) | CTO | design freeze; banking app must not depend on a font CDN |
| `socket.io-client` | the FE socket.io transport — connects to the same `/socket.io` the server (and mobile) use, JWT in `auth.token`; drives the live notification bell + Field Monitoring roster | CTO (ADR-0027) | the matching client for the LOCKED socket.io contract |
| `sonner` | toast surface (frozen UI standard) — incoming-notification toasts | CTO (ADR-0027; UI build) | the pre-approved toast lib (this file's Pending list); single Toaster mount |

## Tooling / dev (root)
| Package | Purpose | Owner | Approved because |
|---|---|---|---|
| `turbo` | monorepo task runner/cache | CTO | frozen stack |
| `typescript` | compiler | CTO | frozen stack |
| `vitest` | unit + integration runner | CTO | frozen test stack |
| `eslint`, `@eslint/js`, `typescript-eslint` | lint enforcement (Parts 2/3/6/8/11/12) | CTO | machine enforcement |
| `eslint-config-prettier` | disable formatting-conflict lint rules | CTO | prettier owns formatting |
| `prettier` | formatting (Part 4) | CTO | single formatter |
| `husky`, `lint-staged` | pre-commit gates (Part 39) | CTO | local fast-fail |
| `dependency-cruiser` | circular + boundary enforcement (Parts 25/27/28) | CTO | machine enforcement |
| `knip` | dead-code report (Part 26) | CTO | hygiene |

## Banned (never add)
`prisma` / any ORM · `moment` · `lodash` (wholesale) · `axios` (FE — use `@crm2/sdk`) · `react-icons` (use `lucide-react`) · `styled-components`/`emotion` (Tailwind only) · `enzyme` · `webpack`/CRA by hand.

## Pending (approved-to-add when their phase lands)
`@asteasolutions/zod-to-openapi` + `openapi-typescript` (Part 21 SDK gen) · `playwright` + `@axe-core/playwright` (Parts 19/29 E2E + a11y) · `lucide-react`, `@radix-ui/*`, `react-hook-form`, `@hookform/resolvers`, `sonner` (UI build) · `bullmq` + Valkey client (workers).

## Platform-capability locations & package scope (FROZEN 2026-06-05)
SoT: `docs/PLATFORM_CAPABILITIES_OWNERSHIP.md`. The mandatory capabilities are **app-internal** and
**consume** the 6 packages — **extraction stays DEFERRED** (no new package without ADR):
- **DataGrid** (search/filters/pagination/saved-views/columns/export/loading) → `apps/web/src/components/ui/data-grid/`; deps TanStack Table+Query · `@crm2/sdk` (query+envelope contracts) · `@crm2/ui-theme` (styling tokens) · `@crm2/access` (permission state).
- **Import engine** → `apps/api/src/platform/import/` (+ worker job, web `components/import/`, `@crm2/sdk` contracts); deps `@crm2/logger` (import audit) · `@crm2/config` (storage/queue) · domain repositories.
- **Export engine** → `apps/api/src/platform/export/` (+ report-worker for ≥10k jobs, DataGrid export menu); deps `@crm2/sdk` · `@crm2/logger` (export/job audit) · `@crm2/config` · **`exceljs`** (XLSX builder, api-v2 dep, lazy-imported — write-only, parses no untrusted input; keep patched) · CSV builder is in-house (zero-dep, RFC-4180 + CWE-1236) · object store.
Package scope clarified (responsibilities, not new packages): ui-theme = grid/filter/skeleton/dialog token classes (still tokens-only) · logger = import/export/job audit logs · sdk = import/export/saved-view/DataGrid-query contracts · access = `data.import`/`data.export` (when built) · config = export/import limits + storage/queue.
