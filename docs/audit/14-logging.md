# AUDIT 14: Logging

## Scope

Inspected:
- `packages/logger/src/index.ts`, `packages/logger/src/logger.test.ts` (the centralized `@crm2/logger`)
- `apps/api/src/http/app.ts` (request-observability middleware, global error handler)
- `apps/api/src/platform/audit.ts` (application audit trail)
- `db/v2/migrations/0017_concurrency_audit.sql` (audit_log schema + immutability trigger)
- All `logger.*` call sites under `apps/api/src` (52 call sites), specifically in `modules/auth/*`, `http/authenticate.ts`, `http/enrichAuth.ts`, `http/refreshCookie.ts`, `modules/users/repository.ts`, `modules/cases/service.ts`, `modules/verification-tasks/service.ts`, `modules/fieldReports/service.ts`, `platform/realtime/index.ts`, `platform/jobs/index.ts`, `platform/geocode/*`, `platform/mail/index.ts`, `platform/push/index.ts`, `platform/staticmap/index.ts`, `modules/system/service.ts`
- `apps/worker/`, `apps/report-worker/` (confirmed placeholder/no source — `apps/worker/package.json` description: "Implemented in a later build step"; jobs actually run in-process inside `api` per `infra/prod/docker-compose.yml` comments)
- `infra/prod/docker-compose.yml` (full file, 172 lines) — Docker logging-driver config
- `infra/prod/deploy.sh` (log handling during deploy)
- `docs/operations/OBSERVABILITY_STANDARDS.md`, `docs/security/DATA_RETENTION_POLICY.md`, `docs/COMPLIANCE_GAPS_REGISTRY.md` (cross-checked doc claims against code)
- `eslint.config.js` (no-console enforcement)
- `apps/api/src/modules/users/repository.ts` (audit `before`/`after` payload composition — checked for password-hash leakage into `audit_log`)
- `packages/sdk/src/users.ts` (`User` type shape — confirms no secret fields ever flow into audited rows)

