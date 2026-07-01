# RE-AUDIT 14: Logging

Re-audited fresh against HEAD (8ded432). Baseline b19039e. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|---|---|---|
| LOGGING-01 | CONFIRMED_FIXED | `packages/logger/src/index.ts:56-70` — `redactValue()` recurses into plain objects (`Object.entries` loop, masks each `SENSITIVE_KEY` key at every depth) and arrays (`value.map`), depth-capped at `MAX_REDACT_DEPTH=6` as cycle guard. Top-level masking preserved: `redact()` calls `redactValue(record, 0)`, record is a non-null object so it enters the key loop. `value instanceof Date` guard (line 58) returns Dates untouched → serialized as ISO by `JSON.stringify`. Tests `logger.test.ts:62-101` cover top-level, nested-object, nested-array, deep (3-level), and Date cases. |
| LOGGING-02 | CONFIRMED_FIXED (doc) | `docs/security/DATA_RETENTION_POLICY.md:8-24` — audit-log line now reads "append-only (DB-trigger-enforced, migration 0017) today. Hash-chaining + monthly partitioning + an off-DB copy are deferred … PLANNED, not day-1"; `legal_hold` column corrected to "does NOT exist … policy intent, not an enforced mechanism". Table row (line 32) flags partition-drop as PLANNED. Corroborated by `db/v2/migrations/0017_concurrency_audit.sql:7-8` (own header defers hash-chain/partition) and lines 42-50 (append-only enforced via `trg_audit_log_immutable` trigger blocking UPDATE/DELETE). |
| LOGGING-03 | CONFIRMED_FIXED | `infra/prod/docker-compose.yml:21-26` (`x-logging` anchor: json-file, max-size 20m, max-file 10) applied via `logging: *default-logging` on all 6 active services — db (49), minio (71), minio-init (90), migrate (117), api (156), edge (183). No active service omits it (the only other two refs, lines 199/216, are inside commented-out future clamav/valkey stanzas). |

## New Findings

None.

Independent hunt performed: (a) grep for `console.*` / `process.stdout|stderr.write` across `apps/api/src` + `packages` (excluding tests + the logger itself) — zero hits, so no logging path bypasses the redactor; (b) confirmed the recursion introduced by LOGGING-01 does not drop top-level masking (regression check — it does not; masking runs at depth 0); (c) confirmed the `instanceof Date` guard prevents Date mangling (a plausible remediation regression — none). The depth cap silently stops recursing past level 6 rather than masking, but log-call payloads are developer-controlled shallow objects, not user-controlled depth (per the code comment), so this is an acceptable, documented trade-off, not a finding.

## Verdict

**PASS.** All three claimed fixes are real and complete against the live code: `redact()` now recurses depth-capped while preserving top-level masking and leaving Dates intact (with tests proving each), the data-retention doc honestly downgrades hash-chaining/partitioning/`legal_hold` to PLANNED and matches migration 0017's own header, and every one of the 6 active prod services caps its json-file driver at 200m. No new findings, no remediation-introduced regression, and no logging path escapes the centralized redactor. This area is clean and production-ready.
