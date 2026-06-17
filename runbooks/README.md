# runbooks/

Incident runbooks for **CRM2**. Architecture **FROZEN**
(`CRM2_MASTER_MEMORY.md`). Unbuilt infra is marked **PLANNED**.
Hostnames/credentials are placeholders — real values in the secret store.

Start here during an incident, then open the matching runbook. Entry-point
diagnosis: `curl -fsS https://<host>/api/v2/health`.

## Index
| Runbook | When |
|---|---|
| [api-outage.md](./api-outage.md) | `/api/v2/health` failing, 5xx, api process down |
| [db-outage.md](./db-outage.md) | PostgreSQL 17 unreachable / failing / replica lag |
| [redis-outage.md](./redis-outage.md) | Valkey 8 queue or cache down |
| [report-worker-outage.md](./report-worker-outage.md) | worker/report jobs not running (**PLANNED**) |
| [storage-outage.md](./storage-outage.md) | object store (MinIO→S3) / evidence unreachable |
| [queue-backlog.md](./queue-backlog.md) | BullMQ queue depth growing (**PLANNED**) |
| [failed-deployment.md](./failed-deployment.md) | deploy failed / bad release / migrate step failed |

## Standard runbook format
Every runbook follows the same sections:

1. **Symptoms** — observable signals (alerts, errors, user reports).
2. **Impact / severity** — who/what is affected; SEV level.
3. **Diagnosis** — commands to confirm root cause.
4. **Mitigation** — stop the bleeding (fast, possibly temporary).
5. **Recovery** — restore normal service.
6. **Verification** — prove it's fixed (health + functional check).
7. **Postmortem** — capture timeline, root cause, action items (blameless).

## Cross-references
- `../OPERATIONS_GUIDE.md` — topology, deploy/rollback, routine ops.
- `../DISASTER_RECOVERY.md` — backups, PITR restore, failover, drills.
- `MONITORING_STRATEGY.md` / `OBSERVABILITY_STANDARDS.md` — alerts & telemetry (**PLANNED**).
