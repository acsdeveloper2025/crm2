# CRM2 — Remediation Plan

**Scope:** Findings sourced exclusively from the independent re-verification report (`docs/audit/FINDING_VERIFICATION.md`) — TRUE_POSITIVE and ACCEPTED_RISK dispositions only; the 3 FALSE_POSITIVE findings (SSRF-01, API_SECURITY-03, DEPENDENCY_AUDIT-03) are excluded entirely as retracted. Duplicate clusters use their merged canonical identity. **No code was modified to produce this plan.**

## Summary

| Phase | Severity | # Findings | Total Est. Hours | Target Window |
|---|---|---|---|---|
| Phase 1 | Critical | 0 | 0 | N/A |
| Phase 2 | High | 1 | ~1.5h | Day 1 |
| Phase 3 | Medium | 8 | ~72-119h | Week 1-8 |
| Phase 4 | Low | 33 (4 Accepted-Risk/optional) | ~75-107h | Week 1-6 (parallel) |
| Informational | Informational | 12 | N/A (no action mandated) | N/A |

Total findings planned = 42 phased (1 High + 8 Medium + 33 Low, of which 4 Low are Accepted-Risk/optional) + 12 Informational tracked in the appendix (no phase, no action mandated).

## Rollout Sequencing

"Day 0" = the date remediation work is kicked off (not a fixed calendar date, since this plan may be approved at any time). Phase 2 (High) starts Day 0 — it is a single finding (LOGGING-03) and is a same-day/next-day fix. Phase 3 (Medium) starts immediately after or in parallel with Phase 2 where there's no dependency — most Medium items are independent config/migration changes (LOGGING-03 pattern repeats: PERFORMANCE-04's index migration, MERGED-SECURITY-HEADERS' nginx edit, MOBILE_API_COMPATIBILITY-03's CI-gate fix, DATABASE-05's doc fix all have zero cross-item dependency). The two Medium items with real sequencing constraints are FILE_UPLOAD-01 (needs a ClamAV sidecar provisioned before the 3 call sites can be wired) and DATABASE-04 (needs an ADR + key-management decision before any migration is written) — both are called out in their own Dependencies field and should not block the other 6 Medium items. Phase 4 (Low) runs as a parallel, lower-priority workstream throughout Phases 2-3 since Low items carry minimal risk and mostly have no cross-dependency. Exceptions found in the drafted entries: CODE_QUALITY-03 (God-component split) must be spread across multiple incremental PRs, not attempted opportunistically inside unrelated work; REDIS_CACHE-02 must land before the commented-out prod Valkey block is ever uncommented (zero risk while dormant, but gates that future activation); DATABASE-06 should land procedurally after DATABASE-05 is closed out (no technical coupling, just sequencing hygiene) and needs its own prod DB maintenance window. The 4 Low-severity ACCEPTED_RISK items (MERGED-ACCESS-TOKEN-LOCALSTORAGE, FRONTEND_SECURITY-01, PERFORMANCE-02, BUSINESS_LOGIC-01) are optional/opportunistic re-affirmations of already-signed-off team decisions and don't gate any phase — they carry 0h of mandated work.

## Phase 1 — Critical

_No Critical findings._ Zero Critical findings were raised in the original 19 audits, and the independent re-verification pass (`docs/audit/FINDING_VERIFICATION.md`) confirmed zero Critical findings survive — nothing to remediate in this phase.

## Phase 2 — High

### LOGGING-03 — No Docker log-rotation config on any production service (unbounded stdout log growth)

