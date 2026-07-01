# AUDIT 12: Redis / Cache

## Scope

Static, read-only inspection of every Redis/Valkey-related file and call site in `/Users/mayurkulkarni/Downloads/crm2`. No live Redis/Valkey/Postgres connection was made; no command that mutates the repo or any external system was run.

Files inspected:
- `docs/architecture-inventory.md` (baseline, §4 Cache)
- `infra/prod/docker-compose.yml` (prod compose, incl. the commented-out `valkey` service)
- `docker-compose.yml` (dev compose, active `valkey` service)
- `packages/config/src/index.ts` (env schema — `REDIS_QUEUE_URL`, `REDIS_CACHE_URL`)
- `apps/api/src/platform/jobs/index.ts` (BullMQ queue/worker wiring)
- `apps/api/src/platform/realtime/index.ts` (socket.io + `@socket.io/redis-adapter` wiring)
- `apps/api/src/platform/tokenRevocation/index.ts` (in-process revocation cache — confirmed NOT Redis-backed)
- `apps/api/src/http/rateLimit.ts` (rate-limit store — confirmed in-memory, not Redis-backed)
- `apps/api/.env.example`, `infra/prod/.env.prod.example` (env documentation for the Redis vars)
- `runbooks/redis-outage.md`
- `docs/operations/OPERATIONS_GUIDE.md` (health-check claims)
- `apps/api/src/http/app.ts` (actual `/api/v2/health` route)
- `apps/api/src/modules/system/{routes,controller,service}.ts` (the gated `/system/health` diagnostics endpoint)

