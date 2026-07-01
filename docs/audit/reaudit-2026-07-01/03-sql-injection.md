# RE-AUDIT 03: SQL Injection

Re-audit of area 03 against current HEAD (`8ded432`); remediation range `b19039e..8ded432`.
Original audit reported **no findings** here. This pass confirms the 4-wave remediation
introduced no new raw-SQL / interpolation risk.

## Scope of what actually changed

`git diff --name-only b19039e..8ded432` limited to SQL-relevant files returns exactly three:

- `apps/api/src/modules/auth/repository.ts` (new `rotateRefresh` transaction, DATABASE-02)
- `db/v2/migrations/0105_case_tasks_completion_index.sql` (new)
- `db/v2/migrations/0106_case_tasks_verification_unit_index.sql` (new)

No other `*/repository.ts` was modified in the range. `cases/service.ts` was touched but its
diff (assignee-pool cache + `scanBuffer` AV call) contains **zero SQL** — pure JS Map caching
and a buffer scan.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| DATABASE-02 (`rotateRefresh` atomic revoke+insert, no injection introduced) | CONFIRMED_FIXED | `apps/api/src/modules/auth/repository.ts:200-220` — both statements use `$1..$7` placeholders with an array param list; no interpolation. Wrapped in `withTransaction` (`platform/db.ts:46-63`), which passes `(text, params)` straight to `client.query`. |
| 0105 migration introduces no dynamic SQL | CONFIRMED_FIXED | `db/v2/migrations/0105_case_tasks_completion_index.sql:11-15` — static `CREATE INDEX IF NOT EXISTS ... ON case_tasks (completed_at, submitted_at)` inside `BEGIN/COMMIT`. No parameters, no interpolation. |
| 0106 migration introduces no dynamic SQL | CONFIRMED_FIXED | `db/v2/migrations/0106_case_tasks_verification_unit_index.sql:8-11` — static `CREATE INDEX IF NOT EXISTS ... ON case_tasks (verification_unit_id)`. Static DDL. |
| `cases/service.ts` remediation adds no raw SQL | CONFIRMED_FIXED | `git diff b19039e..8ded432 -- apps/api/src/modules/cases/service.ts` — only a `poolCache` Map and a `scanBuffer(bytes)` call; no `query(`/`` `SELECT `` etc. added. |

## New Findings

**None.**

Independent sweep of every `apps/api/src/modules/*/repository.ts` for `${...}` inside SQL
template literals: all interpolations are one of three safe classes —
(a) static column-list / FROM-clause constants (`COLS`, `CR_FROM`, `PICKUP_COLS`, …),
(b) computed placeholder indices (`$${params.length}`, `$${n}`) whose values are always pushed
into the bound `params` array, and
(c) `sortColumn` / `sortOrder`, both whitelisted before interpolation. `sortBy` is gated by
`Object.prototype.hasOwnProperty.call(spec.sortMap, reqSortBy)` and otherwise falls back to
`spec.defaultSort`; `sortColumn` is the mapped value from the static `sortMap`; `sortOrder` is
narrowed to the literals `'asc'`/`'desc'` (`platform/pagination.ts:178-188`). No
request-controlled string reaches a query body unparameterized. This pattern is pre-existing and
untouched by the remediation.

## Verdict

**PASS** — All four remediation touch-points that could bear on SQL injection are confirmed safe:
`rotateRefresh` is fully parameterized, migrations 0105/0106 are static DDL, and the
`cases/service.ts` change carries no SQL. No new Medium+ (or any) injection risk was introduced,
and the pre-existing parameterization / sort-column whitelist discipline across the repositories
remains intact. The area was clean before and stays clean after remediation.
