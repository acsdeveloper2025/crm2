# Runbook: Object store outage (MinIO → S3)

Evidence/attachment bytes live in an **immutable, versioned, object-locked**
store served via **signed URLs** — **NEVER a local container volume**.

> **Why this matters:** v1 lost photo bytes when a `crm_uploads` Docker volume
> was rebuilt — DB rows survived, files were gone and unrecoverable. Object
> bytes must never depend on node-local storage.

## Symptoms
- `/api/v2/health` reports `object-store` unhealthy.
- Evidence images "unavailable"; signed-URL fetches 403/404/timeout; uploads fail.

## Impact / severity
- **SEV-1** — evidence is regulated banking data. Read failures block
  verification review; write failures risk capture loss. Integrity > availability.

## Diagnosis
- Reachability: `mc admin info <alias>` (MinIO) or S3 list on the bucket.
- Signed-URL HEAD on a known object → expect 200; 403 = creds/clock/policy.
- Confirm **versioning + object-lock** still enabled (must never be disabled):
  `mc version info <alias>/<bucket>`, `mc retention info ...`.
- Logs: `docker compose logs --tail=200 <minio-or-gateway>` (**PLANNED** for S3).

## Mitigation
- **Do NOT** fall back to a local volume for writes — fail closed instead;
  surface "capture queued/blocked" rather than silently dropping bytes.
- Creds/clock issue: rotate/sync from secret store; re-sign URLs.
- Region/endpoint down (S3, **PLANNED**): fail over to replication target region.

## Recovery
- Restore store reachability; verify object-lock + versioning intact.
- Replay any client-queued uploads (mobile retries on sync).

## Verification
- `/api/v2/health` object-store green; sample evidence signed-URL fetch 200.
- sha256 integrity check on a sample of objects matches DB checksums.

## Postmortem
- Cause, whether any bytes were at risk, integrity-check results, action items.
