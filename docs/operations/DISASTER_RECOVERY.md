# DISASTER_RECOVERY.md (Part 6)

CRM2 disaster-recovery policy. Architecture is **FROZEN** (see
`CRM2_MASTER_MEMORY.md`). Process/policy level. Items dependent on
infrastructure not yet provisioned are marked **PLANNED**.

## Ground truth (stack)
- **PostgreSQL 17** — system of record.
- **Object store: MinIO → S3** — immutable, versioned, object-lock, sha256
  integrity, served via signed URLs. Evidence/attachment bytes live here,
  **NEVER** on a local container volume.
- **Valkey 8** — split into queue + cache. Both **reconstructable** (not a
  recovery source of truth).

> **Motivating incident:** v1 lost photo bytes when a `crm_uploads` Docker
> volume was rebuilt fresh — DB rows survived, files were gone and
> unrecoverable. Object bytes must live in a versioned, object-locked store
> with cross-region replication, never a node-local volume.

## Backup policy
- **Database (Postgres 17):** automated **daily full** base backup +
  **continuous WAL archiving** for point-in-time recovery (PITR). Backups
  stored off the DB host. **PLANNED**: backup encryption at rest + retention
  per `DATA_RETENTION_POLICY.md`.
- **Object store:** **versioning + object-lock** (WORM) already in the model;
  **cross-region replication** target for DR. **PLANNED** when second region
  lands.
- **Config / secrets:** backed up **out-of-band** (secret manager / sealed
  store), never in the DB or object dumps. Restored before app repoint.
- **Queue / cache (Valkey):** **not backed up** — rebuilt on recovery
  (queue jobs re-enqueued from DB state, cache repopulates on read).

## RTO / RPO targets — *target, ratify with bank SLA*
- **RPO ≤ 5 min** via continuous WAL archiving.
- **RTO ≤ 1–2 h** for full restore + repoint.
- Object store: RPO bounded by replication lag (**PLANNED**, near-zero target).
- These are engineering targets; **must be ratified against the bank/client SLA.**

## Restore process
1. **Provision** clean Postgres 17 + object-store access + secrets from
   out-of-band backup.
2. **Restore base backup**, then **replay WAL** to the chosen recovery point
   (PITR).
3. **Verify**: row counts vs. last-known, audit hash-chain continuity, sha256
   checksums on a sample of evidence objects.
4. **Repoint app** at restored DB + object store; warm Valkey (queue re-enqueue,
   cache cold-start).
5. **Smoke test** via `runbooks/` (login, case read, evidence signed-URL fetch,
   one finalize path).

## Failover process
- **DB:** promote **replica → primary** (streaming replica, **PLANNED**), update
  app connection target.
- **Object store:** fail over to replication target region (**PLANNED**).
- **Queue / cache:** **reconstructable** — stand up fresh Valkey, re-enqueue
  pending jobs from DB, let cache rebuild on demand.

## Recovery testing — **MANDATORY quarterly restore drill**
- Restore latest backups into an **isolated environment** (never prod).
- **Validate against the golden dataset** (`TEST_DATASET_STRATEGY.md`):
  expected row counts, checksums, audit chain, sample evidence retrieval.
- **Record results** (date, RPO/RTO achieved, anomalies, sign-off).

> **Backup success ≠ recoverable.** A successful backup job proves nothing
> about restorability. Restoration **MUST** be exercised and validated
> **quarterly**.

## Cross-references
- `runbooks/` — DB outage, storage outage step-by-step procedures (**PLANNED**).
- `TEST_DATASET_STRATEGY.md` — golden dataset for restore validation.
- `DATA_RETENTION_POLICY.md` — backup retention + disposal.
- `SECURITY_STANDARDS.md` — encryption, access to backups.
