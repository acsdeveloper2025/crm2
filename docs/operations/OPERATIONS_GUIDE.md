# OPERATIONS_GUIDE.md

Operational runbook for **CRM2** (banking RCU/KYC CRM). Architecture is
**FROZEN** (see `CRM2_MASTER_MEMORY.md`). Infra not yet provisioned is
marked **PLANNED**. Hostnames/credentials are placeholders — real values live in
the secret store, never in git.

## System topology
Modular monolith, one image, ROLE-gated processes (`PROCESS_ROLE=api|worker|report`).

```
                       ┌──────────────┐
   clients ──HTTPS──▶  │  nginx edge  │ (TLS, gzip, rate-limit)
                       └──────┬───────┘
                              ▼
                       ┌──────────────┐
                       │  api (N x)   │──┐ writes/reads
                       └──────────────┘  │
   ┌──────────────┐    ┌──────────────┐  │   ┌──────────────────┐
   │ worker (N x) │    │  report (N)  │  ├──▶│ PostgreSQL 17 (SoR)│
   │  PLANNED     │    │  PLANNED     │  │   └──────────────────┘
   └──────┬───────┘    └──────┬───────┘  │   ┌──────────────────┐
          │ BullMQ (PLANNED)  │          ├──▶│ Valkey 8: queue   │ noeviction
          └─────────┬─────────┘          │   │            cache  │ LRU
                    ▼                     │   └──────────────────┘
              (job consume)               ▼
                                  ┌──────────────────────────┐
                                  │ Object store MinIO→S3      │
                                  │ immutable/versioned/       │
                                  │ object-lock/signed-URL     │
                                  └──────────────────────────┘
```
- **api** — HTTP, serves `/api/v2/*`. Stateless; scale horizontally.
- **worker / report** — **PLANNED**; consume BullMQ jobs (notifications, report
  generation). Same image, different `PROCESS_ROLE`.
- **Valkey queue** (`noeviction` — jobs must never be evicted) is separate from
  **Valkey cache** (`LRU` — disposable). Both reconstructable, not a SoR.
- **Object store** holds evidence/attachment bytes — **NEVER a local volume**
  (v1 lost photo bytes once on a `crm_uploads` volume rebuild). Versioned +
  object-locked + signed-URL access.

## Deploy / rollback
- CI/CD via **GitHub Actions** (see `docs/CI_CD_STANDARDS.md`).
- **Migrations apply via a gated `migrate` step before `api` starts** —
  `api depends_on migrate: service_completed_successfully`. Migration runs to
  completion atomically; if it fails, api never starts (no schema/code-mismatch
  window). Migrations are forward-only (see `DATABASE_CHANGE_PROCESS.md`).
- **Rollback:** redeploy the **previous image tag**. If the bad release changed
  the schema, a code rollback alone is unsafe — restore the DB (PITR per
  `DISASTER_RECOVERY.md`) to before the migration, then redeploy prior image.
  Prefer additive, backward-compatible migrations so code rollback stands alone.

## Health / readiness
- Aggregate health: `curl -fsS https://<host>/api/v2/health` → `200` healthy.
  Reports per-dependency status (db, valkey-queue, valkey-cache, object-store).
- **PostgreSQL:** `docker compose exec postgres pg_isready -U <user>` then
  `psql -c 'select 1'`.
- **Valkey (queue & cache):** `redis-cli -h <queue-host> -p <port> ping` → `PONG`;
  same for cache host. Confirm policy: `redis-cli config get maxmemory-policy`.
- **Object store:** signed-URL HEAD on a known object, or `mc admin info <alias>`
  (MinIO). Verify a sample evidence object resolves (PLANNED: S3 reachability).

## Routine ops
- **Scaling:** api is stateless — `docker compose up -d --scale api=N` behind
  nginx. worker/report scale by job depth (**PLANNED**).
- **Logs:** structured JSON via **@crm2/logger** (see `OBSERVABILITY_STANDARDS.md`).
  `docker compose logs -f <service>`; ship to the log aggregator (**PLANNED**).
  Correlate by request/correlation id, never grep PII.
- **Queue inspection:** `redis-cli -h <queue-host> llen bull:<queue>:wait` /
  `:active` / `:failed`; BullMQ dashboard (**PLANNED**). See `runbooks/queue-backlog.md`.
- **Matview refresh:** reporting `mv_*` refreshed on cadence by the report
  process (**PLANNED**); until then `REFRESH MATERIALIZED VIEW CONCURRENTLY <mv>`
  on schedule. Reads tolerate staleness; writes go to base tables/`v_*`.
- **Secrets/env:** sourced from env / secret store only — **never committed to
  git** (enforced by gitleaks, see `SECURITY_STANDARDS.md`). Rotate per policy.

## Incident response
1. Confirm scope via `/api/v2/health` + per-dependency checks above.
2. Declare severity, page on-call, open an incident channel.
3. Jump to the matching **`runbooks/`** entry (index in `runbooks/README.md`):
   api / db / redis(Valkey) / report-worker / storage / queue-backlog / deploy.
4. Mitigate → recover → verify → write a postmortem (blameless).
- **On-call:** primary + secondary; ack target ≤15 min; escalate to eng lead if
  unmitigated in 30 min. Evidence-integrity incidents (object store) are SEV-1.

## Cross-references
- `DISASTER_RECOVERY.md` — backups, RTO/RPO, restore/failover, quarterly drill.
- `MONITORING_STRATEGY.md` — what to alert on (**PLANNED**).
- `OBSERVABILITY_STANDARDS.md` — logs/metrics/traces conventions (**PLANNED**).
- `runbooks/` — step-by-step incident procedures.
