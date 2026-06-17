# CRM2 — Data Access Layer & Engineering Standards (FROZEN)
**Status:** PERMANENT engineering baseline. Complements `DESIGN_AND_STACK_FREEZE.md`. No architecture/workflow/UI change.

---

## PART 1 — FINAL DATA ACCESS DECISION

### Should Prisma be the primary data-access layer? → **NO.**
**Primary data access = raw `pg` + repository pattern + zod (boundary validation). Reporting = SQL/materialized views read through raw-SQL reporting repositories.**

I evaluated the **hybrid** proposal (Prisma for CRUD + views for reporting) specifically — it is a legitimate pattern and it neutralizes the *reporting* objection. It still loses for **this** schema, for one decisive reason:

> **Every core v2 table is integrity-heavy in ways Prisma's `schema.prisma` cannot model** — and that's not just the reporting tables, it's the transactional core Prisma is supposed to own.

| Integrity feature in v2 | Used by | Prisma schema can model it? |
|---|---|---|
| **CHECK constraints** (the 3 Verification Unit invariants; result-set non-empty) | verification_units, results | ❌ no — raw migration only |
| **Triggers** (status-transition guard, audit hash-chain, case rollup) | tasks, audit_logs, cases | ❌ no — raw migration only |
| **Range partitioning** (monthly) | tasks, reports, attachments, audit, notifications, commission | ❌ no — raw migration only |
| **Partial-unique index** (one active task per case+unit) | tasks | ❌ no — raw migration only |
| **Recursive CTE** (hierarchical scope) | every list query | ❌ no — raw SQL only |

Adopting Prisma therefore means: a `schema.prisma` that is a **second, partial source of truth** which *lies* about the real DDL; **raw-SQL migration additions on essentially every table** (not just reporting); `prisma migrate` **drift risk** against hand-edited migrations; and a **dual mental model**. The CRUD DX gain does not offset maintaining two schema truths across a schema whose *defining characteristic is DB-enforced integrity*. We already have a clean raw-`pg` + zod + repository + ephemeral-DB-test foundation (1 module shipped) that delivers the type-safety and migration discipline without that tax.

**What we keep from the hybrid idea:** the reporting carve-out (views/matviews) — adopted below. **What we reject:** Prisma itself.

**Database:** **PostgreSQL 17** stays frozen (RDS-available, stable data-dir layout, banking-conservative). PG18 (async I/O, virtual generated cols, UUIDv7, skip-scan) is re-evaluated **only** once managed PG18 is GA on the target host — not a Day-1 change.

> **Prisma decision: NO — banned as the ORM. LOCKED.**

---

## PART 2 — PRISMA USAGE POLICY
**Prisma is not a dependency of CRM2.** It MUST NOT be added to any `package.json`. (Optional future: **Kysely** as a *typed query builder at the repository layer only* — composes with raw SQL/partitioning, no schema-ownership conflict. Not Day-1.) There is therefore no allowed/restricted Prisma surface — the boundary is: **all data access goes through repositories (raw `pg`)**; validation is **zod** at the service boundary.

---

## PART 3 — REPORTING STRATEGY

**Official pattern: B + C + D — Database Views (live) + Materialized Views (precomputed) read through Raw-SQL Reporting Repositories. Never A (Prisma N/A); never ad-hoc SQL in controllers.**

| Surface | Mechanism | Why |
|---|---|---|
| **Dashboard KPIs** | **Materialized View** `mv_dashboard_kpi`, worker-refreshed (5–15 min) | precomputed, hot, tolerates seconds-staleness |
| **MIS / Bank Exports** | **Materialized View(s)** `mv_mis_*` + a reporting repo that maps internal cols → the per-client column template | 95-col format, heavy, per-client mapping; precompute |
| **Billing** | **Raw-SQL reporting repository** over base tables (live) | money must be exact + live; summaries can use a `v_billing_summary` view |
| **Commission** | **Raw-SQL reporting repository** + `mv_commission_summary` for rollups | per-task accuracy live; rollups precomputed |
| **TAT / Manager reports** | **SQL Views** `v_tat_*` (live); promote to matview if heavy | freshness matters; light enough for live |

