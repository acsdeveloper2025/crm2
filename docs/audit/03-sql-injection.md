# AUDIT 03: SQL Injection

## Scope

Inspected every SQL call site in `apps/api` (the only app that talks to Postgres — `apps/worker` and
`apps/report-worker` have no SQL of their own today, confirmed by command below) plus all DB migrations
under `db/v2/migrations/` for stored-procedure/trigger-function dynamic SQL.

Files read in full or by targeted grep+read:
- `apps/api/src/platform/db.ts` (the pool wrapper / query primitive)
- `apps/api/src/platform/pagination.ts` (`resolvePage`, `resolveFilters`, `filterClauses`, `likeContains` — the shared sort/filter/search/LIMIT/OFFSET chokepoint used by every list endpoint)
- `apps/api/src/platform/scope/index.ts`, `apps/api/src/platform/scope/dimensions.ts`, `apps/api/src/platform/scope/repository.ts` (the RBAC/scope predicate composer reused by ~12 modules)
- `apps/api/src/platform/import/index.ts`, `parsers.ts`, `format.ts`, `importLog.repository.ts` (CSV/Excel bulk import engine)
- All 44 `repository.ts` / `*.repository.ts` files under `apps/api/src/modules/**` and `apps/api/src/platform/**` (listed below) — every one read or grepped for template-literal `${...}` interpolation inside SQL strings
- `apps/api/src/modules/*/controller.ts` and `apps/api/src/modules/*/service.ts` — checked that none of them call `query()`/`pg` directly (raw SQL is repository-only, per the frozen architecture rule)
- `.dependency-cruiser.cjs` — the machine-enforced boundary rule that blocks raw `pg`/`platform/db.ts` access from anywhere except `repository.ts` files
- `db/v2/migrations/*.sql` — grepped for `CREATE FUNCTION`/`CREATE PROCEDURE`/`EXECUTE`/`format(` (stored-procedure dynamic SQL)

Repository files enumerated (44 total):
```
apps/api/src/modules/auth/repository.ts, version.repository.ts
apps/api/src/modules/billing/repository.ts
apps/api/src/modules/caseDataEntries/repository.ts
apps/api/src/modules/caseReports/repository.ts
apps/api/src/modules/cases/repository.ts
apps/api/src/modules/clients/repository.ts
apps/api/src/modules/commissionRates/repository.ts
apps/api/src/modules/consents/repository.ts
apps/api/src/modules/cpv/repository.ts
apps/api/src/modules/dashboard/repository.ts
apps/api/src/modules/departments/repository.ts
apps/api/src/modules/designations/repository.ts
apps/api/src/modules/field-monitoring/repository.ts
apps/api/src/modules/fieldReports/repository.ts
apps/api/src/modules/geocode/repository.ts
apps/api/src/modules/location/repository.ts
apps/api/src/modules/locations/repository.ts
apps/api/src/modules/mis/repository.ts
apps/api/src/modules/notifications/repository.ts, settings.repository.ts, token.repository.ts
apps/api/src/modules/policies/repository.ts
apps/api/src/modules/products/repository.ts
apps/api/src/modules/rateTypeAssignments/repository.ts
apps/api/src/modules/rateTypes/repository.ts
apps/api/src/modules/rates/repository.ts
apps/api/src/modules/reference/repository.ts
apps/api/src/modules/reportLayouts/repository.ts
apps/api/src/modules/roles/repository.ts
apps/api/src/modules/saved-views/repository.ts
apps/api/src/modules/scopeAssignments/repository.ts
apps/api/src/modules/sync/repository.ts
apps/api/src/modules/system/repository.ts
apps/api/src/modules/tasks/repository.ts
apps/api/src/modules/tatPolicies/repository.ts
apps/api/src/modules/userKycUnits/repository.ts
apps/api/src/modules/users/repository.ts
apps/api/src/modules/verificationUnits/repository.ts
apps/api/src/platform/access/repository.ts
apps/api/src/platform/import/importLog.repository.ts
apps/api/src/platform/jobs/repository.ts
apps/api/src/platform/scope/repository.ts
apps/api/src/platform/tokenRevocation/repository.ts
```