Commands run (all read-only):
```
grep -n -i "redis\|valkey" packages/config/src/index.ts
grep -rln "REDIS_QUEUE_URL|REDIS_CACHE_URL|ioredis|bullmq|BullMQ|redis-adapter" apps packages   (excluding node_modules/dist)
grep -rln "node-cache|NodeCache|lru-cache|memory-cache|cache-manager" apps packages
grep -n "valkey" infra/prod/docker-compose.yml docker-compose.yml
grep -rn "valkey-queue|valkey-cache" --include="*.yml" --include="*.ts" --include="*.md"
grep -rn "maxmemory" --include="*.yml" --include="*.ts"
grep -n "mem_limit" infra/prod/docker-compose.yml
grep -n "api/v2/health|'/health'" apps/api/src/http/app.ts
```

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Authentication | NOT VERIFIED (current prod) / FAIL (forward-looking dev config) | Prod: `infra/prod/docker-compose.yml` lines 151-157, `valkey` service entirely commented out — no instance is running, so live auth posture cannot be exercised. Forward-looking prod template DOES set a password: line 155 `command: ["valkey-server","--requirepass","${VALKEY_PASSWORD}", ...]`. Dev: `docker-compose.yml` lines 103-113, the **active** dev `valkey` service has no `command:` override at all — no `--requirepass`, default Valkey config (no auth) | Prod-template auth design is sound (requirepass); dev compose runs Valkey with zero authentication, reachable on host port 6380 (`docker-compose.yml:108`) |
| TLS | FAIL (forward-looking config, both dev and prod) | `infra/prod/.env.prod.example:45-46`: `REDIS_QUEUE_URL=redis://:__pw__@valkey:6379` / `REDIS_CACHE_URL=redis://:__pw__@valkey:6379` — scheme is `redis://`, not `rediss://`. `apps/api/.env.example:24-25`: `redis://127.0.0.1:6380` for dev. Code DOES support TLS conditionally: `apps/api/src/platform/jobs/index.ts:137` `...(u.protocol === 'rediss:' ? { tls: {} } : {})`, and `ioredis`'s `Redis(url, ...)` constructor in `apps/api/src/platform/realtime/index.ts:115` natively honors a `rediss://` scheme — but no example/template anywhere in the repo uses it, and the prod docker network path (`api` container → `valkey` container) is unencrypted Docker-bridge traffic | The capability exists in code (BullMQ `connectionOpts`), but every documented/example deployment config in this repo configures plaintext `redis://`, including the prod template. Since both containers sit on the same Docker bridge network on a single VPS, this is a defense-in-depth gap rather than an exploitable-today issue |
| Memory limits | FAIL (forward-looking config) | `infra/prod/docker-compose.yml` lines 151-157 (commented valkey block) has no `mem_limit:` key, unlike every other service in the same file (`mem_limit: 4g` line 36 for db, `1g` line 54 for minio, `2g` line 125 for api, `256m` line 148 for edge). Dev `docker-compose.yml:103-113` also has no `mem_limit`. Redis-level `maxmemory` is likewise never set (only `--maxmemory-policy noeviction` is set, with no memory ceiling alongside it) | `noeviction` + no `maxmemory` ceiling + no Docker `mem_limit` is an unbounded-growth configuration: under `noeviction` Valkey will keep accepting writes until it runs out of host RAM (then OOM, or the kernel OOM-killer kills the container) rather than ever capping itself |
| Eviction policy | PASS (forward-looking config, queue role) / NOT VERIFIED (no separate cache role exists) | `infra/prod/docker-compose.yml:155`: `--maxmemory-policy noeviction` — correct policy for a BullMQ queue (job data must never be silently evicted). `runbooks/redis-outage.md` and `docs/operations/OPERATIONS_GUIDE.md:55` describe a second, separate `valkey-cache` node intended to run `allkeys-lru`/`volatile-lru`, but no such second service, second compose entry, or second `REDIS_*_URL` exists anywhere in the repo — `REDIS_QUEUE_URL` and `REDIS_CACHE_URL` are documented in `.env.prod.example:45-46` as pointing at the **same single** `valkey:6379` host. The runbook's two-role topology does not match the actual single-instance config | This is a doc/reality mismatch, not a misconfigured eviction policy — see REDIS_CACHE-03 |
| Sensitive data in cache | PASS (no Redis-backed cache layer exists) | `grep -rln "node-cache\|NodeCache\|lru-cache\|memory-cache\|cache-manager"` across `apps/` and `packages/` → zero matches. `docs/architecture-inventory.md` §4: "No general-purpose app-data cache layer found." The only Redis/Valkey call sites are the BullMQ job queue (`apps/api/src/platform/jobs/index.ts`) and the socket.io pub/sub adapter (`apps/api/src/platform/realtime/index.ts`) — neither stores client/case/KYC/PII payloads as a cache; BullMQ job payloads (`q.add('run', { jobId, type, payload, userId }, ...)`, `apps/api/src/platform/jobs/index.ts:167-171`) do pass through whatever `payload` a job producer gives it (e.g. export/import job params), and `removeOnComplete: true` (same line) deletes the Redis key on success, `removeOnFail: 500` caps retained failed-job entries to 500 | Caveat: IF the out-of-process worker tier is ever turned on (`REDIS_QUEUE_URL` set) without `--requirepass` (as in the current dev compose default) or TLS, EXPORT/IMPORT job payloads (which can include case/client search filters) would transit/rest in Valkey in plaintext, reachable by anything on the Docker network. Today (queue unset in prod) this is moot |
| Session storage | PASS | `docs/architecture-inventory.md` §4 and §8 confirm stateless JWT; verified directly: `apps/api/src/platform/tokenRevocation/index.ts:23` uses a plain in-process `const cache = new Map<string, Entry>()` (5s TTL) for the access-token revocation cutoff — explicitly commented "cached in-process," not Redis. `apps/api/src/http/rateLimit.ts:8-10` confirms `express-rate-limit`'s default in-memory store, with a code comment (`rateLimit.ts:15-16`) noting the swap to `rate-limit-redis` is a known FUTURE change, not present today. No `connect-redis`, no Express `session` middleware, no Redis `SET`/`GET` call sites for session data found anywhere in `apps/api/src` | Confirms the architecture-inventory baseline — no session data, of any kind, currently lands in Redis/Valkey |
| Expiration | PASS (queue jobs) / N/A (no cache role in practice) | `apps/api/src/platform/jobs/index.ts:167-171`: `removeOnComplete: true, removeOnFail: 500` — completed BullMQ jobs are deleted from Valkey immediately; failed jobs are capped at the 500 most recent (bounded retention, not unbounded). No separate cache-role keys exist to evaluate TTL on (see Eviction-policy row) | |
| Cache poisoning | NOT VERIFIED / N/A | No read-through/write-through app cache exists to poison (confirmed above). The only “cache” surface that could be poisoned is the BullMQ job queue itself, which is keyed by internally-generated `jobId` (`apps/api/src/platform/jobs/index.ts:159-160`, `jobRepository.insert`) and is not addressable by external/user-controlled cache keys; socket.io's Redis adapter pub/sub channels are also internally named (`createAdapter(pubClient, subClient)`, `apps/api/src/platform/realtime/index.ts:119`), not user-keyed. No HTTP-cache-control / CDN layer was found (`docs/architecture-inventory.md` §6: "CDN: None found") so no CDN-cache-poisoning surface either | Genuinely not applicable given the absence of any key-addressable cache that takes attacker input as part of the key |

