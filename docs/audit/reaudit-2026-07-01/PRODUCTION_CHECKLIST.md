# CRM2 — Production Readiness Checklist (Go/No-Go)

**Target:** `crm.allcheckservices.com` (single-box docker-compose, push-to-main auto-deploy)
**Code under review:** HEAD `8ded432` — remediation range `b19039e..8ded432` (Wave 1–4: `955ca91` / `987f01f` / `db87685` / `ed8ec86` / `8ded432`)
**Method:** read-only static inspection + named commands (`pnpm boundaries`, `pnpm run deadcode`, `pnpm audit --prod`). Full test suite NOT run.
**Date:** 2026-07-01

Each item: **PASS / FAIL / NOT VERIFIED / N/A** + one-line evidence.

---

## 1 — Build & gates

| # | Item | State | Evidence |
|---|------|-------|----------|
| 1.1 | `pnpm verify` is the release gate (typecheck→lint→format→no-suppressions→boundaries→test→build) | PASS | `package.json:22` — `"verify": "pnpm typecheck && pnpm lint && pnpm format && pnpm no-suppressions && pnpm boundaries && pnpm test && pnpm build"` |
| 1.2 | Dependency boundaries clean | PASS | `pnpm boundaries` → `✔ no dependency violations found (566 modules, 1876 dependencies cruised)` |
| 1.3 | No-suppressions gate wired | PASS | `package.json:21` — `"no-suppressions": "node scripts/check-suppressions.mjs"` (in verify chain) |
| 1.4 | Dead-code / unused-exports clean | FAIL (non-blocking; NOT in `pnpm verify`) | `pnpm run deadcode` → knip exit 1: `Unused exports (19)` + `Unused exported types (14)`. Note: `deadcode` is NOT part of the `verify` gate (1.1) — tracked as CODE_QUALITY-01 DEFERRED (registry:1642). |
| 1.5 | Typecheck / lint / format / test / build | NOT VERIFIED | Not run this pass (full suite excluded by instruction). Registry states "`pnpm verify` green after every wave" (registry:1569) — trust-but-unverified here. |

## 2 — Secrets & config

| # | Item | State | Evidence |
|---|------|-------|----------|
| 2.1 | No real committed secrets (spot-check) | PASS | Spot-grep found only `apps/api/.env` (`minioadmin`) which is `git check-ignore` → IGNORED and `git ls-files` → not tracked; `.env.prod.example` holds only `__generate…__` placeholders |
| 2.2 | gitleaks in CI | PASS | `.gitleaks.toml` present; `.github/workflows/ci.yml:21-29` `secret-scan` job runs `gitleaks/gitleaks-action@v2` with `GITLEAKS_CONFIG`/`GITHUB_TOKEN` |
| 2.3 | Prod fail-fast on dev-default `JWT_SECRET`/`MFA_ENC_KEY` | PASS | `packages/config/src/index.ts:95-98` — `.superRefine` runs `checkSecretStrength` for both, only when `NODE_ENV === 'production'` |
| 2.4 | New entropy floor (length + distinct-char) beyond literal dev-default | PASS | `packages/config/src/index.ts:107-132` — `MIN_SECRET_LENGTH=32`, `MIN_DISTINCT_CHARS=10`; rejects `min(16)`-passing low-entropy strings (AUTHENTICATION-03) |
| 2.5 | `.env.prod.example` complete vs env schema | PASS | `infra/prod/.env.prod.example:9-46` covers NODE_ENV/ROLE/PORT, Postgres, JWT+MFA, S3/minio, mail, geocoding, FCM; optional externals correctly omitted (schema `.optional()` at `index.ts:41-64`) |

## 3 — Auth & session

