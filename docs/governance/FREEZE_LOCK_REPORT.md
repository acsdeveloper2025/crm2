# Freeze Lock Report (CRM2)

> Per-decision **enforcement** view of `docs/FROZEN_DECISIONS_REGISTRY.md`. For each LOCKED decision:
> what enforces it (the mechanism that catches drift), the governing doc, and the ADR. Governance &
> change process: `docs/ARCHITECTURE_GOVERNANCE.md`. Partial/deferred/ratchet/fixed status of these
> decisions: **`docs/COMPLIANCE_GAPS_REGISTRY.md`**. All decisions below are **LOCKED**; change only
> via the ACR + superseding ADR + CTO process.

| Decision | Status | ADR | File (governing doc) | Enforcement mechanism |
|---|---|---|---|---|
| Case → Task → Verification Unit | LOCKED | ADR-0002 | MASTER_MEMORY §2 | DDL CHECKs (mig 0001) + code review + governance |
| Verification Unit Registry (68 units) | LOCKED | ADR-0001 | `db/v2/REGISTRY_SPEC.md`, `BUILD_GATE_REGISTRY_LOCK.md` | migration + seed lock + review |
| PostgreSQL 17 | LOCKED | ADR-0003 | DESIGN_AND_STACK_FREEZE | `DATABASE_CHANGE_PROCESS.md` + review |
| No Prisma / no ORM | LOCKED | ADR-0004 | ENGINEERING_STANDARDS | dependency-cruiser `db-access-only-in-repositories` + review |
| Repository pattern | LOCKED | ADR-0005 | ENGINEERING_STANDARDS §5 | dependency-cruiser `controller-not-to-repository` + review |
| Data access (raw SQL in repos+migrations only) | LOCKED | ADR-0005 | ENGINEERING_STANDARDS §5 | dependency-cruiser + ESLint + review |
| API versioning (`/api/v2`) | LOCKED | ADR-0011 | `API_VERSIONING_POLICY.md` | route-prefix convention + review |
| Mobile compatibility | LOCKED | ADR-0012 | `MOBILE_API_COMPATIBILITY_MATRIX.md` | contract tests (pending-activation) + review |
| Verification Workspace | LOCKED | ADR-0006 | MASTER_MEMORY §1 | review (build pending) |
| Naming convention | LOCKED | ADR-0007 | ENGINEERING_STANDARDS §6 | `camelize()` edge + ESLint + review |
| Design system | LOCKED | ADR-0008 | DESIGN_AND_STACK_FREEZE, `COLOR_SYSTEM_FREEZE.md` | token-only + review |
| UI theme (`@crm2/ui-theme` only color source) | LOCKED | ADR-0008 | `COLOR_SYSTEM_FREEZE.md` | no-hardcoded-color review gate (0 in features/components) |
| Feature-flag strategy | LOCKED | ADR-0009 | ADR-0009 | review (impl pending) |
| Reporting strategy (`v_`/`mv_`) | LOCKED | ADR-0010 | ENGINEERING_STANDARDS §5 | repository pattern + review |
| TypeScript strict | LOCKED | ADR-0013 | `tsconfig.base.json` | CI `typecheck` (6 strict flags) |
| Logger (`@crm2/logger`, 6 levels) | LOCKED | ADR-0013 | ENGINEERING_STANDARDS | ESLint `no-console` + `check-suppressions` + CI |
| Quality gates | LOCKED | ADR-0013 | `docs/CI_CD_STANDARDS.md` | `pnpm verify` + CI (typecheck/lint/format/no-suppressions/boundaries/coverage/build/gitleaks) |
| Security standards (RBAC default-deny) | LOCKED | ADR-0013 | `SECURITY_STANDARDS.md` | `@crm2/access` + gitleaks + review |
| Universal DataGrid | LOCKED | — (ADR-0013 umbrella) | `docs/DATAGRID_STANDARD.md` | CI gates 45–48 + code review (no raw/custom data table) |
| Pagination standard | LOCKED | — (standards freeze) | `docs/PAGINATION_AND_LOADING_STANDARDS.md` | CI gates 40–44 + review |
| Search & filtering standard | LOCKED | — (standards freeze) | `docs/DATAGRID_STANDARD.md` | CI gates 46–47 + review |
| Loading standard | LOCKED | — (standards freeze) | `docs/PAGINATION_AND_LOADING_STANDARDS.md`, `UI_STANDARDS.md` | review |
| Background-job standard | LOCKED | — (standards freeze) | `docs/PAGINATION_AND_LOADING_STANDARDS.md` | CI gate 44 + review |
| Package architecture (no `@crm2/ui`) | LOCKED | ADR-0013 | MASTER_MEMORY §4, `ALLOWED_DEPENDENCIES.md` | dependency-cruiser + review |
| Technology stack | LOCKED | ADR-0003/0008/0013 | DESIGN_AND_STACK_FREEZE, `ALLOWED_DEPENDENCIES.md` | lockfile review + governance |
| Universal Import/Export + `@crm2/import-engine` | LOCKED | — (standards freeze) | `docs/IMPORT_EXPORT_STANDARD.md`, `docs/DATAGRID_STANDARD.md` | code review (no bespoke import/export; DataGrid-only export) + governance (build DEFERRED) |
| Case Workspace (single page) & Reporting engine | LOCKED | ADR-0015 | `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` | review (build DEFERRED) |
| Rate Management — flat one-table model | LOCKED | ADR-0018 (supersedes ADR-0016) | migrations 0013/0014, `rates`/`rateTypes` modules | code review + governance |
| Effective-From temporal usability gating | LOCKED | ADR-0017 | `docs/EFFECTIVE_FROM_STANDARD.md`, migrations 0015/0016 | repo-SQL gate + tests + review |
| Responsive-First web design | LOCKED | — (ADR-0008/0013 umbrella) | `docs/RESPONSIVE_DESIGN_STANDARD.md` | CI gates 49–50 + review |
| Concurrency & editing (OCC) | LOCKED | ADR-0019 | `docs/CONCURRENCY_AND_EDITING_STANDARD.md` | version-guarded UPDATE + CI gates 51–53 + review |

**Example (as required):** `No Prisma | LOCKED | ADR-0004 | ENGINEERING_STANDARDS.md | dependency-cruiser (db-only-in-repositories) + code review + governance`.

Every LOCKED decision has an ADR (or a standards-freeze SoT doc under the ADR-0013 governance
umbrella), an owner (`FROZEN_DECISIONS_REGISTRY.md`, default CTO), and a live enforcement mechanism.
