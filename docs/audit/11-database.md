# AUDIT 11: Database

## Scope

Static, read-only inspection of the CRM2 Postgres schema and the API's data-access layer. No live DB, no migrations run.

Inspected:
- `db/v2/migrations/*.sql` — all 103 tracked migration files (schema source of truth)
- `db/v2/migrate.sh` (migration runner) and `db/v2/REGISTRY_SPEC.md` / `db/v2/BUILD_GATE_REGISTRY_LOCK.md`
- `apps/api/src/platform/db.ts` (pool + transaction helper)
- `apps/api/src/platform/audit.ts` (audit-log writer)
- `apps/api/src/modules/cases/repository.ts`, `apps/api/src/modules/tasks/repository.ts`, `apps/api/src/modules/auth/repository.ts`, `apps/api/src/modules/auth/service.ts`, plus a `withTransaction` usage sweep across all 40 `repository.ts` files under `apps/api/src`
- `docs/PAGINATION_AND_LOADING_STANDARDS.md` §13/§14 (claimed DB rules + "machine enforcement")
- `docs/security/DATA_RETENTION_POLICY.md`, `docs/operations/DISASTER_RECOVERY.md`, `runbooks/db-outage.md`
- `infra/prod/docker-compose.yml`, `infra/prod/.env.prod.example`
- `docs/architecture-inventory.md` (baseline, cross-checked not regenerated)

