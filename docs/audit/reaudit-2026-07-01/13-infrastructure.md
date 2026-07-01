# RE-AUDIT 13: Infrastructure

Re-audit of area 13 against post-remediation HEAD (`8ded432`), baseline `b19039e`. Static inspection only (docker not run). Files: `infra/Dockerfile.api`, `infra/prod/{docker-compose.yml,nginx.conf,deploy.sh,renew-cert.sh}`.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| INFRASTRUCTURE-01 (non-root API) | CONFIRMED_FIXED | `infra/Dockerfile.api:37-38` — `RUN chown -R node:node /app` then `USER node`, placed after `pnpm install` (root-only steps) and before the runtime `CMD`. Base `node:24-bookworm-slim` ships uid-1000 `node`. API binds :4000 (>1024, non-root OK). PDF path (`apps/api/src/platform/pdf/index.ts:35`) launches chromium with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` — correct pairing for non-root; no runtime disk writes to `/app` (PDF → buffer, no `mkdtemp`/`writeFileSync` in runtime code). Diff confirms these 2 lines are new. |
| INFRASTRUCTURE-02 (nginx security headers) | CONFIRMED_FIXED | `infra/prod/nginx.conf:76-81` — X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS (`max-age=31536000; includeSubDomains`), strict CSP; all `always`. Correctly re-declared in `/assets/` (137-143) and `= /index.html` (150-155) since nginx does not inherit `add_header` into a location that sets its own. CSP `connect-src 'self'`/`script-src 'self'`/`img-src 'self' data: blob:` verified safe: web app has no external CDN/gstatic/googleapis/firebase resources (grep clean); the one external `<a href>` to google.com/maps (`apps/web/.../FieldMonitoringPage.tsx:110`) is anchor navigation, not governed by CSP fetch directives. |
| INFRASTRUCTURE-03 (cert renewal) | CONFIRMED_FIXED | New `infra/prod/renew-cert.sh` — `certbot renew --webroot` against the shared `crm2_certbot_webroot` volume + `nginx -s reload`, install-as-cron documented (`:14-16`), idempotent outside renewal window. `deploy.sh:12-15` note clarifies deploy only checks the cert exists (`:38`), never renews. |
| INFRASTRUCTURE-04 (cpus + one-shot limits) | CONFIRMED_FIXED | `docker-compose.yml` — all 6 active services (db, minio, minio-init, migrate, api, edge) carry `cpus` + `mem_limit`; the 2 one-shots gained both: `minio-init` mem_limit 256m/cpus 0.5 (`:88-89`), `migrate` 512m/1 (`:115-116`). Non-comment counts: cpus=6, mem_limit=6. |
| INFRASTRUCTURE-05 (explicit ciphers) | CONFIRMED_FIXED | `nginx.conf:51` — explicit Mozilla-Intermediate ECDHE-only allowlist (`ssl_ciphers ECDHE-…-GCM-…:…-CHACHA20-POLY1305`); `ssl_protocols TLSv1.2 TLSv1.3` (`:44`); comment correctly notes ciphers only govern TLS 1.2 (TLS 1.3 suites fixed by OpenSSL). |
| INFRASTRUCTURE-06 (gzip/JSON BREACH) | ACCEPTED_AS_DOCUMENTED | Track-only NO-ACTION. `nginx.conf:60` still gzips `application/json`; acceptable because the refresh token lives in an httpOnly cookie (SEC-10), so no session secret is reflected in a compressible response body alongside attacker-controlled input. Matches documented disposition. |

Bonus (adjacent, this file): LOGGING-03 (json-file 20m×10 cap via `x-logging` anchor, 6/6 services) and REDIS_CACHE-02 (`--maxmemory 512mb` added to the commented valkey stanza) are also present and correct. `security_opt: no-new-privileges:true` on all 6 active services (`:50-51` etc.). Only edge publishes ports (80/443, `:168-170`) — no DB/MinIO/console exposure.

## New Findings

None.

Checked and cleared: non-root regression (chromium `--no-sandbox`, port >1024, no `/app` runtime writes, firebase secret mount readable at 0444); YAML anchor integrity (1 def / 8 uses, all resolve); `cpus:`/`mem_limit:` are legacy-but-supported compose keys matching the pre-existing style; deploy.sh change is comment-only; CSP does not break the SPA; edge running as root-in-container with `no-new-privileges` is standard nginx and unchanged by this remediation (not a regression). HSTS omits `preload` and CSP has no `report-uri` — both are pre-existing deliberate choices, not defects.

## Verdict

PASS.

All five claimed fixes are real and complete against the actual files, the one NO-ACTION item matches its documented acceptance, and the remediation introduced zero new findings — the non-root Dockerfile change is correctly paired with chromium `--no-sandbox` and a full `chown`, and the compose limits/headers/scripts are all consistent and parse-clean. This is the expected good outcome: a genuinely clean, production-ready infrastructure area.
