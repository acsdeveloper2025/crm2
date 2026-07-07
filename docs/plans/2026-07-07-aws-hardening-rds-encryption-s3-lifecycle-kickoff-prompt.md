# Kickoff prompt — AWS hardening: RDS encryption-at-rest + S3 image lifecycle/tiering

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. You have AWS access
> (account 824826126880, region ap-south-1, CLI profile `crm2` on this Mac — see
> `crm2/secrets/CREDENTIALS.md`). Two independent AWS-side fixes, both surfaced during the
> 2026-07-07 cost/capacity review at the real ~25k-cases/month volume. Neither needs app code.
> **Read `CLAUDE.md` → `CRM2_MASTER_MEMORY.md` §8 → memory `project_aws_migration_2026_07_04`
> (all AWS resource ids + the SES/Fast2SMS/WhatsApp env-flip templates) first.**

Standing rules: **ask the owner before any live-DB write, snapshot-restore cutover, or deploy**
(feedback_ask_before_acting); conventional commits (author Mayur, NO AI trailer); update
`CRM2_MASTER_MEMORY.md` §8 + memory + `docs/COMPLIANCE_GAPS_REGISTRY.md` at the end. Next ADR = 0091.

---

## Current prod AWS config (verified 2026-07-07)
- **RDS** `crm2-prod` · PostgreSQL 18.4 · db.t4g.medium · 20 GB gp3 (autoscale→100) · single-AZ ·
  7-day PITR · param group `crm2-pg18` (**timezone=Asia/Kolkata — MUST carry over**) ·
  **StorageEncrypted=FALSE** ← Fix 1 · deletion-protection ON · SG `sg-031b15b6166bed497` ·
  master user `crm2`. App connects via `DATABASE_URL` in `/opt/crm2/secrets/.env.prod` on the
  EC2 box (`43.204.64.111`), `sslmode=require&sslrootcert=/run/secrets/rds-ca.pem`.
- **S3** `crm2-prod-824826126880` · private · no lifecycle rules yet ← Fix 2. Prefixes in use:
  `field-photos/<caseId>/<taskId>/…` (the bulk — mobile uploads, ~0.6 MB each after the app's
  1920px/q85 resize), `case-reports/`, `attachments/` (web↔mobile, up to 25 MiB uncompressed),
  `users/` (avatars). ~310 GB/mo new at 25k cases/mo.

---

## FIX 1 — Encrypt RDS at rest (closes audit DATABASE-04)

RDS storage encryption **cannot be toggled in place** — the only path is snapshot → copy-with-KMS →
restore-as-new → cutover. The DB is small (~100 MB), so the restore is fast; the cutover needs a
**short write-freeze window** (stop the api so no writes are lost between the final snapshot and the
switch). Do it in a low-traffic window **with explicit owner OK**.

**Runbook (all `export AWS_PROFILE=crm2`):**
1. Dry-run rehearsal FIRST (no downtime): snapshot the live DB, copy encrypted, restore as
   `crm2-prod-enc-test`, point a *scratch* check at it, confirm data + `SHOW timezone`=Asia/Kolkata +
   TLS works, then delete the test instance. Proves the process before touching prod.
2. Real cutover (owner window):
   a. Freeze: on the EC2 box stop the api container (`docker compose -f infra/prod/docker-compose.aws.yml … stop api`).
   b. `aws rds create-db-snapshot --db-instance-identifier crm2-prod --db-snapshot-identifier crm2-prod-preenc-<stamp>` (wait available).
   c. `aws rds copy-db-snapshot --source-db-snapshot-identifier crm2-prod-preenc-<stamp> --target-db-snapshot-identifier crm2-prod-enc-<stamp> --kms-key-id alias/aws/rds` (default RDS-managed key = free; a CMK is ~$1/mo — default is fine). Wait available.
   d. `aws rds restore-db-instance-from-db-snapshot --db-instance-identifier crm2-prod-enc --db-snapshot-identifier crm2-prod-enc-<stamp> --db-instance-class db.t4g.medium --db-parameter-group-name crm2-pg18 --vpc-security-group-ids sg-031b15b6166bed497 --no-publicly-accessible --no-multi-az`. After it's available: set backup retention 7, deletion-protection ON, copy-tags, Name/env tags (restore doesn't carry all of these).
   e. New endpoint: `aws rds describe-db-instances --db-instance-identifier crm2-prod-enc --query 'DBInstances[0].Endpoint.Address'`. Update `DATABASE_URL` host in the prod `.env.prod` (keep `?sslmode=require&sslrootcert=…` — same RDS regional CA, no cert change). Restart api. Verify health + a real login (email/WhatsApp OTP path exercises the DB) + `StorageEncrypted=true`.
   f. Keep the OLD `crm2-prod` instance stopped (not deleted) for a rollback window; delete after a few days of confidence. Also refresh the DLM/backup story if the identifier changed.
