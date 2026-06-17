# Runbook: Queue backlog (BullMQ on Valkey, **PLANNED**)

> BullMQ queues + worker/report consumers are **PLANNED**. Target procedure.
> Queue Valkey is `noeviction` — backlog never silently drops; it grows.

## Symptoms
- `bull:<queue>:wait` (and/or `:delayed`) depth climbing and not draining.
- Notification / report latency rising; `:failed` count growing.
- Valkey **queue** memory rising toward `maxmemory` (OOM risk under noeviction).

## Impact / severity
- **SEV-2** — async work delayed. Becomes **SEV-1** if queue Valkey nears OOM
  (under `noeviction` new enqueues start failing).

## Diagnosis
- Depths: `redis-cli -h <queue-host> llen bull:<queue>:wait` / `:active` / `:delayed`
  / `:failed`.
- Consumers attached? `:active` should be non-zero — if 0 see
  `report-worker-outage.md`.
- Memory headroom: `redis-cli -h <queue-host> info memory`.
- Inspect a failed job for a poison-message pattern (BullMQ dashboard, **PLANNED**).

## Mitigation
- Throughput problem: scale consumers `docker compose up -d --scale worker=N`.
- Poison job (repeated same failure): move to failed/DLQ, don't let it block;
  pause the queue if a downstream dep is down, resume when healthy.
- Near OOM: raise queue `maxmemory` temporarily; **never** switch to eviction.

## Recovery
- Backlog drains as consumers catch up; retry `:failed` after root cause fixed.

## Verification
- `:wait` / `:delayed` falling to baseline; `:failed` not growing.
- Valkey queue memory stable; end-to-end test job completes.

## Postmortem
- Cause (throughput / poison / downstream / undersized), peak depth, action items.
