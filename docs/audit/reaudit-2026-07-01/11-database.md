# RE-AUDIT 11: Database

Re-audit of area 11 (Database) against current HEAD (`8ded432`), baseline `b19039e`.
Read-only static inspection; no live DB touched.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| DATABASE-01 | CONFIRMED_FIXED | `db/v2/migrations/0106_case_tasks_verification_unit_index.sql:9` — `CREATE INDEX IF NOT EXISTS idx_case_tasks_verification_unit ON case_tasks (verification_unit_id)`. FK is at `db/v2/migrations/0010_cases.sql:58` and had **no** prior index (grep of all migrations: only case/assigned/status/created/etc. indexes on `case_tasks`, none on `verification_unit_id`). Live filter it serves confirmed at `apps/api/src/modules/tasks/repository.ts:134` (`ct.verification_unit_id = $N`). Non-redundant, idempotent. |
| DATABASE-02 | CONFIRMED_FIXED | `apps/api/src/modules/auth/repository.ts:201-220` — `rotateRefresh()` wraps revoke-old + insert-new in a single `withTransaction`. Wired at `apps/api/src/modules/auth/service.ts:327` via the `persist` callback injected into `issueTokens` (`service.ts:127`). Diff `b19039e..8ded432` confirms the pre-remediation `refresh()` did two independent `query()` calls. Transaction correctly kept inside the repository layer (`db-access-only-in-repositories` boundary). |
| DATABASE-03 | CONFIRMED_FIXED (doc) | `docs/PAGINATION_AND_LOADING_STANDARDS.md:154-159` — explicit correction that "query plan reviewed" is a manual PR-review practice, not a §14 CI gate; no automated EXPLAIN check claimed. |
| DATABASE-05 | CONFIRMED_FIXED (doc) | `docs/security/DATA_RETENTION_POLICY.md:5,9,14-17,32,52` — `legal_hold` column + hash-chaining/partitioning all explicitly marked **PLANNED**, not day-1; "Ground truth" note corrects the prior false claim. |
| DATABASE-04 | STILL_DEFERRED_AS_DOCUMENTED | `docs/COMPLIANCE_GAPS_REGISTRY.md:1598-1605` (Medium deferred). `cases/repository.ts` unchanged in `b19039e..8ded432` (`git diff --stat` shows only the 2 index migrations under `db/`); no pgcrypto/encrypt/blind-index in 0105/0106. PII columns still plaintext, dedupe/ILIKE-search intact — correctly untouched pending searchable-encryption ADR. |
| DATABASE-06 | STILL_DEFERRED_AS_DOCUMENTED | `docs/COMPLIANCE_GAPS_REGISTRY.md:1639-1641` (Low deferred). No `CREATE ROLE`/`GRANT`/`REVOKE`/`ALTER ROLE` in 0105/0106; no infra role-separation attempted. Documented as needing live DB-admin access. |

## New Findings

None.

Independent checks performed, all clean:
- **Lock hazard on the two new indexes:** both are plain (non-`CONCURRENTLY`) `CREATE INDEX` in `BEGIN/COMMIT`. This takes a write-blocking `SHARE` lock on `case_tasks` for the build. However, **zero** migrations in the repo history use `CONCURRENTLY` — 0105/0106 follow the identical established convention (`0010`, `0036`, `0037`, `0039`, `0054`, etc. all plain). No regression; consistent with the migrate.sh transactional runner. On a small/idle `case_tasks` the build is sub-second. (`CONCURRENTLY` cannot run inside a transaction anyway, which would break the runner's per-file BEGIN/COMMIT.)
- **Idempotency:** both use `CREATE INDEX IF NOT EXISTS` — safe re-run.
- **Numbering:** 0104/0105/0106 sequential, no filename-number duplicates across `db/v2/migrations/`.
- **Index correctness / non-redundancy:** 0106 serves a real live predicate (tasks/repository.ts:134) with no pre-existing covering index; 0105's composite `(completed_at, submitted_at)` matches MIS `ORDER BY completed_at DESC` and the Billing/Commission range anchor, and the migration comment honestly documents the one query it does NOT cover (the `AT TIME ZONE`-wrapped STABLE expression) rather than overclaiming.
- **rotateRefresh atomicity vs. reuse-detection:** revoke-then-insert ordering is correct; a replayed old jti is already `revoked_at`-set and rejected by the existing reuse path. No new race introduced.

## Verdict

**PASS.** All four claimed fixes (DATABASE-01, -02, -03, -05) are real and complete against the actual file:line — the FK index is genuinely new and query-backed, the refresh-token rotation is a single well-placed transaction wired into the live refresh path, and both doc corrections accurately restate ground truth. The two deferred items (DATABASE-04 PII plaintext, DATABASE-06 role separation) are confirmed untouched and remain in their documented deferred state — the remediation did not accidentally "half-fix" or worsen them. The two new migrations are additive, idempotent, non-redundant, and follow the repo's long-standing non-concurrent-index convention, so they introduce no lock or numbering regression. Zero new findings; this area is clean.