Commands actually run (all read-only):
- `ls db/v2/migrations | wc -l` → `103`
- `grep -n "FOREIGN KEY\|REFERENCES" db/v2/migrations/*.sql | wc -l` → `94`
- `grep -n "CREATE INDEX\|CREATE UNIQUE INDEX" db/v2/migrations/*.sql | wc -l` → `100`
- `grep -n "CREATE EXTENSION" db/v2/migrations/*.sql` → confirms `pgcrypto` (0007), `pg_trgm` (0020, 0021), `btree_gist` (0012, 0058)
- `grep -rn "SELECT \*" apps/api/src --include="*.ts"` → 1 hit, in a test file only
- A custom Python static FK-vs-index correlator (`/private/tmp/.../scratchpad/fk_check.py`) over all migrations, then manually re-verified every flagged column against the actual index/constraint definitions (the naive script has false positives for composite indexes/constraints where the FK column isn't the leading key — those were manually reconciled, see Findings)
- `grep -rl "withTransaction" apps/api/src --include="repository.ts" | wc -l` → `20` of `40` repositories use it; the other 20 were individually reviewed to confirm each is single-statement-only or genuinely doesn't need cross-row atomicity
- `grep -rn "GRANT\|REVOKE\|SUPERUSER" db/v2/migrations/*.sql infra/prod/docker-compose.yml` → no role/privilege separation found
- `find . -iname "*backup*" -not -path "*/node_modules/*"` → no backup script/cron in-repo (only an unrelated git branch name)

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Indexes | PARTIAL/PASS | `db/v2/migrations/0021_cases_growth_indexes.sql:13-23` (composite + trigram indexes matching actual query/sort patterns, with comments naming the exact query they serve); `db/v2/migrations/0012_rate_management.sql:81-82` (`idx_rates_resolve`); `apps/api/src/modules/tasks/repository.ts:132-134` filters `ct.verification_unit_id = $n` with **no index** on `case_tasks.verification_unit_id` | Overall index discipline is strong (100 `CREATE INDEX` statements, explicit comments reasoning about planner behavior) but one hot operational filter (Pipeline task list by unit) is unindexed — see DATABASE-01 |
| Constraints | PASS | `db/v2/migrations/0001_verification_unit_registry.sql:55-69` (cross-field `CHECK` invariants `chk_vu_field_visit`/`chk_vu_kyc_document`); `0010_cases.sql:24-26` (`chk_cases_status`, `chk_cases_dedupe`); `0054_task_lineage.sql:43` (partial UNIQUE backstopping a race, with comment explaining the double-bill scenario it prevents) | Real cross-field business invariants are enforced at the DB level, not just app code |
| Foreign keys | PASS | `grep -c REFERENCES` → 94 FK declarations across migrations; `apps/api/src/modules/cases/repository.ts:982` (`pgCode(e) === FK_VIOLATION` mapped to `400 INVALID_REFERENCE`), `:982` and `:467` show the app relies on the DB FK as the integrity backstop, not just app-level checks | |
| Unique keys | PASS | `0010_cases.sql:24` (`uq_cases_number`), `0010_cases.sql:47` (`uq_case_one_primary` partial-unique, exactly one primary applicant per case), `0012_rate_management.sql:76-79` (`rates_no_overlap` GiST exclusion constraint preventing overlapping rate periods for the same client/product/unit/rate_type), `0054_task_lineage.sql:43` (`uq_case_tasks_active_revisit`) | Real invariants, not just surrogate-key uniqueness |
| Transactions | PARTIAL | `apps/api/src/platform/db.ts:46-63` (`withTransaction`: BEGIN/COMMIT/ROLLBACK on one pooled client); `apps/api/src/modules/cases/repository.ts:920-980` (`assignTask`: OCC-guarded UPDATE + `task_assignment_history` INSERT + case-status recompute, all atomic); `apps/api/src/modules/auth/service.ts:297-307` (`refresh()`: `repo.revokeRefresh(claims.jti)` then a separate, non-transactional `issueTokens()` → `repo.insertRefresh()`, with JWT signing in between, not wrapped in `withTransaction`) | Case/task-creation and assignment paths are correctly atomic; refresh-token rotation is not — see DATABASE-02 |
| Isolation level | NOT VERIFIED (no override found = Postgres default) | `apps/api/src/platform/db.ts` — no `SET TRANSACTION ISOLATION LEVEL` anywhere in the pool config or `withTransaction`; `grep -rn "isolation" apps/api/src` returns only unrelated test-name matches | Runs at Postgres default READ COMMITTED. This is a reasonable default for this workload (OCC `version` columns are the actual concurrency control, not snapshot isolation), but it is implicit, not a documented decision |
| Deadlock risk | PASS | `apps/api/src/modules/cases/repository.ts:150` (single-row `SELECT ... FOR UPDATE WHERE id = $1`, always by PK); `apps/api/src/modules/tasks/service.ts:266-298` (`bulkAssign` loops per-task, each task's `assignTask` call is its own short-lived `withTransaction` — no single transaction holds multiple task-row locks at once) | The bulk-assign design specifically avoids the classic multi-row-lock-ordering deadlock pattern by never locking more than one task row per transaction |
| Slow queries | NOT VERIFIED | No query-log artifact, `pg_stat_statements` config, or slow-query threshold found in `infra/prod/docker-compose.yml` or `packages/config/src/index.ts` | Cannot verify from static inspection; would need a live system |
| Execution plans | NOT VERIFIED | `docs/PAGINATION_AND_LOADING_STANDARDS.md:151` claims every paginated endpoint must "have its query plan reviewed"; no `EXPLAIN` output, lint rule, or CI check found anywhere (`grep -rln EXPLAIN` over `apps/api/src`, `db/v2`, `docs` returns zero `.sql`/`.ts` hits, only doc mentions) | Policy text with no enforcement mechanism — see DATABASE-03 |
| Encryption at rest | FAIL | `db/v2/migrations/0010_cases.sql:34-44` (`case_applicants.name/mobile/pan` plaintext `varchar`, plus plaintext functional indexes `lower(name)`/`upper(pan)` at `:49,51`); `pgcrypto` extension (`0007_users.sql:7`) is loaded but only used for `gen_random_uuid()` — no `pgp_sym_encrypt`/column-level encryption call found anywhere (`grep -rln "pgp_sym_encrypt"` → 0 hits); `infra/prod/docker-compose.yml:27-29` — plain Docker named volume `pgdata`, no LUKS/encrypted-volume config | PAN, mobile, and name (PII under DPDP) are stored and indexed in plaintext — see DATABASE-04 |
| Backup strategy | FAIL (confirms architecture-inventory baseline) | `docs/operations/DISASTER_RECOVERY.md:21-24` claims "automated daily full base backup + continuous WAL archiving" as policy; `find . -iname "*backup*"` and `grep -rln "pg_dump\|pg_basebackup\|wal-g\|archive_command\|barman"` across `infra/`, `db/`, root → zero matches in the repo | No backup automation exists anywhere in this repo; the DR doc's own "PLANNED" markers on adjacent items (encryption, replication, failover) make clear the backup claim itself is unverified from code — re-confirms architecture-inventory.md's "could not be determined" |
| Retention | FAIL | `docs/security/DATA_RETENTION_POLICY.md:9` ("Ground truth": "`consent`, `retention`, `legal_hold` columns exist **day-1**") vs. `grep -rn "legal_hold" db/v2/migrations/*.sql apps/api/src` → **zero hits** anywhere in the schema or code; policy doc's own §"Enforcement" (`:41-43`) admits "a scheduled purge job (PLANNED)... Until it lands, retention is policy-only (no automated deletion)" | The "Ground truth" section overclaims relative to the schema; no purge/archival job exists anywhere (`grep -rln "purge\|PURGE"` over `apps/api/src` → only mobile-device-side sync-purge comments, unrelated) — see DATABASE-05 |
| PII handling | PARTIAL | Same evidence as Encryption at rest; `db/v2/migrations/0001_verification_unit_registry.sql:44` (`pii_sensitive` flag exists on `verification_units`, "drives masking/field-encryption downstream" per comment at `:10`) but no masking/encryption code keyed off that flag was found (`grep -rln "piiSensitive\|pii_sensitive" apps/api/src` limited to read-through of the flag value, no redaction logic located) | The flag exists and is plumbed through, but nothing downstream acts on it for masking/encryption |
| Audit tables | PASS | `db/v2/migrations/0017_concurrency_audit.sql:28-50` — `audit_log` table + `audit_log_block_mutation()` trigger function that `RAISE EXCEPTION`s on any `UPDATE`/`DELETE`, wired via `BEFORE UPDATE OR DELETE ON audit_log`; same pattern reused for `task_assignment_history` (`0036_task_assignment.sql:33-38`); `apps/api/src/platform/audit.ts:21-31` (`appendAudit` always called with the same-transaction `q`, single `INSERT`, never `UPDATE`) | Genuinely DB-enforced append-only, not just convention — but see DATABASE-06 for the privilege-separation caveat |

## Findings

### DATABASE-01
- **Category:** Performance / Indexing
- **Severity:** Low
- **CVSS:** 3.1 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L) — availability/perf degradation only, no data exposure
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1049 (Inadequate Filtering of Database Query)
- **Location**
  - **File:** `apps/api/src/modules/tasks/repository.ts`
  - **Line Number:** 132-134
- **Evidence:**
  ```
  if (o.unitId !== undefined) {
    params.push(o.unitId);
    where.push(`ct.verification_unit_id = $${params.length}`);
  }
  ```
  No `CREATE INDEX ... ON case_tasks (verification_unit_id)` exists anywhere in `db/v2/migrations/*.sql` (verified via `grep -n "case_tasks" db/v2/migrations/*.sql | grep -iE "CREATE (UNIQUE )?INDEX"`, which lists indexes on `case_id`, `assigned_to`, `status`, `applicant_id`, `area_id`, `parent_task_id`, `created_at`, `assigned_at`, and a composite `(case_id, task_number)` — `verification_unit_id` is absent).
- **Why it is a problem:** The Pipeline task list (the primary operational screen) supports filtering by verification unit, and that filter is a plain equality predicate with no supporting index. On `case_tasks` — the one table flagged elsewhere in the same migration set as growing unbounded (cf. `0021_cases_growth_indexes.sql` comment about `cases`) — this degrades to a sequential scan as the table grows.
- **Real world attack scenario:** Not an attack vector; a performance/availability concern. An operations user filtering the Pipeline by a specific verification unit (e.g. "show me all PAN verification tasks") on a multi-hundred-thousand-row `case_tasks` table triggers a full table scan, slowing the page for all concurrent users sharing the connection pool (`DB_POOL_MAX` default 10).
- **Business impact:** Violates the documented `docs/PAGINATION_AND_LOADING_STANDARDS.md` §12 budget ("Pipeline < 2s") as case volume grows; degrades shared-pool responsiveness for every other in-flight request.
- **Recommended fix:** `CREATE INDEX IF NOT EXISTS idx_case_tasks_unit ON case_tasks (verification_unit_id);` as a new forward-only migration.
- **Estimated effort:** S (1 migration file)
- **Priority:** P3
- **Status:** OPEN

### DATABASE-02
- **Category:** Transactions / Data Integrity
- **Severity:** Low
- **CVSS:** 2.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L) — availability impact for the affected user only, fails closed
- **OWASP Mapping:** A04:2021 – Insecure Design
- **CWE Mapping:** CWE-662 (Improper Synchronization)
- **Location**
  - **File:** `apps/api/src/modules/auth/service.ts`
  - **Line Number:** 297-307
