# Runbook: Valkey 8 outage (queue / cache)

<!-- REDIS_CACHE-03 (docs/audit/12-redis-cache.md): this runbook previously described a two-node
     valkey-queue/valkey-cache topology and a Redis-aware /api/v2/health check. Neither exists —
     corrected against docker-compose.yml (ONE combined `valkey` service) and apps/api/src/http/app.ts
     (a static health stub with no dependency checks). Also: Valkey is fully commented out / dormant in
     prod today (infra/prod/docker-compose.yml) — jobs run in-process, socket.io uses its in-memory
     adapter. This runbook applies once a prod Valkey is actually stood up. -->

**Current reality:** Valkey is **ONE combined service** (`docker-compose.yml`, container
`crm2_valkey`) backing both `REDIS_QUEUE_URL` (BullMQ) and `REDIS_CACHE_URL` (socket.io's
Redis adapter) — not two separate queue/cache nodes. In **prod today it is dormant**: the
`valkey` block in `infra/prod/docker-compose.yml` is commented out, `REDIS_*` env vars are
unset, jobs run in-process inside the `api` container, and socket.io falls back to its
in-memory adapter. This runbook applies once that block is uncommented and prod actually
runs a Valkey instance.

## Symptoms
- BullMQ jobs (notifications, exports, reports) stop enqueuing/processing.
- Multi-instance socket.io fan-out breaks (each instance only sees its own connected
  clients) — only relevant once prod runs more than one `api` replica.
- **`/api/v2/health` does NOT check Valkey** — it is a static `{status:'ok'}` stub
  (`apps/api/src/http/app.ts`), so a Valkey outage will NOT show up there. Diagnose via
  the symptoms above + direct `redis-cli`/`docker` checks, not the health endpoint.

## Impact / severity
- **SEV-2** if jobs stop processing (queue data is reconstructable — see Recovery — but
  work stalls until it is).
- **SEV-3** if only the cache/fan-out role degrades (socket.io still works single-instance).

## Diagnosis
- `docker exec crm2_valkey valkey-cli ping` → `PONG`.
- `docker exec crm2_valkey valkey-cli info memory`; `docker compose logs --tail=100 valkey`.
- Policy check (once the prod block is active): `docker exec crm2_valkey valkey-cli config
  get maxmemory-policy` — the prod template sets `noeviction` (jobs must never be evicted);
  confirm this hasn't drifted.

## Mitigation
- If OOM: raise `maxmemory` or drain the backlog (see `queue-backlog.md`); do **not** switch
  to an eviction policy — that silently drops queued jobs.
- Restart: `docker compose restart valkey` (dev) / the equivalent prod compose command.

## Recovery
- Queue data lost: BullMQ jobs are derived from durable DB rows for the domains that need
  it — re-trigger the underlying action rather than trying to recover the queue's internal
  state.
- Socket.io fan-out: reconnects automatically once Valkey is back; no manual step.

## Verification
- `valkey-cli ping` → PONG; `maxmemory-policy` correct; BullMQ queue depth draining
  (`queue-backlog.md`).

## Postmortem
- Cause (OOM / wrong policy / node loss), jobs lost & how recovered, action items.
