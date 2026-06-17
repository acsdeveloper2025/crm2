# AGENT_RULES.md — CRM2 Operating Manual

This is the CRM2 (v2) greenfield monorepo. **Architecture, data model, design system, and tech stack are FROZEN. Work is BUILD-ONLY** — no redesign, no architecture/data-model/workflow changes.

## Required reading (read ALL before writing any code, in order)
1. `CRM2_MASTER_MEMORY.md`
2. `docs/ENGINEERING_STANDARDS.md`
3. `docs/DESIGN_AND_STACK_FREEZE.md`
4. `docs/CI_CD_STANDARDS.md`
5. `db/v2/BUILD_GATE_REGISTRY_LOCK.md`
6. `AGENT_RULES.md` (this file)
7. `CTO_RULES.md`

## Machine-enforced rules (hard rules — no exceptions)

### TypeScript (`tsconfig.base.json`)
- All strict flags ON. Forbidden: `any`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`. No exceptions, no override, no bypass.

### ESLint (`eslint.config.js`)
- Forbidden `eslint-disable` / `-next-line` / `-line` — inert via `noInlineConfig` and fails CI via `scripts/check-suppressions.mjs`.
- Forbidden `console.*` — use `@crm2/logger`.
- Forbidden `TODO` / `FIXME` / `HACK` / `TEMP` — use issue-linked comments, e.g. `// CRM2-142 waiting for bank API`.
- No magic numbers in the business layer (service / controller / repository).
- No commented-out code — Git is the history.

### Prettier (`.prettierrc.json`)
- Mandatory. `pnpm format` runs in CI.

### Logger
- Only `@crm2/logger`. Levels: `trace` (troubleshooting), `debug` (diagnostics), `info` (business events), `warn` (recoverable/validation/retry/degraded), `error` (failed ops), `fatal` (cannot continue).

### Data access (dependency-cruiser enforced)
- Raw SQL only in repositories + migrations, always parameterized. Forbidden in controllers / services / routes / react / hooks.

### Layering (dependency-cruiser + eslint enforced)
- Controllers: validate → authorize → call service → return. No business logic.
- Flow: Controller → Service → Repository. Never controller → repository.

### React
- TanStack Query for data; custom hooks; feature-first. No business logic in components; no giant components; no `useEffect` data-fetching.

### Frontend networking (eslint enforced)
- Use `@crm2/sdk` only — never raw `fetch()` / `axios` in features/components.

### Errors (`platform/errors.ts`)
- Structured `AppError` + `ErrorCode`. Never `throw new Error("...")` in domain code.

### Security
- Default-deny. If scope can't be determined, DENY.
- Audit: login/logout, role changes, assignments, reviews, approvals, billing, commission, master-data.

### Data integrity
- Financial / verification / review / assignment history is immutable + append-only.
- Soft delete (`deleted_at` / `deleted_by`). No hard delete except system cleanup tables.

### Time
- UTC everywhere. DB `timestamptz`. Convert only for display.

### Naming
- SQL: `snake_case`, tables plural, prefixes `idx_` / `uq_` / `fk_` / `v_` / `mv_` / `trg_` / `fn_`.
- TS/API: `camelCase`. Routes: `kebab-case`. Env + domain codes: `UPPER_SNAKE`.
- `camelize()` at the repository edge only. Never use SQL casing aliases.

### Display casing (`UPPERCASE_DISPLAY_STANDARD.md`)
- Uppercase display is visual-only (CSS). Never transform stored values.

### Dependencies
- Nothing installed without an entry in `ALLOWED_DEPENDENCIES.md`.

### Tests
- Every feature ships unit + integration tests in the same change.
- Coverage: repositories/services ≥90%, overall ≥80%. No feature is complete without tests.

### Transactions
- Mandatory for case / task / assignment / billing / commission creation.

### Observability
- Every API logs requestId / duration / status / userId.
- Every job logs start / finish / duration / retry / failure.

## Definition of Done (per agent)
- `pnpm verify` passes locally: typecheck → lint → format → no-suppressions → boundaries → test → build.
- Tests cover the change.
- Never claim done without running `pnpm verify`.

## Commits
- Author is always `Mayur Kulkarni <mayurkulkarni786@gmail.com>`.
- Conventional commits. NO AI / `Co-Authored-By` trailer.
- Never push without explicit human OK.

## When in doubt
- If something seems to require an architecture / data-model / design change: **STOP and ask the human. Do not redesign.**

---
**Build only. Verify before done. No suppressions, ever.**
---

## Long-Term Governance & Operations (2026-06-04 freeze)

Full map: `CRM2_MASTER_MEMORY.md` §7.6. **Decisions** → `docs/adr/` (ADR-0001..0019; change a frozen decision only via a superseding ADR + CTO + domain-owner sign-off — `LONG_TERM_PROTECTION.md`). **Business rules** → `BUSINESS_RULES.md` (no rule lives only in code). **API/contract** → `API_VERSIONING_POLICY.md`, `DOCUMENTATION_AS_CODE.md`. **DB change** → `DATABASE_CHANGE_PROCESS.md`. **Security** → `SECURITY_STANDARDS.md`, `SECURITY_GUIDE.md`. **Resilience** → `DISASTER_RECOVERY.md` (quarterly restore drill), `DATA_RETENTION_POLICY.md`. **Ownership** → `DOMAIN_OWNERSHIP.md`. **Quality/ops** → `TEST_DATASET_STRATEGY.md`, `PERFORMANCE_STANDARDS.md`, `OBSERVABILITY_STANDARDS.md`, `MONITORING_STRATEGY.md`, `OPERATIONS_GUIDE.md` + `runbooks/`, `RELEASE_GUIDE.md` + `RELEASE_CHECKLIST.md`, `UPGRADE_POLICY.md`, `TECH_DEBT_POLICY.md`.

