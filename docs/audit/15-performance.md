# AUDIT 15: Performance

## Scope

Read-only static inspection of `/Users/mayurkulkarni/Downloads/crm2`. Read `docs/architecture-inventory.md` first for stack/baseline context (DB pool, Redis/Valkey deployment status, UV_THREADPOOL_SIZE, gzip config all cross-checked against source below, not assumed).

Inspected in depth:
- `apps/api/src/modules/dashboard/repository.ts`, `apps/api/src/modules/mis/repository.ts`, `apps/api/src/modules/billing/repository.ts`, `apps/api/src/modules/commissionRates/repository.ts` (aggregation-heavy modules named in the brief)
- `apps/api/src/modules/cases/service.ts`, `apps/api/src/modules/cases/repository.ts` (case/task creation + assignment + field-photo zip)
- `apps/api/src/modules/verification-tasks/service.ts`, `apps/api/src/modules/caseReports/service.ts`, `apps/api/src/modules/fieldReports/{service,render,sections}.ts`
- `apps/api/src/modules/scopeAssignments/repository.ts` (label-resolution batching pattern)
- `apps/api/src/platform/db.ts` (pool + transaction wrapper), `apps/api/src/platform/pagination.ts` (`resolvePage`/`resolveFilters`)
- `apps/api/src/platform/bulk.ts` (bulk OCC pattern), `apps/api/src/platform/import/index.ts`, `apps/api/src/platform/export/{index,format}.ts`, `apps/api/src/platform/export/job.ts`
- `apps/api/src/platform/pdf/index.ts` (puppeteer), `apps/api/src/platform/photo.ts` (sharp), `apps/api/src/platform/geocode/{index,queue}.ts`, `apps/api/src/platform/staticmap/index.ts`, `apps/api/src/modules/caseReports/docx.ts` (external fetch timeouts)
- `apps/api/src/platform/jobs/index.ts` (EXPORT/IMPORT/CASE_REPORT job engine, in-process-vs-BullMQ degrade path)
- `apps/api/src/platform/tokenRevocation/index.ts`, `apps/api/src/http/rateLimit.ts` (in-memory cache/store growth check)
- `packages/sdk/src/pagination.ts` (`MAX_PAGE_SIZE`/`DEFAULT_PAGE_SIZE`)
- `db/v2/migrations/*.sql` — grepped all 103 files for `CREATE INDEX` (84 total) against `case_tasks`/`cases` column usage
- `infra/prod/nginx.conf` (gzip), `infra/prod/docker-compose.yml` (UV_THREADPOOL_SIZE, mem_limit, worker/report-worker commented out)

Commands actually run (paste-verified outputs used as evidence below):
- `grep -rn "for (const\|\.forEach(\|\.map(async" apps/api/src --include="*.ts"` + a per-file scan for `await query` inside loop bodies
- `grep -rn "CREATE INDEX" db/v2/migrations/*.sql | grep -i case_tasks` / `| grep -i cases`
- `grep -rn "completed_at\|submitted_at" db/v2/migrations/*.sql`
- `pnpm audit --prod` (re-ran; same 2 moderate `uuid` transitive findings as the architecture inventory — security-track, not re-litigated here)
- `grep -n "gzip" infra/prod/nginx.conf`, `grep -n "UV_THREADPOOL_SIZE" infra/prod/docker-compose.yml`
- `grep -n "ROLE=worker\|ROLE=report" infra/prod/docker-compose.yml` (confirmed commented out)