| # | Item | State | Evidence |
|---|------|-------|----------|
| 3.1 | JWT refresh rotation (single-use, atomic) | PASS | `apps/api/src/modules/auth/service.ts:311-322` rotates via `repo.rotateRefresh`; `repository.ts:198-217` does revoke-old + insert-new in one `withTransaction` (DATABASE-02) |
| 3.2 | Refresh reuse-detection + family revoke (with grace) | PASS | `service.ts:295-301` — already-revoked token beyond `REFRESH_REUSE_GRACE_MS` → `fullyRevokeUser` + warn log; inside grace → plain 401 |
| 3.3 | Access-token kill-switch (iat cutoff) | PASS | `apps/api/src/http/authenticate.ts:22` — `!(await isAccessRevoked(claims.userId, claims.iat))` gates `req.auth` |
| 3.4 | MFA enrolled login requires valid TOTP/recovery | PASS | `service.ts:197-207` — enrolled user with missing code → `mfaRequired()`; wrong code → failed-login recorded + `mfaRequired()` |
| 3.5 | Lockout counts wrong MFA codes (new path) | PASS | `service.ts:203-205` — wrong MFA code calls `recordFailedLogin(creds.id, MAX_FAILED_LOGINS=5, LOCKOUT_COOLDOWN_S=900)`, same counter as wrong password (AUTHENTICATION-01) |
| 3.6 | Rate limiter on change-password / MFA endpoints | PASS | `apps/api/src/modules/auth/routes.ts:26,34-36` — `sensitiveActionLimiter()` on `/change-password`, `/mfa/enroll/start`, `/mfa/enroll/verify`, `/mfa/disable` |
| 3.7 | CSRF same-origin on cookie-auth refresh | PASS | `routes.ts:18` — `/refresh` wraps `verifySameOrigin()`; `http/sameOrigin.ts:14-27` rejects Origin/Referer host ≠ Host with 403 `CROSS_ORIGIN_REQUEST` |
| 3.8 | Refresh cookie flags (httpOnly, SameSite, Secure-in-prod, scoped path) | PASS | `apps/api/src/http/refreshCookie.ts:16-24` — `httpOnly:true`, `sameSite:'lax'`, `secure: NODE_ENV==='production'`, `path:'/api/v2/auth'` |
| 3.9 | Elevated-role assignment guard | PASS | `apps/api/src/modules/users/service.ts:199-205` — `assertCanAssignRole`: granting a `grantsAll` role requires actor already `grantsAll`, else 403 `CANNOT_GRANT_ELEVATED_ROLE` (AUTHORIZATION-04) |

## 4 — Data & migrations

| # | Item | State | Evidence |
|---|------|-------|----------|
| 4.1 | Tracked migration runner (only new/edited) | PASS | `infra/prod/docker-compose.yml:108-113` runs `db/v2/migrate.sh` via `schema_migrations`, gated one-shot (`service_completed_successfully` at :131) |
| 4.2 | 0105 additive + idempotent | PASS | `db/v2/migrations/0105_case_tasks_completion_index.sql:14-18` — `CREATE INDEX IF NOT EXISTS idx_case_tasks_completion_dates` inside `BEGIN;…COMMIT;` |
| 4.3 | 0106 additive + idempotent | PASS | `db/v2/migrations/0106_case_tasks_verification_unit_index.sql:7-11` — `CREATE INDEX IF NOT EXISTS idx_case_tasks_verification_unit` inside `BEGIN;…COMMIT;` |
| 4.4 | No destructive migration in 0105/0106 range | PASS | Both files contain only `CREATE INDEX IF NOT EXISTS`; no DROP/DELETE/ALTER…DROP |
| 4.5 | Audit-log append-only | PASS | `db/v2/migrations/0017_concurrency_audit.sql:42-50` — trigger `trg_audit_log_immutable` `RAISE EXCEPTION 'audit_log is append-only'` on UPDATE/DELETE (test-confirmed at `clients.api.test.ts:335-337`) |

## 5 — Infra hardening

| # | Item | State | Evidence |
|---|------|-------|----------|
| 5.1 | Non-root container (api) | PASS | `infra/Dockerfile.api:37-38` — `RUN chown -R node:node /app` + `USER node` (INFRASTRUCTURE-01) |
| 5.2 | `no-new-privileges` on all prod services | PASS | `infra/prod/docker-compose.yml` — `security_opt: [no-new-privileges:true]` on db(:50), minio(:72), minio-init(:91), migrate(:118), api(:157), edge(:184) |
| 5.3 | `mem_limit`/`cpus` on every service | PASS | `docker-compose.yml` — db 4g/2, minio 1g/1, minio-init 256m/0.5, migrate 512m/1, api 2g/2, edge 256m/1 (INFRASTRUCTURE-04) |
| 5.4 | Log rotation cap on every service | PASS | `docker-compose.yml:21-25` anchor `&default-logging` (20m×10) referenced by all 6 services (LOGGING-03) |
| 5.5 | Only 80/443 published | PASS | `docker-compose.yml` — only `edge` has `ports: ['80:80','443:443']` (:168-170); db/minio/api have no `ports:` (internal network only) |
| 5.6 | TLS 1.2/1.3 + explicit cipher allowlist | PASS | `infra/prod/nginx.conf:44-52` — `ssl_protocols TLSv1.2 TLSv1.3`; ECDHE-only Mozilla-Intermediate `ssl_ciphers` (INFRASTRUCTURE-05) |
| 5.7 | Security headers (nginx edge) | PASS | `nginx.conf:76-81` (server-level) + repeated at `/assets/` (:138-143) and `/index.html` (:150-155) — CSP/HSTS/X-Frame/nosniff/Referrer/Permissions-Policy, `always` |
| 5.8 | Security headers (Express API) | PASS | `apps/api/src/http/app.ts` — `securityHeaders()` sets nosniff/X-Frame DENY/Referrer-Policy/`CSP default-src 'none'`, mounted `app.use(securityHeaders())` before json (MERGED-SECURITY-HEADERS) |
| 5.9 | Cert-renewal mechanism present | PASS | `infra/prod/renew-cert.sh` — one-shot `certbot/certbot renew --webroot` against `certbot_webroot` volume + `nginx -s reload`; cron install documented (:14-16) (INFRASTRUCTURE-03) |

