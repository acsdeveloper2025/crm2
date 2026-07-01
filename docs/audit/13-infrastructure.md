# AUDIT 13: Infrastructure

## Scope

Inspected files (all read in full):
- `infra/Dockerfile.api`
- `infra/Dockerfile.web`
- `infra/prod/docker-compose.yml`
- `infra/prod/nginx.conf`
- `infra/prod/deploy.sh`
- `infra/prod/.env.prod.example`
- `docker-compose.yml` (repo root, local dev stack — for comparison only, not prod)
- `.github/workflows/deploy.yml`
- `.dockerignore`
- `runbooks/db-outage.md`, `runbooks/storage-outage.md` (cross-check only)
- `docs/architecture-inventory.md` (baseline, not regenerated)

Commands actually run (all read-only `grep`/`find`/`cat`/`awk`, no installs, no mutations, no network calls, no DB/container connections):
```
grep -n -i "add_header|X-Frame|X-Content-Type|Strict-Transport|Content-Security-Policy|Referrer-Policy|Permissions-Policy|X-XSS" infra/prod/nginx.conf
grep -n "^USER|^RUN.*useradd|^RUN.*adduser" infra/Dockerfile.api infra/Dockerfile.web
grep -n "cap_drop|cap_add|read_only|no-new-privileges|security_opt|privileged" infra/prod/docker-compose.yml
grep -n -A3 "ports:" infra/prod/docker-compose.yml
grep -n "mem_limit|cpus:|cpu_" infra/prod/docker-compose.yml
grep -n "healthcheck:" infra/prod/docker-compose.yml
grep -rn -i "certbot" . --include="*.sh" --include="*.yml" --include="*.yaml" --include="*.conf" --include="*.md"
find . -iname "*cron*" -o -iname "*timer*"
grep -rn "mode 600|chmod 600|0600" infra/ docs/
awk '/^  [a-z-]+:$/{svc=$0} /ports:/{print svc, NR}' infra/prod/docker-compose.yml
grep -n "postgres|Postgres|PG1[0-9]" runbooks/db-outage.md
```

