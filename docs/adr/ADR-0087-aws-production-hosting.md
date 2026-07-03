# ADR-0087: Host production on AWS (EC2 + RDS + S3 + ALB + ElastiCache); old box becomes staging

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Production ran on a single self-managed box (`49.50.119.155`): Postgres, MinIO,
api, and edge all in one docker-compose stack, TLS via box-local certbot, no
off-box backups (full-platform audit 2026-07-02 flagged this), and vertical
scale capped by the box. The owner asked for future-proof hosting on AWS and a
separate staging environment, with the existing domain kept.

## Decision

We will host production on AWS `ap-south-1` (account `824826126880`), keeping
the application architecture unchanged and moving only the stateful edges to
managed services:

- **EC2** (`t3.large`, Elastic IP `43.204.64.111`) runs the same `api` + `edge`
  containers via `infra/prod/docker-compose.aws.yml`.
- **RDS PostgreSQL 18** (`crm2-prod`, 7-day PITR backups, custom parameter
  group `crm2-pg18` pinning `timezone=Asia/Kolkata` to match the old DB)
  replaces the Postgres container. `DATABASE_URL` uses
  `sslmode=require&sslrootcert=/run/secrets/rds-ca.pem` (the bundled pg driver
  treats `require` as verify-full; the RDS CA bundle is mounted into both
  db-touching containers).
- **S3** (`crm2-prod-824826126880`, private, scoped IAM user `crm2-app-s3`)
  replaces MinIO — the ADR-0021 storage seam made this an env-only swap
  (`STORAGE_BACKEND=s3`, no `S3_ENDPOINT`). Edge CSP `img-src`/`connect-src`
  additionally allow the S3 origin (presigned reads are cross-origin now).
- **ALB + ACM** terminate TLS (auto-renewing cert, HTTP→HTTPS redirect);
  `nginx.aws.conf` serves plain :80 behind it, passes the ALB's
  `X-Forwarded-Proto` through, and keys rate limiting on the real client IP
  via `set_real_ip_from` the VPC CIDR.
- **ElastiCache Valkey** (`crm2-valkey`, non-cluster t4g.micro) is provisioned
  for the out-of-process job tier but NOT yet wired (`REDIS_*` stays unset;
  jobs remain in-process exactly as before — enabling the worker tier is a
  separate, later change).
- **`infra/prod/deploy.sh` gains a flavor switch**: the marker file
  `/opt/crm2/.aws-box` selects the AWS compose file and localhost health gates.
  One workflow and one script serve both boxes; the old box's behavior is
  byte-identical without the marker.
- **The old box becomes staging** at `staging.crm.allcheckservices.com`
  (own certbot cert + `.env`), deployed manually — push-to-`main` deploys to
  AWS production only (GitHub secrets `PRODUCTION_HOST`/`KNOWN_HOSTS_PIN`/
  `DEPLOY_USER` repointed at cutover).

Mobile (`crm-mobile-native`) is unaffected: same domain, same `/api/v2`
contract; presigned URLs simply point at S3.

## Consequences

### Positive

- Point-in-time DB recovery + 11-nines file durability; closes the
  no-backups audit finding (DATABASE-level).
- App tier is now stateless — scale up/out without another data migration;
  ALB already in place for multi-instance.
- Managed TLS ends the certbot-renewal failure class on prod.
- A real staging environment isolated from production.

### Negative

- ~₹10k/mo AWS spend (vs a single flat-rate box).
- Two infra flavors to keep in sync (`docker-compose.yml` vs `.aws.yml`);
  mitigated by the shared deploy.sh and images.
- In-VPC dependencies (RDS/Valkey unreachable from outside) make local
  debugging against prod data require an SSH tunnel through the EC2 box.

## Alternatives Considered

- **ECS/EKS** — orchestration overhead unjustified for a 2-container app.
- **Lift-and-shift single EC2 (everything in compose)** — cheapest, but keeps
  the no-backup/single-disk failure class the audit flagged; rejected by owner
  ("think future").
- **CloudFront CDN** — deferred; nginx static serving is fine at current
  traffic, can be added without architecture change.

## Related ADRs

- ADR-0021 — object-storage seam that made the MinIO→S3 swap env-only.
- ADR-0076 — security hardening (rate limits/timeouts) preserved in the AWS
  nginx flavor.