Commands actually run (all read-only):
```
grep -rnE '`[^`]*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|ORDER BY|JOIN)[^`]*\$\{' apps/api/src --include="*.ts"
grep -rn "sortColumn\|sortOrder\|ORDER BY \${" apps/api/src --include="*.ts"
grep -rn "sortMap:" apps/api/src/modules --include="*.ts" -A5
grep -rn "ILIKE\|likeContains" apps/api/src/modules --include="*.ts"
grep -rn "LIMIT \${\|OFFSET \${" apps/api/src --include="*.ts"
grep -rn "COPY \|pg-copy\|copyFrom\|copyTo" apps/api/src --include="*.ts"
grep -rnE "query\(\s*['\"\`].*\+\s*\w" apps/api/src --include="*.ts"
grep -rln "from 'pg'" apps/api/src apps/worker/src apps/report-worker/src --include="*.ts"
grep -rln "from '../../platform/db.js'\|from '../db.js'" apps/api/src/modules/*/controller.ts apps/api/src/modules/*/service.ts
grep -rln "CREATE FUNCTION\|CREATE OR REPLACE FUNCTION\|CREATE PROCEDURE" db/v2/migrations/
grep -rn "EXECUTE \|format(" db/v2/migrations/*.sql
find apps/worker/src apps/report-worker/src -name "*.ts" | xargs grep -l "query(\|pg\b"
grep -n "repository\|pg\b" .dependency-cruiser.cjs
```

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Parameterized queries used consistently | PASS | `apps/api/src/platform/db.ts:35-37` — `query()` always calls `getPool().query(text, params)`; `withTransaction` (`db.ts:46-60`) same contract via `client.query(text, params)`. Every one of the 44 repository files passes user-derived values as array elements (`[id]`, `[userId, name]`, etc.), never via string concatenation. | No exceptions found. |
| Prepared statements / parameter binding | PASS | Same as above — `pg`'s `Pool.query(text, params)` always sends a parameterized (extended-protocol) query when `params` is supplied; confirmed at every call site inspected. | |
| Unsafe string concatenation / template-literal interpolation of user input into SQL | PASS | `grep -rnE 'query\(\s*['"'"'\"\`].*\+\s*\w'` returned **zero matches**. All `${...}` interpolations found (≈150 occurrences across 36 files) resolve to one of: (a) hardcoded `COLS`/`FROM` constants defined once per file from literal column lists, (b) the `sortColumn`/`sortOrder` pair from `resolvePage()` which is allowlist-validated (`pagination.ts:172-181`), (c) `WHERE`/`AND` clause fragments built by `where.push(...)` helpers where every user value is pushed to a `params` array and referenced as `$N`, (d) the scope-predicate composer (`platform/scope/index.ts`) which is parameterized end-to-end. | See SQL_INJECTION findings for residual design notes (informational only). |
| Dynamic SQL construction | PASS (no unsafe dynamic SQL) | All dynamic SQL is fragment-assembly of **trusted, code-owned strings** (column allowlists, scope predicates) with **values always bound** — never raw user text spliced into the SQL string. `apps/api/src/modules/scopeAssignments/repository.ts:17,41,98,188,197` interpolates `def.catalogTable`/`def.labelExpr`/`def.valueColumn`, but `apps/api/src/platform/scope/dimensions.ts:13,39-67` shows `DimensionDef` is a hardcoded `Record<DimensionCode, DimensionDef>` keyed by a closed 4-value union (`CLIENT`\|`PRODUCT`\|`PINCODE`\|`AREA`) — never derived from request input. | |
| LIKE clauses (search) | PASS | `apps/api/src/platform/pagination.ts:106-109` `likeContains()` escapes `\`, `%`, `_` before wrapping in `%...%`, and the escaped value is always bound as a parameter (e.g. `apps/api/src/modules/clients/repository.ts:37-38`: `params.push(likeContains(o.search)); where.push(`code ILIKE $${params.length}`)`). Confirmed identical pattern in 18 repository files via `grep -rn "ILIKE\|likeContains"`. | Wildcard-escaping (D1) correctly prevents a user `%`/`_` from turning the search box into an unintended wildcard — this is a search-injection-adjacent hardening, also done right. |
| ORDER BY (column allowlisting vs raw user-controlled column name) | PASS | `apps/api/src/platform/pagination.ts:159-184` (`resolvePage`): `sortBy` is checked with `Object.prototype.hasOwnProperty.call(spec.sortMap, reqSortBy)` before any lookup; an unrecognized `sortBy` silently falls back to `spec.defaultSort`. `sortColumn = spec.sortMap[sortBy]`. Every module's `PageSpec.sortMap` (e.g. `apps/api/src/modules/clients/service.ts:22-27`, `apps/api/src/modules/cases/service.ts:106-115`, `tasks/service.ts:24-29`, 14 more) is a **hardcoded literal object** — confirmed by reading all `sortMap:` definitions. `sortOrder` is strictly `rawOrder === 'desc' ? 'desc' : rawOrder === 'asc' ? 'asc' : default` (`pagination.ts:179-181`) — no raw passthrough possible. The two repos with bespoke (non-`PageSpec`) sort params (`platform/jobs/repository.ts`, `modules/notifications/repository.ts`) still receive `sortColumn`/`sortOrder` from `resolvePage()` against their own hardcoded `sortMap` (`jobs/service.ts:9`: `sortMap: { createdAt: 'created_at' }`). | This is the single most safety-critical pattern in the codebase for this audit category and it is implemented correctly and consistently everywhere it's used. |
| LIMIT/OFFSET (must be bound params, not concatenated) | PASS | `grep -rn "LIMIT \${\|OFFSET \${"` returned **zero matches** anywhere in `apps/api/src`. Every list query uses `LIMIT $N OFFSET $N+1` with `limit`/`offset` appended to the bound `params` array, e.g. `apps/api/src/modules/clients/repository.ts:56-58`, `apps/api/src/modules/tasks/repository.ts:186-188` (`LIMIT $${params.length+1} OFFSET $${params.length+2}`, `[...params, o.limit, o.offset]`), `apps/api/src/modules/cases/repository.ts:414-415`. `resolvePage()`'s `limit`/`offset` are computed via `toInt()` (`pagination.ts:153-166`) and bounded (`limit > MAX_PAGE_SIZE` throws `LIMIT_TOO_LARGE`). | |
| Search endpoints | PASS | All search params route through `likeContains()` + bound `$N` (see LIKE row above). The two cross-module search-shaped features audited deeper — `cases/repository.ts` dedupe search (`searchDuplicates`/`searchDuplicatesPaged`, lines 388-418) and `sync/repository.ts` mobile down-sync — bind every value; `dedupeConditions()` (`cases/repository.ts:348-368`) only ever appends hardcoded column-expression strings (`upper(a.pan) = $N`, etc.) gated by which optional identifier was supplied, never raw text. | |
| Bulk import | PASS | `apps/api/src/platform/import/index.ts` (340 lines) contains **no SQL** — it is pure orchestration that calls each domain module's `repository.create()`/`update()` (already-audited parameterized functions) per row. `apps/api/src/platform/import/importLog.repository.ts:14-27` is a single fully-parameterized `INSERT`. | |
| CSV import | PASS | Same engine as Bulk import (CSV and XLSX share `platform/import/`). `parsers.ts` cell coercers (`parseIsoDate`, `parseBoolean`, `parseInteger`, `parseNumber`, `parseCsvList`) only type-coerce values; they return JS primitives that are later passed as bound params to a domain repository's `create`, never assembled into a query string. | |
| Excel import | PASS | Same as CSV import — same `platform/import/` engine, `exceljs`-driven; verified no SQL-string assembly from cell values anywhere in `parsers.ts`/`index.ts`/`format.ts`. | |
| Stored procedures / DB functions | PASS | 3 functions exist in migrations, all static trigger functions with no dynamic SQL: `rates_check_eligibility()` (`db/v2/migrations/0012_rate_management.sql:104-118`, a static `EXISTS` check against `NEW.*` columns), `audit_log_block_mutation()` (`0017_concurrency_audit.sql:43-46`, unconditionally `RAISE EXCEPTION`), `case_attachments_freeze_geocoded_address()` (`0065_field_photo_reverse_geocode.sql:33-44`, compares `OLD`/`NEW` columns). Separately, 4 migrations (`0015_effective_from.sql:25-27`, `0016_cpv_effective_from.sql:19-21`, `0017_concurrency_audit.sql:23`, `0018_cpv_concurrency.sql:22`) use `EXECUTE format('ALTER TABLE %I ...', t)` for one-time idempotent DDL, where `t` iterates a **hardcoded literal array** (e.g. `tables text[] := ARRAY['clients','products','locations','users','report_templates']`, `0017_concurrency_audit.sql:15`) — never user/request input — and correctly uses `%I` identifier-quoting via `format()`, the Postgres-recommended safe pattern for dynamic DDL. | These are forward-only, version-controlled, developer-authored migration scripts with zero external/request input — not an application attack surface. |
| ORM bypass (confirm no ORM, raw `pg` only, consistently) | PASS | `grep -rln "from 'pg'"` across `apps/api/src`, `apps/worker/src`, `apps/report-worker/src` returns only `apps/api/src/platform/db.ts` plus 2 test-harness files (`migrate.runner.test.ts`, `migrations.rerun.test.ts` — ephemeral test-DB bootstrapping, not application code). No `prisma`, `typeorm`, `sequelize`, `knex`, `objection`, or any ORM/query-builder package found in `package.json`/`apps/api/package.json`. `.dependency-cruiser.cjs:15-28` machine-enforces the boundary: rule `controller-not-to-repository` forbids any file outside `repository.ts`/`platform/db.ts`/tests from importing `pg` or `platform/db.ts` directly — confirmed no controller or service in `apps/api/src/modules/*/controller.ts` or `*/service.ts` imports `platform/db.ts` (`grep -rln "from '../../platform/db.js'..." apps/api/src/modules/*/controller.ts apps/api/src/modules/*/service.ts` → zero matches). `apps/worker/src`, `apps/report-worker/src` have no SQL/`pg` usage at all (placeholder builds per architecture inventory). | Matches ADR-0004 ("No Prisma") and the frozen-architecture claim exactly; this is the one checklist item explicitly flagged as "verify, don't assume" and it checks out under direct inspection. |

## Findings

No findings reached FAIL or warrant a numbered SQL_INJECTION-NN entry. Every checklist item above is a
PASS backed by direct code inspection (not inference from library presence) — the codebase implements a
single, consistently-applied parameterization discipline:

1. The low-level `db.ts:query()`/`withTransaction()` primitives never accept a fully-assembled string
   without a separate `params` array, and always delegate binding to `pg`'s extended query protocol.
2. The one legitimately dynamic axis common to a SQL-injection audit — **ORDER BY column names** — is
   centralized in a single, correctly-implemented allowlist function (`resolvePage` in
   `platform/pagination.ts`) used by every list endpoint, including the two repositories with
   locally-typed (non-`PageSpec`) sort params (`jobs`, `notifications`), which still flow through the
   same `resolvePage()` chokepoint with their own hardcoded `sortMap`.
3. LIKE/search values are always wildcard-escaped (`likeContains`) and always bound.
4. LIMIT/OFFSET are always bound `$N` parameters, never concatenated, anywhere in the 44 repository
   files inspected.
5. The few places where a table/column *name* (not a value) is interpolated (`scopeAssignments`
   `def.catalogTable`, the migration-script `EXECUTE format('... %I ...', t)` DDL) are demonstrably
   sourced from closed, code-owned/hardcoded sets — never from request input — and the migration DDL
   additionally uses Postgres's `%I` safe-identifier quoting.
6. Bulk/CSV/Excel import never builds SQL from parsed cell data; it always routes through the same
   parameterized domain repositories.
7. No ORM exists; raw `pg` is confined to `platform/db.ts` plus the 44 repository files, machine-enforced
   by `.dependency-cruiser.cjs`.

This is a genuine zero-findings result for this audit area, not an absence of looking — ~150
template-literal SQL interpolations across 36 files were individually triaged to confirm each one
resolves to a static/code-owned fragment rather than user-controlled text.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Informational | 0 |

**Overall verdict: PASS.**

Every checklist item is a real, evidenced PASS — no Critical/High/Medium/Low FAILs and no material NOT
VERIFIED gaps. CRM2's backend has a single, disciplined SQL-access pattern: raw `pg` confined to a
repository layer, parameter binding used universally for values, and the one inherently dynamic
SQL-shape risk in this codebase (server-side DataGrid sort) is closed off by a centralized
allowlist (`PageSpec.sortMap` + `resolvePage`) rather than left to each of the 36 list endpoints to get
right independently — which is the correct architectural choice for this class of bug. The ADR-0004
"no ORM" claim and the "raw SQL only in repositories" rule are both independently verified true, not
merely asserted: no ORM dependency exists, `pg` is imported nowhere outside `platform/db.ts` (plus test
bootstrapping), and `.dependency-cruiser.cjs` makes the repository-only boundary machine-enforced rather
than a convention that could silently rot.