Rule: a reporting read is **either** a view/matview **or** a raw-SQL reporting repository — never inline SQL in a controller/service, never a transactional repository doing analytics.

---

## PART 4 — RAW SQL POLICY

**Raw SQL is NOT banned. It is *located*.** It lives ONLY in repositories and migrations, always parameterized.

**✅ Allowed (raw SQL):**
- Materialized views + views (defined in `db/v2/migrations`)
- Reporting repositories (`*-report.repository.ts`, `*-view.repository.ts`)
- The recursive hierarchy/scope repository (`scope.repository.ts`)
- Partition management (creation/detachment) — migrations + a worker job
- Specialized aggregations (window functions, lateral joins, `ARRAY_AGG FILTER`)
- All schema DDL (CHECK, triggers, partitions, partial-unique) — migrations

**❌ Forbidden:**
- SQL strings inside **controllers**
- SQL strings inside **services** (business logic) — services call repositories
- SQL strings inside **UI/route handlers**
- **String-interpolated** user input into SQL (always `$1,$2` parameters)
- A transactional repository running reporting/analytics queries

**Rule:** *"If it's SQL, it's in a `*.repository.ts` or a migration, and it's parameterized. Nowhere else."*

---

## PART 5 — REPOSITORY STANDARDS

One domain → a `repositories/` folder with **one repository per data concern**:
```
apps/api/src/modules/<domain>/
└── repositories/
    ├── <entity>.repository.ts          # TRANSACTIONAL: CRUD + transactions over base tables (raw pg, typed)
    ├── <entity>-report.repository.ts    # REPORTING: raw-SQL analytics over base tables (read-only)
    └── <entity>-view.repository.ts       # VIEW: reads a v_/mv_ view (read-only)
└── scope.repository.ts (shared)          # recursive hierarchy/scope CTE (read-only)
```
Contract for every repository:
- Returns **typed camelCase** objects (`camelize` via `platform/db.ts`).
- **Parameterized** queries only; maps PG error codes to typed `AppError` (e.g. 23505 → 409).
- **Transactional** repos own writes + multi-statement transactions (`BEGIN/COMMIT` via a client).
- **Reporting/View** repos are **read-only** (no writes, ever).
- Services call repositories; controllers call services. **No layer skips.**
- The existing `verificationUnits/repository.ts` is the reference transactional repository.

---

## PART 6 — DATABASE VIEW STRATEGY

**Use both, by load profile:**
- **SQL Views (`v_<name>`)** — live, light, always-fresh aggregations (`v_case_summary`, `v_task_pipeline`, `v_tat_open`).
- **Materialized Views (`mv_<name>`)** — heavy/precomputed (`mv_dashboard_kpi`, `mv_mis_axis`, `mv_commission_summary`).

| Aspect | Rule |
|---|---|
| **Naming** | `v_` = view · `mv_` = materialized view · reporting repos read these |
| **Definition / ownership** | Views are **migrations** (`db/v2/migrations`) — versioned, reviewed like tables |
| **Refresh** | matviews refreshed by **`apps/worker`** on a schedule via `REFRESH MATERIALIZED VIEW CONCURRENTLY` (requires a unique index on the matview); cadence per surface (dashboard ~5–15 min, MIS nightly/on-demand) |
| **Consumption** | only through a `*-view.repository.ts` — never queried inline |
| **Drift guard** | a matview's base-column dependencies are part of its migration; changing a base table that feeds a matview requires re-creating the matview in the same migration |

---

## PART 6.5 — NAMING CONVENTIONS (FROZEN)

| Layer | Convention | Example |
|---|---|---|
| **PostgreSQL** (tables, columns, indexes) | `snake_case` | `verification_units.required_form_code` |
| **snake→camel bridge** (NOT Prisma — banned) | `camelize()` at the repository edge (`platform/db.ts`) | row `required_form_code` → `requiredFormCode` |
| **API** (JSON request/response payloads) | `camelCase` | `{ "requiredFormCode": "RESIDENCE_FORM" }` |
| **Backend** (TS identifiers, services, controllers) | `camelCase` | `verificationUnitService.create()` |
| **Frontend** (TS, props, hooks, query keys) | `camelCase` | `requiredPhotos`, `useVerificationUnits` |
| **Routes** (URL paths) | `kebab-case` | `/api/v2/verification-units` |
| **Env Vars** | `UPPER_SNAKE_CASE` | `DATABASE_URL`, `JWT_SECRET`, `REDIS_QUEUE_URL` |