Commands actually run (read-only):
```
grep -rn "console\.(log|error|warn|info|debug)" apps/api/src --include="*.ts"   → 0 hits
grep -rn "console\.(log|error|warn|info|debug)" apps/worker/src --include="*.ts" → 0 hits (no src/ dir)
grep -rn "console\.(log|error|warn|info|debug)" apps/report-worker/src --include="*.ts" → 0 hits (no src/ dir)
grep -n "no-console" eslint.config.js → line 41: 'no-console': 'error' (files: **/*.{ts,tsx}, repo-wide)
grep -rn "logger\.(info|warn|error|debug|trace|fatal)(" apps/api/src --include="*.ts" | wc -l → 52
grep -rn "appendAudit" apps/api/src --include="*.ts" | grep -v audit.ts | wc -l → 14 (master-data modules)
grep -n "logging:|driver:|max-size|max-file" infra/prod/docker-compose.yml → 0 hits
find . -iname "daemon.json" -not -path "*/node_modules/*" → 0 hits
node -e "<simulate redact() against a nested object>" → confirms redact() is shallow (one level only)
```

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Passwords never logged | PASS | `packages/logger/src/index.ts:50` `SENSITIVE_KEY` regex matches `pass(word)?` on top-level keys; grep of all 52 `logger.*` call sites in `apps/api/src` found zero sites passing a `password`/`passwordHash` field or a raw object containing one. `apps/api/src/modules/users/repository.ts:13-14` `COLS` (used for both API responses and audit `before`/`after` snapshots) excludes `password_hash` entirely. | Defense-in-depth (regex) backed by clean call-site discipline (no raw-body/object logging found anywhere) |
| JWT never logged | PASS | Same `SENSITIVE_KEY` regex matches `jwt`/`token`. Grepped `apps/api/src/http/authenticate.ts`, `enrichAuth.ts`, `modules/auth/{service,controller,repository,version.*}.ts` — zero `logger.*` calls in `authenticate.ts`/`enrichAuth.ts`/`controller.ts` at all; the one call in `service.ts:283` logs only `{ userId: claims.userId }` on refresh-reuse. | No call site ever passes a raw token |
| Cookies never logged | PASS | `grep -rn "logger\." apps/api/src --include="*.ts" -A2 \| grep -iE "cookie\|authorization\|\.headers\b"` → 0 hits. `apps/api/src/http/refreshCookie.ts` has zero `logger` calls. | httpOnly refresh cookie (web) never touches a log call site |
| Authorization header never logged | PASS | Same grep as above, 0 hits across the whole `apps/api/src` tree; `app.ts`'s `requestObservability()` (lines 54-73) logs an explicit allowlist (`method, path, status, durationMs, userId`), never `req.headers` | Allowlist-style access log, not a blanket header/body dump |
| PII never logged | PASS (with one shallow-redaction caveat, see LOGGING-01) | Grepped all `logger.*` calls in `cases/service.ts`, `verification-tasks/service.ts`, `fieldReports/service.ts`, `users/repository.ts` — every call passes only IDs (`taskId`, `caseId`, `userId`), filenames, or `error: e.message`; never a case/applicant/KYC payload field | `redact()` is shallow (top-level keys only) — see LOGGING-01 for the latent gap; no current call site exploits it |
| Audit trail | PASS | `apps/api/src/platform/audit.ts:1-39` — `appendAudit()` writes one row per CREATE/UPDATE/DEACTIVATE/ACTIVATE to `audit_log`, called from inside the same DB transaction as the write (`q` param) in 14 repository modules (`grep -rln appendAudit apps/api/src --include="*.ts"` → clients, products, scopeAssignments, designations, cases, roles, departments, policies, rateTypes, locations, users, verificationUnits, cpv, tatPolicies repositories) | Confirmed via `docs/COMPLIANCE_GAPS_REGISTRY.md:495-505`: "C-10 ADMINISTRATION COMPLETE" — all 8 editable admin surfaces OCC-guarded + audited |
| Tamper resistance | PARTIAL — PASS for DB-row level, FAIL for the production-hardening layer the project's own docs claim is done | `db/v2/migrations/0017_concurrency_audit.sql:38-47` — `audit_log_block_mutation()` trigger `RAISE EXCEPTION`s on any UPDATE/DELETE against `audit_log`, installed `BEFORE UPDATE OR DELETE`. This genuinely makes `audit_log` rows immutable at the DB layer. BUT: `docs/security/DATA_RETENTION_POLICY.md:9` states as "Ground truth": "Audit log: append-only, **hash-chained, partitioned monthly**" — neither hash-chaining nor partitioning exist in any migration (`grep -rln "audit_log" db/v2/migrations/*.sql \| xargs grep -ln "hash\|chain\|partition"` → only hits the *comment* in 0017 itself, which says hash-chain/partition are explicitly NOT done: "NOTE: hash-chaining + monthly partitioning + off-DB copy ... are deferred") | See LOGGING-02. The gap IS tracked (`COMPLIANCE_GAPS_REGISTRY.md:505`, "C-10 ... still deferred"), so it is not silently dropped per repo rules — but the *implementation* is genuinely incomplete and one source doc (`DATA_RETENTION_POLICY.md`) incorrectly states it as already-shipped fact |
| Log rotation | FAIL | `infra/prod/docker-compose.yml` (full 172-line file read) contains **zero** `logging:` blocks on any of the 6 services (db/minio/minio-init/migrate/api/edge); no `driver:`/`max-size:`/`max-file:` keys anywhere in the file. `find . -iname "daemon.json" -not -path "*/node_modules/*"` → no Docker daemon-level override either. Application logs go to `process.stdout` (`packages/logger/src/index.ts:61`), which Docker's **default `json-file` driver captures with no size cap and no rotation** unless explicitly configured | See LOGGING-03. This is the same disk-exhaustion failure mode that caused the documented 2026-06-26 prod outage (per project memory, that incident was un-pruned *image* layers, not logs — but the *mechanism* — unbounded disk growth under the same default Docker behavior — is identical and currently unmitigated for container logs) |
| Retention | FAIL | `docs/security/DATA_RETENTION_POLICY.md:27` documents "System / application logs: 90–180 d ... Rotate + delete" as policy, and explicitly says under "Enforcement": "a scheduled purge job (PLANNED) ... Until it lands, retention is **policy-only** (no automated deletion)." `docs/operations/OBSERVABILITY_STANDARDS.md:17` says "Retention of log data follows `DATA_RETENTION_POLICY.md`" — but there is no rotation, no shipper, no purge job, and (per LOGGING-03) no Docker log-rotation config, so in practice retention is unbounded-growth-until-disk-fills, not 90-180 days | `grep -n -i "json-file\|log rotation\|docker.*log\|stdout.*retention" docs/COMPLIANCE_GAPS_REGISTRY.md` → 0 hits: this specific gap (app/system log retention enforcement) is **not tracked** in the compliance registry at all, unlike the `audit_log` hardening gap which is tracked. See LOGGING-03 |

## Findings

