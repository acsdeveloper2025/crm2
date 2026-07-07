# ADR-0091: RDS storage encryption at rest (snapshot-copy-restore cutover)

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The production database `crm2-prod` (RDS PostgreSQL 18.4, ADR-0087) was launched with
**`StorageEncrypted=false`** — the underlying EBS volumes, automated backups, snapshots, and any
future read replicas were stored unencrypted. The 2026-07-07 cost/capacity review flagged this as a
baseline at-rest hygiene gap (DPDP / SOC2-style control; protects against physical-media or
snapshot-copy exfiltration).

RDS storage encryption **cannot be toggled in place** — the only supported path is snapshot →
copy-with-KMS → restore-as-new-instance → cutover. The database is small (~100 MB used, dominated by
the 157k-row location catalog), so the restore is fast; the cutover needs only a short write-freeze.

**This is distinct from audit finding DATABASE-04** (`case_applicants.name/mobile/pan` stored +
indexed in plaintext). DATABASE-04 is a *field-level* control that remains DEFERRED pending a
searchable-encryption ADR (dedupe/ILIKE require plaintext columns). Storage-level (volume) encryption
neither closes nor conflicts with it — it is a complementary control at a different layer.

## Decision

We will **encrypt `crm2-prod` at rest** via the snapshot-copy-restore path, cutting over to a new
encrypted instance under a brief write-freeze.

- Snapshot the frozen DB → `copy-db-snapshot` with **`--kms-key-id alias/aws/rds`** (the AWS-managed
  RDS key — free, sufficient) → `restore-db-instance-from-db-snapshot` as new identifier
  **`crm2-prod-enc`**, mirroring the source exactly (db.t4g.medium, param group `crm2-pg18` with
  `timezone=Asia/Kolkata`, db SG `sg-031b15b6166bed497`, `default` subnet group, gp3 20 GB, private,
  single-AZ, port 5432); then set backup retention 7, deletion-protection ON, copy-tags, Name/env tags.
- Cutover: stop the api container (write-freeze — no writes are lost), verify the new instance
  (exact per-table `count(*)` parity vs the frozen source, `SHOW timezone`=Asia/Kolkata, TLS in use),
  then update the `DATABASE_URL` **host** in `/opt/crm2/secrets/.env.prod` to the new endpoint
  (`?sslmode=require&sslrootcert=…` unchanged — same regional RDS CA, no cert change) and recreate api.
- The old unencrypted instance `crm2-prod` is **stopped, not deleted**, as a rollback anchor for a few
  days; delete once confidence is established. The two RDS CloudWatch alarms (`crm2-rds-storage-low`,
  `crm2-rds-cpu-high`) are repointed to `crm2-prod-enc`.

Executed 2026-07-07 in a zero-traffic window (owner-authorized). Endpoint changed from
`crm2-prod.…` to `crm2-prod-enc.cvaak2y0k7wu.ap-south-1.rds.amazonaws.com`.

## Consequences

### Positive

- All data at rest (volumes, automated backups, future snapshots, read replicas) is now KMS-encrypted;
  closes the RDS at-rest watch-item carried since ADR-0087.
- No application code change; no schema/migration; `/api/v2` unchanged. Same master credentials
  (restore preserves them) — only the host moved.
- Cutover verified end-to-end: row-count parity (51 tables / 157,546 rows, exact), `Asia/Kolkata`
  timezone preserved, TLS confirmed, external ALB health 200 + DB-path login probe 401.

### Negative

- Endpoint DNS changed → a one-line `DATABASE_URL` host edit was required (documented; the box env,
  not a GitHub secret — deploys read the box `.env.prod`).
- Brief api downtime during the cutover (write-freeze). Done in a zero-traffic window, so no user impact.
- ~~The old unencrypted instance is retained (stopped) as a rollback copy.~~ **Closed same day
  (owner decision, pre-production):** the old instance, its automated snapshots, and the unencrypted
  `crm2-prod-preenc-*` intermediate snapshot were deleted on 2026-07-07. The encrypted
  `crm2-prod-enc-*` snapshot is kept as the cutover anchor; rollback would now be a restore from it.

## Alternatives Considered

- **In-place encryption toggle** — not supported by RDS; the copy-restore path is the only option.
- **Customer-managed KMS key (CMK)** — rejected. ~$1/mo plus key-management overhead with no added
  protection for this threat model (media/snapshot theft); the AWS-managed `aws/rds` key covers it and
  is free.
- **Keep the old instance running for instant rollback** — rejected; stopping realizes the encryption
  intent sooner and rollback (start + host-flip-back) is a few minutes, acceptable for a small DB.
- **Multi-AZ during the migration** — unneeded; single-AZ mirrors the source and the window was
  zero-traffic.

## Related ADRs

- ADR-0087 — AWS production hosting; created `crm2-prod` with encryption off (this ADR completes that
  watch-item).
- Registry **DATABASE-04** (deferred, field-level PII encryption) — a *different* control at the
  application layer; unaffected by this decision and still open.