**Rules:**
- Raw SQL is **always** `snake_case`; never alias to camelCase in SQL (`AS "requiredFormCode"`) — the `camelize()` bridge does it once, at the repository boundary.
- TS code is **always** `camelCase`; never reference `row.required_form_code` after camelize.
- **Unit/enum CODE values** (data, not identifiers) are `UPPER_SNAKE` (`RESIDENCE`, `KYC_DOCUMENT`, `AGENT_COMMISSION`) — these are domain constants, distinct from the casing layers above.
- Never rename across the boundary as drive-by cleanup; the bridge is the single conversion point.

---

## PART 7 — RULE FILE UPDATES (the permanent rules)

Added to the CRM2 engineering baseline (this file is the canonical source; `DESIGN_AND_STACK_FREEZE.md` Part 2 cross-references it):

1. **Data Access Rule** — all DB access goes through repositories (raw `pg`); zod validates at the service boundary; no ORM.
2. **Prisma Rule** — Prisma is **banned**; never added to any `package.json`. (Kysely allowed later at repo layer only.)
3. **Reporting Rule** — reporting = views/matviews read via raw-SQL reporting repositories; never inline, never in a transactional repo.
4. **Raw SQL Rule** — raw SQL only in `*.repository.ts` + migrations, always parameterized; forbidden in controllers/services/UI handlers.
5. **Repository Rule** — one repo per concern (`entity` / `entity-report` / `entity-view`); typed camelCase returns; read-only repos never write; no layer-skipping.
6. **Database View Rule** — `v_` live / `mv_` precomputed; defined in migrations; matviews refreshed by the worker CONCURRENTLY; consumed only via view repositories.
7. **Display Casing Rule** — user-visible text renders UPPERCASE via **CSS only** (`@crm2/ui-theme/tokens.css`). Stored values are **NEVER** transformed (no DB `UPPER()`/`citext`/trigger on write, no API uppercasing, no input value mutation). Editable `input`/`textarea` are WYSIWYG; render case-sensitive data (emails, URLs, file names, hashes, tokens, OTP, LOS/Application/Bank/SOL IDs, other external identifiers) in `font-mono` or `.case-sensitive`. Never use `.toUpperCase()` for display in components. Full spec: `UPPERCASE_DISPLAY_STANDARD.md`.

---

## PART 8 — FINAL DECISION

1. **Prisma decision:** **NO — banned.** Primary access = raw `pg` + repository + zod. (Hybrid evaluated + rejected: the integrity-heavy core, not just reporting, fights Prisma.) Database = **PostgreSQL 17** (PG18 deferred to managed-GA).
2. **Reporting strategy:** **Views + Materialized Views via raw-SQL reporting repositories** (B+C+D). Never Prisma, never inline SQL.
3. **Raw SQL strategy:** allowed **only** in repositories + migrations, parameterized; forbidden in controllers/services/UI handlers.
4. **Repository pattern:** per-domain `repositories/` — `<entity>` (transactional) · `<entity>-report` · `<entity>-view` · shared `scope.repository`.
5. **View strategy:** `v_` (live) / `mv_` (worker-refreshed CONCURRENTLY); defined in migrations; consumed via view repositories.
6. **Rule file updates:** the 6 rules above are codified here as the canonical engineering standard.

> ## "CRM2 Data Access Layer is now permanently frozen."

No architecture redesign · no business-workflow redesign · no UI redesign — data-access + engineering-standard freeze only.

---

## PART 9 — MACHINE ENFORCEMENT (2026-06-04)

