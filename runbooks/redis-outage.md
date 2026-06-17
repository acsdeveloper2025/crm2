# Runbook: Valkey 8 outage (queue / cache)

Valkey runs as two roles: **queue** (`maxmemory-policy noeviction` — jobs must
never be evicted) and **cache** (`LRU` — disposable). Both are reconstructable,
**not** a source of truth.

## Symptoms
- `/api/v2/health` reports `valkey-queue` or `valkey-cache` unhealthy.
- Jobs not enqueuing/processing (queue); elevated DB load / slow reads (cache).

## Impact / severity
- **Queue down: SEV-2** — background work (notifications, reports) stalls; queued
  jobs persist if Valkey data survives, re-enqueue from DB state if not.
- **Cache down: SEV-3** — degraded performance only; reads fall through to DB.

## Diagnosis
- `redis-cli -h <queue-host> -p <port> ping` → `PONG`; same for `<cache-host>`.
- Policy check: `redis-cli -h <queue-host> config get maxmemory-policy`
  (**must be `noeviction`** for queue; `allkeys-lru`/`volatile-lru` for cache).
- Memory: `redis-cli info memory`; logs: `docker compose logs --tail=100 valkey-queue`.

## Mitigation
- **Cache:** stand up fresh cache node; it cold-starts and repopulates on read.
  Safe to flush cache (`redis-cli -h <cache-host> flushall`); never flush queue.
- **Queue:** if OOM with `noeviction`, raise `maxmemory` / drain backlog
  (see `queue-backlog.md`); do **not** switch queue to an eviction policy.

## Recovery
- Restart node: `docker compose restart valkey-queue` / `valkey-cache`.
- If queue data lost: re-enqueue pending jobs from DB state (jobs are derivable
  from durable rows); cache rebuilds automatically.

## Verification
- `ping` → PONG both roles; policies correct; `/api/v2/health` green.
- Queue draining (`llen bull:<queue>:wait` falling); cache hit-rate recovering.

## Postmortem
- Cause (OOM / wrong policy / node loss), jobs lost & how recovered, action items.
