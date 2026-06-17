# Runbook: API outage

## Symptoms
- `/api/v2/health` non-200, timing out, or unreachable.
- Widespread 5xx; clients/mobile cannot log in or load cases.
- api container restarting / not running.

## Impact / severity
- **SEV-1** if all api instances down (full outage). SEV-2 if partial (some
  instances healthy behind nginx).

## Diagnosis
- `curl -fsS https://<host>/api/v2/health` — note which dependency is unhealthy.
- `docker compose ps` — is `api` Up? `docker compose logs --tail=200 api`.
- If health reports a dependency down, branch to that runbook (db / redis / storage).
- nginx up but api down → `docker compose logs --tail=100 nginx` (502/504).

## Mitigation
- If a subset of instances are bad: let nginx drop them; `docker compose up -d
  --scale api=N` to add healthy capacity.
- If all down from a bad release: roll back to previous image tag (see
  `failed-deployment.md`).
- If app-level crash loop: `docker compose restart api` once; do not loop-restart.

## Recovery
- Resolve the failing dependency, then `docker compose up -d api`.
- Confirm migrate gate completed (api won't start if `migrate` failed —
  `docker compose logs migrate`).

## Verification
- `curl -fsS https://<host>/api/v2/health` → 200, all deps green.
- Functional smoke: login, read one case, fetch one evidence signed-URL.
- Error rate / latency back to baseline (`MONITORING_STRATEGY.md`, **PLANNED**).

## Postmortem
- Timeline, trigger (deploy? dependency? resource?), root cause, action items.