- **Issue:** `infra/prod/docker-compose.yml` (172 lines, all 6 services: `db`, `minio`, `minio-init`, `migrate`, `api`, `edge`) has zero `logging:`/`driver:`/`max-size:`/`max-file:` keys, and no Docker daemon-level override (`daemon.json`) exists either. All API output goes to `process.stdout` (`packages/logger/src/index.ts:61`), which Docker's default `json-file` driver captures with no cap, so every request/warn/error line (including the per-request access log firing on every HTTP call) accumulates forever on the single production VPS's disk. This is the same unbounded-disk-growth mechanism that already caused the 2026-06-26 prod outage (that incident was un-pruned image layers, not logs, but the failure mode — disk fills, Postgres crash-loops — is identical and currently has no compensating control for log growth). It's also untracked in `docs/COMPLIANCE_GAPS_REGISTRY.md` despite `DATA_RETENTION_POLICY.md:27` documenting a 90-180 day rotate+delete policy that today is enforced by nothing.
- **Files affected:** `infra/prod/docker-compose.yml` (add `logging:` block to each of the 6 service definitions: `db` L17-32, `minio` L34-49, `minio-init` L51-63, `migrate` L65-82, `api` L84-114, `edge` L116-135); `docs/COMPLIANCE_GAPS_REGISTRY.md` (add an entry so the still-PLANNED scheduled purge job isn't silently dropped)
- **Dependencies:** None — standalone. Pure compose-file config change, no code/schema touch. (Optional stretch — the "scheduled purge job (PLANNED)" mentioned in `DATA_RETENTION_POLICY.md:27` for full 90-180d retention enforcement — is a separate, larger effort and is *not* required to close this finding; log rotation alone bounds disk growth regardless of retention-window enforcement.)
- **Estimated hours:** 1h (source estimate: S, "compose-file edit + redeploy, < 1 hour," for the rotation fix itself — matches directly, no S→h conversion needed). Registry entry add: +0.5h.
- **Breaking change risk:** Low — this is an additive `logging:` stanza per service (standard Docker Compose `json-file` driver options), no app code, no DB schema, no API contract, no mobile-contract touch. Only operational nuance: rotation truncates/rolls the container's log file, so anything tailing `docker logs -f` or grepping `*-json.log` directly on the host loses history older than `max-size × max-file` — acceptable since there's no log shipper today that would "lose" data mid-stream.
- **Testing required:** Local/staging: bring the stack up with the updated compose file (`docker compose -f infra/prod/docker-compose.yml config` to validate YAML/keys parse first), then `docker inspect crm2_api --format '{{json .HostConfig.LogConfig}}'` and confirm `max-size`/`max-file` show the configured values for each of the 6 containers. Generate log volume (hit a few endpoints or `docker exec` a burst of writes) and confirm the on-disk file at `/var/lib/docker/containers/<id>/<id>-json.log*` caps out and rolls to `-json.log.1` etc. instead of growing past `max-size`. No `pnpm verify` involvement (infra-only, no app code changed). After prod deploy: `ssh` the box and re-run the same `docker inspect` check against the live containers, and confirm `df -h` / disk headroom is unaffected by the deploy itself.
- **Rollback plan:** Revert the compose diff (`git revert` the commit) and redeploy the prior image tag via the existing `deploy.sh` blue-green flow — the change is config-only so rollback just removes the `logging:` blocks and restarts the affected containers; no data migration, no down-migration needed.
- **Priority:** P1
- **Owner:** DevOps/Infra
- **Expected completion:** Day 1

## Phase 3 — Medium

### AUTHENTICATION-01 — MFA/TOTP failures don't count toward account lockout

- **Issue:** `login()` in the auth service only calls `repo.recordFailedLogin` on the wrong-password branch (`apps/api/src/modules/auth/service.ts:181-183`); once the password check passes, a wrong TOTP/recovery code falls straight to `mfaRequired()` (line 187) without touching the failed-attempt counter. An attacker holding a valid leaked/phished password can grind the 6-digit TOTP (or 10 recovery codes) indefinitely, bounded only by the per-IP `loginLimiter()` flood cap (30 req/15 min), which a slow or distributed attacker can evade.
- **Files affected:** `apps/api/src/modules/auth/service.ts` (lines ~181-187, the `login()` method); `apps/api/src/modules/auth/repository.ts` (`recordFailedLogin`, line 112, and `resetLoginState`, line 128, reused/mirrored)
- **Dependencies:** None — standalone
- **Estimated hours:** 2-4h (source effort = S: "a few lines in service.ts:192, mirroring the existing recordFailedLogin/isLocked pattern; add a corresponding test alongside the existing describe('lockout', …) block")
- **Breaking change risk:** Low — pure application-logic change in one function, no schema change (reuses the existing `failed_login_count`/`locked_until` columns and `recordFailedLogin` repo method), no API contract change, no mobile impact (mobile hits the same `/auth/login` endpoint and already handles `ACCOUNT_LOCKED`/`MFA_REQUIRED` errors). Slight behavior change: legitimate users who repeatedly mistype their TOTP code could now lock themselves out — mitigate by keeping (or tightening) the same `MAX_FAILED_LOGINS`/`LOCKOUT_COOLDOWN_S` thresholds, or use a separate tighter MFA-attempt threshold per the source's own recommendation.
- **Testing required:** Add/extend a unit test in the existing `describe('lockout', …)` block in the auth service test file asserting N wrong-MFA-code attempts trigger `ACCOUNT_LOCKED`; `pnpm --filter @crm2/api test` (or repo-wide `pnpm verify`); manual check via `curl` against a dev seed user — log in with correct password + wrong `mfaCode` repeatedly and confirm the 401 changes from `MFA_REQUIRED` to `ACCOUNT_LOCKED` after the threshold, and that `resetLoginState` still clears it on a subsequent correct login.
- **Rollback plan:** Single-commit code revert (`git revert`); no migration, no data shape change, safe to roll back at any time by redeploying the prior image tag.
- **Priority:** P1
- **Owner:** Backend/API
- **Expected completion:** Day 1-2

### FILE_UPLOAD-01 — No malware/virus scanning in the upload pipeline

- **Issue:** Every upload path (case attachments, field-agent device photos, admin/user profile photos) validates files only by a 1-8 byte magic-number signature match (`apps/api/src/platform/file.ts:34-39`, `apps/api/src/platform/image.ts:32-37`); there is no ClamAV or managed malware-scan dependency anywhere in `package.json`. A well-formed PDF/JPEG can still carry an embedded exploit that a back-office reviewer later opens via the signed download URL.
- **Files affected:** `apps/api/src/platform/file.ts`, `apps/api/src/platform/image.ts`, `apps/api/src/modules/cases/service.ts` (upload call site ~line 741), `apps/api/src/modules/verification-tasks/service.ts` (~lines 239-242), `apps/api/src/modules/users/service.ts` (~lines 414-418)
- **Dependencies:** Infra provisioning — needs a ClamAV sidecar/daemon added to `infra/prod/docker-compose.yml` (and dev compose) with its own disk/memory budget on the single VPS, or a managed scanning API + outbound network/API-key setup. This is a prerequisite before the application-code call sites can be wired.
- **Estimated hours:** 12-20h (source effort = M: "clamd sidecar + a thin scan call in 3 call sites; more if a managed API is preferred")
- **Breaking change risk:** Medium — adds a new runtime dependency (clamd container) to the prod topology and a synchronous (or async-quarantine) step in 3 upload call sites; a scan-timeout/failure-mode decision (fail-open vs fail-closed) affects upload availability for both web and mobile (mobile photo uploads flow through the same `verification-tasks/service.ts` path), so this needs careful default-mode selection to avoid blocking field agents on a slow/down scanner.
- **Testing required:** `pnpm verify`; upload the EICAR test file through each of the 3 call sites (case attachment, task photo, profile photo) in a dev/staging environment with the sidecar running and confirm rejection/quarantine; upload a clean file and confirm it still succeeds; kill the clamd container and verify the configured fail-mode behaves as intended (document whichever is chosen); load-test upload latency with scanning enabled to confirm it doesn't blow `DB_STATEMENT_TIMEOUT_MS`/request timeouts.
- **Rollback plan:** Revert the docker-compose service addition and the 3 call-site diffs; upload pipeline reverts to magic-byte-only validation (the pre-existing, already-shipped behavior) — no data migration involved.
- **Priority:** P2
- **Owner:** DevOps/Infra (sidecar provisioning) with Backend/API (call-site wiring)
- **Expected completion:** Week 2-3

### DATABASE-04 — PAN/mobile/name PII stored and indexed in plaintext

- **Issue:** `case_applicants.name`/`mobile`/`pan` are stored and functionally indexed in cleartext (`db/v2/migrations/0010_cases.sql:34-44, 49, 51`); `pgcrypto` is loaded but `pgp_sym_encrypt` is never used anywhere in the codebase, and the `pii_sensitive` flag on `verification_units` (intended to "drive masking/field-encryption downstream" per its own migration comment) is only read/returned, never acted on. A DB credential leak, misconfigured backup, or over-privileged reporting connection exposes PAN/mobile/name with zero additional decryption step.
- **Files affected:** `db/v2/migrations/0010_cases.sql` (table + indexes, lines 34-44, 49, 51); every read/write path touching `case_applicants.pan`/`mobile` (search/dedupe logic relying on `upper(pan)` equality matching) across `apps/api/src/modules/cases/*` and any consumer of applicant PII
- **Dependencies:** A key-management decision must land first — mirror the existing `MFA_ENC_KEY` AES-256-GCM pattern (key held outside the DB, in the env/secrets layer) before any column-encryption migration is written. This is a design/ADR-level prerequisite (a superseding ADR per the repo's frozen-architecture rule), not just code.
- **Estimated hours:** 40-64h (source effort = L: "touches every read/write path for applicant PAN/mobile, plus search/dedupe logic that currently relies on upper(pan)/equality matching")
- **Breaking change risk:** High — touches the DB schema (column type/format change), every read/write path for applicant PII, and any exact-match search/dedupe behavior; a naive migration would break existing plaintext-indexed lookups and requires a backfill/re-encryption pass on all existing `case_applicants` rows, which is a live-DB write requiring explicit sign-off per the repo's `feedback_sql_live_db_apply.md` invariant.
- **Testing required:** Requires an ADR first (Impact/Alternatives/Migration per `docs/ARCHITECTURE_GOVERNANCE.md`); once approved: migration dry-run against `crm2_test`, `pnpm verify`, integration tests covering applicant create/search/dedupe with encrypted PAN/mobile, a backfill script tested against a copy of prod-shaped data, and a manual spot-check that case-detail/report views still render the decrypted values correctly for authorized roles.
- **Rollback plan:** Not a simple revert once backfilled — plan requires either a reversible down-migration that decrypts back to plaintext columns (kept as a documented emergency path) or, if encryption is deferred instead of built, the interim compensating-control option from the source report (drop the plaintext functional indexes on `pan` and document network isolation/backup encryption as the accepted mitigation) which IS trivially revertible.
- **Priority:** P2
- **Owner:** Backend/API + DBA/Data (joint — schema/migration owned by DBA, application read/write paths by Backend)
- **Expected completion:** Week 4-8 (spans ADR approval + migration + backfill + verification)

### INFRASTRUCTURE-01 — Containers run as root, no cap_drop/read_only/no-new-privileges

- **Issue:** Neither `infra/Dockerfile.api` nor `infra/Dockerfile.web` has a `USER` directive (confirmed: `grep -n "^USER"` returns zero matches in both), so the `api` container (which runs Puppeteer/Chromium PDF rendering, `sharp` image processing, and `exceljs`/`docx` parsing on user-supplied input) and the `edge` (nginx) container both run as root. `infra/prod/docker-compose.yml` sets no `cap_drop`, `read_only`, or `security_opt: no-new-privileges` on any service, maximizing blast radius if any of those attack-surface-heavy libraries is ever exploited for code execution.
- **Files affected:** `infra/Dockerfile.api` (lines 10-37, no `USER`), `infra/Dockerfile.web` (lines 8-23, no `USER`), `infra/prod/docker-compose.yml` (`api` and `edge` service definitions, lines 92-148)
- **Dependencies:** None — standalone, but must be tested end-to-end (Chromium/Puppeteer sandboxing and nginx both need validation as non-root before shipping) before merging to `main`, since this is a live-production compose file.
- **Estimated hours:** 8-16h (source effort = M: "requires testing that Chromium/Puppeteer and nginx still function correctly as non-root, and validating file-permission ownership for any volumes the containers write to")
- **Breaking change risk:** Medium — changes container runtime identity, which can break Chromium sandbox behavior (may need `--no-sandbox` or specific capabilities) and file ownership on any mounted volumes (e.g. `certbot_webroot`, any tmp/upload staging dirs); requires careful staging verification before prod deploy, but is purely an infra/config change with no API contract or data-shape impact.
- **Testing required:** Build both images locally with the `USER` change, run the full field-report PDF-generation flow (Puppeteer/Chromium) end-to-end in a staging container to confirm rendering still works non-root; run nginx as `nginx`/non-root and confirm static asset serving + `/api/` and `/socket.io/` proxying still work; `docker compose config` validate the `security_opt`/`cap_drop` additions don't break service startup; smoke-test in staging compose before touching `infra/prod/docker-compose.yml`; full `pnpm verify` plus a manual staging deploy.
- **Rollback plan:** Revert the Dockerfile/compose diff and redeploy the prior image tag (the deploy pipeline already supports blue-green + rollback per `deploy.sh`) — purely additive infra hardening, no data or schema involved.
- **Priority:** P2
- **Owner:** DevOps/Infra
- **Expected completion:** Week 2-3

### INFRASTRUCTURE-03 — No certbot renewal automation in-repo

- **Issue:** The repo wires only the ACME-challenge-serving half of Let's Encrypt (`infra/prod/nginx.conf:26`, the `certbot_webroot` volume in `docker-compose.yml`); a repo-wide grep for `cron`/`timer` and `certbot` invocation returns zero matches for any actual renewal mechanism. Since LE certs expire every 90 days, if renewal exists only as undocumented manual/box-level cron outside the repo, it's a single point of failure with no IaC record, peer review, or audit trail — and per `docs/engineering/MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md:54`, a missed renewal risks hard-failing mobile TLS pinning checks too.
- **Files affected:** `infra/prod/nginx.conf` (line 26, ACME challenge location), `infra/prod/deploy.sh` (line 34, precondition check only — no renewal), `infra/prod/docker-compose.yml` (certbot_webroot volume, no certbot service)
- **Dependencies:** Requires SSH/box access to `49.50.119.155:2232` to first determine whether a renewal mechanism already exists outside the repo (cron/systemd timer) — this determines whether the fix is "document what's there" (S) or "build a new mechanism" (M).
- **Estimated hours:** 2h (if documenting an existing box-level mechanism) to 8h (if building a new versioned renewal service/timer) — source effort = "S ... to M"
- **Breaking change risk:** Low — either documentation-only, or an additive `docker-compose` certbot service / systemd timer that doesn't touch the app containers, API, or DB; a botched renewal script is the only real risk, mitigated by testing with `certbot renew --dry-run` before relying on it.
- **Testing required:** SSH to the prod box, inspect `crontab -l` / `systemctl list-timers` for any existing renewal job; if building new: add the certbot service/timer to `infra/prod/docker-compose.yml`, run `certbot renew --dry-run` against the staging/prod webroot to confirm the ACME HTTP-01 flow completes without actually rotating the live cert; verify `nginx -t` succeeds after a simulated cert swap; add a `runbooks/` entry covering TLS/cert-expiry (none of the 8 existing runbooks cover this per the source report).
- **Rollback plan:** N/A if documentation-only (git revert of the doc). If a new timer/service was added, `docker compose` service removal or `systemctl disable` the timer unit — does not touch the currently-valid live certificate.
- **Priority:** P2
- **Owner:** DevOps/Infra
- **Expected completion:** Week 1-2

### PERFORMANCE-04 — case_tasks.completed_at/submitted_at unindexed despite being the hot filter/sort key

- **Issue:** `case_tasks.completed_at` (added in migration 0041) and `submitted_at` (added in migration 0081) have no companion index anywhere in `db/v2/migrations/`, yet both sit in the WHERE range-filter and ORDER BY of MIS (`apps/api/src/modules/mis/repository.ts:69-70, 136`), Billing (`apps/api/src/modules/billing/repository.ts:91-92`), and the newly-shipped Commission Summary (ADR-0081, `repository.ts:121, 173-174, 296-330`) — forcing a sequential scan + in-memory sort on every date-range filter or "latest completed" sort, which directly slows the periodic commission export it was built for.
- **Files affected:** New migration file (next number `0105_case_tasks_completion_indexes.sql` per repo convention, since 0104 is the latest applied); no application code changes required
- **Dependencies:** None — standalone additive migration
- **Estimated hours:** 1h (source effort = S: "migration + verify via EXPLAIN against a populated dev/staging DB, < 1 hour")
- **Breaking change risk:** None — purely additive `CREATE INDEX IF NOT EXISTS ... WHERE status IN ('SUBMITTED','COMPLETED')` (partial indexes mirroring the existing `idx_case_attachments_case ... WHERE deleted_at IS NULL` convention at `db/v2/migrations/0042_case_attachments.sql:28`); no schema shape change, no read/write path touched, no mobile impact.
- **Testing required:** Write migration `0105_case_tasks_completion_indexes.sql` with the two partial indexes on `completed_at` and `submitted_at`; run via the tracked migration runner (`db/v2/migrate.sh`) against `crm2_test`; `EXPLAIN ANALYZE` the MIS/Billing/Commission-summary queries before/after against a populated dev/staging DB to confirm an index scan replaces the sequential scan; `pnpm verify`.
- **Rollback plan:** Additive migration — rollback is a down-migration (`DROP INDEX IF EXISTS idx_case_tasks_completed_at; DROP INDEX IF EXISTS idx_case_tasks_submitted_at;`), zero data loss.
- **Priority:** P2
- **Owner:** DBA/Data
- **Expected completion:** Day 1

### MOBILE_API_COMPATIBILITY-03 — Mobile-contract CI gate is non-blocking by construction

- **Issue:** `.github/workflows/ci.yml:117` runs `pnpm run --if-present contract:web && pnpm run --if-present contract:mobile || echo 'contract tests not yet wired...'` — `contract:web` doesn't exist so it silently no-ops, and any failure of the real `contract:mobile` script is swallowed by the `|| echo` fallback, which always exits 0. This directly contradicts ADR-0054's binding requirement to "make the gate fail when the contract test is absent," even though the step is explicitly labeled a mandatory blocking gate in its own inline comment. Mitigating factor confirmed: the same underlying test files also run (blocking) via the generic `test` job's `vitest run`, so today's regressions are still caught — but a future mobile-only contract test excluded from that glob would have zero enforcement.
- **Files affected:** `.github/workflows/ci.yml` (line 117, the "Contract tests (web + mobile)" step)
- **Dependencies:** None — standalone CI config change
- **Estimated hours:** 1-2h (small YAML edit + a verification CI run; source gives no explicit estimate but this is a single-step config fix)
- **Breaking change risk:** Low — CI-only change, no application code or runtime behavior touched; the risk is process-facing (making the gate blocking could surface a currently-hidden failure and block a merge), not a production breaking change. Since `contract:web` doesn't exist yet, keep `--if-present` for that half but drop the `|| echo` swallow for `contract:mobile` (or add it as a real hard failure), per ADR-0054's intent.
- **Testing required:** Edit the step to remove the `|| echo` fallback (e.g. `pnpm run --if-present contract:web && pnpm run contract:mobile`, since `contract:mobile` is confirmed to exist per `package.json:28`); open a throwaway PR that intentionally breaks a mobile contract test to confirm the CI step now fails red instead of green; confirm a normal passing PR still goes green; then revert the throwaway breakage.
- **Rollback plan:** Single-line git revert of the workflow YAML change; no deploy/infra impact since this only affects the CI pipeline, not the running application.
- **Priority:** P1
- **Owner:** DevOps/Infra
- **Expected completion:** Day 1-2

### MERGED-SECURITY-HEADERS — No CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy anywhere

- **Issue:** Confirmed across four independent audit passes (XSS-01, API_SECURITY-01, FRONTEND_SECURITY-02, INFRASTRUCTURE-02): neither `infra/prod/nginx.conf` (only `Content-Type`/`Cache-Control` headers exist, at lines 30, 65, 116, 121) nor `apps/api/src/http/app.ts` (no `helmet` dependency, confirmed via `package.json` grep) sets any standard security header. This leaves the SPA clickjackable (no `X-Frame-Options`/`frame-ancestors`), removes CSP defense-in-depth against any future XSS regression, allows first-request SSL-stripping (no HSTS), and permits `Referer`-header leakage of case/client identifiers.
- **Files affected:** `infra/prod/nginx.conf` (the `server { listen 443 ... }` block, ~lines 36-126, all `location` blocks); `apps/api/src/http/app.ts` (no header middleware, ~lines 80-89) — nginx is the more complete single fix per the source reports since it covers the SPA's static/index.html responses that Express-level `helmet` cannot reach
- **Dependencies:** None — standalone config change, though the CSP directive specifically needs testing against the Vite-built SPA's asset loading, the socket.io websocket `connect-src`, and MinIO presigned-URL image `img-src` before it can be tightened beyond a starting baseline.
- **Estimated hours:** 4-8h (source effort = S across all four reports, "a few hours" / "a few add_header lines"; upper end reflects CSP tuning to avoid breaking inline scripts/styles, websocket connect-src, and MinIO image loads per FRONTEND_SECURITY-02's more detailed writeup)
- **Breaking change risk:** Low — additive nginx `add_header` directives; the only real risk is a too-strict CSP breaking SPA asset/websocket/image loading, which is caught in testing before prod rollout, not a schema/auth/mobile-contract change. Mobile is unaffected (native app doesn't parse browser security headers).
- **Testing required:** Add `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, and a scoped `Content-Security-Policy` to the HTTPS `server{}` block in `nginx.conf`; `nginx -t` config validation; deploy to staging and manually load the SPA in a browser confirming no CSP console errors (assets, XHR to `/api/`, websocket `/socket.io/` connect, MinIO presigned image URLs all load); `curl -I https://crm.allcheckservices.com` (staging equivalent) to confirm headers present; run `pnpm verify` (build/e2e) to confirm the Playwright e2e suite still passes with headers active.
- **Rollback plan:** Revert the nginx.conf diff and redeploy the prior `edge` image/config — additive header-only change, immediately reversible with no data or schema involved.
- **Priority:** P1
- **Owner:** DevOps/Infra
- **Expected completion:** Week 1

## Phase 4 — Low

### AUTHENTICATION-03 — JWT_SECRET/MFA_ENC_KEY entropy floor too low
- **Issue:** `JWT_SECRET` and `MFA_ENC_KEY` are Zod-validated with only `min(16)`, and the production `superRefine` fail-fast only rejects the exact known dev-default string — it enforces no minimum entropy for an operator-chosen real value. A 16-char low-entropy human-chosen secret (e.g. `"CompanyName2026!"`) would pass validation in production despite being far below the ≥256-bit randomness recommended for HS256, even though `.env.prod.example` already documents `openssl rand -base64 48`.
- **Files affected:** `packages/config/src/index.ts` (lines 16-17, schema; lines 88-103, `superRefine` fail-fast)
- **Dependencies:** None — standalone
- **Estimated hours:** 1-2h (source effort = S: one-line schema change + an updated `index.test.ts` case)
- **Breaking change risk:** Low — raises `min(16)` to `min(32)`; every correctly-provisioned environment (dev/test defaults are 30+ chars, prod example is 48 random bytes) already clears this bar, so no runtime behavior changes for compliant configs. Only an operator who set a real but short (16-31 char) secret would be newly blocked at boot — desirable, fail-fast behavior, not a regression.
- **Testing required:** `pnpm --filter @crm2/config test` (or `pnpm verify`) after bumping the bound and adding a boundary-case test (31-char rejected, 32-char accepted) in `packages/config/src/index.test.ts`; confirm `loadEnv()` still boots cleanly with the existing dev/test `.env` files and with `secrets/.env.prod` (length-check only, no live connection needed).
- **Rollback plan:** Config-only change, git revert of the one-line schema diff; no data or deployed-secret impact either way.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1

### AUTHORIZATION-01 — Realtime case:updated broadcasts bypass REST scope filtering
- **Issue:** `emitTaskUpdate` broadcasts every `case:updated` socket event to the entire `perm:office` room (every role with `page.dashboard` except FIELD_AGENT), with no per-recipient scope filter, while the REST equivalent (`GET /api/v2/cases`) is scope-filtered via `resolveScope(actor)`. A user restricted to one client's portfolio (ADR-0072 CLIENT/PRODUCT scope) still receives live case-number/task-number/status metadata for every case in the system.
- **Files affected:** `apps/api/src/modules/cases/case-events.ts` (lines 11-26, `emitTaskUpdate`), `apps/api/src/platform/realtime/index.ts` (lines 56-61, 159-163, 169-174 — `OFFICE_PERM`/`OFFICE_ROOM` join logic)
- **Dependencies:** None — standalone, but touches the same realtime module as any other socket-scope work; sequence after nothing currently planned
- **Estimated hours:** 6-10h — no explicit S/M/L given in the source report for this ID; scope is moving from a single shared `perm:office` room broadcast to a per-recipient (or per-scope-room) filtered emit, which touches socket room membership logic plus a scope check reused from `cases/service.ts`'s `resolveScope`, so budget a half-to-full day including a socket-level test.
- **Breaking change risk:** Medium — changes realtime event delivery semantics (who receives `case:updated`); does not touch the DB schema or the mobile contract (FIELD_AGENT already excluded from `perm:office`), but any web code relying on "office room = all cases" behavior (dashboards, live counters) must be re-verified to still receive events for cases in their own scope.
- **Testing required:** `pnpm verify`; add/extend a realtime integration test asserting a scope-restricted BACKEND_USER's socket does NOT receive `case:updated` for an out-of-scope case and DOES receive it for an in-scope one; manual browser check — open two sessions (different client scopes) side by side, trigger a task update, confirm only the in-scope session's Pipeline live-updates.
- **Rollback plan:** Revert the emit/room-filter diff; the change is additive logic around an existing emit call, no migration or schema involved — straight git revert and redeploy prior image tag.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Week 2

### AUTHORIZATION-04 — USER_MANAGE permission has no role-assignment capability check
- **Issue:** Nothing between the `authorize(PERMISSIONS.USER_MANAGE)` route gate and the `repo.create`/`repo.update` calls checks whether the actor may assign the *specific* target role (e.g. whether it's `grantsAll`). Under the current 6-role seed this isn't exploitable (only SUPER_ADMIN holds `USER_MANAGE`, and `grantsAll` roles can't be reconfigured), but the RBAC model is explicitly open (ADR-0022, custom roles) so a future narrowly-scoped custom role granted `user.manage` could silently promote any user to SUPER_ADMIN.
- **Files affected:** `apps/api/src/modules/users/service.ts` (lines 273-293 `create`, 314-339 `update`), `packages/sdk/src/users.ts` (lines 78, 97-111, 114-127 — the open role-catalog regex)
- **Dependencies:** None — standalone; conceptually related to the RBAC/role-catalog model (ADR-0022) but requires no change there
- **Estimated hours:** 3-5h — source gives no explicit effort; the fix is a capability check (actor must hold `role.manage`/be `grantsAll`, or target role must not exceed actor's own role) added once in `users/service.ts`'s `create`/`update`, small and localized.
- **Breaking change risk:** Low — purely additive authorization tightening; today only SUPER_ADMIN holds `USER_MANAGE` so no existing account's behavior changes. Risk is theoretical scope creep if a future custom role legitimately needs to assign a `grantsAll` role and the check is too strict — mitigate by scoping the check to "target role is `grantsAll` or outranks actor" only.
- **Testing required:** `pnpm verify`; add a unit/integration test creating a custom role with `user.manage` but not `grantsAll`, asserting `PUT /api/v2/users/:id` with `{"role":"SUPER_ADMIN"}` is rejected (403) while a SUPER_ADMIN actor doing the same succeeds; manual check via Access Control UI creating an `HR_ADMIN`-style role and confirming it cannot self-escalate a user to SUPER_ADMIN.
- **Rollback plan:** Revert the service-layer guard; no schema/migration involved, no mobile impact (admin-only endpoint) — git revert and redeploy.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Week 2

### INPUT_VALIDATION-01 — Unhandled decodeURIComponent throw returns 500 instead of 400
- **Issue:** `decodeURIComponent` throws `URIError` on malformed percent-encoding (confirmed: `decodeURIComponent('%E0%A4%A')` throws). Both call sites (the `x-filename` upload header and the refresh-token cookie parser on the unauthenticated `/api/v2/auth/refresh`) let that exception fall through the generic error-handler branch, returning `500 INTERNAL` and logging as an unhandled error instead of a clean `400`, polluting error-rate observability.
- **Files affected:** `apps/api/src/modules/cases/controller.ts` (line 420), `apps/api/src/http/refreshCookie.ts` (line 36, `readRefreshCookie`)
- **Dependencies:** None — standalone
- **Estimated hours:** 1-3h (source effort = S: a few lines, 2 call sites)
- **Breaking change risk:** Low — wraps existing decode calls in try/catch and falls back to the same "no cookie" / "default filename" path already used for the missing-header case; purely a narrower error classification, no change to any successful-path behavior. Touches the unauthenticated `/auth/refresh` path so deploy with normal care, but the change only affects the malformed-input branch.
- **Testing required:** `pnpm verify`; add a unit test posting `Cookie: crm2_rt=%E0%A4%A` to `/api/v2/auth/refresh` and asserting `400`/no-cookie fallback instead of `500`; same for an `x-filename` header with malformed percent-encoding on an attachment download; confirm normal cookie/filename values still decode correctly.
- **Rollback plan:** Revert the try/catch wrapper; no schema/migration/mobile-contract change — git revert and redeploy.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1-2

### INPUT_VALIDATION-02 — Pagination "page" has no upper bound
- **Issue:** `resolvePage` bounds `limit` (`MAX_PAGE_SIZE`) but not `page`, so `offset = (page-1) * limit` is unbounded. A large `page` value (e.g. `page=999999999`) forces Postgres to walk/skip an arbitrarily large offset on every list endpoint built on this shared helper, wasting CPU/IO disproportionate to the (empty) result, bounded only by the 60s statement timeout.
- **Files affected:** `apps/api/src/platform/pagination.ts` (line 160, `resolvePage`)
- **Dependencies:** None — standalone
- **Estimated hours:** 1-2h (source effort = S: a few lines)
- **Breaking change risk:** Low — additive validation on a shared helper used by every paginated endpoint; a sane cap (e.g. 100,000) will reject/clamp only pathological `page` values no legitimate UI ever sends (the web app paginates sequentially and never deep-links to page 999999999). Verify no admin/report tooling relies on very large page numbers before shipping.
- **Testing required:** `pnpm verify`; unit test `resolvePage` with `page` beyond the new cap asserting `400 PAGE_TOO_LARGE` (or clamp, per chosen behavior) mirroring the existing `LIMIT_TOO_LARGE` test; manual check — `GET /api/v2/cases?page=999999999&limit=500` returns the new error instead of a slow 200.
- **Rollback plan:** Revert the added bound check; standalone code change, no migration — git revert and redeploy.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1-2

### INPUT_VALIDATION-03 — Login/refresh schema fields lack .max() length bounds
- **Issue:** `LoginSchema`'s `username`/`password` and `RefreshSchema`'s `refreshToken` have `.min(1)` but no `.max()`, unlike almost every other string field in the SDK (e.g. `StrongPasswordSchema.max(200)` on the password-change path). This is the lowest-trust, pre-authentication input surface in the API, and the inconsistency offers no benefit — already mitigated in practice by the global 100kb body cap and the login rate limiter, but flagged for defense-in-depth consistency.
- **Files affected:** `packages/sdk/src/auth.ts` (lines 10-25, `LoginSchema`/`RefreshSchema`)
- **Dependencies:** None — standalone
- **Estimated hours:** 1-2h (source effort = S)
- **Breaking change risk:** Low — additive `.max()` bounds (e.g. `username.max(50)`, `password.max(200)`, `refreshToken.max(512)`) matching existing DB column widths / issued-token length; this schema lives in `packages/sdk`, consumed by both web and mobile, so the bound must be generous enough to never reject a legitimate credential — set from the actual DB column widths, not guessed.
- **Testing required:** `pnpm verify` (SDK is shared by web + API, so this also exercises the FE build); unit test asserting a password just under/at/over the new max is accepted/rejected as expected; confirm mobile login still succeeds against the same schema (shared SDK — no separate mobile schema to update).
- **Rollback plan:** Revert the `.max()` additions in the shared SDK schema; standalone, no migration — git revert and redeploy (web + API both rebuild from the same SDK version).
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1-2

### CSRF-01 — /auth/refresh has no CSRF defense beyond SameSite=Lax
- **Issue:** `POST /api/v2/auth/refresh` is authenticated solely by the `crm2_rt` cookie with no CSRF token, double-submit value, or Origin/Referer check — confirmed no CSRF mechanism exists anywhere in the repo (`grep` for csrf/csurf/double-submit/x-csrf returns nothing). Today `SameSite=Lax` plus JSON-only body parsing hold the line, but there is zero defense-in-depth if a future change (e.g. `sameSite: 'none'` for an iframe integration) silently weakens that single control.
- **Files affected:** `apps/api/src/modules/auth/controller.ts` (lines 32-41, `refresh`), `apps/api/src/http/refreshCookie.ts` (lines 1-34, `setRefreshCookie`/`readRefreshCookie`)
- **Dependencies:** None — standalone
- **Estimated hours:** 3-5h (source effort = S: "a few hours" for one shared `requireSameOrigin` check wired into the refresh controller)
- **Breaking change risk:** Low — additive Origin/Referer allow-list check scoped to when those headers are present; does not change the cookie/body dual-read contract that mobile relies on (mobile sends `refreshToken` in-body, not via cookie/Origin, and typically won't set a browser `Origin` header, so the check should only reject when Origin/Referer IS present and mismatched, not require it).
- **Testing required:** `pnpm verify`; unit test posting to `/api/v2/auth/refresh` with a mismatched `Origin` header asserting rejection, with a matching/absent `Origin` asserting success; manual check — web login/refresh flow still works from `https://crm.allcheckservices.com`; confirm mobile refresh (body-only, no Origin) is unaffected.
- **Rollback plan:** Revert the `requireSameOrigin` check; standalone controller-level change, no schema impact — git revert and redeploy.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 2-3

### API_SECURITY-02 — Change-password/MFA endpoints lack a dedicated rate limiter
- **Issue:** Only `/login` and `/refresh` carry `loginLimiter()`/`refreshLimiter()`; `/change-password`, `/mfa/enroll/verify`, and `/mfa/disable` are authenticated but rely solely on the generic nginx 10r/s edge floor. An attacker holding a stolen-but-valid access token could attempt ~36,000 current-password guesses/hour against `/change-password`, far faster than the login endpoint's dedicated limiter intentionally allows.
- **Files affected:** `apps/api/src/modules/auth/routes.ts` (lines 20-31 — `/change-password`, `/mfa/enroll/verify`, `/mfa/disable` route mounts)
- **Dependencies:** None — standalone; reuses the existing `lazyLimiter`/`make()` factory already in `apps/api/src/http/rateLimit.ts`
- **Estimated hours:** 1-2h (source effort = S: reuse existing factory, 1-2 lines per route)
- **Breaking change risk:** Low — purely additive middleware reusing the exact pattern already proven on `/login`/`/refresh`; correctly-behaved users (occasional password change, one MFA enroll) stay well under any reasonable threshold. Choose a threshold generous enough not to lock out a legitimate user retrying a mistyped current password a few times.
- **Testing required:** `pnpm verify`; add a test hitting `/change-password` past the new limit and asserting `429 TOO_MANY_REQUESTS`; manual check — legitimate change-password/MFA-enroll flow in the browser still succeeds on the first attempt.
- **Rollback plan:** Remove the added `make()` limiter call from the route mount; standalone, no migration — git revert and redeploy.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1

### DATABASE-01 — case_tasks.verification_unit_id has no supporting index
- **Issue:** The Pipeline task list filters on `ct.verification_unit_id = $N` (a plain equality predicate) but no index on `case_tasks.verification_unit_id` exists in any migration (confirmed via grep across `db/v2/migrations/*.sql`, which shows indexes on `case_id`, `assigned_to`, `status`, `applicant_id`, `area_id`, `parent_task_id`, `created_at`, `assigned_at` — not this column). This degrades to a sequential scan as `case_tasks` grows, violating the documented Pipeline < 2s budget.
- **Files affected:** `apps/api/src/modules/tasks/repository.ts` (lines 132-134, the unit filter); new migration under `db/v2/migrations/`
- **Dependencies:** None — standalone
- **Estimated hours:** 1-2h (source effort = S: 1 migration file)
- **Breaking change risk:** None — purely additive `CREATE INDEX IF NOT EXISTS`, no schema shape change, no code-path change (the filter already exists and works, just unindexed); safe to apply live with no downtime (Postgres index creation on a single-writer table this size is fast, but consider `CREATE INDEX CONCURRENTLY` if the table has grown large by the time this ships to avoid locking writes).
- **Testing required:** Migration dry-run against `crm2_test` (`:5433`) via the tracked migration runner (`migrate.sh`); `EXPLAIN ANALYZE` the Pipeline unit-filter query before/after to confirm plan changes from `Seq Scan` to `Index Scan`; `pnpm verify`.
- **Rollback plan:** Additive migration — rollback = a down-migration (or manual `DROP INDEX IF EXISTS idx_case_tasks_unit`); no data loss.
- **Priority:** P3
- **Owner:** DBA/Data
- **Expected completion:** Day 1-2

### DATABASE-02 — Refresh-token rotation is two non-atomic statements
- **Issue:** Refresh-token rotation calls `repo.revokeRefresh(claims.jti)` and then `issueTokens(...)` (which signs JWTs and separately calls `repo.insertRefresh`) as two independent DB writes with async crypto in between, not wrapped in `withTransaction` (confirmed: `apps/api/src/modules/auth/repository.ts` has no `withTransaction` import). A crash/timeout between the two leaves the old token revoked with no new token issued, forcing an unexpected re-login.
- **Files affected:** `apps/api/src/modules/auth/service.ts` (lines 297-307, refresh flow; lines 118-147, `issueTokens`)
- **Dependencies:** None — standalone
- **Estimated hours:** 2-4h (source effort = S: a few lines, refactor `issueTokens`/`refresh` to share a `TxQuery`)
- **Breaking change risk:** Low — fails closed today (forced logout, not a security bypass) and the fix only wraps the two existing DB writes in a transaction; JWT signing stays outside the transaction as recommended by the source report. No schema change, no mobile-contract change (same request/response shape), but touches the hot auth-refresh path so needs careful review of the shared `TxQuery` plumbing through `repo.revokeRefresh`/`repo.insertRefresh`.
- **Testing required:** `pnpm verify`; integration test simulating a failure between revoke and insert (e.g. inject a throw) asserting the transaction rolls back and the original token remains valid rather than being left in a revoked-with-no-replacement state; manual refresh-token rotation check in the browser (confirm session survives a normal refresh cycle).
- **Rollback plan:** Revert the `withTransaction` wrapper; no schema/migration involved — git revert and redeploy prior image tag.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Week 1

### DATABASE-03 — "Query plan reviewed" standard has no CI/artifact enforcement
- **Issue:** `docs/PAGINATION_AND_LOADING_STANDARDS.md` mandates every paginated endpoint "have its query plan reviewed," but no `EXPLAIN` artifact, CI step, or lint rule enforces this (confirmed: zero source-code hits for `EXPLAIN` outside unrelated doc mentions). This is a process/documentation gap, not a live vulnerability — actual index coverage observed in migrations is good — but the doc asserts a guarantee that isn't machine-checked.
- **Files affected:** `docs/PAGINATION_AND_LOADING_STANDARDS.md` (line 151, the "MUST...query plan reviewed" clause)
- **Dependencies:** None — standalone; optionally sequence after DATABASE-01 so the new index is itself in scope for the first review pass
- **Estimated hours:** 2-3h if just correcting the doc wording (source effort = S); 12-20h if building the CI `EXPLAIN`-capture gate (source effort = M) — recommend the doc-correction path now (cheap, immediately closes the false-confidence gap) and track the CI gate as a separate opportunistic follow-up.
- **Breaking change risk:** None — doc-only wording fix ("MUST...reviewed" → reflects manual code-review practice, not a machine gate); if the M-effort CI-check option is later chosen instead, that's an additive CI step with no effect on runtime code.
- **Testing required:** N/A for the doc fix beyond a read-through for accuracy; if the CI-gate option is chosen instead, `pnpm verify` plus a CI dry-run confirming the new step correctly flags an intentionally-introduced `Seq Scan` on a paginated endpoint as a smoke test.
- **Rollback plan:** N/A, doc-only change — git revert.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1

### DATABASE-05 — DATA_RETENTION_POLICY.md overclaims a `legal_hold` column that doesn't exist

- **Issue:** `docs/security/DATA_RETENTION_POLICY.md` states under its "Ground truth" heading that `consent`, `retention`, and `legal_hold` columns "exist day-1," but `legal_hold` has zero matches anywhere in the schema or codebase. The same doc's "Rules" section treats `legal_hold` as load-bearing (it must gate any future purge job), so the false "already exists" claim risks a future purge job shipping with no actual legal-hold check.
- **Files affected:** `docs/security/DATA_RETENTION_POLICY.md` (line 9 "Ground truth" claim; line 31 "Rules" dependency)
- **Dependencies:** None — standalone doc correction. (The full `legal_hold` column + purge job build-out is a separate, much larger future effort explicitly out of scope here — the original report already splits this into S doc-fix now / L build later.)
- **Estimated hours:** 1h (doc correction only; the source report's "S" applies to this remediation — the "L" build-the-column-and-purge-job effort is not part of this batch)
- **Breaking change risk:** None — text-only edit to a markdown doc, no schema/code/mobile touch.
- **Testing required:** None functional; visually confirm the edited "Ground truth" section no longer claims `legal_hold`/generic `retention` columns exist, and that it correctly states only the policy-acceptance `consents` table (`0070_mobile_consents.sql`) exists today. `grep -rn "legal_hold" db/v2/migrations apps/api/src` should still show zero matches (confirms doc now matches reality, not the reverse).
- **Rollback plan:** N/A — doc-only change, `git revert` the commit if needed.
- **Priority:** P2
- **Owner:** Backend/API (doc lives under `docs/security/`, owned by whoever maintains the compliance docs — typically backend/platform)
- **Expected completion:** Day 1

### DATABASE-06 — API runtime shares the schema-owning DB role with migrations (no privilege separation)

- **Issue:** `infra/prod/.env.prod.example` configures the API/worker runtime to connect as the same `crm2` Postgres role that runs migrations and owns every table, confirmed live (`POSTGRES_USER=crm2`, `DATABASE_URL=postgresql://crm2:...@db:5432/crm2_prod`). Because the append-only guarantee on `audit_log` (migration `0017_concurrency_audit.sql`) is enforced only by a `BEFORE UPDATE OR DELETE` trigger, the table-owning role can `ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable` and rewrite history — there is no DB-level privilege boundary backstopping the trigger if the runtime credential is ever compromised (e.g. via a future SQL-injection defect; none found today).
- **Files affected:** `infra/prod/.env.prod.example` (POSTGRES_USER/DATABASE_URL lines); `infra/prod/docker-compose.yml` (line 81, `migrate` service `DATABASE_URL`); `db/v2/migrations/0017_concurrency_audit.sql` (lines 42-50, the trigger this hardens)
- **Dependencies:** Infra access requirement — needs a prod DB maintenance window to create the new role and re-point `api`/`worker`/`report-worker` container secrets; should land after DATABASE-05 is closed out procedurally but has no technical coupling to it.
- **Estimated hours:** 8-12h (source report estimate "M" — new lower-privileged runtime role, migration-time GRANTs, secrets/deploy wiring for 3 services, plus prod verification)
- **Breaking change risk:** Medium — changes the DB credential every API/worker/report-worker container uses; a misconfigured GRANT set (e.g. missing INSERT/UPDATE/DELETE on some application table) breaks all writes in prod. Does not touch mobile contract, schema shape, or auth flow directly, but is a live-prod credential/infra change requiring careful rollout.
- **Testing required:** Add the new role + GRANTs in a migration, apply to `crm2_test` first (`pnpm verify` integration tests against `:5433`) confirming all existing CRUD/audit-log paths still pass under the restricted role; specifically test that the restricted role's `ALTER TABLE ... DISABLE TRIGGER` attempt fails (`permission denied`); staged rollout to prod during a maintenance window with the old role kept as fallback until confirmed healthy.
- **Rollback plan:** Revert the container `DATABASE_URL` secret back to the original `crm2` owning-role credential and redeploy the prior image/config — the new role is additive (a new Postgres role + GRANTs), so rollback is just pointing the connection string back, no down-migration needed to drop the role itself (can be dropped later once confirmed unused).
- **Priority:** P3
- **Owner:** DBA/Data (with DevOps/Infra for secrets wiring)
- **Expected completion:** Week 3-4

### REDIS_CACHE-01 — Dev Valkey has no auth and publishes to all host interfaces

- **Issue:** The dev `docker-compose.yml` `valkey` service has no `command:` override (so no `--requirepass`, no `--maxmemory`) and publishes port 6380 as `'6380:6379'`, binding to all host interfaces rather than localhost-only, confirmed live at lines 103-113. Any process reachable on that port can run arbitrary Redis commands (`FLUSHALL`, `CONFIG SET`, read in-flight BullMQ job payloads) with zero authentication.
- **Files affected:** `docker-compose.yml` (lines 103-113, the `valkey` service)
- **Dependencies:** None — standalone, dev-only compose change.
- **Estimated hours:** 0.5h (source report: "S, few minutes")
- **Breaking change risk:** Low — dev-only compose file, not prod; developers connecting to Valkey for local debugging will need the new password, a one-line env addition (`VALKEY_PASSWORD`) covers it.
- **Testing required:** `docker compose up valkey` locally, confirm `valkey-cli -h 127.0.0.1 -p 6380 ping` fails without `-a <password>` and succeeds with it; confirm `nc -zv <lan-ip> 6380` from another host fails after rebinding to `127.0.0.1:6380:6379`; re-run the app's worker-mode local flow (`REDIS_QUEUE_URL`/`REDIS_CACHE_URL` pointed at the authed instance) to confirm BullMQ/socket.io adapter still connect.
- **Rollback plan:** Revert the compose diff (`git revert` or drop the `command:`/port-binding change) and restart the `valkey` container — no persisted state, no data loss risk.
- **Priority:** P3
- **Owner:** DevOps/Infra
- **Expected completion:** Day 1-2

### REDIS_CACHE-02 — Commented prod Valkey block sets `noeviction` with no `--maxmemory` ceiling

- **Issue:** The commented-out future prod `valkey` service in `infra/prod/docker-compose.yml` (lines 151-157) sets `--maxmemory-policy noeviction` with no `--maxmemory` flag and no Docker `mem_limit:`, unlike every other service in the same file (`db`/`minio`/`api`/`edge` all set explicit `mem_limit`). If activated as drafted, unconstrained queue growth (e.g. a burst of EXPORT/IMPORT jobs) could exhaust host RAM on the single shared VPS that also runs Postgres and MinIO, causing an OOM crash rather than the intended graceful backpressure.
- **Files affected:** `infra/prod/docker-compose.yml` (lines 151-157, commented `valkey` block)
- **Dependencies:** None — the block is dormant (commented out) today; this fix must land before anyone uncomments it to activate the worker tier, but has no other prerequisite.
- **Estimated hours:** 0.5h (source report: "S, 15 minutes, plus a sizing decision")
- **Breaking change risk:** None currently — editing a commented-out block changes nothing live; risk only materializes if/when the block is ever uncommented, and this fix reduces that future risk.
- **Testing required:** No live test possible (block is inactive); validate by inspection that the edited block now includes `"--maxmemory","512mb"` (or chosen size) in `command:` and `mem_limit: 768m` on the service, matching the pattern of the other 4 services in the file. When the worker tier is eventually activated, re-verify with `docker stats crm2_valkey` under a simulated import/export burst.
- **Rollback plan:** N/A — doc/config-only edit to a block not currently running; `git revert` if the sizing choice needs revisiting.
- **Priority:** P2 (must land before this block is ever uncommented/activated; zero risk while dormant)
- **Owner:** DevOps/Infra
- **Expected completion:** Day 1-2

### REDIS_CACHE-03 — Redis runbook and OPERATIONS_GUIDE describe a topology and health endpoint that don't exist

- **Issue:** `runbooks/redis-outage.md` describes a two-node `valkey-queue`/`valkey-cache` topology, but both compose files define only a single combined `valkey` service (confirmed: `infra/prod/.env.prod.example` sets `REDIS_QUEUE_URL` and `REDIS_CACHE_URL` to the identical connection string). `OPERATIONS_GUIDE.md` claims `/api/v2/health` reports per-dependency status including `valkey-queue`/`valkey-cache`, but the live route (`apps/api/src/http/app.ts:102`) returns a static `{status:'ok', success:true}` with no dependency check at all, and the gated `/api/v2/system/health` endpoint reports only `database` and `push` — no Valkey key. An on-call engineer following the runbook during a real incident would look for infrastructure and a health signal that don't exist.
- **Files affected:** `runbooks/redis-outage.md` (whole file, lines 1-38); `docs/operations/OPERATIONS_GUIDE.md` (lines 54-55); reference points: `apps/api/src/http/app.ts:102`, `apps/api/src/modules/system/service.ts:30-60`
- **Dependencies:** None for the docs-only fix (option a in the source report). Option (b) — wiring a real Valkey ping into `systemService.health()` — depends on the worker tier (REDIS_CACHE-02) actually being activated first; not needed while Valkey stays dormant.
- **Estimated hours:** 1-2h (source report: "S, docs-only fix" — chosen path here, since option b is gated on Valkey going live)
- **Breaking change risk:** None — documentation-only correction, no code path touched.
- **Testing required:** None functional; manually re-read the edited runbook and OPERATIONS_GUIDE section to confirm they now describe the actual single-`valkey`-service topology and the actual (DB+push-only, no Valkey) health payload; `curl -fsS https://crm.allcheckservices.com/api/v2/health` to confirm the doc's description now matches the real static response.
- **Rollback plan:** N/A — doc-only change, `git revert`.
- **Priority:** P3
- **Owner:** DevOps/Infra
- **Expected completion:** Day 1-2

### INFRASTRUCTURE-04 — No `cpus:` limit on any service; `migrate`/`minio-init` also lack `mem_limit`

- **Issue:** `infra/prod/docker-compose.yml` sets `mem_limit` on the 4 long-running services (`db`, `minio`, `api`, `edge` — confirmed live at lines 36/54/125/148) but the one-shot `migrate` and `minio-init` services have none, and no service anywhere in the file has a `cpus:` directive. On the single-VPS deployment, a CPU-heavy burst (Puppeteer PDF rendering, `sharp` image/photo-overlay processing inside `api`) has no cgroup ceiling and can starve `db` of CPU, degrading query latency for all concurrent users.
- **Files affected:** `infra/prod/docker-compose.yml` (lines 56-91 for `minio-init`/`migrate`; whole file for the missing `cpus:` directives)
- **Dependencies:** None — standalone compose config change.
- **Estimated hours:** 1-2h (source report: "S" — add `cpus:` to `api` and `db` at minimum, `mem_limit` to the two init/migrate services; includes a sizing decision against current VPS core count)
- **Breaking change risk:** Low — resource-limit additions to docker-compose; an undersized `cpus:` cap could throttle legitimate load (PDF/report generation, bulk import bursts) if set too conservatively, so needs a sane starting value with headroom, but this is a config-only change with an easy revert.
- **Testing required:** Apply the compose diff to a staging/dev-parity environment first if available, otherwise deploy to prod during a low-traffic window; monitor `docker stats` for `api`/`db` under a representative load (bulk export/PDF generation) to confirm the `cpus:` ceiling doesn't throttle normal operation; confirm `minio-init`/`migrate` still complete successfully with the new `mem_limit`.
- **Rollback plan:** Revert the compose diff and redeploy the prior container config (`docker compose up -d` re-applies without the limits) — purely additive resource constraints, no data/schema impact.
- **Priority:** P3
- **Owner:** DevOps/Infra
- **Expected completion:** Week 2

### INFRASTRUCTURE-05 — TLS restricted to 1.2/1.3 but no explicit cipher/DH-param allowlist

- **Issue:** `infra/prod/nginx.conf` correctly restricts to `ssl_protocols TLSv1.2 TLSv1.3` (confirmed live, lines 44-46) but sets no `ssl_ciphers`, `ssl_prefer_server_ciphers`, or `ssl_dhparam` directive, leaving cipher-suite selection to the nginx/OpenSSL build defaults, which can vary by base image and may include weaker TLS 1.2 CBC-mode suites without AEAD.
- **Files affected:** `infra/prod/nginx.conf` (lines 44-46, `server { listen 443 ssl }` block)
- **Dependencies:** None — standalone nginx config change.
- **Estimated hours:** 1-2h (source report: "S" — add a modern cipher allowlist via a config generator, e.g. Mozilla SSL Configuration Generator "Intermediate" profile)
- **Breaking change risk:** Low — an overly strict cipher list could reject legacy TLS clients, but modern browsers and the mobile app's TLS stack all support the "Intermediate" Mozilla profile; low practical risk given the CVSS 3.1/low rating in the source report.
- **Testing required:** Apply the `ssl_ciphers`/`ssl_prefer_server_ciphers on;` diff, reload nginx (`nginx -t` config test first), then run `nmap --script ssl-enum-ciphers -p 443 crm.allcheckservices.com` or `testssl.sh` against the live box to confirm only the intended modern cipher suites are offered; manually verify the web app and mobile app (crm-mobile-native) both still connect successfully post-change.
- **Rollback plan:** Revert the nginx.conf diff and reload/redeploy the edge container — config-only change, no persisted state, instant rollback via `nginx -s reload` on the prior config or redeploying the prior `edge` image tag.
- **Priority:** P3
- **Owner:** DevOps/Infra
- **Expected completion:** Day 1-2

### LOGGING-01 — Logger `redact()` is shallow/non-recursive, nested secrets pass through unredacted

- **Issue:** `packages/logger/src/index.ts`'s `redact()` function (lines 52-56, confirmed live) only inspects top-level keys of the fields object via `Object.entries(record)` and never recurses into nested objects. Verified by direct execution: `redact({ headers: { authorization: 'Bearer xyz' } })` leaves the nested `authorization` value completely unredacted. Every current call site is disciplined (52/52 `logger.*` calls in `apps/api/src` pass only scalars, per the source audit), so this is latent, not currently exploited — but it's the project's documented ADR-0076 SEC-11 defense-in-depth backstop, and it wouldn't catch the next careless call that nests a secret one level down (e.g. logging a raw Axios error's `config` object).
- **Files affected:** `packages/logger/src/index.ts` (lines 52-56, `redact()`); test file `packages/logger/src/logger.test.ts` (lines 62-80, existing redaction test to extend)
- **Dependencies:** None — standalone, zero-dependency package (per its own header comment), self-contained fix.
- **Estimated hours:** 2-4h (source report: "S, a few hours — function + test")
- **Breaking change risk:** Low — this is the single centralized logger used app-wide; making `redact()` recurse (bounded depth 3-4 levels per the source report, to avoid cycles/perf issues) changes log *output shape* for any currently-unredacted nested field matching `SENSITIVE_KEY`, which is the intended fix, not a regression. No schema/API/mobile contract touch — pure internal function change in a leaf package.
- **Testing required:** `pnpm --filter @crm2/logger test` (or `pnpm verify`) after adding a nested-payload unit test mirroring the existing "redacts sensitive-named fields" case at `logger.test.ts:62-80`; manually confirm via `node -e` (same repro used in the source audit) that `redact({ request: { config: { headers: { Authorization: 'Bearer x' } } } })` now returns `[REDACTED]` at the nested path; confirm benign nested fields (e.g. `{ user: { caseId: 7 } }`) are still passed through unchanged.
- **Rollback plan:** Revert the `redact()` diff in `packages/logger/src/index.ts` — pure function change, no state/schema, `git revert` and redeploy is a clean rollback.
- **Priority:** P3
- **Owner:** Backend/API (owns `packages/logger`)
- **Expected completion:** Day 2-3

### LOGGING-02 — DATA_RETENTION_POLICY.md claims the audit log is already hash-chained/partitioned; migration 0017 says that's deferred

- **Issue:** `docs/security/DATA_RETENTION_POLICY.md` states under "Ground truth" (line 9) that the "Audit log: append-only, hash-chained, partitioned monthly" — presented as already-implemented fact. But migration `0017_concurrency_audit.sql`'s own comment (lines 7-8, confirmed live) says hash-chaining, monthly partitioning, and off-DB copy "are deferred and tracked," and the actual `audit_log` DDL (confirmed live, lines 29-39) has no hash/prev-hash column and is a single non-partitioned table — tamper resistance today is only the `BEFORE UPDATE OR DELETE` trigger (lines 40-47), which blocks ordinary mutation but not a DB-superuser-level actor. The underlying technical gap is already correctly tracked as DEFERRED elsewhere (`docs/COMPLIANCE_GAPS_REGISTRY.md`); this finding is scoped to the doc's false "Ground truth" claim only.
- **Files affected:** `docs/security/DATA_RETENTION_POLICY.md` (line 9); reference: `db/v2/migrations/0017_concurrency_audit.sql` (lines 7-8, 29-47 — read-only reference, not edited by this fix)
- **Dependencies:** None — standalone doc correction. (The actual hash-chain/partition/off-DB-copy build-out is a separate, already-tracked larger effort in `docs/COMPLIANCE_GAPS_REGISTRY.md` and is explicitly out of scope for this fix.)
- **Estimated hours:** 1h (source report: "S, doc edit, < 1 hour")
- **Breaking change risk:** None — text-only edit to a markdown compliance doc.
- **Testing required:** None functional; visually confirm the edited "Ground truth" line reads accurately (e.g. "Audit log: append-only via DB trigger (UPDATE/DELETE blocked). Hash-chaining + monthly partitioning + off-DB copy: PLANNED, see COMPLIANCE_GAPS_REGISTRY C-10") and cross-check that `docs/COMPLIANCE_GAPS_REGISTRY.md` still correctly tracks the underlying technical gap as DEFERRED (no double-counting).
- **Rollback plan:** N/A — doc-only change, `git revert`.
- **Priority:** P2
- **Owner:** Backend/API (compliance doc maintainer)
- **Expected completion:** Day 1

### PERFORMANCE-01 — `addTasks` calls `eligibleAssigneesForNew` once per assigned task instead of batching

- **Issue:** In `apps/api/src/modules/cases/service.ts` (lines 339-350, confirmed live), the `addTasks` flow loops over every assigned task and calls `repo.eligibleAssigneesForNew(...)` individually — each call issues its own `SELECT ... FROM users` query (`apps/api/src/modules/cases/repository.ts`, confirmed live at the `eligibleAssigneesForNew` method) — instead of de-duplicating by `(visitType, pincodeId, areaId, verificationUnitId)` and batching. `AddTasksSchema` (`packages/sdk/src/cases.ts`, confirmed live) caps the array at `MAX_TASKS` (50) via `.max(MAX_TASKS)`, so this is not an unbounded DoS vector, but a realistic 10-20-task KYC/CPV batch case assigned at creation turns into 10-20 sequential, non-parallelized DB round-trips on the hot case-creation path.
- **Files affected:** `apps/api/src/modules/cases/service.ts` (lines 339-350); reference: `apps/api/src/modules/cases/repository.ts` (`eligibleAssigneesForNew` method, ~lines 851-873); `packages/sdk/src/cases.ts` (`AddTasksSchema`, ~lines 410-459, confirms the 50-row cap — not edited by this fix)
- **Dependencies:** None — standalone service-layer refactor, no schema/migration/SDK contract change.
- **Estimated hours:** 1-2h (source report: "S, 1-2 hours")
- **Breaking change risk:** Low — pure internal refactor of `addTasks`'s assignee-validation loop (de-duplicate tuples, call `eligibleAssigneesForNew` once per distinct tuple, check each task's `assigneeId` against the resolved pool in memory); same validation semantics and error codes (`INVALID_ASSIGNEE`), no API contract or mobile-visible behavior change since this is server-side request validation only.
- **Testing required:** `pnpm verify` (typecheck/lint/test); add/extend an integration test in the cases module covering a multi-task `addTasks` call with tasks sharing the same `(visitType, pincodeId, areaId, verificationUnitId)` tuple to confirm only one `eligibleAssigneesForNew` DB call fires (can assert via a query-count spy or by checking existing test coverage for `addTasks` still passes with the same INVALID_ASSIGNEE behavior for a bad assignee); manual smoke test: create a case with 10+ FIELD tasks assigned to the same territory at create-time via the web UI and confirm case creation completes and all tasks show correctly assigned.
- **Rollback plan:** Revert the `service.ts` diff — the loop reverts to per-task calls, functionally equivalent (just slower), no data/schema impact, clean `git revert`.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 2-3

### CODE_QUALITY-01 — 19 unused exports + 14 unused exported types per knip

- **Issue:** `pnpm run deadcode` (knip), confirmed live, reports 19 unused exports and 14 unused exported types spread across `apps/api/src/platform/*`, `apps/api/src/modules/{rateTypes,shared,fieldReports,mis}/*`, and `apps/web/src/lib/*` (e.g. `getPool`, `ERROR_CODES`, `connectSocket`, `setTheme`, `MisColumn`, `HierarchyMode`). These are dead exports with no current importer — irrelevant code (CWE-1164) that adds maintenance surface without runtime effect.
- **Files affected:** `apps/api/src/platform/db.ts`, `apps/api/src/platform/errors.ts`, `apps/api/src/platform/bulk.ts`, `apps/api/src/platform/export/{job,format}.ts`, `apps/api/src/platform/import/{format,index}.ts`, `apps/api/src/platform/jobs/index.ts`, `apps/api/src/platform/scope/index.ts`, `apps/api/src/platform/{access/index,access/repository,audit,mail/index,pagination}.ts`, `apps/api/src/modules/rateTypes/service.ts`, `apps/api/src/modules/shared/masterDataImport.ts`, `apps/api/src/modules/fieldReports/sectionMap.ts`, `apps/api/src/modules/mis/{resolver,service}.ts`, `apps/web/src/lib/{serverClock,socket,theme,sessionManager}.ts` (full list is the `pnpm run deadcode` output, 19 exports + 14 types)
- **Dependencies:** None — standalone cleanup pass. Should be done as one PR after confirming each item truly has zero external consumer (some may be intentional public API surface for `@crm2/sdk`-style consumption — verify per-item, not blanket-deleted).
- **Estimated hours:** 3-5h (source report gives no explicit estimate for this item — sizing based on ~33 call sites across ~20 files, each requiring a quick "confirm truly unused, delete or keep with a documented reason" pass; mechanical but touches many files)
- **Breaking change risk:** Low — removing genuinely-unused exports has no runtime behavior change by definition; the only risk is misjudging an export as dead when it's actually used dynamically/reflectively or is intentional public API (e.g. SDK barrel exports) — mitigated by re-running `pnpm run deadcode` and full `pnpm verify` after each removal.
- **Testing required:** `pnpm run deadcode` before and after to confirm the flagged items drop to zero (or a documented, justified remainder via `knip.json` ignore if any are intentionally-public); `pnpm verify` (typecheck → lint → format → no-suppressions → boundaries → test → build) full green after removal, since deleting an export can cascade into unused-import lint failures in the same file.
- **Rollback plan:** Revert the cleanup commit(s) — pure deletions of unreferenced code, trivially revertible via `git revert`, no data/schema/runtime state involved.
- **Priority:** P3
- **Owner:** Backend/API (majority of items) with Frontend/Web for the `apps/web/src/lib/*` items
- **Expected completion:** Week 2-3

### CODE_QUALITY-02 — Duplicated IST-midnight time logic across 3 service files
- **Issue:** The `IST_OFFSET_MS = 19_800_000` constant plus the "IST midnight" `Date.UTC(...) - offset` algorithm is copy-pasted verbatim in `dashboard/service.ts` and `field-monitoring/service.ts`, with a related single-line variant (`istHour`) in `location/service.ts`. There is no shared time utility (`apps/api/src/platform/` has no `time.ts`), so a future correctness fix must be applied in 3 places, and any missed copy reintroduces a Dashboard-vs-Field-Monitoring "today" count mismatch.
- **Files affected:** `apps/api/src/modules/location/service.ts` (line 19, 28-30), `apps/api/src/modules/dashboard/service.ts` (line 9, 13-16), `apps/api/src/modules/field-monitoring/service.ts` (line 49, 52-57)
- **Dependencies:** None — standalone
- **Estimated hours:** 1h (source effort: S / 1 hour)
- **Breaking change risk:** None — pure internal refactor extracting an identical pure function into `apps/api/src/platform/time.ts`; no API, DB, or mobile contract surface touched.
- **Testing required:** `pnpm --filter @crm2/api test` (existing `dashboard`/`field-monitoring`/`location` suites must stay green); manually diff dashboard "today" counts vs. field-monitoring "today" counts against current values before/after to confirm no numeric drift; `pnpm verify`.
- **Rollback plan:** Revert the commit — it's a same-behavior extraction with no schema/config change, so `git revert` is sufficient.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 1

### CODE_QUALITY-03 — CaseDetailPage.tsx is a 2332-line God-component
- **Issue:** `apps/web/src/features/cases/CaseDetailPage.tsx` bundles 30 conceptually separate components (applicant forms, task assignment/completion/finalize forms, attachments, data-entry, pickup, mobile report rendering, field-photo gallery, case-report rendering) as module-private functions in one file — by far the largest file in the frontend. The audit's own text concedes zero security exploitability; this is a pure maintainability/velocity and merge-conflict-surface risk on the single most-touched screen in the CRM.
- **Files affected:** `apps/web/src/features/cases/CaseDetailPage.tsx` (whole file, 1-2332; component boundaries at lines 71, 266, 403, 438, 929, 1085, 1141, 1190, 1248, 1425, 1445, 1464, 1568, 1620, 1641, 1662, 1767, 1794, 1833, 1911, 1938, 1980, 2025, 2095, 2112, 2180, 2245)
- **Dependencies:** None — standalone, but must be split incrementally across multiple PRs, not one, per the source report's own caution ("do NOT attempt this opportunistically inside an unrelated change").
- **Estimated hours:** 16-24h (source effort: L, "multi-PR refactor of the busiest screen"; converted to a rough 2-3 working days spread over several PRs, not one sitting)
- **Breaking change risk:** Low — this is a pure file-split refactor (extract `CaseDetailTasksSection.tsx`, `CaseDetailAttachments.tsx`, `CaseDetailFieldPhotos.tsx`, `CaseDetailDataEntry.tsx`, `CaseDetailPickup.tsx`, `CaseDetailReport.tsx` as sibling files re-imported by the page), no behavior change, stays inside the `cases` feature folder so the `no-cross-feature-internals` dependency-cruiser rule is unaffected. Risk is only "Low, not None" because it's the busiest screen in the product and a slip in prop-threading during extraction could regress a workflow.
- **Testing required:** `pnpm verify` after each extraction PR; manual browser pass on each extracted section per `feedback_browser_verify_perform_actions.md` — open a real case, exercise: add applicant, assign/complete/finalize a task, upload/view attachments, data entry, pickup, mobile report view, field photos gallery+GPS overlay, case report — confirm each still renders and submits identically before/after.
- **Rollback plan:** Each extraction is its own small PR/commit — revert the specific commit to restore the inlined component; no data or schema involved.
- **Priority:** P2
- **Owner:** Frontend/Web
- **Expected completion:** Week 3-6 (spread across multiple incremental PRs, not a single sprint)

### CODE_QUALITY-05 — Oversized, multi-responsibility functions in cases/repository.ts
- **Issue:** `addTasks` (121 lines), `reassignRevokedTask` (102 lines), and `assignTask` (78 lines) in `cases/repository.ts` each mix multiple responsibilities — insert loops, rate-derivation business logic, large parameterized SQL with embedded `CASE` clauses, and history/status-recompute side-effects — in one function, raising the cost and risk of safely extending task-creation/assignment logic.
- **Files affected:** `apps/api/src/modules/cases/repository.ts` (lines 638-759 `addTasks`, 1258-1360 `reassignRevokedTask`, 912-990 `assignTask`)
- **Dependencies:** None — standalone, but must keep the existing `cases.api.test.ts` suite (3088 lines, already covers `addTasks`) green throughout the extraction.
- **Estimated hours:** 3-5h (source effort: M, "a few hours")
- **Breaking change risk:** Low — no behavior change is required per the source report; extracting the per-task INSERT+history-write pair into an `insertOneTask(q, caseId, seq, t, userId)` helper is a pure refactor of code on the case/task creation and assignment critical path, so a mistake here would affect live task creation (hence Low, not None).
- **Testing required:** `pnpm --filter @crm2/api test -- cases.api.test.ts` before and after each extraction; `pnpm verify`; manually create a case with multiple FIELD+OFFICE tasks in crm2_dev and confirm TAT-hours and rate-type stamping are unchanged, plus exercise one reassign-revoked-task flow end to end.
- **Rollback plan:** Revert the extraction commit — no schema change, pure function-boundary refactor inside the repository file.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Week 2

### BUSINESS_LOGIC-02 — Dedupe-search export gated on generic data.export instead of dedupe.view
- **Issue:** `GET /dedupe-search` (the view endpoint) is correctly gated on the dedicated `dedupe.view` permission, but `GET /dedupe-search/export` — exporting the identical cross-client PII dataset — is gated only on the generic `data.export` permission, the exact bug class the codebase's own `billing/routes.ts` comment already documents and fixes for billing exports. Today the two permissions happen to be granted to the same role set, so it's not currently exploitable, but the check is logically inconsistent with its own sibling pattern.
- **Files affected:** `apps/api/src/modules/cases/routes.ts` (line 16)
- **Dependencies:** None — standalone, one-line change
- **Estimated hours:** 0.5h (source effort: S, 15 minutes; rounding up to include the regression test)
- **Breaking change risk:** Low — changes an authorization check on a live route from `PERMISSIONS.DATA_EXPORT` to `PERMISSIONS.DEDUPE_VIEW`; since role grants currently coincide, no user's access should visibly change today, but this is still an auth-flow edit and should be verified against the live role matrix before deploy to avoid accidentally locking out a role that has `data.export` but not `dedupe.view`.
- **Testing required:** `pnpm verify`; add a regression test asserting a `dedupe.view`-less, `data.export`-holding role gets 403 on `/dedupe-search/export`; manually confirm in crm2_dev that MANAGER/TEAM_LEADER/BACKEND_USER (which hold both perms per `db/v2/migrations/0033_roles.sql` and `0040_dedupe_company_and_perm.sql`) can still export.
- **Rollback plan:** One-line `git revert` of the route change; no migration involved.
- **Priority:** P2
- **Owner:** Backend/API
- **Expected completion:** Day 1

### MOBILE_API_COMPATIBILITY-01 — Compatibility matrix still documents the deprecated /auth/accept-policies endpoint
- **Issue:** `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` (lines 35 and 46) still documents `POST /api/v2/auth/accept-policies {policyIds[],source}` as the locked mobile policy-acceptance contract, but ADR-0043's reconciliation note and the live code (`apps/api/src/modules/consents/service.ts`, `packages/sdk/src/consents.ts`) confirm the real, implemented endpoint is `POST /api/v2/consents/accept {policyVersion}` with no `source` field. ADR-0054 explicitly flagged this doc as needing an update and it was never done.
- **Files affected:** `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` (Policy acceptance gate row, line 35; "Don't-regress" footer, line 46)
- **Dependencies:** None — standalone, doc-only change
- **Estimated hours:** 1h (source effort: S, documentation-only)
- **Breaking change risk:** None — documentation-only change, no code/API/schema touched.
- **Testing required:** No automated test; manually re-read the updated matrix against `apps/api/src/modules/consents/service.ts` and `packages/sdk/src/consents.ts` to confirm the corrected `{policyVersion}` shape and endpoint match; confirm the ADR-0054 cross-reference is added as ADR-0054 itself calls for.
- **Rollback plan:** N/A — doc-only change, `git revert` if needed.
- **Priority:** P2
- **Owner:** Backend/API (doc owner of the mobile contract matrix)
- **Expected completion:** Day 1

### MOBILE_API_COMPATIBILITY-02 — forms and telemetry modules have zero test coverage, absent from mobile-contract test scope
- **Issue:** `apps/api/src/modules/forms/service.ts` and `apps/api/src/modules/telemetry/service.ts` are documented mobile-parity endpoints but have no `__tests__/` directory and are not included in the `test:contract-mobile` script's module list, leaving no regression net if either gains real logic later (telemetry's own comment already flags wiring a real sink as "a deliberate later step").
- **Files affected:** `apps/api/src/modules/forms/service.ts`, `apps/api/src/modules/telemetry/service.ts`, `apps/api/package.json` (line 13, `test:contract-mobile` script)
- **Dependencies:** None — standalone
- **Estimated hours:** 2-4h (source effort: S, "a few hours")
- **Breaking change risk:** None — additive test files plus adding two module paths to an existing test-script glob; no production code path changed.
- **Testing required:** Add `apps/api/src/modules/forms/__tests__/forms.api.test.ts` and `apps/api/src/modules/telemetry/__tests__/telemetry.api.test.ts` asserting the documented response shape (forms returns `null` template, telemetry validates+counts without persisting); add both module paths to `test:contract-mobile` in `apps/api/package.json`; run `pnpm --filter @crm2/api test:contract-mobile` to confirm both are now included and passing; `pnpm verify`.
- **Rollback plan:** N/A — purely additive test files and a script-list edit; revert the commit if needed, no runtime impact either way.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Week 2

### MOBILE_API_COMPATIBILITY-04 — Idempotency dedupe is operation_id-only, doesn't compare replay body against documented "method+body+key" contract
- **Issue:** The API's idempotency dedupe (`verification-tasks/service.ts`, `location/repository.ts`) is a sound DB-level `operation_id` UNIQUE-constraint dedupe, but never compares a replay's body against the original — contradicting `MOBILE_API_COMPATIBILITY_MATRIX.md`'s documented "keep `Idempotency-Key` dedupe (method+body+key)" guarantee. Under current well-behaved device usage this is a non-issue, but a future client bug reusing an `operationId` with a different body would silently drop the second (different) evidence photo/GPS fix with a 200 success and no error surfaced.
- **Files affected:** `apps/api/src/modules/verification-tasks/service.ts` (lines 210-216), `apps/api/src/modules/location/repository.ts` (lines 36-57), `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` (the "method+body+key" don't-regress line)
- **Dependencies:** None for the doc-fix option (a). If pursuing option (b), no prerequisite beyond deciding which option — recommend (a) first (cheap, matches actual documented device behavior), defer (b) as a P3/opportunistic hardening.
- **Estimated hours:** 1h for option (a) doc fix (source effort: S); 4-8h if option (b) body-hash defense-in-depth is later chosen (source effort: M)
- **Breaking change risk:** None for option (a) — doc-only. Low for option (b) — adding a body-hash comparison on replay changes idempotency behavior (a same-key/different-body replay would now 409 instead of silently returning the first result), which touches the mobile sync/upload contract and would need mobile-side validation before shipping, since crm-mobile-native is a first-class `/api/v2` consumer.
- **Testing required:** For (a): manually re-read the corrected matrix line against `verification-tasks/service.ts:210-216` and `location/repository.ts:36-57` to confirm the described `operation_id`-only mechanism now matches. If (b) is later chosen: `pnpm --filter @crm2/api test` covering a new "same operationId, different body → 409" case; coordinate with mobile team before enabling since it changes response semantics on retry.
- **Rollback plan:** (a) doc-only, `git revert`. (b) if implemented later: revert the body-hash comparison commit; the underlying `operation_id` UNIQUE constraint dedupe is unaffected either way.
- **Priority:** P3
- **Owner:** Backend/API
- **Expected completion:** Day 2 (option a); deferred/opportunistic for option b

### MERGED-ACCESS-TOKEN-LOCALSTORAGE — Web access token stored in localStorage, readable by any XSS for its 15-min TTL
- **Issue:** `apps/web/src/lib/auth.ts` stores the short-lived (15-minute default `AUTH_ACCESS_TTL_S`) access token in `localStorage`, which any XSS on the page could read and replay, and could also silently call `/auth/refresh` (cookie rides via `credentials:'include'`) to keep minting fresh access tokens. This was independently confirmed as an already-signed-off team decision: ADR-0076 SEC-10 deliberately moved only the refresh token to an httpOnly cookie and knowingly left the access token client-side, per `docs/COMPLIANCE_GAPS_REGISTRY.md` SEC-10 and the code comment in `apps/api/src/http/refreshCookie.ts` citing ADR-0076 SEC-10 explicitly. No current XSS sink exists in the codebase (verified in both source audits), so this is not exploitable today.
- **Files affected:** `apps/web/src/lib/auth.ts` (lines 11-23, specifically `tokenStore.access`/`tokenStore.set` at 14-15, 102-108), `apps/api/src/http/refreshCookie.ts` (reference point for the accepted ADR-0076 SEC-10 boundary)
- **Dependencies:** None to re-affirm as-is. If ever revisited: prerequisite is landing FRONTEND_SECURITY-02 (CSP) first, since CSP further reduces this risk and the source report calls that out as the natural companion mitigation before touching token storage itself.
- **Estimated hours:** 0h to re-affirm (no action). 6-10h if later upgraded to an in-memory token store (source effort: M — "move `tokenStore.access` to an in-memory module variable; requires re-deriving the access token on every fresh page load via a silent `/auth/refresh` call, touching `AuthContext.tsx`/`sdk.ts` boot sequence").
- **Breaking change risk:** None to re-affirm. Medium if later implemented — moving the access token to an in-memory-only store changes web session behavior on hard page refresh (token would need silent re-acquisition via `/auth/refresh` on every boot), touching the `AuthContext.tsx`/SDK boot sequence used on every authenticated page load; needs careful browser verification across tab-restore/refresh scenarios before shipping.
- **Testing required:** For re-affirmation: no test needed, this entry documents the decision stands. If later implemented: `pnpm verify`; browser-verify per `feedback_browser_verify_perform_actions.md` — hard-refresh an authenticated session, confirm silent re-auth via `/auth/refresh` succeeds and the user isn't bounced to login; verify multi-tab behavior; verify the 15-min TTL expiry path still degrades gracefully.
- **Rollback plan:** N/A for re-affirmation. If implemented later: revert the `tokenStore` commit to restore `localStorage`-backed access-token storage.
- **Priority:** P3 — Optional (Accepted Risk, re-affirm or fix opportunistically)
- **Owner:** Frontend/Web
- **Expected completion:** N/A (re-affirm only); Week 4+ if opportunistically upgraded

### FRONTEND_SECURITY-01 — Admin routes render unconditionally for any authenticated user, no client-side route guard
- **Issue:** `apps/web/src/App.tsx` mounts all `/admin/*` route components (users, RBAC, system, etc.) for any authenticated user regardless of permission — the only gate is `if (!user) return <LoginPage />`. The backend independently 403s the underlying data fetches (no data leak), but the page shell/labels/UI structure render first. This was independently confirmed as an already-signed-off team decision: `docs/COMPLIANCE_GAPS_REGISTRY.md` SR-11 defers this at LOW because every sampled admin route is independently backend-gated via `authorize()`.
- **Files affected:** `apps/web/src/App.tsx` (lines 69-121, all `<Route>` declarations; guard gap originates at line 63), `apps/web/src/components/Layout.tsx` (lines 47-66, the existing `perm`-per-route metadata that a guard would reuse), `apps/web/src/context/AuthContext.tsx` (the existing `useAuth().has()` helper a guard would call)
- **Dependencies:** None to re-affirm as-is. If later fixed: reuse the `perm` values already declared per-route in `Layout.tsx`'s `ADMINISTRATION`/`OPERATIONS` arrays as the single source of truth for both the nav filter and the new route guard — no new permission taxonomy needed.
- **Estimated hours:** 0h to re-affirm. 3-5h if later implemented (source effort: S — "a few hours — one wrapper component + applying it to ~16 routes, reusing existing `perm` metadata already in `Layout.tsx`").
- **Breaking change risk:** None to re-affirm. Low if later implemented — adding a `RequirePermission` wrapper around `/admin/*` routes changes client-side navigation behavior (redirect to `/dashboard` on missing permission) but does not touch the API/auth flow/DB; risk is limited to accidentally mis-mapping a route's required permission and blocking a role that should have access.
- **Testing required:** For re-affirmation: no test needed. If later implemented: `pnpm verify`; browser-verify per `feedback_browser_verify_perform_actions.md` — log in as a low-privilege role (e.g. FIELD_AGENT) and directly navigate to each `/admin/*` URL, confirm redirect instead of page-shell render; log in as an admin role and confirm all admin routes still load normally.
- **Rollback plan:** N/A for re-affirmation. If implemented later: revert the `RequirePermission` wrapper commit; routes return to always-mounting (prior, backend-gated-only behavior).
- **Priority:** P3 — Optional (Accepted Risk, re-affirm or fix opportunistically)
- **Owner:** Frontend/Web
- **Expected completion:** N/A (re-affirm only); Week 3-4 if opportunistically upgraded

### PERFORMANCE-02 — EXPORT/IMPORT/CASE_REPORT jobs run in-process, no out-of-process worker in prod
- **Issue:** `apps/api/src/platform/jobs/index.ts` runs EXPORT (up to 200k-row XLSX/CSV), IMPORT, and CASE_REPORT (puppeteer PDF) jobs fire-and-forget inside the single `api` container's Node process, sharing the event loop and libuv threadpool with live HTTP request handling, scrypt password hashing, and sharp image processing. This was independently confirmed as an already-signed-off team decision: `docker-compose.yml`'s top-of-file comment and `docs/adr/ADR-0030-background-jobs.md` document the in-process degrade path (no `REDIS_QUEUE_URL`, `worker`/`report-worker` services commented out) as an intentional, config-gated design property for current single-VPS scale.
- **Files affected:** `apps/api/src/platform/jobs/index.ts` (lines 159-188), `infra/prod/docker-compose.yml` (lines 158-159, commented-out `worker`/`report-worker` services)
- **Dependencies:** Re-affirmation needs none. If later activated: requires provisioning Valkey (Redis-compatible queue) in prod infra — an infra/ops prerequisite, not a code change — before uncommenting the worker services.
- **Estimated hours:** 0h to re-affirm. 4-8h if later activated (source effort: M — "infra change + Valkey provisioning + smoke test, not a code change").
- **Breaking change risk:** None to re-affirm. Medium if later activated — moving EXPORT/IMPORT/CASE_REPORT off the request-serving process requires a maintenance-window infra change (new Valkey service, uncommented worker containers) and changes job-completion latency characteristics (async dispatch to a separate container); needs a smoke test of each job type end-to-end post-cutover.
- **Testing required:** For re-affirmation: no test needed, existing ADR-0030 stands. If later activated: provision Valkey in a staging/maintenance window; uncomment `worker`/`report-worker` in `infra/prod/docker-compose.yml`; set `REDIS_QUEUE_URL`; smoke-test one EXPORT, one IMPORT, and one CASE_REPORT job end-to-end confirming they dispatch to the worker container and complete; monitor API container CPU/event-loop latency during a concurrent load burst before/after.
- **Rollback plan:** N/A for re-affirmation. If activated later: re-comment the `worker`/`report-worker` services and unset `REDIS_QUEUE_URL` — jobs fall back to the existing in-process path with zero code change required (the same `runJob` function already supports both paths).
- **Priority:** P3 — Optional (Accepted Risk, re-affirm or fix opportunistically)
- **Owner:** DevOps/Infra
- **Expected completion:** N/A (re-affirm only); Week 4+ if load later warrants activation

### BUSINESS_LOGIC-01 — Legacy assignableUsers (no-taskId branch) still uses org-hierarchy-capped getScopedUserIds
- **Issue:** `cases/repository.ts`'s `assignableUsers` function (reached via `GET /cases/:id/assignable-users` without a `taskId` param) still caps the assignee pool using the org-hierarchy `getScopedUserIds`, unlike its ADR-0078-fixed sibling `eligibleAssigneesForNew`, which uses territory/unit grants. This was independently confirmed as an already-signed-off team decision: `docs/adr/ADR-0078-assignee-pool-territory-not-hierarchy.md` (lines 49-50) explicitly names this function and states it deliberately stays hierarchy-scoped as a visibility filter, not the work-eligibility pool. No web/mobile consumer currently calls the no-`taskId` branch (confirmed by the source report's grep of `apps/web/src`).
- **Files affected:** `apps/api/src/modules/cases/repository.ts` (lines 830-838, `assignableUsers`), `apps/api/src/modules/cases/service.ts` (lines 450-451), `apps/api/src/modules/cases/routes.ts` (line 62)
- **Dependencies:** Re-affirmation needs none. If later fixed: confirm zero external/mobile consumers before deleting the branch (per the source report's recommended option (a)), since this is a live, callable API surface even though unused by first-party clients today.
- **Estimated hours:** 0h to re-affirm. 1-2h if later fixed (source effort: S — "confirm zero external/mobile consumers, then delete the branch + function + route param, or align it to the territory model").
- **Breaking change risk:** None to re-affirm. Low if later fixed — deleting or realigning an unused API branch; only risk is if an undocumented third-party or future FE consumer relies on the no-`taskId` call path, so a consumer-confirmation step (grep + ask web/mobile teams) precedes any code change.
- **Testing required:** For re-affirmation: no test needed, ADR-0078 lines 49-50 already document the intent. If later fixed: `grep -rn "assignableUsers(caseId)" apps/web/src crm-mobile-native` (or equivalent) to reconfirm zero no-`taskId` callers; if deleting, run `pnpm --filter @crm2/api test` on `cases.api.test.ts` to confirm no test depends on the branch; `pnpm verify`.
- **Rollback plan:** N/A for re-affirmation. If fixed later: revert the deletion/realignment commit; no schema or migration involved either way.
- **Priority:** P3 — Optional (Accepted Risk, re-affirm or fix opportunistically)
- **Owner:** Backend/API
- **Expected completion:** N/A (re-affirm only); Day 1-2 if opportunistically cleaned up

## Informational (Tracked, Not Phased)

These 12 findings are Informational severity — no dedicated remediation phase was requested for them and none carry standalone risk; tracked here so nothing from the verified findings set is silently dropped.

| ID | Issue | Disposition | Suggested action |
|---|---|---|---|
| MERGED-SOCKETIO-CORS | Socket.IO CORS `origin:true, credentials:true`, currently inert (handshake needs bearer JWT) | TRUE_POSITIVE | replace with explicit origin allow-list + drop `credentials:true`, in `apps/api/src/platform/realtime/index.ts:135-137` |
| AUTHORIZATION-03 | Export 413 threshold verified correctly computed on scope-filtered total | TRUE_POSITIVE | no action — confirms a working control |
| INPUT_VALIDATION-04 | `CreateCaseSchema.applicants` array has no `.max()` ceiling | TRUE_POSITIVE | add `.max(10)` in `packages/sdk/src/cases.ts:370` |
| API_SECURITY-04 | No ADR documents the deliberate same-origin / no-CORS decision | TRUE_POSITIVE | doc correction — add same-origin note to `docs/DESIGN_AND_STACK_FREEZE.md` or a short ADR |
| FRONTEND_SECURITY-04 | ADR-0009 feature flags marked Accepted but zero implementation exists | TRUE_POSITIVE | doc correction — update ADR-0009 status to reflect no implementation |
| INFRASTRUCTURE-06 | Global gzip on `application/json` incl. `/api/`, a BREACH precondition, no concrete exploit path | TRUE_POSITIVE | no action — track only, exempt specific route with `gzip off;` if a reflected-secret endpoint is ever found |
| MERGED-UNUSED-VITEST-DEPS | Root `package.json` has unused `vitest`/`@vitest/coverage-v8` devDeps duplicating per-workspace declarations | TRUE_POSITIVE | remove both entries from root `package.json` (lines 32, 43) |
| DEPENDENCY_AUDIT-02 | License sweep covered only direct deps; `firebase-admin` transitive tree not individually checked | TRUE_POSITIVE | no action — scope-boundary note; run `license-checker` full sweep only if ever formally required |
| DEPENDENCY_AUDIT-04 | No Dependabot/Renovate; CVEs surface only via manual `pnpm audit` | TRUE_POSITIVE | add `.github/dependabot.yml` (weekly, npm ecosystem) |
| CODE_QUALITY-06 | `location` vs `locations` modules differ only by trailing "s", unrelated domains, same-named `locationService` export | TRUE_POSITIVE | optional rename (e.g. `location`→`deviceLocation`) opportunistically alongside other work in that module, not standalone |
| BUSINESS_LOGIC-03 | Async export `ExportBuild` threads bare `actorId`, not resolved `Actor`/`Scope`, unlike `caseReportJobProcessor` | TRUE_POSITIVE | no action now (YAGNI, zero scope-sensitive builders registered) — widen signature to `actor: Actor` + re-resolve scope when a scope-sensitive builder is added |
| PERFORMANCE-03 | XLSX export builds full workbook in memory via `writeBuffer()` instead of streaming `WorkbookWriter` | ACCEPTED_RISK | already accepted per `docs/agents/performance.md` RATCHET (filed 2026-06-07, reaffirmed 2026-06-15) with sized upgrade trigger |
