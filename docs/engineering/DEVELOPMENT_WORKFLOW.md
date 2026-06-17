# Development Workflow — CRM2

Day-to-day engineering workflow for this greenfield monorepo. Authoritative
references: `CRM2_MASTER_MEMORY.md`, `docs/ENGINEERING_STANDARDS.md`,
`docs/CI_CD_STANDARDS.md`. The `verificationUnits` module is the reference
implementation for everything below.

## Build Order (greenfield)

Build vertical slices in dependency order, one domain at a time:

1. Verification Units — **done** (`apps/api/src/modules/verificationUnits`)
2. Clients → 3. Products → 4. CPV Mapping → 5. Case Creation → 6. Task Creation
→ 7. Assignment → 8. **Verification Workspace (keystone)** → 9. Reports → 10. MIS
→ 11. Billing & Commission

Then: Dashboard, Field Monitoring, Admin, workers (`apps/worker`,
`apps/report-worker`).

**In parallel, before production** — infra hardening: Redis/Valkey split + HA,
backup / PITR / DR, scope-cache, object-store HA + CDN, partition automation.

## Test-First (TDD)

Write the test, then the code. Every module ships its tests in the same change.
Layers:

- **unit** — pure functions, no I/O
- **integration** — HTTP + ephemeral Postgres (see `verificationUnits.api.test.ts`)
- **db** — DDL / constraints
- **contract** — DTO / zod schemas (from `@crm2/sdk`)
- **seed-validation** — seed data integrity

Coverage gates: repositories ≥ 90%, services ≥ 90%, overall ≥ 80%.

## Backend Module Anatomy

Under `apps/api/src/modules/<domain>/`:

- `repositories/<entity>.repository.ts` — transactional CRUD, raw `pg`, typed camelCase
- `<entity>-report.repository.ts` — read-only analytics
- `<entity>-view.repository.ts` — reads `v_` / `mv_` views
- `service.ts` — zod validation + business rules
- `controller.ts` — validate / authorize / call / return only (no logic)
- `routes.ts` — `authorize(perm)` per route
- `__tests__/`

Shared `scope.repository.ts` handles recursive hierarchy (SA=all, MGR=subtree,
TL=team, BE=self|portfolio, FE=territory). Default-deny scope.

## Frontend Module Anatomy

Under `apps/web/src/features/<domain>/`: `components/` + `hooks/` +
`queries/` + `page`.

- Data via **TanStack Query** (no manual fetch state)
- Forms via **react-hook-form + `zodResolver(@crm2/sdk schema)`**
- All API calls go through **`@crm2/sdk`** — never raw `fetch`
- Tokens only — no hardcoded colors (`docs/COLOR_SYSTEM_FREEZE.md`)
- Mandatory states: loading, empty, error, permission-denied

## Logger

The only logger is **`@crm2/logger`**. No `console.*`. Levels:

| level | use for |
|-------|---------|
| `trace` | troubleshooting |
| `debug` | diagnostics |
| `info`  | business events |
| `warn`  | recoverable / validation / retry / degraded dependency |
| `error` | failed operation |
| `fatal` | system cannot continue |

## Error Handling

Throw `AppError` with a standard `ErrorCode` from
`apps/api/src/platform/errors.ts` (e.g. `AppError.notFound`,
`AppError.conflict`, `AppError.badRequest`). The HTTP layer maps status + code.
Never `throw new Error("something went wrong")`.

## Time

UTC everywhere. DB columns are `timestamptz`. Backend stores and operates in
UTC. The frontend converts to local time only for display.

## Data Lifecycle

- Business entities use **soft delete** (`deleted_at` / `deleted_by`). No hard
  delete except system cleanup tables.
- Financial / verification / review / assignment history is **append-only and
  immutable** — never update or overwrite.

## Transactions

Wrap **case creation, task creation, assignment, billing, commission** in DB
transactions (`BEGIN` / `COMMIT` via a single client inside the repository).

## Audit

Assignment, review, approval, billing, commission, and master-data changes must
write an audit record. Tests must assert the audit row exists.

## Feature Flags

High-risk features ship behind a flag: workspace, billing, reporting,
assignment engine.

## Observability

Per-request `requestId` / `duration` / `status` / `userId` is already wired via
`requestObservability()` in `apps/api/src/http/app.ts`. Workers log per
job: start / finish / duration / retry / failure.

## Code Hygiene

- No commented-out code — Git is the history.
- No `TODO` / `FIXME` / `HACK` / `TEMP`. Use issue-linked comments, e.g.
  `// CRM2-142: reason`.

## Before Marking Work Done

Run **`pnpm verify`** and confirm it is green (typecheck → lint → format →
no-suppressions → boundaries → test → build). See `docs/CI_CD_STANDARDS.md`.
---

## Long-Term Governance & Operations (2026-06-04 freeze)

Full map: `CRM2_MASTER_MEMORY.md` §7.6. **Decisions** → `docs/adr/` (ADR-0001..0019; change a frozen decision only via a superseding ADR + CTO + domain-owner sign-off — `LONG_TERM_PROTECTION.md`). **Business rules** → `BUSINESS_RULES.md` (no rule lives only in code). **API/contract** → `API_VERSIONING_POLICY.md`, `DOCUMENTATION_AS_CODE.md`. **DB change** → `DATABASE_CHANGE_PROCESS.md`. **Security** → `SECURITY_STANDARDS.md`, `SECURITY_GUIDE.md`. **Resilience** → `DISASTER_RECOVERY.md` (quarterly restore drill), `DATA_RETENTION_POLICY.md`. **Ownership** → `DOMAIN_OWNERSHIP.md`. **Quality/ops** → `TEST_DATASET_STRATEGY.md`, `PERFORMANCE_STANDARDS.md`, `OBSERVABILITY_STANDARDS.md`, `MONITORING_STRATEGY.md`, `OPERATIONS_GUIDE.md` + `runbooks/`, `RELEASE_GUIDE.md` + `RELEASE_CHECKLIST.md`, `UPGRADE_POLICY.md`, `TECH_DEBT_POLICY.md`.