Did NOT: connect to the live box, read `/etc/letsencrypt`, inspect actual file permissions on the box, run `pnpm audit`, run docker/compose, or touch anything outside `/Users/mayurkulkarni/Downloads/crm2`.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Docker — multi-stage build | PASS | `infra/Dockerfile.web:8-23` has `AS build` → `AS runtime` (nginx) stages; copies only `dist` out. `infra/Dockerfile.api:10-37` is single-stage (`FROM node:24-bookworm-slim AS runtime`, no separate build stage) | API image is intentionally single-stage by design (runs via `tsx` against TS source, not compiled `dist`, per comment `Dockerfile.api:5-8`) — not a defect, just worth noting it's not "multi-stage" in the classic sense |
| Docker — non-root USER | FAIL | `grep -n "^USER"` on both Dockerfiles returned **zero matches** | See INFRASTRUCTURE-01 |
| Docker — minimal base image | PASS | `infra/Dockerfile.api:10` `node:24-bookworm-slim`; `infra/Dockerfile.web:8` `node:24-bookworm-slim` (build) → `infra/Dockerfile.web:20` `nginx:1.27-alpine` (runtime) — slim/alpine variants used throughout | API image additionally installs `chromium fonts-liberation fonts-noto-core ca-certificates tini wget` (`Dockerfile.api:16-18`) for Puppeteer PDF rendering — necessary bloat, not minimal, but justified and `apt-get clean`'d (`rm -rf /var/lib/apt/lists/*`) |
| Docker — no secrets baked into layers | PASS | `infra/Dockerfile.api:7-8` comment: "Image stays environment-neutral: ALL config arrives at runtime via env_file (no secrets baked)"; no `ARG`/`ENV` lines in either Dockerfile set credential-shaped values — only `PUPPETEER_*`, `TZ` (api) and none (web). `docker-compose.yml:113-116` confirms secrets arrive via `env_file` + Docker `secrets:` at runtime, not build time | Verified by reading both full Dockerfiles line-by-line; no `COPY .env*` or credential `ARG` present |
| Compose — mem_limit set per service | PARTIAL/PASS (4 of 4 long-running services) | `infra/prod/docker-compose.yml:36` `db` 4g, `:54` `minio` 1g, `:125` `api` 2g, `:148` `edge` 256m. `migrate` (one-shot, `:73-91`) and `minio-init` (one-shot, `:56-68`) have no `mem_limit` | One-shot init/migrate containers lacking a limit is low-risk (they run-and-exit) but technically incomplete coverage — see INFRASTRUCTURE-05 |
| Compose — healthchecks present | PASS | `db:30-35`, `minio:48-53`, `api:117-122`, `edge:142-147` all have `healthcheck:` blocks; `api`/`edge` further gate via `depends_on: condition: service_healthy` (`:97-103`, `:132-134`) | `migrate` has no healthcheck but is `restart: 'no'` one-shot gated by `condition: service_completed_successfully` downstream (`:102-103`) — appropriate pattern for a one-shot, not a gap |
| Compose — secrets via Docker `secrets:` for Firebase + `env_file` for the rest | PASS | `docker-compose.yml:170-172` `secrets: firebase-service-account: file: ${FIREBASE_SECRET_FILE:-/opt/crm2/secrets/firebase-service-account.json}`; mounted into `api` via `secrets: [firebase-service-account]` (`:115-116`) → readable at `/run/secrets/firebase-service-account` (`:112`). All other config via `env_file: - ${ENV_FILE:-/opt/crm2/secrets/.env.prod}` (`:113-114`) | Matches the documented pattern exactly |
| Compose — only 80/443 published to host | PASS | `awk` scan of every `ports:` block in `infra/prod/docker-compose.yml` found exactly one service with a `ports:` key: `edge` at line 135, mapping `'80:80'` and `'443:443'` (`:136-137`). `db`, `minio`, `minio-init`, `migrate`, `api` have **no** `ports:` key — reachable only over the compose-internal network | Confirmed by direct read of `:17-172` plus the awk scan; `minio` (`:38-54`) and `db` (`:17-36`) are NOT exposed to the host in prod (unlike the local dev `docker-compose.yml:31-77` which does publish `54329`, `5433`, `9000`, `9001` — dev-only, by design, not a prod issue) |
| Nginx — TLS protocols restricted to 1.2/1.3 | PASS | `infra/prod/nginx.conf:44` `ssl_protocols TLSv1.2 TLSv1.3;` | No `ssl_ciphers` directive set — relies on nginx/OpenSSL build defaults. Not flagged as FAIL since TLSv1.2/1.3 default cipher suites in modern OpenSSL are reasonable, but see INFRASTRUCTURE-04 |
| Nginx — security headers present | FAIL | `grep -n -i "add_header"` over the full file (`infra/prod/nginx.conf`) returns only `Content-Type: text/plain` (lines 30, 65) and `Cache-Control` (lines 116, 121) — **no** `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Referrer-Policy`, or `Permissions-Policy` anywhere in the file | Confirms the architecture-inventory baseline's implicit gap and the audit prompt's own pointer to "Audit 10" findings (no `docs/audit/10-*.md` exists yet in this run — `ls docs/audit` shows only 01/05/06/07/08). See INFRASTRUCTURE-02 |
| Nginx — gzip not creating a BREACH-style compression oracle on token-bearing responses | PASS | `infra/prod/nginx.conf:48-55`: `gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss application/atom+xml image/svg+xml;` compresses static/JSON content types globally (including `application/json`, which covers API JSON responses proxied through `/api/`). However, the access/refresh token delivery mechanism is httpOnly cookie + JWT response body field (per `docs/architecture-inventory.md` §8), not a reflected/attacker-influenced secret-in-response pattern that BREACH requires (BREACH needs attacker-controlled input echoed alongside the secret in the same compressed response, e.g. a CSRF token reflected next to user input) | This is a real exposure class to be aware of (gzip is enabled for `application/json` proxied responses, and nginx does not exempt `/api/` from gzip), but no concrete BREACH-exploitable pattern (secret + attacker-reflected input in one gzip'd response) was found in the routes reviewed in this audit's scope. Flagged as Informational — see INFRASTRUCTURE-06 |
| Firewall | NOT VERIFIED | `find . -iname "*cron*" -o -iname "*timer*"` and repo-wide search found no `ufw`/`iptables`/cloud-security-group/IaC files anywhere in this repo | Matches the prompt's expected honest answer — firewall rules are a box-level config not tracked in this repo |
| SSH | NOT VERIFIED (config) / PASS (key handling in CI) | `.github/workflows/deploy.yml:108-141`: SSH access is via `webfactory/ssh-agent` with `secrets.PRODUCTION_SSH_KEY`, host pinned via `secrets.KNOWN_HOSTS_PIN` written to `~/.ssh/known_hosts` with `chmod 600` (`:115-118`), and `StrictHostKeyChecking=accept-new` (`:131`) — not `=no`. No SSH daemon config (`sshd_config`), no box-level SSH hardening (e.g. `PasswordAuthentication no`) is present in this repo to verify | The CI-side SSH usage is sound (pinned host key, dedicated deploy key, file mode 600 on known_hosts). The box's actual `sshd_config` is outside repo scope — NOT VERIFIED, not guessed |
| Secrets handling | PASS (documented requirement) / NOT VERIFIED (enforced in practice) | `.env.prod.example:1-8` documents the real file lives at `/opt/crm2/secrets/.env.prod`, "mode 600", never committed; `docker-compose.yml:11-12` repeats "mode 600, never committed"; `.dockerignore:1-18` excludes `.env`, `.env.*`, `**/secrets` from the build context; `.gitleaks.toml` exists at repo root for CI secret-scanning | The actual live file permission on `/opt/crm2/secrets/.env.prod` on the production box cannot be verified from static repo inspection — explicitly NOT VERIFIED for "enforced in practice", PASS only for "documented as a requirement" |
| Certificates — TLS cert source | PASS | `infra/prod/nginx.conf:42-43` mounts `/etc/letsencrypt/live/crm.allcheckservices.com/{fullchain,privkey}.pem`; `docker-compose.yml:140` mounts `/etc/letsencrypt:/etc/letsencrypt:ro` (read-only) into `edge`; `deploy.sh:34` precondition-checks the cert file exists before deploying | Cert mount is read-only — correct hardening for the runtime container |
| Certificates — renewal mechanism | NOT VERIFIED | `grep -rn -i certbot` across `*.sh/*.yml/*.yaml/*.conf/*.md` found only the ACME challenge **serving** path (`nginx.conf:26`, webroot volume `docker-compose.yml:141,166-167`) and documentation mentions (`architecture-inventory.md:97,138`) — **no** certbot renew invocation, cron entry, or systemd timer file exists anywhere in this repo | The HTTP-01 challenge location is wired (so a renewal *could* succeed if certbot is invoked), but the actual renewal trigger (cron/systemd timer/manual) lives on the box, outside this repo. Worth flagging as an operational risk if truly absent — see INFRASTRUCTURE-03 |
| File permissions — secrets file mode | PASS (documented) / NOT VERIFIED (live) | Same as "Secrets handling" row above — `.env.prod.example:3` and `docker-compose.yml:11` both state mode 600 as the requirement | Cannot inspect actual `ls -l` output on the production box from this repo |
| Container hardening — non-root | FAIL | Same evidence as "Docker — non-root USER" row | See INFRASTRUCTURE-01 |
| Container hardening — capabilities (cap_drop) | FAIL | `grep -n "cap_drop|cap_add"` over `infra/prod/docker-compose.yml` returned no matches | See INFRASTRUCTURE-01 (bundled — same root cause: no container-hardening directives used anywhere in the compose file) |
| Container hardening — read-only root filesystem | FAIL | `grep -n "read_only"` over `infra/prod/docker-compose.yml` returned no matches | See INFRASTRUCTURE-01 |
| Container hardening — no-new-privileges | FAIL | `grep -n "no-new-privileges|security_opt"` over `infra/prod/docker-compose.yml` returned no matches | See INFRASTRUCTURE-01 |
| Health checks | PASS | See "Compose — healthchecks present" row above; additionally `api` healthcheck hits the real `/api/v2/health` endpoint (`docker-compose.yml:118`) and `edge` hits `/_edge_health` (`:143`), both backed by real nginx/app routes (`nginx.conf:28-31,63-66`), not stubs | `deploy.sh:60-69` also re-verifies both endpoints externally over HTTPS post-deploy before declaring GREEN — defense in depth beyond the container-level healthcheck |
| Resource limits — memory | PASS (mostly) | See "mem_limit" row above — 4 of 6 services have `mem_limit`; `migrate` and `minio-init` (one-shot, short-lived) do not | See INFRASTRUCTURE-05 (Low severity) |
| Resource limits — CPU | FAIL | `grep -c "cpus:"` over `infra/prod/docker-compose.yml` → `0` (zero matches across the entire file) | See INFRASTRUCTURE-05 |
| Disk management | PASS | `deploy.sh:73-78`: `docker image prune -af --filter "until=72h"` runs after every successful (GREEN) deploy, with an explanatory comment citing the 2026-06-26 disk-full incident | Confirmed via direct read of `deploy.sh`; this is a real, already-shipped fix for a real prior incident, not aspirational |
| Rollback mechanism | PASS | `deploy.sh:49-51` captures `PREV_TAG` from the currently running `crm2_api` container before pulling; `:83-91` on RED rolls `api`+`edge` back to `PREV_TAG` via `dc up -d --no-deps api edge` and exits non-zero | `db`/`minio` are explicitly never rolled back (named volumes, stable singletons per header comment `:10`) — correct scope for a stateless-tier rollback |

## Findings

### INFRASTRUCTURE-01
- **Category:** Container Hardening
- **Severity:** Medium
- **CVSS:** 5.9 / CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L (container-escape primitive given an existing RCE; not directly remotely exploitable on its own)
- **OWASP Mapping:** A05:2021 – Security Misconfiguration
- **CWE Mapping:** CWE-250 (Execution with Unnecessary Privileges)
- **Location**
  - **File:** infra/Dockerfile.api
  - **Line Number:** 10-37 (no `USER` directive anywhere in the file)
  - **File:** infra/Dockerfile.web
  - **Line Number:** 8-23 (no `USER` directive anywhere in the file)
  - **File:** infra/prod/docker-compose.yml
  - **Line Number:** 92-148 (`api` and `edge` service definitions — no `cap_drop`, `read_only`, or `security_opt: no-new-privileges` on any service)
- **Evidence:**
```
$ grep -n "^USER" infra/Dockerfile.api infra/Dockerfile.web
(no output — zero matches)

$ grep -n "cap_drop|cap_add|read_only|no-new-privileges|security_opt|privileged" infra/prod/docker-compose.yml
(no output — zero matches)
```
  `infra/Dockerfile.api:33-37`:
  ```
  WORKDIR /app/apps/api
  EXPOSE 4000
  ENTRYPOINT ["/usr/bin/tini", "--"]
  CMD ["pnpm", "exec", "tsx", "src/main.ts"]
  ```
  No `USER` switch before this `CMD` — the process runs as `root` (the implicit default for `node:24-bookworm-slim` unless explicitly changed).
- **Why it is a problem:** Both the `api` container (which parses untrusted uploads via `multer`, renders untrusted HTML→PDF via `puppeteer`/`chromium`, and processes user-supplied images via `sharp`) and the `edge` container (nginx, terminating TLS and serving the SPA) run their main process as root. If any of the several attack-surface-heavy libraries in the `api` image (Puppeteer/Chromium PDF rendering from user-influenced HTML, `sharp` image processing, `exceljs`/`docx` parsing) is ever exploited for code execution, the attacker lands as root inside the container — maximizing the blast radius for container-breakout primitives (writable `/proc`, ability to install packages, full filesystem access within the container) compared to a dropped-privilege user.
- **Real world attack scenario:** A crafted XLSX/DOCX import (the CRM has bulk case import features per repo memory) or a malicious field-report HTML template that reaches the Puppeteer PDF-render path triggers a Chromium sandbox-escape or a `sharp`/libvips memory-corruption CVE. Running as root inside the container removes one layer of containment that would otherwise limit a successful exploit to a low-privilege user, making any subsequent container-escape attempt (e.g. via a misconfigured Docker socket mount, kernel CVE, or capability misuse) more consequential. This directly affects a system storing client/KYC/PII data and commission/billing records.
- **Business impact:** Increases the severity ceiling of any future RCE in the api/edge containers from "compromised low-priv process" to "compromised root process," widening the path to broader infrastructure compromise (other secrets on the box, lateral movement) in a worst-case chained exploit. No known active exploit today — this is a defense-in-depth gap, not an active breach.
- **Recommended fix:** Add a non-root `USER` to both Dockerfiles (e.g. `RUN useradd -r -u 1001 -g node appuser` + `USER appuser` in `Dockerfile.api` before the final `CMD`; nginx's official alpine image already ships an `nginx` user — switch to it or use `nginx-unprivileged` base for `Dockerfile.web`). Add `security_opt: ["no-new-privileges:true"]` to every service in `infra/prod/docker-compose.yml`, and evaluate `cap_drop: [ALL]` + selective `cap_add` for `api`/`edge` (note: `tini`/`puppeteer`/Chromium sandboxing may need `SYS_ADMIN` or `--no-sandbox`; this needs to be tested, not assumed risk-free, before shipping).
- **Estimated effort:** M (requires testing that Chromium/Puppeteer and nginx still function correctly as non-root, and validating file-permission ownership for any volumes the containers write to)
- **Priority:** P2
- **Status:** OPEN

### INFRASTRUCTURE-02
- **Category:** Security Headers
- **Severity:** Medium
- **CVSS:** 4.3 / CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N
- **OWASP Mapping:** A05:2021 – Security Misconfiguration
- **CWE Mapping:** CWE-1021 (Improper Restriction of Rendered UI Layers, via missing X-Frame-Options/CSP frame-ancestors), CWE-319 (related: missing HSTS allows protocol-downgrade exposure on first visit)
- **Location**
  - **File:** infra/prod/nginx.conf
  - **Line Number:** 36-126 (the entire HTTPS `server {}` block — no `add_header` for any standard security header)
- **Evidence:**
```
$ grep -n -i "add_header" infra/prod/nginx.conf
30:        add_header Content-Type text/plain;
65:        add_header Content-Type text/plain;
116:        add_header Cache-Control "public, immutable";
121:        add_header Cache-Control "no-cache, no-store, must-revalidate";
```
  No `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Referrer-Policy`, or `Permissions-Policy` header is set anywhere in the file.
- **Why it is a problem:** The edge nginx config terminates TLS and serves both the SPA and proxies `/api/`, `/socket.io/`, and `/crm2-prod/` (MinIO), but emits none of the standard defense-in-depth response headers. Concretely: no HSTS means a user's first HTTP request (before the 301 redirect at `nginx.conf:33`) is plaintext and vulnerable to SSL-stripping on a hostile network; no `X-Frame-Options`/CSP `frame-ancestors` means the SPA (which handles login, case/KYC/PII data, and commission/billing data) can be framed by another origin for clickjacking; no `X-Content-Type-Options: nosniff` allows MIME-sniffing-based attacks on uploaded content served back to users.
- **Real world attack scenario:** An attacker registers a lookalike domain, frames `https://crm.allcheckservices.com/` inside an invisible iframe with overlaid UI elements (clickjacking), and tricks an authenticated field-agent or backend-user into clicking through to perform an action (e.g. approve a case, trigger an export) while believing they're interacting with the attacker's page. Separately, a user on public wifi who types `crm.allcheckservices.com` (no `https://` prefix) sends their first request in plaintext; without HSTS, a MITM can intercept that first request and downgrade-attack the session before the 301 redirect takes effect.
- **Business impact:** Increases susceptibility to clickjacking and SSL-stripping against a CRM handling client PII, KYC verification data, and commission/billing figures — reputational and potential regulatory exposure if exploited against an admin/backend account with broad RBAC permissions.
- **Recommended fix:** Add to the `server { listen 443 ... }` block in `nginx.conf`: `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`, `add_header X-Content-Type-Options "nosniff" always;`, `add_header X-Frame-Options "DENY" always;` (or a CSP `frame-ancestors 'none'`), `add_header Referrer-Policy "strict-origin-when-cross-origin" always;`, and a scoped `Content-Security-Policy` (needs careful construction given inline scripts/styles used by the SPA build — should be tested, not copy-pasted blindly).
- **Estimated effort:** S (header additions) to M (if CSP requires SPA build adjustments to avoid breaking inline styles/scripts)
- **Priority:** P1
- **Status:** OPEN

### INFRASTRUCTURE-03
- **Category:** Certificate Management
- **Severity:** Medium
- **CVSS:** N/A (operational/availability risk, not directly exploitable)
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-298 (Improper Validation of Certificate Expiration) — applies if renewal silently fails to occur
- **Location**
  - **File:** infra/prod/nginx.conf
  - **Line Number:** 26 (ACME challenge serving location — the renewal-serving half exists)
  - **File:** infra/prod/deploy.sh
  - **Line Number:** 34 (precondition check that the cert file exists — but nothing in this repo *renews* it)
- **Evidence:**
```
$ grep -rn -i "certbot" --include="*.sh" --include="*.yml" --include="*.yaml" --include="*.conf" --include="*.md" .
./infra/prod/docker-compose.yml:141:      - certbot_webroot:/var/www/certbot
./infra/prod/docker-compose.yml:166:  certbot_webroot:
./infra/prod/docker-compose.yml:167:    name: crm2_certbot_webroot
./infra/prod/nginx.conf:26:    location /.well-known/acme-challenge/ { root /var/www/certbot; }
./docs/architecture-inventory.md:97: SSL provider | **Let's Encrypt** (certbot)...
./docs/architecture-inventory.md:138: **Let's Encrypt** — TLS certificates (via certbot, external CA)
./docs/engineering/MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md:54: ...so ~60–90-day LE renewals don't re-brick the field APK.

$ find . -iname "*cron*" -o -iname "*timer*"
(no output — zero matches anywhere in the repo)
```
- **Why it is a problem:** The repo wires the *serving* half of ACME HTTP-01 (the `/.well-known/acme-challenge/` location and the `certbot_webroot` named volume that a certbot container/process would write challenge files into), but contains no certbot invocation, no renewal cron entry, no systemd timer unit, and no `docker-compose` certbot service anywhere. Let's Encrypt certs expire every 90 days. If the actual renewal mechanism lives purely as ad-hoc manual commands or an undocumented box-level cron job outside this repo, that is a single point of failure with no infrastructure-as-code record, peer review, or audit trail — and the next operator (or this audit) has no way to verify it exists or works.
- **Real world attack scenario:** Not directly an attacker-exploitable vulnerability, but an availability/trust risk: if the renewal mechanism is undocumented and the person who set it up leaves or forgets, the cert silently expires, browsers show hard TLS errors to all users (clients, field agents, KYC verifiers) hitting `crm.allcheckservices.com`, and the mobile app (per `docs/engineering/MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md:54`, which explicitly worries about "~60–90-day LE renewals don't re-brick the field APK") may hard-fail certificate validation/pinning checks, taking the entire field workforce offline.
- **Business impact:** A missed renewal is a full-outage event (web + mobile) for a production CRM with no compensating IaC record in this repo to catch the gap in advance.
- **Recommended fix:** Add a certbot renewal mechanism as version-controlled infra (e.g. a `infra/prod/certbot-renew.timer`/`.service` systemd unit pair, or a renewal step folded into `deploy.sh`/a separate scheduled script) so the renewal trigger is auditable from the repo, not just tribal knowledge on the box. At minimum, document in `runbooks/` (none of the 8 existing runbooks cover TLS/cert expiry) exactly where/how renewal is configured on the box today.
- **Estimated effort:** S (if a renewal mechanism already exists on the box and just needs documenting) to M (if it needs to be built)
- **Priority:** P2
- **Status:** OPEN

### INFRASTRUCTURE-04
- **Category:** TLS Configuration
- **Severity:** Low
- **CVSS:** 3.1 / CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N
- **OWASP Mapping:** A02:2021 – Cryptographic Failures
- **CWE Mapping:** CWE-327 (Use of a Broken or Risky Cryptographic Algorithm) — only if the underlying OpenSSL default cipher list includes weaker suites
- **Location**
  - **File:** infra/prod/nginx.conf
  - **Line Number:** 44-46
- **Evidence:**
```
44:    ssl_protocols TLSv1.2 TLSv1.3;
45:    ssl_session_cache shared:SSL:10m;
46:    ssl_session_timeout 10m;
```
  No `ssl_ciphers`, `ssl_prefer_server_ciphers`, or `ssl_dhparam` directive is present anywhere in the file.
- **Why it is a problem:** Restricting to TLSv1.2/1.3 is correct and is explicitly verified PASS, but the cipher suite selection is left entirely to the nginx/OpenSSL build defaults rather than an explicit allowlist. Default cipher lists on most distro OpenSSL builds are reasonable today, but they can silently include weaker suites (e.g. certain TLS 1.2 CBC-mode ciphers without AEAD) depending on the OpenSSL version baked into the nginx image, and the config has no `ssl_dhparam` to control DHE group strength if DHE suites are negotiated.
- **Real world attack scenario:** Without an explicit modern-cipher allowlist, a downgrade to a weaker-but-still-TLSv1.2-compliant cipher suite (depending on what the base image's OpenSSL offers) is theoretically possible against a client that doesn't itself enforce strong suites — low practical risk against modern browsers/mobile TLS stacks, but not verifiable as hardened from this config alone.
- **Business impact:** Low — modern clients (browsers, the mobile app's TLS stack) negotiate strong suites regardless; this is a defense-in-depth gap rather than a demonstrated weakness.
- **Recommended fix:** Add an explicit modern cipher suite list (e.g. Mozilla's "Intermediate" or "Modern" config generator output) via `ssl_ciphers` + `ssl_prefer_server_ciphers on;` to `nginx.conf`'s `server { listen 443 }` block, and verify with `nmap --script ssl-enum-ciphers` or `testssl.sh` against the live box (cannot be done from this static audit).
- **Estimated effort:** S
- **Priority:** P3
- **Status:** OPEN

### INFRASTRUCTURE-05
- **Category:** Resource Limits
- **Severity:** Low
- **CVSS:** N/A (availability/DoS-adjacent operational gap, not directly exploitable)
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-770 (Allocation of Resources Without Limits or Throttling)
- **Location**
  - **File:** infra/prod/docker-compose.yml
  - **Line Number:** 56-91 (`minio-init` and `migrate` services — no `mem_limit`); entire file (no service has a `cpus:` limit)
- **Evidence:**
```
$ grep -c "cpus:" infra/prod/docker-compose.yml
0

$ grep -n "mem_limit" infra/prod/docker-compose.yml
36:    mem_limit: 4g
54:    mem_limit: 1g
125:    mem_limit: 2g
148:    mem_limit: 256m
```
  (4 matches — `db`, `minio`, `api`, `edge`; `migrate` and `minio-init` have none; no service anywhere has a `cpus:` directive.)
- **Why it is a problem:** Memory limits are set for the 4 long-running services (good — confirmed PASS above), but the two one-shot init/migrate containers have no cap, and **no service in the file has a CPU limit**, single VPS box. A runaway process (e.g. a pathological migration, or — more relevant under load — Puppeteer/Chromium PDF rendering or `sharp` image processing spiking CPU inside `api`) has no cgroup CPU ceiling and can starve sibling containers (notably `db`) of CPU time on a single-box deployment with no orchestrator-level scheduling fairness beyond the kernel's default CFS sharing.
- **Real world attack scenario:** Not directly attacker-triggered, but a burst of legitimate concurrent PDF report generations or bulk photo-overlay processing (both CPU-heavy paths confirmed in `docs/architecture-inventory.md` §2 — `puppeteer`, `sharp`) could degrade `db` query latency for all concurrent users (field agents submitting cases, KYC verifiers reviewing) since nothing prevents `api` from consuming all available CPU on the box.
- **Business impact:** Potential noisy-neighbor degradation under load spikes (report generation, bulk import/export) affecting case/KYC turnaround times for all users on the single-box deployment; not a security breach.
- **Recommended fix:** Add `cpus:` limits to `api` (the most CPU-variable service) and at minimum `db` (to guarantee a floor) in `infra/prod/docker-compose.yml`; add a `mem_limit` to `migrate` and `minio-init` for completeness even though they're short-lived.
- **Estimated effort:** S
- **Priority:** P3
- **Status:** OPEN

### INFRASTRUCTURE-06
- **Category:** Compression / Information Disclosure
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** A05:2021 – Security Misconfiguration
- **CWE Mapping:** CWE-524 (Use of Cache Containing Sensitive Information, related class) — BREACH is technically CWE-310-adjacent (Cryptographic Issues)
- **Location**
  - **File:** infra/prod/nginx.conf
  - **Line Number:** 48-55, 69-84
- **Evidence:**
```
48:    gzip on;
49:    gzip_vary on;
50:    gzip_comp_level 6;
51:    gzip_min_length 1024;
52:    gzip_proxied any;
53:    gzip_types text/plain text/css text/xml text/javascript
54:               application/javascript application/json
55:               application/xml+rss application/atom+xml image/svg+xml;
...
69:    location /api/ {
...
74:        proxy_pass http://api:4000;
```
  `gzip_types` includes `application/json`, and the `/api/` location block (which proxies all `application/json` API responses) has no gzip exemption.
- **Why it is a problem:** This is flagged Informational rather than a FAIL because BREACH requires a specific exploitable pattern (a secret token reflected in the same gzip'd response body alongside attacker-controlled, attacker-observable input, with the attacker able to make repeated requests and measure compressed response size) — no such concrete reflected-secret endpoint was identified within this audit's scope of the infra/edge config alone (would require an application-layer route audit, out of scope here — the API route handlers themselves are audited elsewhere, not in this Infrastructure audit). Still, enabling gzip globally for `application/json` API responses without per-route exemption is a config-level precondition that an app-layer finding elsewhere could combine with.
- **Real world attack scenario:** N/A at the infra-config level alone — would require a specific application route audit finding (e.g. a CSRF-token-echoing endpoint) to become concretely exploitable. Documented here so a cross-reference exists if such a route is found in another audit (e.g. the CSRF or authentication audits already present at `docs/audit/06-csrf.md`, `docs/audit/01-authentication.md`).
- **Business impact:** None demonstrated; purely a precondition worth tracking.
- **Recommended fix:** No change required unless a future app-layer audit identifies a specific reflected-secret response; if one is found, exempt that route from gzip (`gzip off;` in a more specific `location` block) rather than disabling gzip globally.
- **Estimated effort:** N/A (no action needed unless paired finding emerges)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 2 |
| Informational | 1 |

**Overall verdict: PARTIAL.**

The deployment topology itself is well-engineered for a single-VPS setup: ports are correctly minimized (only `edge` publishes 80/443; `db`/`minio`/`api` are unreachable from outside the compose network), secrets flow only through `env_file` + Docker `secrets:` (never baked into images), healthchecks gate every dependent service with a real blue-green + automatic-rollback deploy script that re-verifies externally over HTTPS before declaring success, and a previously-incident disk-full bug has a shipped, evidenced fix (`deploy.sh:73-78`). Two real Medium-severity gaps keep this from a clean PASS: container hardening is essentially absent (no non-root `USER` in either Dockerfile, no `cap_drop`/`read_only`/`no-new-privileges` anywhere in the compose file), and the edge nginx config emits zero standard security response headers (no HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) — both fixable in isolation without touching the frozen architecture. Certificate renewal could not be confirmed to exist anywhere in this repo as code (only the ACME-challenge-serving half is wired), and CPU resource limits are entirely absent — both lower-severity but real gaps. SSH hardening and firewall configuration are correctly NOT VERIFIED (genuinely outside this repo's scope, not guessed at).