## 6 — Observability & ops

| # | Item | State | Evidence |
|---|------|-------|----------|
| 6.1 | Centralized logger, console.* banned | PASS | `packages/logger/src/index.ts:96` single `logger` export; console.* ESLint-banned (header comment :2) |
| 6.2 | Log redaction recurses (nested objects/arrays) | PASS | `packages/logger/src/index.ts:57-67` — `redactValue` recurses into arrays/objects, `MAX_REDACT_DEPTH=6`, key regex at :50 (LOGGING-01) |
| 6.3 | Per-request logging (requestId/duration/status/userId) | PASS | `apps/api/src/http/app.ts` — `requestObservability()` middleware (diff :52-53 comment "Part 36") |
| 6.4 | Health endpoint | PASS | `apps/api/src/http/app.ts:117` — `GET /api/v2/health` → `{status:'ok',success:true}` (unauth; used by container + deploy gate) |
| 6.5 | Runbooks present + accurate (redis corrected) | PASS | `runbooks/redis-outage.md:1-18` — rewritten to ONE `valkey` service, static health stub, "dormant in prod / jobs in-process" (REDIS_CACHE-03) |

## 7 — Dependencies

| # | Item | State | Evidence |
|---|------|-------|----------|
| 7.1 | `pnpm audit --prod` clean of High/Critical | PASS | `pnpm audit --prod` → `2 vulnerabilities found · Severity: 2 moderate` — zero high/critical |
| 7.2 | Only transitive moderate vulns, no direct prod dep | PASS (Watch) | Both are `uuid <11.1.1` (GHSA-w5hq-g745-h8pq) reached only via `exceljs@4.4.0` and `firebase-admin@14.0.0 > @google-cloud/storage`; no direct dependency, buffer-bounds issue not on any reachable path |
| 7.3 | Dependabot configured | PASS | `.github/dependabot.yml` — weekly `npm` (grouped patch/minor) + `github-actions` ecosystems (DEPENDENCY_AUDIT-04) |
| 7.4 | No deprecated/EOL major in direct prod deps | NOT VERIFIED | Not exhaustively checked; Node engine `>=22` (package.json:8), image `node:24` (Dockerfile.api:10) — both current. Direct-dep EOL sweep not performed this pass. |

## 8 — Deploy safety

| # | Item | State | Evidence |
|---|------|-------|----------|
| 8.1 | Blue-green + auto-rollback | PASS | `infra/prod/deploy.sh:64-95` — 180s health gate on edge+api; GREEN keeps, RED does `IMAGE_TAG=$PREV_TAG dc up -d api edge` + exits non-zero |
| 8.2 | Image prune (disk-exhaustion prevention) | PASS | `deploy.sh:81-82` — `docker image prune -af --filter "until=72h"` on GREEN (keeps rollback image) |
| 8.3 | Smoke test in gate | PASS | `deploy.sh:68-69` — curls `$EDGE_URL` and `$HEALTH_URL`, greps `"status":"ok"` before declaring healthy |
| 8.4 | CI mobile-contract gate now blocking | PASS | `.github/workflows/ci.yml` — `pnpm run contract:mobile` is now unconditional (old `|| echo 'not yet wired'` removed); a real failure fails the job (MOBILE_API_COMPATIBILITY-03) |
| 8.5 | Migrate is a gated one-shot before api | PASS | `docker-compose.yml:97-119` migrate one-shot; api `depends_on migrate: service_completed_successfully` (:131-132) |

## 9 — Known accepted risks & deferrals carried into prod

