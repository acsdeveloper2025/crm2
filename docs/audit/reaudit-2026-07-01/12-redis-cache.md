# RE-AUDIT 12: Redis / Cache

Re-audited fresh against post-remediation HEAD `8ded432` (baseline `b19039e`). Read-only static inspection. No live Redis/Valkey/Postgres connection.

Files read: `docker-compose.yml`, `infra/prod/docker-compose.yml`, `runbooks/redis-outage.md`, `apps/api/src/http/app.ts`, `apps/api/src/platform/realtime/index.ts`, `apps/api/.env.example`, `docs/operations/OPERATIONS_GUIDE.md`, `docs/audit/12-redis-cache.md`, `docs/COMPLIANCE_GAPS_REGISTRY.md`.

## Fix Confirmations

| ID | Status | Evidence file:line |
|---|---|---|
| REDIS_CACHE-01 | CONFIRMED_FIXED | `docker-compose.yml:110` `command: ['valkey-server', '--requirepass', 'devonly-valkey-pw']`; `docker-compose.yml:112` port now `'127.0.0.1:6380:6379'` (was `'6380:6379'`); healthcheck at `:114` auths with `-a devonly-valkey-pw --no-auth-warning`. Loopback bind + dev-only password both present. |
| REDIS_CACHE-02 | CONFIRMED_FIXED | `infra/prod/docker-compose.yml:211` commented valkey `command` now includes `"--maxmemory","512mb"` (was absent); `:214` adds `mem_limit: 768m` + `cpus: '1'` + logging + `no-new-privileges`. Ceiling (512mb) sits below container mem_limit (768m) as recommended. Block remains commented/dormant — correct. |
| REDIS_CACHE-03 | PARTIALLY_FIXED | Runbook half done: `runbooks/redis-outage.md:10-16` now describes ONE combined `crm2_valkey` service + explicitly states `/api/v2/health` does NOT check Valkey (static stub) — matches `apps/api/src/http/app.ts:117` `res.json({ status: 'ok', success: true })` and `apps/api/src/platform/realtime/index.ts:109-119` (Redis adapter only when `REDIS_CACHE_URL` set). BUT the finding's own recommended-fix option (a) also required correcting `docs/operations/OPERATIONS_GUIDE.md:55`, which was **not touched** — see New Findings. |

## New Findings

### REDIS-REAUDIT-01 — OPERATIONS_GUIDE.md still asserts the phantom two-node topology + a Redis-aware health check
- **Severity:** Low
- **Classification:** PRE_EXISTING_MISSED (part of REDIS_CACHE-03's scope; the remediation fixed the runbook but left this file, so the finding is only partially closed)
- **File:line:** `docs/operations/OPERATIONS_GUIDE.md:36-37`, `:55`, `:58-59`
- **Evidence:** Line 36-37: "**Valkey queue** (`noeviction`) ... is separate from **Valkey cache** (`LRU` — disposable)." Line 55: "Aggregate health: `curl ... /api/v2/health` → `200` healthy. Reports per-dependency status (db, valkey-queue, valkey-cache, object-store)." Line 58-59: `redis-cli -h <queue-host> ... same for cache host`. `git log b19039e..8ded432 -- docs/operations/OPERATIONS_GUIDE.md` returns nothing — file untouched by remediation. These are the exact claims REDIS_CACHE-03 flagged: no two valkey nodes exist (`docker-compose.yml` has one combined `valkey`), and `/api/v2/health` reports NO per-dependency status (`apps/api/src/http/app.ts:117` returns a static `{status:'ok'}`).
- **Why it matters:** An on-call engineer following the OPERATIONS_GUIDE during a real incident is sent to look for two Valkey hosts that don't exist and told `/api/v2/health` surfaces a Redis-down condition it structurally cannot. The runbook rewrite fixed one of the two documents carrying this exact wrong mental model; the guide still propagates it. The compliance-registry entry (`docs/COMPLIANCE_GAPS_REGISTRY.md:1621`) describes the fix as only "rewrote the outage runbook," silently narrowing REDIS_CACHE-03's documented scope.
- **Recommended action:** Correct `OPERATIONS_GUIDE.md` §Architecture (36-37) and §Health (54-59) to the single-instance reality and to the actual DB+push-only health payload — same edit already applied to the runbook — then update the registry entry to reflect that both docs were corrected.

### REDIS-REAUDIT-02 — Dev `.env.example` Redis URLs lack the now-mandatory password
- **Severity:** Informational
- **Classification:** REGRESSION_FROM_REMEDIATION (the -01 fix added `--requirepass` but the example URLs a dev copies from were not updated)
- **File:line:** `apps/api/.env.example:24-25`
- **Evidence:** `# REDIS_QUEUE_URL=redis://127.0.0.1:6380` / `# REDIS_CACHE_URL=redis://127.0.0.1:6380` — no password. `docker-compose.yml:106-109`'s own comment now documents the correct URL as `redis://:devonly-valkey-pw@127.0.0.1:6380`. A dev who uncomments the `.env.example` lines verbatim to exercise the worker tier hits `NOAUTH`/`WRONGPASS` against the now-password-protected dev valkey. `git log b19039e..8ded432 -- apps/api/.env.example` is empty — the file was not updated alongside the compose change.
- **Why it matters:** Pure dev-ergonomics papercut — zero security or prod impact (prod valkey is dormant; `REDIS_*` unset means in-process fallback). Only bites a developer opting into the out-of-process tier locally.
- **Recommended action:** Update `apps/api/.env.example:24-25` to `redis://:devonly-valkey-pw@127.0.0.1:6380` to match the compose comment. Trivial.

## Verdict

**PASS.** REDIS_CACHE-01 and -02 are fully and correctly implemented against the live files (loopback bind + dev password; prod `--maxmemory 512mb` + `mem_limit 768m`, still dormant). REDIS_CACHE-03 is materially done — the operationally-critical runbook now matches the real single-service, no-health-check topology — but is only PARTIALLY complete: its own recommended fix also named `docs/operations/OPERATIONS_GUIDE.md:55`, which still carries the identical phantom two-node/health-check claims (Low), and the dev `.env.example` URLs weren't updated for the new password (Informational). Both new findings are documentation/ergonomics only — no Medium+ issue, no exploitable regression, and the whole Valkey tier is dormant in prod today. Fix the two doc gaps to fully close REDIS_CACHE-03.