These standards are **machine-enforced**, not advisory. The full rule→mechanism→file map is `docs/CI_CD_STANDARDS.md` (Enforcement Matrix, 40 rules). Highlights: TS strict (all flags, `tsconfig.base.json`); ESLint flat config (`eslint.config.js`) banning `any`/ts-suppressions/`eslint-disable`/`console`/TODO-FIXME-HACK-TEMP/business-layer magic numbers/FE-raw-fetch/controller→repository; Prettier `--check`; centralized `@crm2/logger`; structured `AppError`+`ErrorCode`; dependency-cruiser boundaries (no-circular, DB-only-in-repos, controller→service→repository, no-cross-feature-internals); gitleaks secrets; knip dead-code; vitest coverage ENFORCED+always-on (@vitest/coverage-v8; honest floors api 85/58, sdk 90/65, logger 95/80 — ratchet up per TECH_DEBT_POLICY); husky+lint-staged pre-commit; CI 9-gate (`.github/workflows/ci.yml`). Local gate = `pnpm verify`. Rule files: `AGENT_RULES.md`, `CTO_RULES.md`, `CONTRIBUTING.md`, `DEVELOPMENT_WORKFLOW.md`, `BUILD_GUIDE.md`, `ALLOWED_DEPENDENCIES.md`.

---
*Engineering-standard freeze. Consistent with the prior stack freeze (NO Prisma). The shipped `verificationUnits` repository already conforms; no rework required. Reporting/view/scope repositories follow this pattern as those modules land.*
---

## Long-Term Governance & Operations (2026-06-04 freeze)

Full map: `ACS_CRM_2.0_MASTER_MEMORY.md` §7.6. **Decisions** → `docs/adr/` (ADR-0001..0019; change a frozen decision only via a superseding ADR + CTO + domain-owner sign-off — `LONG_TERM_PROTECTION.md`). **Business rules** → `BUSINESS_RULES.md` (no rule lives only in code). **API/contract** → `API_VERSIONING_POLICY.md`, `DOCUMENTATION_AS_CODE.md`. **DB change** → `DATABASE_CHANGE_PROCESS.md`. **Security** → `SECURITY_STANDARDS.md`, `SECURITY_GUIDE.md`. **Resilience** → `DISASTER_RECOVERY.md` (quarterly restore drill), `DATA_RETENTION_POLICY.md`. **Ownership** → `DOMAIN_OWNERSHIP.md`. **Quality/ops** → `TEST_DATASET_STRATEGY.md`, `PERFORMANCE_STANDARDS.md`, `OBSERVABILITY_STANDARDS.md`, `MONITORING_STRATEGY.md`, `OPERATIONS_GUIDE.md` + `runbooks/`, `RELEASE_GUIDE.md` + `RELEASE_CHECKLIST.md`, `UPGRADE_POLICY.md`, `TECH_DEBT_POLICY.md`.

---

## Pagination & list-API contract (FROZEN 2026-06-05)
SoT: **`docs/PAGINATION_AND_LOADING_STANDARDS.md`** · UI side: `UI_STANDARDS.md`.
- **Every list endpoint is server-side paginated.** Accepts `page, limit, search, sortBy, sortOrder, filters`; returns the single envelope `{ items, totalCount, page, pageSize, totalPages, sort, filters }`. No custom pagination shapes.
- **Page size:** default `25`; allowed `25/50/100/200`; extended max `500` (MIS/reporting); server **clamps/rejects `limit > 500`**; no unbounded rows.
- **DB:** index sort/filter columns; **no `SELECT *`**; no full scans; `EXPLAIN` reviewed; count+page in the repository (parameterized); no N+1.
- **Exports never paginate** — background jobs (`>8s ⇒ background job`).
- CI gates (activate per endpoint): pagination-contract · query-count · N+1 · large-dataset · perf-budget (`docs/CI_CD_STANDARDS.md`). Pre-freeze list endpoints are non-compliant → retrofit tracked in MASTER_MEMORY §8.

---

## Universal DataGrid contract (FROZEN 2026-06-05) — SoT `docs/DATAGRID_STANDARD.md`
- **One table component** (`apps/web/src/components/ui/data-grid/`, TanStack Table); raw/
  custom/page-specific data tables are forbidden and **fail review**. No `@crm2/ui` package created
  (frozen §4) — DataGrid is owned in-app like the shadcn components.
- It is the FE realization of the pagination envelope: sends `page/limit/search/sortBy/sortOrder/
  filters` via `@crm2/sdk`, consumes `{items,totalCount,page,pageSize,totalPages,sort,filters}`.
- **Server-side only** for search/filter/sort/pagination. Column whitelists for `sortBy`/search/
  filters live server-side. Export = background job respecting the active view (XLSX/CSV).
