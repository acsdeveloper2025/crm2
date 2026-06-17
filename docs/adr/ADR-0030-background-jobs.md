# ADR-0030 — Background jobs (the >8s / ≥10k worker tier)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** CTO
- **Supersedes / amends:** none (additive — fulfils B-7; the stack already froze Valkey 8 + worker roles in `DESIGN_AND_STACK_FREEZE.md`, `ALLOWED_DEPENDENCIES.md`, the `ROLE` enum in `@crm2/config`, and the `apps/worker` / `apps/report-worker` placeholders).

## Context

`PAGINATION_AND_LOADING_STANDARDS.md` §10–11 mandates that any operation exceeding ~8s — or any
export/import at/above the 10k row threshold (`EXPORT_JOB_THRESHOLD`/`IMPORT_JOB_THRESHOLD`) — must
run as a **background job**: the user keeps working, real progress is shown (Hexagon determinate %),
and completion is delivered via the bell + toast (+ a download link for exports). Until now the
synchronous export path simply threw `413 EXPORT_TOO_LARGE` at the ceiling; the import engine threw
`IMPORT_TOO_LARGE`. There was no queue, no worker, no job record.

## Decision

A single **config-gated job seam** at `platform/jobs/` mirroring `platform/realtime`/`storage`/`geocode`:

1. **`jobs` table (mig 0050)** — durable record: `type` (EXPORT|IMPORT), `status`
   (PENDING→RUNNING→SUCCEEDED|FAILED), real `progress` 0..100 + `stage`, `payload`, `result` jsonb,
   `error`, `created_by` (owner), timestamps. **Own-user scoped** at the query layer (identity, not a
   permission — like `notifications`).

2. **Processor registry** — `registerJobProcessor(type, fn)`. A processor receives a `JobContext`
   (`payload`, `userId`, `jobId`, and an async `progress(pct, stage)` that writes the row + emits a
   socket `job:progress`). It returns a `result` jsonb. Processors are registered at boot by BOTH the
   `api` role (in-process path) and the `worker` role (BullMQ path) so the contract is identical.

3. **`enqueue(type, payload, userId)`** — INSERT a PENDING row, then dispatch:
   - **`REDIS_QUEUE_URL` set →** add to a **BullMQ** queue on Valkey; a separate `worker`-role process
     consumes and runs the processor (prod / multi-instance).
   - **unset →** run the processor **in-process** on `setImmediate` after the HTTP response is sent
     (dev / tests — no Valkey needed, exactly as realtime degrades to its in-memory adapter).
   Both paths call the SAME `runJob()` which flips status/started_at, runs the processor with the
   progress callback, then writes SUCCEEDED+result or FAILED+error, emits `job:done`, and inserts a
   `JOB_COMPLETED`/`JOB_FAILED` notification (bell + socket + toast; `action_type='DOWNLOAD'` for
   exports, `payload.jobId` → the FE fetches the result download URL).

4. **Job-status API** — `GET /api/v2/jobs` (own tray, paginated) + `GET /api/v2/jobs/:id` (own; 404
   otherwise — IDOR-safe) + `GET /api/v2/jobs/:id/result-url` (presigned download for EXPORT results).

5. **FE** — `useBackgroundJob(jobId)` (react-query poll + the `job:progress`/`job:done` socket events)
   feeds the existing `HexagonLoader` determinate mode; completion repaints the bell and toasts a
   download link. The DataGrid export menu enqueues a job instead of erroring when the count ≥ threshold.

## Consequences

- Tests and local dev need **no Valkey** (in-process runner). Prod runs `ROLE=worker` against Valkey.
- Result artifacts (export files) are written to object storage (ADR-0021) and served via a
  short-lived presigned URL — the job row carries only the `storageKey`/`filename`, never bytes.
- `413/IMPORT_TOO_LARGE` become "enqueued a job" at the threshold; the synchronous path is unchanged
  below it.
- New dep **`bullmq`** (ALLOWED_DEPENDENCIES) — Valkey-backed; lazy-imported so the in-process path
  pulls nothing.

## Worker tier — BUILT (2026-06-15)

`REDIS_QUEUE_URL` set ⇒ `enqueue` adds to the BullMQ queue `acs-jobs` (Valkey) and a **`ROLE=worker`**
process (`main.ts`) consumes it, running the SAME `runJob` out-of-process (off the API event loop).
The worker boots an emit-only socket.io server on the Valkey adapter (`REDIS_CACHE_URL`) so its
`job:progress`/`job:done` reach the API's connected clients. Unset ⇒ in-process runner (dev/tests).
Dev Valkey is `docker compose up valkey` on host **6380** (v1's `crm_redis` owns 6379). Job-row cap is
the tunable **`EXPORT_JOB_MAX_ROWS`** (default 200k — covers the ~157k catalog; a larger set is flagged
`capped`, never silently truncated). Verified live: API `enqueued to BullMQ` → worker ran 157k export
→ SUCCEEDED, `capped:false`, 157,074 rows. **Remaining (carry):** streaming builders + a DB cursor to
raise the cap safely for >200k / high concurrency.

## Don't-regress

- The job seam stays config-gated + degrades to in-process when `REDIS_QUEUE_URL` is unset (never a
  hard runtime dep, like realtime/storage/geocode).
- Jobs are own-user scoped (`WHERE created_by = actor`); `:id` reads 404 for a non-owner.
- `progress` is REAL (canonical stage maps) — never an animated guess (PAGINATION §8).
- Export result bytes live in object storage; the job row carries the key, served by presigned URL.