---

## Pagination & loading (FROZEN 2026-06-05) — SoT `docs/PAGINATION_AND_LOADING_STANDARDS.md`
- A new list endpoint that is NOT server-side paginated (`page/limit/search/sortBy/sortOrder/filters` → `{items,totalCount,page,pageSize,totalPages,sort,filters}`) is **incorrect** — do not ship it. Default `limit=25`; reject `limit>500`; never return unbounded rows.
- A list UI without **search + filters + sorting** and **skeleton rows** is incorrect. Loading bands: 0–300ms none · 300ms–1s skeleton · 1–3s loader+% · 3–8s loader+%+operation · **>8s background job**. Loader = Hexagon (no spinners/old bars/bouncing dots); **real** stage-based % only.
- Any operation that can exceed 8s (PDF/MIS/billing/commission export, bulk import, bank-API batch, report regen) MUST be a background job; user keeps working; notify via bell/toast/in-app.

---

## Responsive-First web design (FROZEN 2026-06-05) — SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`
- Design every screen **mobile-up**; it must work at **320 / 768 / 1024 / 1440** with **no horizontal
  overflow**, no desktop-only flow. Grids `grid-cols-1 md:…` (never bare `grid-cols-N`); nav →
  hamburger/Sheet `<lg`, sidebar `lg+`; dialogs `w-full`+scroll (or Sheet); filters `flex-wrap`.
- **Tables:** desktop DataGrid → tablet condensed → **mobile card/list**; interim `<table>` wrapped in
  `overflow-x-auto`. Never force a wide table onto a phone. Playwright viewport tests per page. WEB only.

## Concurrency & editing (FROZEN 2026-06-05) — SoT `docs/CONCURRENCY_AND_EDITING_STANDARD.md`
- Editing a record? **Optimistic Concurrency Control only.** Table has `version int`; the UPDATE is
  guarded `… SET …, version=version+1, updated_at=now(), updated_by=$actor WHERE id=$id AND version=$expected`.
- 0 rows → **404** or **409 `STALE_UPDATE`** (return `current`). Updates **must** send the version (else
  **400 VERSION_REQUIRED**); reads return version. No last-write-wins, no pessimistic locks across think-time.
- Multi-statement = `withTransaction`; every change appends an **immutable** audit/history row; bulk =
  per-row OCC partial-success. FE: send version on save, show the Conflict dialog on 409 (no silent overwrite).

## Universal DataGrid (FROZEN 2026-06-05) — SoT `docs/DATAGRID_STANDARD.md`
- Building a list/table? Use the **one** DataGrid (`apps/web/src/components/ui/data-grid/`,
  TanStack Table). A new custom/page-specific table or raw `<table>` for data is **incorrect** —
  do not ship it. Do NOT create an `@crm2/ui` package (frozen decision).
- The grid does **server** search/filter/sort/pagination via `@crm2/sdk` (never client-side on
  operational data); state lives in the URL (search/filters/sort/page/columns/view); export is a
  background job that respects the current view.
- Every grid renders loading(skeleton)/empty/error/permission states + supports global+column
  search, Excel-style header filters, multi-column filters, column visibility, saved views, row
  selection, bulk actions, keyboard nav, a11y.

---

## Architecture governance — prefer reuse, never reinvent (FROZEN 2026-06-05)
SoT: `docs/ARCHITECTURE_GOVERNANCE.md` · `docs/FROZEN_DECISIONS_REGISTRY.md` · `FREEZE_LOCK_REPORT.md`.
- **Default behaviour = REUSE the approved pattern. Do NOT reinvent.** When an approved pattern
  exists (registry + reference module `apps/api/src/modules/verificationUnits/`), use it.
- An agent may **NOT** introduce a new architecture pattern / framework / ORM / data-access strategy
  / state-management / table-or-grid framework / design system / component library / auth strategy /
  API pattern / logging framework / testing framework / package architecture / folder architecture —
  even a "better" one — without the change process (ADR + Impact + Alternatives + Migration + CTO).
- A competing approach to a LOCKED decision is **architecture drift** → STOP and escalate; do not ship.
- Quality gates cannot be weakened (coverage floors ratchet up, never down without CTO).

---

## Import / Export (FROZEN 2026-06-05) — SoT `docs/IMPORT_EXPORT_STANDARD.md`
A module-specific export button/endpoint or a bespoke import is **incorrect** — do not ship it.
Export goes through the DataGrid (3 modes; `≥10k`=job); import goes through the one `@crm2/import-engine`
(domains provide only Template/Validator/Mapper/Processor). Never direct-insert or silent import;
always template→validate→preview→confirm→background→report+audit.