- CI gates 45–48 (`docs/CI_CD_STANDARDS.md`) validate grid behaviour + a11y; pre-freeze bespoke
  tables retrofit to DataGrid (MASTER_MEMORY §8).

---

## Architecture governance (FROZEN 2026-06-05)
These standards are LOCKED decisions (`docs/FROZEN_DECISIONS_REGISTRY.md`). Governance + change
process: `docs/ARCHITECTURE_GOVERNANCE.md`; enforcement map: `FREEZE_LOCK_REPORT.md`; proposals:
`ARCHITECTURE_CHANGE_REQUEST.md`. No new ORM/framework/data-access/logging/testing/package/folder
pattern without ADR + Impact + Alternatives + Migration + CTO approval. **Default: reuse the approved
pattern.** Quality gates cannot be weakened (coverage ratchets up only).

---

## Responsive-First web design (FROZEN 2026-06-05) — SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`
Every web screen is designed **mobile-up** and must work at **320 / 768 / 1024 / 1440** with **no
horizontal overflow** and **no desktop-only workflow**. Grids start single-column (`grid-cols-1 md:…`,
never a bare `grid-cols-N`); nav collapses to a hamburger/Sheet below `lg`; dialogs are `w-full` with
vertical scroll (or a mobile Sheet); filter rows `flex-wrap`. **Table strategy:** desktop DataGrid →
tablet condensed → **mobile card/list** (interim tables min. `overflow-x-auto`). Playwright viewport
tests required (CI gates 49–50). Review rejects bare `grid-cols-N`, unwrapped wide tables, fixed page
widths, desktop-only nav. New screens ship responsive from day 1. Scope = WEB UI only.

## Concurrency & editing standard (FROZEN 2026-06-05) — SoT `docs/CONCURRENCY_AND_EDITING_STANDARD.md`
**Optimistic Concurrency Control.** Every editable table has `version integer NOT NULL DEFAULT 1`. Every
update (incl. activate/deactivate) is guarded: `… SET …, version = version + 1, updated_at = now(),
updated_by = $actor WHERE id = $id AND version = $expected RETURNING …`. 0 rows → existence check → **404
NOT_FOUND** or **409 `STALE_UPDATE`** (body carries `current`). Updates **require** the expected version
(body `version` or `If-Match`; missing → **400 VERSION_REQUIRED**); reads return `version`. Multi-statement
writes use `withTransaction`; raw SQL only in repos. Every create/update/deactivate appends an
**immutable** audit/history row. Bulk = **per-row OCC** partial-success (large = background job). FE shows
a **Conflict dialog** (reload & re-apply / discard) — **never a silent overwrite**. No pessimistic locks
across user think-time. CI gates 51–53. New modules build it in; pre-freeze modules retrofit (C-10).

## Import / Export standard (FROZEN 2026-06-05) — SoT `docs/IMPORT_EXPORT_STANDARD.md`
One export path (DataGrid; 3 modes; XLSX/CSV/PDF; `≥10k`=background job) and one import engine
(`@crm2/import-engine`, app-internal per the no-new-package freeze — backend `apps/api/src/platform/import/`,
contracts in `@crm2/sdk`). Import flow: template→fill→upload→validate→preview→confirm→background→report;
every import writes a validation report + permanent audit record (User/Date/File/Total/Success/Failed/
Duration). No bespoke per-module import/export. Forbidden import: audit/billing/commission/system/
notification history.

---

## Platform-capability ownership (FROZEN 2026-06-05) — SoT `docs/PLATFORM_CAPABILITIES_OWNERSHIP.md`
Where the frozen mandatory capabilities live (all app-internal; extraction DEFERRED): **DataGrid** →
`apps/web/src/components/ui/data-grid/`; **Import engine** → `apps/api/src/platform/import/`
(+ worker + web flow); **Export engine** → `apps/api/src/platform/export/` (+ report-worker jobs +
DataGrid menu). Contracts in `@crm2/sdk`; styling tokens in `@crm2/ui-theme`; import/export audit via
`@crm2/logger`; limits/storage/queue in `@crm2/config`; `data.import`/`data.export` in `@crm2/access`.