### LOGGING-01
- **Category:** Logging / Defense-in-Depth Gap
- **Severity:** Low
- **CVSS:** 3.1 (AV:L/AC:H/PR:H/UI:N/S:U/C:L/I:N/A:N) — N/A as a directly exploitable vuln; this is a latent weakness, not a live leak
- **OWASP Mapping:** A09:2021 – Security Logging and Monitoring Failures
- **CWE Mapping:** CWE-532 (Insertion of Sensitive Information into Log File) — potential, not confirmed exploited
- **Location**
  - **File:** packages/logger/src/index.ts
  - **Line Number:** 52-56
- **Evidence:**
```ts
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|jwt|api[-_]?key|mfa|credential/i;
const REDACTED = '[REDACTED]';
function redact(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : v;
  return out;
}
```
  Verified via direct execution:
```
$ node -e "... redact({ msg: 'debug', user: { username: 'bob', password: 'hunter2' }, headers: { authorization: 'Bearer xyz' } }) ..."
{
  "msg": "debug",
  "user": { "username": "bob", "password": "hunter2" },
  "headers": { "authorization": "Bearer xyz" }
}
```
  Nested secrets pass through completely unredacted — `redact()` only inspects top-level keys of the `fields` object, never recurses, and never touches the `msg` string itself (no template-literal interpolation guard either).
- **Why it is a problem:** The redaction is the project's documented "defense-in-depth" backstop (per the code comment at `index.ts:46-49`, citing ADR-0076 SEC-11) for exactly the scenario of "a careless `logger.info('x', { authorization, password, token, ... })`". Today every call site is disciplined (verified: 52/52 `logger.*` calls in `apps/api/src` pass only scalar IDs or `e.message` strings, never a raw object/header/body). But the backstop itself would not catch the very next careless call if it nested the secret one level down (e.g. `logger.warn('upstream call failed', { request: axiosError.config })`, which is a realistic shape for any future Axios/fetch-error logging since Axios error objects carry `config.headers.Authorization`).
- **Real world attack scenario:** A future developer adds error logging around an outbound HTTP call (e.g. a new payment/SMS/KYC-vendor integration) and logs the raw error object or its `config`/`response` sub-object for debugging. If that object carries an `Authorization` header or API key nested under a non-top-level key, it is written verbatim to stdout/Docker logs, where (per LOGGING-03) it has no rotation and persists indefinitely on disk — readable by anyone with shell/Docker access to the box, or exfiltrated if the box is ever compromised.
- **Business impact:** Low likelihood today (no current call site triggers it) but the blast radius if it does fire is a real credential/PII leak with no compensating control, since the only redaction layer is this shallow regex.
- **Recommended fix:** Make `redact()` recurse into plain-object and array values (bounded depth, e.g. 3-4 levels, to avoid pathological cycles/perf issues), still matching on key name. Add a unit test mirroring the existing `logger.test.ts` "redacts sensitive-named fields" case but with a nested payload, so a regression is caught at the same place the existing redaction tests live (`packages/logger/src/logger.test.ts:62-80`).
- **Estimated effort:** S (a few hours — function + test)
- **Priority:** P3
- **Status:** OPEN

### LOGGING-02
- **Category:** Logging / Documentation-Reality Drift (Tamper Resistance)
- **Severity:** Medium
- **CVSS:** N/A (documentation accuracy issue, not a direct vulnerability)
- **OWASP Mapping:** A09:2021 – Security Logging and Monitoring Failures
- **CWE Mapping:** CWE-1059 (Insufficient Technical Documentation) / adjacent to CWE-778 (Insufficient Logging) for the underlying incomplete control
- **Location**
  - **File:** docs/security/DATA_RETENTION_POLICY.md (claim) vs db/v2/migrations/0017_concurrency_audit.sql (actual implementation)
  - **Line Number:** DATA_RETENTION_POLICY.md:9; migration 0017 lines 7-8 and 38-47