Not run / not possible per ground rules: no live DB (`EXPLAIN ANALYZE`), no production network calls, no load test. Where static inspection can't establish a runtime fact (actual query plans, real row counts, p95 latency), the item is marked NOT VERIFIED with the specific reason.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| N+1 queries | **PARTIAL** (1 FAIL) | `apps/api/src/modules/cases/service.ts:341-349` — `for (const t of assigned) { await repo.eligibleAssigneesForNew(...) }`; dashboard/MIS/billing/commission repos use single set-based SQL (`apps/api/src/modules/dashboard/repository.ts:90-128`, `apps/api/src/modules/billing/repository.ts:188-331`) | See PERFORMANCE-01. All other loop-with-query candidates checked (scopeAssignments label batching, verification-tasks attachment signing, caseReports photo presign) are either batched (`= ANY($1)`) or bounded-parallel `Promise.all`, not per-row queries |
| Memory leaks | PASS | `apps/api/src/platform/tokenRevocation/index.ts:21` (`cache = new Map()` keyed by userId, bounded by distinct-user count, TTL-refreshed); `apps/api/src/platform/staticmap/index.ts:65-80`, `apps/api/src/platform/geocode/index.ts:61-77`, `apps/api/src/modules/caseReports/docx.ts:86-88` — every `setTimeout` paired with `clearTimeout` in `finally`; `grep -rn "setInterval" apps/api/src` → zero results (no recurring timer anywhere in the API) | express-rate-limit uses its own self-pruning in-memory store (library-managed, not custom) |
| Blocking code | PASS (with 1 informational caveat) | scrypt: `infra/prod/docker-compose.yml:110` `UV_THREADPOOL_SIZE: '16'` (libuv off-main-thread); puppeteer: `apps/api/src/platform/pdf/index.ts:24,51-65` concurrency-gated (`PDF_MAX_CONCURRENCY=6`) + timeouts (30s/60s); sharp: `apps/api/src/platform/photo.ts:26-40` fully async/buffered, capped input (`MAX_INPUT_PIXELS=50_000_000`); `grep -rn "readFileSync\|writeFileSync\|...Sync" apps/api/src --include="*.ts"` → only `platform/openapi/cli.ts` (build-time CLI, not a request path) and `platform/push/index.ts:84` (one-time cached FCM init, not per-request) | See PERFORMANCE-02 (informational): EXPORT/IMPORT/CASE_REPORT (puppeteer) jobs all execute in-process in the single `api` container because Valkey/BullMQ-worker is not deployed in prod — they share the same event loop/threadpool as request handling, not a separate process |
| Slow APIs | NOT VERIFIED (static-only) | No live system access permitted; no APM/tracing tool found in dependency inventory (`docs/architecture-inventory.md` §9: "No analytics, error-tracking... were found") | Cannot measure real p95/p99 latency from this repo alone. Static read of the heaviest endpoints (dashboard `stats`, MIS `misRows`, billing `commissionSummary`) shows single-scan SQL with explicit comments justifying the design (e.g. `apps/api/src/modules/dashboard/repository.ts:13-15` "ONE scoped scan... cheap, no MV needed") |
| Large payloads | PASS | Sync export capped at `EXPORT_JOB_THRESHOLD` (10,000 rows, 413 above) — `apps/api/src/platform/export/index.ts:39-56`; background job capped at `EXPORT_JOB_MAX_ROWS` (200,000) — `apps/api/src/platform/export/job.ts:59-60`; `client_max_body_size 50m` — `infra/prod/nginx.conf:61`; field-photo upload capped 15 MiB × 10 files/request — `apps/api/src/platform/photo.ts:19-20` | See PERFORMANCE-03 (informational): XLSX export builds the full workbook in memory (`wb.xlsx.writeBuffer()`, `apps/api/src/platform/export/format.ts:75-92`) rather than streaming — at the 200k-row ceiling this is a multi-tens-of-MB in-memory buffer inside a 2g container, though it is gated to the async job path so it never blocks a request thread |
| Caching | PASS (scope as designed) | `docs/architecture-inventory.md` §4 confirms: no general app-data cache layer; the one cache that exists (`tokenRevocation` 5s TTL, `apps/api/src/platform/tokenRevocation/index.ts:13-31`) is verified in source; reverse-geocode result cache-first — `apps/api/src/modules/geocode/service.ts:22-34` (`repo.getCached`/`repo.putCached`) | No HTTP-response cache layer (e.g. ETags/Cache-Control on API JSON) found — acceptable for a CRM with per-actor-scoped, frequently-mutated data; flagged as informational only, not a FAIL, since add-on caching wasn't found to be needed by any evidenced hot path |
| Compression | PASS | `infra/prod/nginx.conf:48-55`: `gzip on; gzip_types ... application/json ...` confirmed covers JSON API responses | `gzip_min_length 1024` (sub-1KB responses uncompressed — reasonable, avoids compressing trivial payloads) |
| Pagination | PASS | `packages/sdk/src/pagination.ts:7-9` (`DEFAULT_PAGE_SIZE=25`, `MAX_PAGE_SIZE=500`); `apps/api/src/platform/pagination.ts:159-184` (`resolvePage` rejects `limit > 500`, clamps `page`); every module's `service.ts` `list()` routes through it — `grep -rLn "resolvePage" apps/api/src/modules/*/service.ts \| xargs grep -ln "async list("` returned **zero files** (no list endpoint bypasses it); repo-level `LIMIT $n OFFSET $n` confirmed at `apps/api/src/modules/billing/repository.ts:209`, `apps/api/src/modules/mis/repository.ts:137-138`, `apps/api/src/modules/billing/repository.ts:327-328` | Large catalogs (locations, 157k rows per memory) additionally backed by `pg_trgm` GIN indexes — `apps/api/src/modules/locations/service.ts:33` comment + migration 0020 |
| Database performance | **FAIL** | `grep -rn "completed_at\|submitted_at" db/v2/migrations/*.sql` → columns added at `0041_task_completion_result.sql:16` and `0081_case_tasks_submitted.sql:20`; `grep -rn "CREATE INDEX" db/v2/migrations/*.sql \| grep -i case_tasks` → indexes exist for `case_id`, `assigned_to`, `status`, `created_at`, `assigned_at`, `area_id`, `applicant_id`, `parent` — **none for `completed_at` or `submitted_at`** | See PERFORMANCE-04. These two columns are the WHERE-range-filter AND `ORDER BY` key for MIS (`apps/api/src/modules/mis/repository.ts:69-70,136`), Billing (`apps/api/src/modules/billing/repository.ts:91-92,121,173-174`), and the Commission Summary `EARNED_AT` anchor (`apps/api/src/modules/billing/repository.ts:121,173-174`) — exactly the aggregation-heavy modules the audit brief named |
| Connection pooling | PASS (informational sizing note) | `apps/api/src/platform/db.ts:6-21` — single `pg.Pool`, `max: env.DB_POOL_MAX` (default 10, `packages/config/src/index.ts:83`), `connectionTimeoutMillis`/`statement_timeout`/`idle_in_transaction_session_timeout` all wired from env; `withTransaction` (`db.ts:46-63`) releases the client in `finally` on both commit and rollback paths | `DB_POOL_MAX=10` against a single-API-container deployment (`mem_limit: 2g`, no PgBouncer) is plausible for the current single-VPS scale but is also the ceiling for concurrent in-process EXPORT/CASE_REPORT job DB access competing with live request traffic (PERFORMANCE-02) — informational, not a FAIL, since no evidence of pool exhaustion exists from static inspection |

