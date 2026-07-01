# RE-AUDIT 15: Performance

Re-audit of area 15 (Performance) against post-remediation HEAD (`8ded432`), baseline `b19039e`.
Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| PERFORMANCE-01 | CONFIRMED_FIXED | `apps/api/src/modules/cases/service.ts:347-359` — request-scoped `new Map<string, AssignableUser[]>()` inside `addTasks`; key `${t.visitType} ${t.pincodeId ?? ''} ${t.areaId ?? ''} ${t.verificationUnitId ?? ''}` (all 4 pool inputs, fixed-position, space-delimited) misses → query → cache. Key covers exactly the params `eligibleAssigneesForNew(visitType, pincodeId, areaId, verificationUnitId)` consumes (`repository.ts:851-857`). `AssignableUser` type properly imported (`service.ts:24`). |
| PERFORMANCE-04 | CONFIRMED_FIXED | `db/v2/migrations/0105_case_tasks_completion_index.sql:16` — `CREATE INDEX IF NOT EXISTS idx_case_tasks_completion_dates ON case_tasks (completed_at, submitted_at)`, BEGIN/COMMIT, idempotent. Leading `completed_at` supports MIS `WHERE ct.completed_at >= / <=` (`mis/repository.ts:69-70`) and `ORDER BY ct.completed_at DESC` (`mis/repository.ts:136`). Both columns exist (`0041:16`, `0081:20`). |
| PERFORMANCE-02 | ACCEPTED_AS_DOCUMENTED | `docs/COMPLIANCE_GAPS_REGISTRY.md:1662-1663` — ACCEPTED_RISK per ADR-0030 + docker-compose comment (in-process job tier is intentional, config-gated). No code change; matches acceptance. |
| PERFORMANCE-03 | ACCEPTED_AS_DOCUMENTED | `docs/COMPLIANCE_GAPS_REGISTRY.md:1687-1690` — ACCEPTED_RISK, pre-existing RATCHET (`docs/agents/performance.md`, 2026-06-07) with sized upgrade trigger. `wb.xlsx.writeBuffer()` still in `platform/export/format.ts`, gated to async job path only. Matches documented state. |

## New Findings

None.

Notes from independent inspection (no finding, recorded for completeness):

- **Cache-key collision check (PERFORMANCE-01):** no collision is possible. `visitType` is the enum
  `FIELD|OFFICE` (`packages/sdk/src/cases.ts:78`, no spaces); the three IDs are integers; fixed
  positions with single-space delimiters mean two distinct tuples cannot alias (e.g. `pincodeId=1,areaId=2`
  → `"FIELD 1 2 3"` vs `pincodeId=12,areaId=∅` → `"FIELD 12  3"`). The key over-differentiates for
  OFFICE (which ignores area/pincode) and FIELD (which ignores unit) — a harmless extra cache miss,
  never a wrong merge. Map is local to each `addTasks` call → no cross-request leakage.
- **Migration 0106 (DATABASE-01, adjacent):** `idx_case_tasks_verification_unit` is also sound
  (`0106:9`); unique index name, column exists (`0010_cases.sql:58`).
- **AV scan added to `addAttachment` in the same file diff (`service.ts:755-756`, `platform/av.ts`)**
  is a security item, not perf: fully async `node:net` INSTREAM, inert unless `AV_SCAN_HOST` set — no
  synchronous blocking of the request thread, no perf regression.

## Verdict

**PASS.** Both claimed fixes are real and complete against the live code: PERFORMANCE-01's pool cache
is request-scoped and correctly keyed on all four inputs `eligibleAssigneesForNew` consumes with no
possible cross-tuple aliasing, and PERFORMANCE-04's `(completed_at, submitted_at)` index is
idempotent, sound, and directly serves the MIS filter/sort hot path. Both ACCEPTED items
(PERFORMANCE-02 in-process job tier, PERFORMANCE-03 in-memory XLSX buffer) remain in their documented
accepted-risk state, unchanged. Zero new findings — the remediation introduced no regressions in this
area.