- **Evidence:**
  `docs/security/DATA_RETENTION_POLICY.md:9` (listed under "## Ground truth", i.e. presented as already-implemented fact):
  > `- **Audit log:** append-only, hash-chained, partitioned **monthly**.`

  `db/v2/migrations/0017_concurrency_audit.sql:7-8` (the migration's own comment, written by the same project):
  > `-- NOTE: hash-chaining + monthly partitioning + off-DB copy (the §1 production-hardening on top of`
  > `-- append-only) are deferred and tracked — this immutable append-only log satisfies the C-10 contract.`

  The actual `audit_log` DDL (lines 29-39) has no hash/prev-hash column and is a single non-partitioned table:
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type   text        NOT NULL,
  entity_id     text        NOT NULL,
  action        text        NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'ACTIVATE')),
  actor_id      text,
  before_data   jsonb,
  after_data    jsonb,
  version_after integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```
  Tamper resistance present today is **only** the `BEFORE UPDATE OR DELETE` trigger (lines 40-47) that blocks row mutation — no cryptographic chain-of-custody, so a sufficiently privileged actor with raw DB access (e.g. a compromised `POSTGRES_USER`, or anyone who can `DROP TRIGGER`/issue raw SQL with superuser rights) could still insert fabricated rows or drop+recreate the table without any way to detect the tamper from the data itself.
- **Why it is a problem:** `DATA_RETENTION_POLICY.md` is a security/compliance source-of-truth doc presented under a "## Ground truth" heading — i.e. as verified current state, not aspiration. A reviewer (internal auditor, bank client, RBI/DPDP counsel per the doc's own footer) reading it would conclude the audit trail already has cryptographic integrity it does not have.
- **Real world attack scenario:** During a regulatory/bank-client audit of this RCU-vendor CRM, the client's compliance team is shown `DATA_RETENTION_POLICY.md` as evidence of audit-log integrity controls ("hash-chained"). If a dispute later arises over whether a case/commission record was tampered with, the actual mechanism (trigger-only, no hash chain) cannot prove non-tampering by a DB-superuser-level actor — undermining the evidentiary value the doc implies it has, in exactly the kind of dispute (§65B evidentiary chain mentioned elsewhere in the same doc) the doc exists to support.
- **Business impact:** Reputational/compliance risk if a bank client or regulator relies on the doc's "Ground truth" claim during an audit and the gap surfaces later; this is a documentation-correctness issue layered on top of a genuinely incomplete (but already tracked-as-deferred) technical control.
- **Recommended fix:** Edit `DATA_RETENTION_POLICY.md:9` to state the accurate current state (e.g. "Audit log: append-only via DB trigger (UPDATE/DELETE blocked). Hash-chaining + monthly partitioning + off-DB copy: PLANNED, see COMPLIANCE_GAPS_REGISTRY C-10") rather than presenting the hardened end-state as already-true "Ground truth". This is a documentation fix only — the underlying hardening work itself is already correctly tracked as DEFERRED in `docs/COMPLIANCE_GAPS_REGISTRY.md:505` and `docs/operations/OPEN_ITEMS_2026-06-17.md` ("audit_log production hardening ... compliance prerequisite for GA"), so per the repo's own finding-disposition rule this should be logged as RATCHET (doc correction) rather than re-opened as a new technical gap.
- **Estimated effort:** S (doc edit, < 1 hour) for the doc fix; the underlying hash-chain/partition work is already scoped elsewhere as a separate, larger effort
- **Priority:** P2 (doc fix) / already P-tracked separately for the technical work
- **Status:** OPEN

### LOGGING-03
- **Category:** Logging / Operational Resilience (Log Rotation & Retention)
- **Severity:** High
- **CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L) — CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L — availability impact via disk exhaustion, no direct confidentiality/integrity break
- **OWASP Mapping:** A09:2021 – Security Logging and Monitoring Failures (also touches A05:2021 – Security Misconfiguration, for the missing Docker logging config)
- **CWE Mapping:** CWE-400 (Uncontrolled Resource Consumption) / CWE-779 (Logging of Excessive Data without proper rotation)
- **Location**
  - **File:** infra/prod/docker-compose.yml (absence of config); docs/security/DATA_RETENTION_POLICY.md:27 (the unenforced policy)
  - **Line Number:** entire file (172 lines) has no `logging:` key on any of the 6 service blocks (`db` 17-32, `minio` 34-49, `minio-init` 51-63, `migrate` 65-82, `api` 84-114, `edge` 116-135)
- **Evidence:**
```
$ grep -n "logging:|driver:|max-size|max-file" infra/prod/docker-compose.yml
(no output — zero matches)
$ find . -iname "daemon.json" -not -path "*/node_modules/*"
(no output — no Docker daemon-level override either)
```
  `packages/logger/src/index.ts:61`: `const write = options.write ?? ((line: string) => process.stdout.write(\`${line}\n\`));` — every log line from the API process goes to stdout, which under Docker's default `json-file` log driver is written to an uncapped file on the host disk (typically `/var/lib/docker/containers/<id>/<id>-json.log`) unless `max-size`/`max-file` are set per-service or in `/etc/docker/daemon.json`. Neither exists in this repo.

  `docs/security/DATA_RETENTION_POLICY.md:27` (policy table row):
  > `| System / application logs | 90–180 d | Operational / security triage | Rotate + delete | Yes |`

  `docs/security/DATA_RETENTION_POLICY.md` "Enforcement" line:
  > `- **Enforcement:** a **scheduled purge job (PLANNED)** evaluates retention + legal-hold per entity and performs logged disposal. Until it lands, retention is **policy-only** (no automated deletion).`

  `docs/COMPLIANCE_GAPS_REGISTRY.md` — confirmed this specific gap is **not** tracked anywhere (only the unrelated `audit_log` hash-chain/partition gap is tracked, at line 505):
```
$ grep -n -i "json-file|log rotation|docker.*log|stdout.*retention" docs/COMPLIANCE_GAPS_REGISTRY.md
(no output)
```
- **Why it is a problem:** Every API request, job failure, and warning is written to an unbounded, unrotated file on the single production VPS's disk, forever (or until manual operator intervention). There is no automated mechanism enforcing the documented 90-180 day retention, and no rotation to cap disk usage. `info`-level access logs alone fire on every single HTTP request (`apps/api/src/http/app.ts:61-70`, `res.on('finish', ...)`), so volume scales directly with traffic.
- **Real world attack scenario:** This repo's own project memory (`docs/operations/...` / `project_prod_disk_full_db_outage_2026_06_26.md`, referenced in the orchestrator's CRM2 memory) documents a real 2026-06-26 production outage where un-pruned Docker artifacts filled the disk and crashed Postgres. That incident was image layers, not logs — but it proves the failure mode (single-box disk exhaustion → Postgres crash-loop → full service outage for a live KYC/banking-verification CRM) is real and has already happened once via an analogous unbounded-growth mechanism. Container logs are the same risk, unmitigated: a traffic spike, a noisy retry loop (e.g. the BullMQ job-failure warn at `apps/api/src/platform/jobs/index.ts:119` firing repeatedly), or simply organic growth over months, can independently fill the disk and trigger the same outage class — with no rotation as a backstop and no alerting on log-volume/disk-usage tied to this specific risk.
- **Business impact:** Repeat-outage risk for a live production CRM handling KYC/banking verification data (crm.allcheckservices.com), where an outage directly blocks field agents and bank clients; also a compliance gap against the project's own documented 90-180 day retention policy for system logs (currently: indefinite retention until disk fills, not a controlled 90-180 day window).
- **Recommended fix:** Add `logging: { driver: "json-file", options: { max-size: "20m", max-file: "10" } }` (or equivalent, sized to the box) to each service in `infra/prod/docker-compose.yml`, prioritizing `api` (highest log volume). This is a small, additive, low-risk infra change (no app code change). Separately, track the "scheduled purge job (PLANNED)" mentioned in `DATA_RETENTION_POLICY.md` in `docs/COMPLIANCE_GAPS_REGISTRY.md` so it isn't silently dropped, since it currently has zero registry entry.
- **Estimated effort:** S (compose-file edit + redeploy, < 1 hour) for rotation; M for the full scheduled-purge-job enforcement layer
- **Priority:** P1
- **Status:** OPEN

## Summary

**Counts by severity:** Critical: 0 · High: 1 · Medium: 1 · Low: 1 · Informational: 0

**Overall verdict: PARTIAL.**

The application-level logging discipline itself is genuinely strong: `@crm2/logger` is a clean, zero-dependency, structured JSON logger; `console.*` is verifiably absent from `apps/api/src` and both worker apps (machine-enforced via `eslint.config.js:41`); every one of the 52 `logger.*` call sites in the API was individually inspected and none pass a raw password, token, cookie, Authorization header, or PII payload — error handling consistently extracts only `.message` strings, and the request-observability middleware logs a tight allowlist (`method/path/status/durationMs/userId`), never headers or body. The application audit trail (`audit_log`) is real, transactionally consistent with the writes it records, covers 14 master-data modules, and is enforced immutable at the DB layer via a blocking trigger — and audited user snapshots provably never include the password hash. The two real gaps are at the infrastructure/process layer, not the application code: (1) **no Docker log-rotation configuration exists anywhere in `infra/prod/docker-compose.yml`**, so stdout logs grow unbounded on the single production box with no automated retention enforcement, despite a documented 90-180 day policy and a prior, related disk-exhaustion outage on this exact host — this is untracked in the compliance registry and is the audit's highest-severity finding (LOGGING-03, High); and (2) the project's own `DATA_RETENTION_POLICY.md` overclaims the audit log as already "hash-chained, partitioned monthly" when migration 0017's own comment says that hardening is deferred — a tracked-but-mis-documented gap (LOGGING-02, Medium). A third, low-severity latent design weakness (LOGGING-01) notes the redaction helper is shallow/non-recursive, which is not exploited by any current call site but offers no protection if a future call site nests a secret one level deep.