- **Evidence:**
  ```ts
  await repo.revokeRefresh(claims.jti);
  return issueTokens(
    claims.userId,
    status.role,
    { deviceId: row.deviceId, deviceInfo: row.deviceInfo },
    ip,
    row.absoluteExpiresAt ? new Date(row.absoluteExpiresAt) : null,
  );
  ```
  `issueTokens` (lines 118-147) does JWT signing (`Promise.all([signAccessToken, signRefreshToken])`) and then a separate `repo.insertRefresh(...)` call. Neither `revokeRefresh` nor `insertRefresh` is wrapped in `withTransaction` (confirmed: `apps/api/src/modules/auth/repository.ts` does not import `withTransaction` — `grep -n withTransaction apps/api/src/modules/auth/repository.ts` → no match).
- **Why it is a problem:** Refresh-token rotation revokes the presented token and issues a new one as two independent, non-atomic database statements with async crypto work in between. A crash, timeout, or connection drop between the two leaves the old token revoked and no new token issued.
- **Real world attack scenario:** Not exploitable for privilege escalation (it fails closed — the user is simply logged out and must re-authenticate), but under load or a transient DB blip during a refresh burst, a field agent or office user can be unexpectedly logged out mid-session with no recourse but re-login.
- **Business impact:** Minor availability/UX impact (forced re-login), not a security bypass. Low likelihood given the operations are adjacent in the same request and typically fast.
- **Recommended fix:** Wrap `revokeRefresh` + `insertRefresh` in a single `withTransaction` (the JWT signing itself doesn't need to be inside the transaction, only the two DB writes).
- **Estimated effort:** S (a few lines, refactor `issueTokens`/`refresh` to share a `TxQuery`)
- **Priority:** P3
- **Status:** OPEN

### DATABASE-03
- **Category:** Process / Enforcement Gap
- **Severity:** Low
- **CVSS:** N/A (process gap, not directly exploitable)
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `docs/PAGINATION_AND_LOADING_STANDARDS.md`
  - **Line Number:** 151
- **Evidence:** `"Every paginated endpoint MUST: use indexes on the sort/filter columns · avoid full table scans · avoid SELECT * (return only required columns) · have its query plan reviewed."` — no `EXPLAIN` artifact, CI step, or lint rule enforcing "query plan reviewed" was found: `grep -rln "EXPLAIN" apps/api/src db/v2` → zero source-code hits (only doc mentions in unrelated files like `DATAGRID_STANDARD.md`).
- **Why it is a problem:** The standard claims a process ("query plan reviewed") that has no machine enforcement and no recorded evidence (no committed `EXPLAIN` output, no CI gate). §14 of the same doc lists 5 specific CI-enforced gates (pagination validation, query-count validation, N+1 detection, performance validation, large-dataset testing) — none of them are "query plan reviewed."
- **Real world attack scenario:** N/A — this is a documentation/process-rigor gap, not a vulnerability. The actual index coverage observed in migrations is good (see Checklist "Indexes" row), so the practical risk is low, but the claim itself is unverifiable and should not be asserted as a guarantee.
- **Business impact:** False confidence — a future endpoint could ship without index-backed query plans and nothing in CI would catch it, despite the doc asserting this is "frozen" and enforced.
- **Recommended fix:** Either (a) add a lightweight CI check that captures `EXPLAIN (FORMAT JSON)` for the paginated endpoints' generated SQL and fails on `Seq Scan` over tables above a row-count threshold, or (b) soften the doc's wording from "MUST...have its query plan reviewed" to reflect that this is a manual code-review practice, not a machine gate.
- **Estimated effort:** M (if building the CI check) / S (if just correcting the doc)
- **Priority:** P3
- **Status:** OPEN

### DATABASE-04
- **Category:** PII / Encryption
- **Severity:** Medium
- **CVSS:** 4.9 (AV:L/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N) — requires DB-level access (already gated by network/secrets), but full plaintext PII exposure if that boundary is crossed
- **OWASP Mapping:** A02:2021 – Cryptographic Failures
- **CWE Mapping:** CWE-312 (Cleartext Storage of Sensitive Information)
- **Location**
  - **File:** `db/v2/migrations/0010_cases.sql`
  - **Line Number:** 34-44 (table), 49 and 51 (plaintext functional indexes)
- **Evidence:**
  ```sql
  CREATE TABLE IF NOT EXISTS case_applicants (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id        uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    name           varchar(200) NOT NULL,
    mobile         varchar(20),
    pan            varchar(20),
    ...
  );
  ...
  CREATE INDEX IF NOT EXISTS idx_applicants_name ON case_applicants (lower(name));
  CREATE INDEX IF NOT EXISTS idx_applicants_mobile ON case_applicants (mobile);
  CREATE INDEX IF NOT EXISTS idx_applicants_pan ON case_applicants (upper(pan));
  ```
  `pgcrypto` is loaded (`0007_users.sql:7`) but `grep -rln "pgp_sym_encrypt" db/v2 apps/api/src` returns zero hits — it is used only for `gen_random_uuid()` default values, never for column encryption.
- **Why it is a problem:** PAN (a sensitive Indian government ID, directly regulated under DPDP) and mobile number are stored, and explicitly indexed, in cleartext. `verification_units.pii_sensitive` (migration 0001, comment: "drives masking/field-encryption downstream") exists as a flag but no downstream masking/encryption was found acting on it (`grep -rn "piiSensitive" apps/api/src` shows only the flag being read/returned, not used to redact or encrypt).
- **Real world attack scenario:** A DB credential leak, an over-privileged read-replica/reporting connection, or a misconfigured backup/export (cf. DATABASE-05's "no backup automation found" — meaning ad hoc `pg_dump`s by an operator are the likely actual backup path today) would expose every applicant's full name, mobile number, and PAN in plaintext, with zero additional decryption step required.
- **Business impact:** This is a KYC/RCU vendor handling bank-client PII under DPDP and likely RBI data-handling expectations (per `docs/security/DATA_RETENTION_POLICY.md`'s own framing, "Indian banking RCU vendor"). Plaintext PAN/mobile at rest is a real regulatory and breach-notification exposure if any layer below the API (DB host, backup, replica, leaked credential) is compromised.
- **Recommended fix:** Either column-level encryption (`pgcrypto`'s `pgp_sym_encrypt`/`pgp_sym_decrypt`, with the key held outside the DB — mirroring the existing `MFA_ENC_KEY` AES-256-GCM pattern already used for TOTP secrets) for `pan` and `mobile`, or, at minimum, drop the plaintext functional indexes on `pan` if exact-match search isn't a hard requirement, and document this as an accepted residual risk with compensating controls (network isolation, backup encryption) if encryption is intentionally deferred.
- **Estimated effort:** L (touches every read/write path for applicant PAN/mobile, plus search/dedupe logic that currently relies on `upper(pan)`/equality matching)
- **Priority:** P2
- **Status:** OPEN

### DATABASE-05
- **Category:** Data Retention / Compliance
- **Severity:** Medium
- **CVSS:** N/A (compliance/process gap, not directly exploitable)
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1059 (Insufficient Technical Documentation — applied here to a documented-vs-actual schema mismatch)
- **Location**
  - **File:** `docs/security/DATA_RETENTION_POLICY.md`
  - **Line Number:** 9
- **Evidence:** `"DPDP / PII: verification units flagged pii_sensitive (IDENTITY / FINANCIAL); consent, retention, legal_hold columns exist day-1."` — under the doc's own "Ground truth" heading (implying verified fact, not aspiration). `grep -rn "legal_hold" db/v2/migrations/*.sql apps/api/src --include="*.sql" --include="*.ts"` → **zero matches** anywhere in the schema or codebase. A `consents` table does exist (`0070_mobile_consents.sql:8`) but it is policy-acceptance tracking (terms/DPDP consent acknowledgement), not a generic per-record `consent`/`retention`/`legal_hold` column set as the doc implies.
- **Why it is a problem:** The retention policy's own "Ground truth" section overclaims schema support that does not exist, for a column (`legal_hold`) that the same document's "Rules" section (line 31) says is load-bearing: "Legal hold suspends disposal. While `legal_hold` is set on a record... no purge/anonymise/expiry runs regardless of retention period." If a purge job were built today against this doc without re-verifying the schema, it would have no `legal_hold` column to check.
- **Real world attack scenario:** N/A directly, but the operational risk is real: if/when the "PLANNED" purge job (acknowledged at line 41-43 of the same doc) is eventually implemented, a developer trusting the "Ground truth" section's claim that `legal_hold` "exists day-1" could ship a purge job with no actual legal-hold gate, permanently destroying records under active legal hold (e.g. mid-litigation bank verification reports).
- **Business impact:** For an "Indian banking RCU vendor" (the doc's own framing) with 8-10 year regulatory retention requirements, a purge job built on a false premise could destroy records a bank/regulator needs, with real legal exposure.
- **Recommended fix:** Correct the doc's "Ground truth" section to reflect actual state (no `legal_hold`/generic `retention` columns exist yet), and treat `legal_hold` as a hard pre-requisite to build (with its own migration + a fail-closed default of "hold" for any case where retention status is ambiguous) before the purge job in line 41 is implemented — not an assumed precondition.
- **Estimated effort:** S (doc correction) + L (if/when the actual purge job + `legal_hold` column + retention enforcement is built)
- **Priority:** P2
- **Status:** OPEN

### DATABASE-06
- **Category:** Privilege Separation / Defense in Depth
- **Severity:** Low
- **CVSS:** N/A (no exploitable path found; this is a missing defense-in-depth layer, not a demonstrated bypass)
- **OWASP Mapping:** A01:2021 – Broken Access Control
- **CWE Mapping:** CWE-269 (Improper Privilege Management)
- **Location**
  - **File:** `infra/prod/.env.prod.example`
  - **Line Number:** (POSTGRES_USER / DATABASE_URL lines)
- **Evidence:**
  ```
  POSTGRES_USER=crm2
  DATABASE_URL=postgresql://crm2:__same_password__@db:5432/crm2_prod
  ```
  This is the same `crm2` role used by `infra/prod/docker-compose.yml`'s `migrate` service (`DATABASE_URL: ${DATABASE_URL}`, line 81), meaning the API runtime connects as the schema-owning role. `grep -rn "GRANT\|REVOKE" db/v2/migrations/*.sql` returns zero results — no privilege restriction was ever applied to a separate, more-limited runtime role.
- **Why it is a problem:** The append-only guarantee on `audit_log` and `task_assignment_history` (DATABASE checklist "Audit tables" = PASS) is enforced entirely by a `BEFORE UPDATE OR DELETE` trigger (`db/v2/migrations/0017_concurrency_audit.sql:42-50`). A trigger is not bypass-proof against the table owner — the owning role can run `ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable` and then freely rewrite history. Because the API's runtime DB role is the same table-owning role that ran the migrations, there is no DB-level privilege boundary stopping an attacker who achieves SQL injection or arbitrary-query execution (e.g. via a future code defect) from disabling the trigger and rewriting audit history.
- **Real world attack scenario:** If a future code change introduced a SQL injection point (none found in this audit — all production code paths use parameterized queries, see Audit 5/SQL-injection-focused audits for that determination), the attacker's queries would run as the same role that owns `audit_log`, able to `ALTER TABLE ... DISABLE TRIGGER` and erase the evidence trail for a falsified KYC/field verification, then re-enable it — leaving no trace in the one table designed to be tamper-evident.
- **Business impact:** Undermines the audit trail's value as forensic/legal evidence (the retention policy explicitly relies on audit-log integrity for "any such proceeding" per `0073_policy_acceptance.sql:148`) if the runtime credential is ever fully compromised.
- **Recommended fix:** Create a separate, lower-privileged runtime DB role (no `ALTER TABLE`/no trigger-disable rights, no `DROP`) for the `api`/`worker`/`report-worker` containers, distinct from the migration-runner role; grant it only `SELECT/INSERT/UPDATE/DELETE` on application tables and explicitly withhold `TRIGGER`-disable-capable ownership on `audit_log`/`task_assignment_history`.
- **Estimated effort:** M (new role + migration-time grants + deploy/secrets wiring)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Informational | 0 |

**Overall verdict: PARTIAL.**

No Critical or High findings. The core schema is well-engineered for an "enterprise" build: real cross-field `CHECK` invariants, a GiST exclusion constraint preventing overlapping rate periods, optimistic-concurrency `version` columns consistently wrapped in `withTransaction` for every write that needs atomicity (case creation, task assignment + history + audit, completion, revisit/reassign), a genuinely DB-enforced (trigger-blocked) append-only `audit_log`, and thoughtful, comment-justified indexing including trigram indexes for search. The findings that exist are real but bounded: one missing index on a hot filter (Low), one non-atomic refresh-token rotation that fails closed rather than open (Low), an unenforced "query plan reviewed" process claim (Low), no DB-level privilege separation backstopping the audit trigger (Low), and two genuine documentation-vs-reality gaps — plaintext PII storage despite a `pii_sensitive` flag with no downstream masking/encryption (Medium), and a retention-policy document that asserts `legal_hold`/`retention` columns "exist day-1" when they do not exist anywhere in the schema (Medium). Backup automation, slow-query monitoring, and execution-plan review could not be verified from this static repo — consistent with `docs/architecture-inventory.md`'s own "could not be determined" flag on backups, which this audit independently reconfirms.
