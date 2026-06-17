# Runbook: Failed deployment

Deploys run via **GitHub Actions** (`docs/CI_CD_STANDARDS.md`). Migrations apply
in a **gated `migrate` step before `api` starts** (`api depends_on migrate:
service_completed_successfully`) — atomic, no schema/code-mismatch window.

## Symptoms
- GitHub Actions deploy job red, or new release unhealthy after rollout.
- `migrate` step failed → api never started (`/api/v2/health` down/unchanged).
- Post-deploy 5xx spike, errors tied to the new image.

## Impact / severity
- **SEV-1** if production left down. SEV-2 if previous version still serving
  (migrate failed before api swap = old release intact).

## Diagnosis
- Read the Actions run logs for the failing step.
- `docker compose logs migrate` — did migrations fail? (api won't start if so.)
- `docker compose ps` — which image tag is running? `docker compose logs api`.
- Decide: did the bad release change the schema? (drives rollback path.)

## Mitigation
- **No schema change:** roll back to the **previous image tag** and redeploy —
  code rollback stands alone.
- **Schema changed (forward-only):** code rollback alone is unsafe. Restore DB
  via PITR to before the migration (`DISASTER_RECOVERY.md`), then redeploy the
  prior image. Prefer additive/backward-compatible migrations to avoid this.
- **Migrate failed mid-way:** do not force api up; fix the migration, re-run the
  gated step (it must complete before api starts).

## Recovery
- Redeploy known-good image; confirm migrate step green; bring api up.

## Verification
- Actions deploy green; `curl -fsS https://<host>/api/v2/health` → 200, deps green.
- Functional smoke (login, case read, evidence signed-URL, one finalize path).
- Error rate back to baseline.

## Postmortem
- Cause (migration / image / config), why CI didn't catch it, rollback path used,
  action items (test gate, additive-migration discipline).