## Findings

### REDIS_CACHE-01
- **Category:** Cache / Infrastructure Hardening (forward-looking configuration)
- **Severity:** Low
- **CVSS:** 4.0 (CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N) — attack vector restricted to the internal Docker bridge network, not internet-reachable
- **OWASP Mapping:** A05:2021 – Security Misconfiguration
- **CWE Mapping:** CWE-319 (Cleartext Transmission of Sensitive Information), CWE-1188 (Insecure Default Initialization of Resource)
- **Location**
  - **File:** `docker-compose.yml`
  - **Line Number:** 103-113
- **Evidence:**
```yaml
  valkey:
    image: valkey/valkey:8-alpine
    container_name: crm2_valkey
    # Host 6380 (v1's crm_redis owns 6379) → REDIS_QUEUE_URL/REDIS_CACHE_URL use redis://127.0.0.1:6380.
    ports:
      - '6380:6379'
    healthcheck:
      test: ['CMD', 'valkey-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
```
No `command:` override (so no `--requirepass`, no `--maxmemory`, no `--maxmemory-policy`), and the port is published to the host (`6380:6379`), not just exposed on the internal Docker network.
- **Why it is a problem:** Any process on the developer's machine (or, if this compose file were ever reused for a shared/staging box, any host on the same network reachable to port 6380) can connect to this Valkey instance with zero authentication and run arbitrary commands (`FLUSHALL`, `CONFIG SET`, read all queue job payloads). It is also the template developers copy from when reasoning about the prod config.
- **Real world attack scenario:** A developer laptop with this `docker-compose.yml` running and port 6380 reachable on a shared/coffee-shop network (or a misconfigured cloud dev box with the port left open) lets anyone run `redis-cli -h <ip> -p 6380 keys '*'` and dump in-flight BullMQ job payloads — which, when the worker tier is exercised for testing, can include EXPORT/IMPORT job parameters containing client/case search filters. Low real-world severity since this is dev-only and not the live prod topology (prod's Valkey is fully commented out today).
- **Business impact:** Limited — dev-only exposure, not internet-facing, and the live prod box does not run Valkey at all today. Becomes relevant only if a developer's environment is more exposed than assumed, or if this same unauthenticated pattern gets carried into a future shared/staging deployment by copy-paste.
- **Recommended fix:** Add `command: ["valkey-server","--requirepass","${VALKEY_PASSWORD:-devonly}"]` to the dev `valkey` service for parity with the (already-correct) prod template, and prefer binding the published port to localhost only (`127.0.0.1:6380:6379`) rather than all interfaces.
- **Estimated effort:** S (few minutes)
- **Priority:** P3
- **Status:** OPEN

### REDIS_CACHE-02
- **Category:** Cache / Infrastructure Hardening (forward-looking configuration)
- **Severity:** Low
- **CVSS:** 3.7 (CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L) — denial-of-service surface only, network-adjacent
- **OWASP Mapping:** A05:2021 – Security Misconfiguration
- **CWE Mapping:** CWE-770 (Allocation of Resources Without Limits or Throttling)
- **Location**
  - **File:** `infra/prod/docker-compose.yml`
  - **Line Number:** 151-157 (commented-out future `valkey` service block)
- **Evidence:**
```yaml
  # valkey:
  #   image: valkey/valkey:8-alpine
  #   container_name: crm2_valkey
  #   restart: unless-stopped
  #   command: ["valkey-server","--requirepass","${VALKEY_PASSWORD}","--appendonly","yes","--maxmemory-policy","noeviction"]
  #   volumes: [valkeydata:/data]
  #   healthcheck: { test: ["CMD","valkey-cli","-a","${VALKEY_PASSWORD}","ping"], interval: 10s, timeout: 5s, retries: 5 }
```
Compare to every other prod service in the same file, all of which set an explicit `mem_limit` (`db` → `mem_limit: 4g` at line 36, `minio` → `mem_limit: 1g` at line 54, `api` → `mem_limit: 2g` at line 125, `edge` → `mem_limit: 256m` at line 148). The commented valkey block has neither a Docker `mem_limit:` nor a Redis-level `--maxmemory` flag.
- **Why it is a problem:** `--maxmemory-policy noeviction` is the correct choice for a job queue (never silently drop a job), but it is only safe paired with an explicit `--maxmemory` ceiling that is itself below the container's `mem_limit`. As currently drafted, when this block is eventually uncommented and shipped, Valkey will accept writes without any memory ceiling at either the Redis or Docker level, risking unconstrained host-memory growth (e.g. from a queue backlog) until the kernel OOM-killer intervenes — which, with `noeviction` and no `maxmemory`, manifests as a full container crash/data-loss event rather than the intended "OOM error returned to writers" backstop `noeviction` is supposed to provide.
- **Real world attack scenario:** Not externally triggerable today (queue unused in prod). If/when the worker tier goes live, a burst of EXPORT/IMPORT jobs (e.g. several large `IMPORT_JOB_MAX_ROWS`-sized files queued back-to-back by office staff) without a `maxmemory` ceiling could let queue memory grow until the single VPS — which also hosts Postgres and MinIO on the same box per `docs/architecture-inventory.md` §6 — runs out of RAM, which can cascade into the kind of disk/host outage this repo's own `runbooks/redis-outage.md` and the 2026-06-26 disk-full incident (project memory) warn about.
- **Business impact:** Medium if/when activated without fixing this first — single shared VPS, so a Valkey OOM event risks taking down Postgres/MinIO/API alongside it (same failure class as the prior prod disk-full incident).
- **Recommended fix:** Before uncommenting this block for real use, add `"--maxmemory","512mb"` (or a sized value) to the `command:` array and a matching `mem_limit: 768m` (headroom above maxmemory) on the service, mirroring the pattern already used for every other service in this file.
- **Estimated effort:** S (15 minutes, plus a sizing decision)
- **Priority:** P2 (must fix before this commented block is ever activated; no risk while it stays commented)
- **Status:** OPEN

### REDIS_CACHE-03
- **Category:** Documentation Accuracy / Operational Readiness
- **Severity:** Low
- **CVSS:** N/A (documentation defect, not a vulnerability)
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `runbooks/redis-outage.md` (whole file); `docs/operations/OPERATIONS_GUIDE.md`
  - **Line Number:** `runbooks/redis-outage.md:1-38`; `docs/operations/OPERATIONS_GUIDE.md:54-55`
- **Evidence:**
```
docs/operations/OPERATIONS_GUIDE.md:54: - Aggregate health: `curl -fsS https://<host>/api/v2/health` → `200` healthy.
docs/operations/OPERATIONS_GUIDE.md:55:   Reports per-dependency status (db, valkey-queue, valkey-cache, object-store).
```
versus the actual route:
```
apps/api/src/http/app.ts:102:  app.get('/api/v2/health', (_req, res) => res.json({ status: 'ok', success: true }));
```
and the actual gated diagnostics endpoint (`apps/api/src/modules/system/service.ts:30-60`), which reports only `database` (Postgres) and `push` (FCM) — no `valkey`/Redis key anywhere in its `SystemHealth` payload. Additionally, `runbooks/redis-outage.md` describes a two-node `valkey-queue`/`valkey-cache` topology throughout (e.g. line 8 `valkey-queue` or `valkey-cache` unhealthy`, line 17 separate `<queue-host>`/`<cache-host>`), but both `infra/prod/docker-compose.yml:151-157` and `docker-compose.yml:103-113` define only a single combined `valkey` service that both `REDIS_QUEUE_URL` and `REDIS_CACHE_URL` would point at (confirmed in `infra/prod/.env.prod.example:45-46`, both vars set to the identical `redis://:__pw__@valkey:6379`).
- **Why it is a problem:** An on-call engineer following `runbooks/redis-outage.md` during a real incident would look for two Valkey containers/hosts that do not exist, and would expect `/api/v2/health` to surface a Redis-down condition that it structurally cannot (the route returns a static `{status:'ok'}` with no dependency check at all — see `app.ts:102`). The gated `/api/v2/system/health` endpoint also never reports Valkey status even though it does report DB and push health.
- **Real world attack scenario:** N/A (operational/availability risk, not a security exploit) — but directly relevant to incident response speed if Valkey is ever activated and fails, e.g. during a queue backlog from a large KYC bulk-import job.
- **Business impact:** Low today (Valkey isn't running in prod, so the runbook is currently moot); becomes a real MTTR risk the day the out-of-process worker tier is turned on, since the runbook and health-check docs would actively mislead responders.
- **Recommended fix:** Either (a) update `runbooks/redis-outage.md` to describe the actual single-instance topology and drop the queue/cache-host split, and correct `OPERATIONS_GUIDE.md:55`'s health-check claim to match the real (DB+push-only) payload, or (b) if/when the worker tier ships, actually add a Valkey ping to `systemService.health()` so the docs become true. Either resolves the mismatch; (b) is preferable once Valkey is live.
- **Estimated effort:** S (docs-only fix) / M (if adding a real health probe)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Informational | 0 |

**Overall verdict: PARTIAL.**

Redis/Valkey is confirmed **not deployed in current production** (`infra/prod/docker-compose.yml:151-157` fully commented out, `REDIS_QUEUE_URL`/`REDIS_CACHE_URL` unset) — matching and confirming the architecture-inventory baseline via direct re-read. This makes most of the checklist (TLS, memory limits, eviction policy, authentication) **not exercisable against a live system** for prod today; those items were instead evaluated against the forward-looking commented config and the dev compose file, which is the only way to meaningfully audit infrastructure that is deliberately dormant. Findings there are real but low-severity (no auth/maxmemory in the dev valkey service; no `maxmemory` ceiling alongside `noeviction` in the prod template; `redis://` not `rediss://` in every example, though the code does support `rediss://` when supplied). The two checklist items that matter most for an *active* security posture — sensitive data in cache, and session storage — both genuinely PASS: there is no general-purpose app-data cache, sessions are stateless JWT with a Postgres-tracked refresh-token table, and the only two real Redis call sites (BullMQ queue, socket.io adapter) don't persist PII at rest beyond a transient, auto-expiring job-queue entry. A secondary, non-security finding (REDIS_CACHE-03) flags that `runbooks/redis-outage.md` and `docs/operations/OPERATIONS_GUIDE.md` describe a two-node valkey-queue/valkey-cache topology and a Redis-aware `/api/v2/health` endpoint that do not exist in the code — worth fixing before this dormant infrastructure is ever activated, since it would mislead an on-call responder.
