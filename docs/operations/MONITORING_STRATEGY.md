# MONITORING_STRATEGY — Part 13

Status: architecture FROZEN. **Tooling is PLANNED** — Playwright-based synthetics + uptime checks. This doc defines *what* runs continuously and *when it pages*.

See: `OBSERVABILITY_STANDARDS.md` (pillars, correlation, alerting), `runbooks/` (on-call response, PLANNED), `PERFORMANCE_STANDARDS.md` (latency budgets, PLANNED).

## Three monitoring layers
- **Liveness** — is the process up? `GET /api/v2/health` returns 200 with no dependency checks. Cheap, frequent.
- **Readiness** — can it serve traffic? `GET /api/v2/health` deep mode checks **DB**, **Valkey**, **object store** reachability. Failing readiness = pull from rotation, do not page unless sustained.
- **Deep synthetic** — does the real user journey work end-to-end through the UI/API? Drives actual flows below.

## Health checks
- **Liveness probe:** `/api/v2/health` — every **30s**, against every instance. Two consecutive fails ⇒ restart/rotate.
- **Readiness probe:** `/api/v2/health` (deep: DB + Valkey + object-store) — every **30s**. Sustained fail (>2 min) ⇒ page on-call.

## Synthetic flows (PLANNED — Playwright)
Each flow runs continuously; on failure it **pages on-call** per `runbooks/`.

1. **Login** — POST credentials, assert JWT + `/me`. *Success:* authenticated session. *Freq:* **2 min**.
2. **Create case** — create a case via API. *Success:* case persisted, id returned. *Freq:* **5 min**.
3. **Assign task** — assign a verification task to a test agent. *Success:* task `ASSIGNED`, assignee correct. *Freq:* **5 min**.
4. **Open workspace** — load the verification/document workspace for that task. *Success:* workspace renders, data loads under `PERFORMANCE_STANDARDS.md` budget. *Freq:* **5 min**.
5. **Generate report** — produce the task/case report. *Success:* report generated, downloadable, non-empty. *Freq:* **10 min**.

> Flows 2–5 chain on disposable test data and clean up after themselves; a failure at any step pages with the failing step named.

## Alert routing
- Synthetic failure ⇒ **page on-call** (links to the matching `runbooks/` entry).
- Liveness/readiness sustained failure ⇒ page on-call.
- Single transient synthetic blip auto-retries once before paging (avoid flap noise).

## Environments
- Synthetics run against **staging continuously** and against a **prod canary** (read-mostly + isolated test tenant data so prod metrics/billing stay clean).
- Health probes run against **every prod + staging instance**.

## Ownership & cadence
- **Owner:** Platform/Infra lead.
- Synthetic flows and thresholds reviewed **monthly**; runbook links validated after each incident.
