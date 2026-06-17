# Runbook: Database (PostgreSQL 17) outage

## Symptoms
- `/api/v2/health` reports `db` unhealthy; api 5xx on any DB path.
- `connection refused` / `too many connections` / replica lag alerts.

## Impact / severity
- **SEV-1** — Postgres 17 is the system of record; total outage = full outage.

## Diagnosis
- `docker compose exec postgres pg_isready -U <user>` → expect `accepting`.
- `psql -h <db-host> -U <user> -d <db> -c 'select 1'`.
- Connections: `psql -c "select count(*),state from pg_stat_activity group by state"`.
- Disk full? `df -h` on DB host. Long locks?
  `psql -c "select * from pg_stat_activity where wait_event_type='Lock'"`.
- Logs: `docker compose logs --tail=200 postgres`.

## Mitigation
- Exhausted connections: kill idle-in-transaction
  `psql -c "select pg_terminate_backend(pid) from pg_stat_activity where state='idle in transaction' and now()-state_change>'5 min'"`; verify pool sizing.
- Disk full: free WAL/archive space, expand volume; do **not** delete WAL needed
  for PITR (`DISASTER_RECOVERY.md`).

## Recovery
- Restart only after root cause known: `docker compose restart postgres`.
- Data loss / corruption → PITR restore per `DISASTER_RECOVERY.md`
  (base backup + WAL replay), then repoint api.
- Failover replica → primary (**PLANNED**), update connection target.

## Verification
- `pg_isready` ok; `/api/v2/health` db green.
- Row counts vs last-known + audit hash-chain continuity after any restore.

## Postmortem
- Cause (disk/locks/connections/corruption), RPO/RTO achieved, action items.