3. **Staging**: the staging DB is a local Postgres container on the old box — not RDS, so encryption
   N/A there (disk-level only if wanted). This fix is prod-RDS-only.
- Owner decisions to confirm: the maintenance window; default `aws/rds` KMS key vs a customer CMK
  (recommend default — free, sufficient); whether to keep the same instance identifier by renaming
  (endpoint DNS changes either way, so simplest is new identifier + DATABASE_URL update).
- Likely warrants **ADR-0091** (infra change completing a deferred audit item); registry DATABASE-04 → FIXED.

## FIX 2 — S3 image storage lifecycle (keep the storage line flat)

At ~310 GB/mo new, S3 Standard storage compounds (~$0.025/GB). Cheap insurance — **pure S3 config,
NO app code, NO downtime.** Evaluate two options and pick with the owner:

- **Option A — S3 Intelligent-Tiering (safest, zero-risk):** put a lifecycle rule transitioning
  `field-photos/`, `case-reports/`, `attachments/` to Intelligent-Tiering. AWS then auto-moves each
  object between frequent/infrequent/archive-instant tiers by real access, **no retrieval fees**,
  millisecond access always (presigned GET unaffected). Cost: a tiny monitoring fee (~$0.0025 per
  1,000 objects/mo). Best when access patterns are unknown — it self-optimizes. **Recommended default.**
- **Option B — explicit transition to Glacier Instant Retrieval after 90 days:** storage
  $0.025→~$0.005/GB (80% off) for objects >90 days; still millisecond access (presigned works), but a
  $0.03/GB retrieval fee on access + 90-day min-duration + 128 KB min object size. More savings on
  genuinely-cold data, small cost if old images get re-viewed. Note: S3 lifecycle keys on object
  AGE/prefix/tag, **NOT case status** — so "closed-case only" isn't directly expressible; age-based is
  the practical proxy (a closed case's photos simply age out).
- Do NOT use Glacier Flexible/Deep Archive for these — minutes-to-hours retrieval would break the
  in-app image view. Only instant-retrieval tiers are transparent.
- Also add: abort-incomplete-multipart-uploads after 7 days (housekeeping). And confirm bucket keeps
  public-access-block ON.
- Apply via `aws s3api put-bucket-lifecycle-configuration --bucket crm2-prod-824826126880 …`. Verify
  with `get-bucket-lifecycle-configuration` and that a presigned image GET still works instantly.
- No ADR needed (config, additive); note in registry + memory. Independent of Fix 1 — can ship first.

## Related context (do not re-investigate — already confirmed 2026-07-07)
- Mobile field photos are resized on-device to **1920px long-edge, JPEG q85, EXIF stripped**
  (`crm-mobile-native` `CameraService.ts` `NORMALIZE_MAX_EDGE=1920`/`NORMALIZE_QUALITY=85`) →
  ~0.6 MB typical, well under the 15 MiB backend cap. Attachments (25 MiB cap) are NOT compressed —
  the larger per-file risk if staff upload big scans.
- Backend caps: field photo 15 MiB (max 10/upload), attachment 25 MiB, profile 5 MiB, nginx 50 MB.
- Projected AWS ≈ ₹22–23k/mo at month 6 (25k cases/mo) with today's compression; Fix 2 keeps the
  storage component from compounding past that.
