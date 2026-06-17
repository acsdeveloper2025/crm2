# OBSERVABILITY_STANDARDS — Part 17

Status: architecture FROZEN. Logging + per-request observability are LIVE; tracing/metrics/dashboards/alerts tooling is **PLANNED**.

## Ground truth (built today)
- Centralized **`@crm2/logger`** — structured JSON only; levels `trace/debug/info/warn/error/fatal`.
- Per-request observability wired in `apps/api/src/http/app.ts` (`requestObservability` middleware) emitting `requestId, method, path, status, durationMs, userId`.
- Workers/jobs (**BullMQ on Valkey**) are **PLANNED** (see Part 36).

## The four pillars

### 1. Logging
- **Structured JSON only** via `@crm2/logger`. No `console.*`, no free-text lines.
- **Correlation:** every log line carries `requestId` (request-scoped; for jobs, a `jobId`).
- **Levels:** `trace`=hot-path detail · `debug`=dev diagnostics · `info`=lifecycle/business events · `warn`=recoverable/degraded · `error`=request/job failed · `fatal`=process-level, exit.
- **Never log secrets or PII** — no passwords, tokens, OTPs, full PAN/Aadhaar, raw applicant docs. Redact at the logger boundary.
- **Retention** of log data follows `DATA_RETENTION_POLICY.md` (no ad-hoc retention).

### 2. Tracing
- **Propagate `requestId` end-to-end**: HTTP → service → repository → (PLANNED) enqueued job inherits it as correlation id.
- Inbound `X-Request-Id` honored if present, else generated; echoed in response header.
- **Distributed tracing (OpenTelemetry spans/exporter): PLANNED.**

### 3. Metrics *(collection layer PLANNED)*
- **APIs — RED:** Rate (req/s), Errors (rate of 5xx / non-2xx), Duration (p50/p95/p99 from `durationMs`).
- **Resources — USE:** Utilization, Saturation, Errors for CPU/mem/disk/connections.
- **Queues:** depth and consumer **lag** per BullMQ queue.
- **DB:** connection-pool in-use/idle/wait, slow-query count.
- **Per-screen latency** compared against `PERFORMANCE_STANDARDS.md` budgets (PLANNED doc); breach = alertable.

### 4. Dashboards *(PLANNED)*
- One dashboard **per critical service** (API, job workers, DB, Valkey, object store).
- Each surfaces its RED/USE panels, queue depth/lag, DB pool, and screen-latency-vs-budget.

### 5. Alerts *(PLANNED)*
Page/notify on: SLO breach, error-rate spike, **queue backlog**, **failed jobs**, **DB saturation**, **backup/restore failure**.

## Mandatory instrumentation contract
- **Every API request** logs `requestId`, `durationMs`, `status`, `userId` (already enforced by the middleware above).
- **Every job** logs **start, finish, duration, retry, failure** with its correlation id (Part 36, PLANNED).
- **All critical services are monitored.**

## Ownership & cadence
- **Owner:** Platform/Infra lead.
- **Cadence:** dashboards reviewed **weekly**; alert thresholds and SLOs reviewed **monthly**; post-incident review after any paging alert.