### ACCEPTED_RISK (knowingly accepted; reversal needs superseding ADR) — registry:1658-1666
- **Access token in localStorage** (MERGED-ACCESS-TOKEN-LOCALSTORAGE / AUTHENTICATION-02 + FRONTEND_SECURITY-03) — ADR-0076 SEC-10 deliberately moved only the refresh token to httpOnly cookie; access token stays in JS.
- **In-process job tier** (PERFORMANCE-02) — jobs run inside the api container; config-gated by ADR-0030; `docker-compose.yml:203-219` valkey/worker tiers commented out.
- **XLSX export buffered in-memory** (implied by PERFORMANCE-02 / registry ≥10k export note) — exceljs is buffered; ≥10k rows require a report-worker streaming tier that is DEFERRED (registry:976, EXPORT_JOB_MAX_ROWS=200k ceiling in place at `config/index.ts:73`).
- **Admin-route client-side guard only** (FRONTEND_SECURITY-01 / SR-11) — web write controls render without a `has()` wrap but every route is backend `authorize()`-gated → info-leak only, not privilege escalation.
- **Legacy assignee pool stays hierarchy-scoped** (BUSINESS_LOGIC-01) — ADR-0078 explicitly names the function as deliberately hierarchy-scoped.

### DEFERRED (tracked, not blockers) — registry:1598-1656
- **PII-at-rest plaintext** (DATABASE-04, MEDIUM) — `case_applicants.name/mobile/pan` plaintext + indexed; encryption blocked on live cross-scope dedupe + ILIKE substring search; needs a searchable-encryption ADR.
- **`case:updated` broadcast scope** (AUTHORIZATION-01, LOW) — realtime broadcast reaches all office sockets (case# + status only, no PII); needs scope-aware socket rooms.
- **DB role separation** (DATABASE-06, LOW) — api runtime shares the schema-owning role with migrations; needs live DB-admin to build a least-privilege role.
- **Code-quality debt** — CODE_QUALITY-01 (19 unused exports / 14 types), CODE_QUALITY-03 (`CaseDetailPage.tsx` 2332-line God-component), CODE_QUALITY-05 (oversized `cases/repository.ts` functions).
- **Mobile test/contract items** — MOBILE_API_COMPATIBILITY-02 (forms/telemetry zero coverage, trivial stubs), MOBILE_API_COMPATIBILITY-04 (idempotency dedupe is operation_id-only vs method+body+key; touches locked mobile contract).

---

## BLOCKING ITEMS (FAILs that should gate go-live)

**None.** No item is a go-live blocker.

- Item 1.4 (knip dead-code, exit 1) is a **FAIL** but explicitly **NOT** in the `pnpm verify` release gate (verify uses `boundaries`+`no-suppressions`, not `deadcode`); it is tracked as CODE_QUALITY-01 DEFERRED with zero functional/security impact. Does **not** block.

## WATCH ITEMS (NOT VERIFIED / accepted-risk to monitor)

1. **1.5 — `pnpm verify` not re-run this pass.** Recommend one clean `pnpm verify` (with ephemeral Postgres :5433) as the final green gate before the Go call. (NOT VERIFIED)
2. **7.2 — 2 moderate transitive `uuid` vulns** via exceljs + firebase-admin; not on a reachable path today, but watch for a `firebase-admin`/`exceljs` bump (Dependabot will surface it). (Watch)
3. **7.4 — Direct-dep EOL sweep not performed.** Node 22/24 current; no exhaustive major-EOL check done. (NOT VERIFIED)
4. **9 — ACCEPTED_RISK carry-ins:** access-token-in-localStorage (XSS → session takeover surface), in-process job tier (single-box scaling ceiling), buffered XLSX (≥10k export memory), client-only admin guard, hierarchy-scoped assignee pool. All knowingly accepted; monitor if scale/threat model changes.
5. **9 — DEFERRED security items to schedule post-launch:** PII-at-rest encryption (DATABASE-04), `case:updated` scoped rooms (AUTHORIZATION-01), DB role separation (DATABASE-06).
6. **Ops one-time on-box actions (not in repo/CI):** confirm `renew-cert.sh` cron is actually installed on the box (:14-16 is documentation, not automation), and confirm real high-entropy `JWT_SECRET`/`MFA_ENC_KEY` are set in `/opt/crm2/secrets/.env.prod` (fail-fast at 2.3/2.4 will crash the boot if not — a safety net, but verify pre-deploy).

---

### Verdict input

Every checklist group passes on its security-relevant items with cited evidence. The only FAIL (knip) is outside the release gate and non-functional. Recommended pre-Go actions are one `pnpm verify` run and confirmation of the two on-box ops one-timers (cert cron + real prod secrets). No code-level blocker to go-live.