## Findings

### PERFORMANCE-01
- **Category:** N+1 query pattern
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1050 (Excessive Platform Resource Consumption within a Loop)
- **Location**
  - **File:** `apps/api/src/modules/cases/service.ts`
  - **Line Number:** 339-350
- **Evidence:**
```ts
const assigned = v.tasks.filter((t) => t.assigneeId);
if (assigned.length > 0) {
  for (const t of assigned) {
    const pool = await repo.eligibleAssigneesForNew(
      t.visitType!,
      t.pincodeId,
      t.areaId,
      t.verificationUnitId,
    );
    if (!pool.some((u) => u.id === t.assigneeId)) throw AppError.badRequest('INVALID_ASSIGNEE');
  }
}
```
  `repo.eligibleAssigneesForNew` (`apps/api/src/modules/cases/repository.ts:851-873`) issues its own `SELECT ... FROM users u WHERE ...` per call. `AddTasksSchema` (`packages/sdk/src/cases.ts:410-459`) has no `.max()` cap on the `tasks` array.
- **Why it is a problem:** Each assigned task in an `addTasks` (case-creation/task-add) request triggers a separate round-trip DB query to re-validate the assignee pool, instead of de-duplicating by `(visitType, pincodeId, areaId, verificationUnitId)` and batching to one query (or a handful) for the whole request.
- **Real world attack scenario:** Not an attacker-facing exploit (the array isn't unbounded enough to be a DoS vector on its own — bulk OCC elsewhere caps at 500 and this path is gated by `case.assign`), but an operator adding a case with many tasks and assigning most of them at create-time (a realistic KYC/CPV batch case with 10-20 applicants/tasks) turns one request into 10-20 sequential DB round-trips on the hot case-creation path, each blocking the next (no parallelization either).
- **Business impact:** Slower case-creation UX for the heaviest cases (the ones with the most tasks/applicants — typically the most valuable/urgent cases); compounds under concurrent case-creation load since each query is a full round-trip, not amortized.
- **Recommended fix:** De-duplicate the `(visitType, pincodeId, areaId, verificationUnitId)` tuples across `assigned` tasks first, run `eligibleAssigneesForNew` once per distinct tuple (typically 1, rarely more), then check each task's `assigneeId` against the resolved pool in memory. Alternatively, parallelize with `Promise.all` (bounded) as a one-line stopgap if true batching is out of scope.
- **Estimated effort:** S (1-2 hours)
- **Priority:** P3
- **Status:** OPEN

### PERFORMANCE-04
- **Category:** Database performance — missing index
- **Severity:** Medium
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1050 (Excessive Platform Resource Consumption — full/partial scan substituting for an index seek)
- **Location**
  - **File:** `db/v2/migrations/0041_task_completion_result.sql` (column added, line 16); `db/v2/migrations/0081_case_tasks_submitted.sql` (column added, line 20) — no companion index migration for either column anywhere in `db/v2/migrations/`
  - **Line Number:** N/A (absence, not a single line)
- **Evidence:**
```
$ grep -rn "CREATE INDEX" db/v2/migrations/*.sql | grep -i "case_tasks"
db/v2/migrations/0010_cases.sql:70:CREATE INDEX IF NOT EXISTS idx_case_tasks_case ON case_tasks (case_id);
db/v2/migrations/0010_cases.sql:71:CREATE INDEX IF NOT EXISTS idx_case_tasks_assigned ON case_tasks (assigned_to);
db/v2/migrations/0010_cases.sql:72:CREATE INDEX IF NOT EXISTS idx_case_tasks_status ON case_tasks (status);
db/v2/migrations/0036_task_assignment.sql:13:CREATE INDEX IF NOT EXISTS idx_case_tasks_created_at ON case_tasks (created_at);
db/v2/migrations/0036_task_assignment.sql:14:CREATE INDEX IF NOT EXISTS idx_case_tasks_assigned_at ON case_tasks (assigned_at);
db/v2/migrations/0039_visit_type_pool.sql:31:CREATE INDEX IF NOT EXISTS idx_case_tasks_task_area ON case_tasks (area_id);
db/v2/migrations/0037_case_task_dispatch_fields.sql:32:CREATE INDEX IF NOT EXISTS idx_case_tasks_applicant ON case_tasks (applicant_id);
db/v2/migrations/0054_task_lineage.sql:35:CREATE INDEX IF NOT EXISTS idx_case_tasks_parent
```
  No `completed_at` or `submitted_at` entry. Consumers that filter/sort on these columns:
  - `apps/api/src/modules/mis/repository.ts:69-70` — `add('ct.completed_at >= $?', ...)`, `add('ct.completed_at <= $?', ...)`
  - `apps/api/src/modules/mis/repository.ts:136` — `ORDER BY ct.completed_at DESC, ct.id DESC LIMIT $n OFFSET $n`
  - `apps/api/src/modules/billing/repository.ts:91-92` — same `completedFrom`/`completedTo` filter pattern
  - `apps/api/src/modules/billing/repository.ts:121` — `EARNED_AT = (COALESCE(ct.submitted_at, ct.completed_at) AT TIME ZONE 'Asia/Kolkata')`, used in every `commissionSummary` WHERE/GROUP BY/ORDER BY (`apps/api/src/modules/billing/repository.ts:173-174, 296-330`)
- **Why it is a problem:** Both columns sit in the WHERE clause (range filter) and the `ORDER BY` of the three modules the audit brief specifically flagged as aggregation-heavy (MIS, Billing, Commission). Without a B-tree index, Postgres must sequential-scan (or scan via a less-selective existing index like `idx_case_tasks_status` and re-sort in memory) every time a date range or "latest completed" sort is requested — the typical interaction pattern for an MIS/billing report (sales/finance teams routinely filter "this month", "last quarter", which compounds with the existing `status IN ('SUBMITTED','COMPLETED')` filter).
- **Real world attack scenario:** Not directly attacker-facing, but a billing/MIS user (any role with `billing.view` or `mis` access) filtering a multi-month commission summary or running an `all`-mode export across a large completed-task history (which, per `EXPORT_JOB_MAX_ROWS`, can be up to 200,000 rows) forces a full scan + filesort of `case_tasks` on every request — directly slows the periodic commission export workflow (ADR-0081, shipped 2026-07-01) it was built for, and as the table grows past the current scale this degrades further (no LIMIT short-circuits a scan-then-sort).
- **Business impact:** Commission/billing reports (used for payroll-period payouts, per the ADR-0081 feature this audit's own session memory shows was just shipped) get slower as `case_tasks` grows; at sufficient row counts this can push report generation past acceptable UX latency or, for the synchronous MIS list view, contribute to request timeouts under `DB_STATEMENT_TIMEOUT_MS` (60s) on a worst-case unfiltered date range.
- **Recommended fix:** Add a forward-only migration (next mig number per project convention) with `CREATE INDEX IF NOT EXISTS idx_case_tasks_completed_at ON case_tasks (completed_at) WHERE status IN ('SUBMITTED','COMPLETED');` and `CREATE INDEX IF NOT EXISTS idx_case_tasks_submitted_at ON case_tasks (submitted_at) WHERE status IN ('SUBMITTED','COMPLETED');` (partial indexes matching the actual WHERE-status predicate keep them small and on-target — mirrors the existing `idx_case_attachments_case ... WHERE deleted_at IS NULL` partial-index convention at `db/v2/migrations/0042_case_attachments.sql:28`). A composite `(status, completed_at)` could also be considered if `EXPLAIN ANALYZE` against real data (not possible in this audit) shows the partial index alone isn't selective enough.
- **Estimated effort:** S (migration + verify via `EXPLAIN` against a populated dev/staging DB, < 1 hour)
- **Priority:** P2
- **Status:** OPEN

### PERFORMANCE-02
- **Category:** Architecture — blocking-code isolation
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-400 (Uncontrolled Resource Consumption)
- **Location**
  - **File:** `apps/api/src/platform/jobs/index.ts`
  - **Line Number:** 159-188
- **Evidence:**
```ts
// apps/api/src/platform/jobs/index.ts:155-157
 * Enqueue a job: INSERT a PENDING row, then dispatch. With REDIS_QUEUE_URL set the job is added to the
 * BullMQ queue and a ROLE=worker process runs it out-of-process; otherwise it runs in-process on the
 * next tick (dev/tests need no Valkey). Either path runs the SAME runJob. Returns the PENDING tray row.
```
```
# infra/prod/docker-compose.yml:158-159
  # worker:   { <<: *api-like, environment: { ROLE: worker } }
  # report-worker: { <<: *api-like, environment: { ROLE: report } }
```
  Confirmed both `worker`/`report-worker` services are fully commented out in prod compose, and `REDIS_QUEUE_URL` is unset (per `docs/architecture-inventory.md` §4, independently confirmed by the absence of a live `valkey` service in the same file).
- **Why it is a problem:** EXPORT (XLSX/CSV up to 200k rows), IMPORT, and CASE_REPORT (puppeteer PDF rendering) jobs all run fire-and-forget inside the single `api` container's Node process — the same process handling every live HTTP request, sharing the same event loop and the same `UV_THREADPOOL_SIZE=16` libuv threadpool that scrypt password hashing and sharp image processing also use (`infra/prod/docker-compose.yml:108-111`). This is a known, partially-documented tradeoff (the threadpool sizing comment explicitly names scrypt+sharp+PDF as co-tenants), but the export/import/report job tier compounds it: a burst of large XLSX exports or several concurrent CASE_REPORT PDF jobs now also compete with that same pool, and CPU-bound XLSX-building work (`wb.xlsx.writeBuffer()`) runs synchronously on the main JS thread itself (not even threadpool-offloaded), so a large export can directly delay the event loop's processing of concurrent unrelated requests.
- **Real world attack scenario:** Not an external-attacker scenario (job triggers require authenticated `billing.view`/`export`-gated roles), but an internal user triggering a large commission-summary export or a batch of CASE_REPORT PDF downloads during business hours could measurably slow down concurrent case/task list requests and login latency (scrypt) for every other user on the platform, since there's only one API instance and no isolated worker tier in prod today.
- **Business impact:** A single heavy report-generation burst can degrade the live CRM's responsiveness platform-wide (field agents submitting tasks, office staff working the pipeline) — worse than an isolated worker-tier slowdown, since there's no bulkhead.
- **Recommended fix:** No code change required to "fix" this — it is explicitly the documented, accepted tradeoff for the current single-VPS scale (per repo memory: `apps/worker`/`apps/report-worker` exist as "placeholder builds... same Docker image as api, switched via ROLE"). The fix, when warranted by real load, is operational: deploy Valkey + uncomment the `worker`/`report-worker` services in `infra/prod/docker-compose.yml` to move EXPORT/IMPORT/CASE_REPORT off the request-serving process. Flagging here only because the audit brief specifically asked to verify this isolation, and the static evidence shows it is NOT currently in effect in prod despite the code path supporting it.
- **Estimated effort:** M (infra change + Valkey provisioning + smoke test, not a code change)
- **Priority:** P3
- **Status:** OPEN

### PERFORMANCE-03
- **Category:** Large payload handling
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `apps/api/src/platform/export/format.ts`
  - **Line Number:** 75-92
- **Evidence:**
```ts
// apps/api/src/platform/export/format.ts:74-92
async function toXlsx<T>(rows: T[], columns: ExportColumn<T>[]): Promise<Buffer> {
  // Lazy import: exceljs is heavy; only load it when an XLSX export actually runs.
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  ...
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```
- **Why it is a problem:** `wb.xlsx.writeBuffer()` (the in-memory `Workbook`, not `stream.xlsx.WorkbookWriter`) builds the entire spreadsheet in process memory before returning a `Buffer`. At the `EXPORT_JOB_MAX_ROWS` ceiling (200,000 rows, `apps/api/src/platform/export/job.ts:60`), this can be a multi-tens-of-megabyte in-memory object inside a `mem_limit: 2g` container that is also running live request traffic (per PERFORMANCE-02).
- **Real world attack scenario:** Same actor class as PERFORMANCE-02 (an authorized export user) — a near-max-row export job is memory-pressure risk, not a security exploit.
- **Business impact:** Low at current data volumes; worth re-evaluating if `EXPORT_JOB_MAX_ROWS` is ever raised or row counts approach the ceiling regularly.
- **Recommended fix:** If export volumes grow, switch to `exceljs`'s streaming `WorkbookWriter` API to bound memory to the row-buffer window instead of the whole file. Not urgent at today's scale — captured for awareness only, no FAIL assigned.
- **Estimated effort:** M
- **Priority:** P3 (informational — no fix required now)
- **Status:** OPEN

## Summary

**Counts by severity:** Critical: 0 · High: 0 · Medium: 1 · Low: 2 · Informational: 1

**Overall verdict: PARTIAL.** One Medium finding (PERFORMANCE-04, missing index on `case_tasks.completed_at`/`submitted_at`) is a real, evidenced gap directly affecting the aggregation-heavy MIS/Billing/Commission modules the audit brief called out as priority areas — it is the only finding that should be prioritized soon. The rest of the codebase shows deliberate, well-reasoned performance engineering: dashboard/billing/MIS repositories use single-scan set-based SQL with explicit no-N+1 design comments, pagination is centrally enforced with a hard 500-row cap and zero bypasses found, exports/imports are threshold-gated into background jobs with row caps, puppeteer PDF rendering has a concurrency gate and timeouts, sharp/scrypt are threadpool-sized, nginx gzip covers `application/json`, the pg pool has proper timeouts and the transaction wrapper releases connections correctly in all paths, and no recurring-timer or unbounded-cache memory-leak pattern was found anywhere in `apps/api/src`. The two Low findings (a small-N N+1 in case-task-add assignee validation, and the in-process job-tier isolation gap that is an already-documented, deferred architectural tradeoff) and one Informational (in-memory XLSX buffering at the export-volume ceiling) are real but low-urgency. "Slow APIs" could not be empirically verified (no live system, no APM tool present in the dependency inventory) — this is the one checklist item left as NOT VERIFIED rather than PASS, which is why the verdict is PARTIAL rather than PASS.
