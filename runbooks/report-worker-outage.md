# Runbook: Worker / Report process outage (**PLANNED**)

> The `worker` and `report` processes (BullMQ consumers) are **PLANNED**. Until
> provisioned, background jobs are not yet split out; this runbook is the target
> procedure. Same image as api, run with `PROCESS_ROLE=worker` / `report`.

## Symptoms
- Jobs enqueued but not processed: notifications not delivered, reports/matview
  refresh not produced.
- `bull:<queue>:active` empty while `:wait` grows (no consumer).
- worker/report container down or crash-looping.

## Impact / severity
- **SEV-2** — async functions degraded; api/reads unaffected. Reporting/matview
  staleness grows; notification delivery delayed.

## Diagnosis
- `docker compose ps` — `worker` / `report` Up? `docker compose logs --tail=200 <svc>`.
- Confirm consumers attached: `redis-cli -h <queue-host> llen bull:<queue>:active`.
- Verify Valkey **queue** healthy first (`redis-cli ping`, `redis-outage.md`).
- Check `PROCESS_ROLE` env is set correctly on the container.

## Mitigation
- Scale up consumers: `docker compose up -d --scale worker=N` (**PLANNED**).
- If crash-looping on a poison job, see `queue-backlog.md` (failed-job handling).

## Recovery
- Restart with correct role: `docker compose up -d worker report`.
- Backlog drains once consumers reattach; matview refresh resumes on cadence.

## Verification
- `:active` non-zero, `:wait` falling; a test job completes end-to-end.
- Sample notification delivered; matview freshness back within cadence.

## Postmortem
- Cause (no consumer / poison job / Valkey), backlog peak, action items.
