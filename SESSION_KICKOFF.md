# CRM2 — Session Kickoff (paste this to start any new session)

Use this to start every CRM2 (v2) session so it continues the project consistently. The agent must READ the listed files (not skim) before doing anything.

---

## 0. Operating rules — read these Claude memory files FIRST (they override defaults)
Memory dir: `~/.claude/projects/-Users-mayurkulkarni-Downloads-CRM-APP-MONOREPO-PROD/memory/`
- `MEMORY.md` (index — read fully; the long **CRM2 BUILD PHASE** line is the live status)
- `feedback_cave_mode.md` — minimal-token output
- `feedback_crm2_autonomous_cto.md` — during v2 build: act as CTO, decide + execute, don't ask per-step; **design/UX is yours to fix too** (only pushes/deploys/architecture-reopens pause)
- `feedback_ask_before_acting.md` — still applies to push/deploy/tag
- `feedback_browser_verify_perform_actions.md` — for UI work, don't stop at tests: **perform the action in the browser preview & confirm persisted**
- `project_crm2_multiagent_build_method.md` — HOW we build (CTO orchestrates + spawns specialist agents)
- `project_acs_crm_v2_build.md` (`crm2-build`) — what's frozen + full current status (read in full)
- `feedback_commit_and_repo_hygiene.md` — author = Mayur Kulkarni, conventional commits, NO AI trailer, secret-sweep before push
- `feedback_never_delete_memory_files.md`, `feedback_update_memory_each_phase.md`, `feedback_use_karpathy_guidelines.md`, `feedback_no_guessing.md`, `feedback_naming_conventions.md`, `feedback_code_quality_standards.md`, `feedback_sql_live_db_apply.md`

## 1. Project source of truth — read in this order (in `crm2/`)
1. `PROJECT_INDEX.md` — the single entry point (links everything)
2. `ACS_CRM_2.0_MASTER_MEMORY.md` — frozen architecture/data-model/UI/stack/security + §7.5 enforcement + §7.6 governance + §8 status
3. `docs/ENGINEERING_STANDARDS.md`, `docs/DESIGN_AND_STACK_FREEZE.md`, `docs/CI_CD_STANDARDS.md`, `UI_STANDARDS.md`
4. `AGENT_RULES.md`, `CTO_RULES.md`, `BUILD_GUIDE.md`, `BUILD_METHOD.md`
5. `docs/adr/README.md` + ADR-0001..0019
6. **UI/UX & scalability freezes:** `docs/MANAGEMENT_LIST_STANDARD.md` (Created/Updated cols · accordion master-detail) · `docs/PAGINATION_AND_LOADING_STANDARDS.md` · `docs/DATAGRID_STANDARD.md` · `docs/IMPORT_EXPORT_STANDARD.md`
7. **Architecture governance (drift-prevention):** `docs/FROZEN_DECISIONS_REGISTRY.md` (33 rows, 32 LOCKED + #29 superseded; decisions — the SoT) · `docs/ARCHITECTURE_GOVERNANCE.md` · `FREEZE_LOCK_REPORT.md` · `docs/COMPLIANCE_GAPS_REGISTRY.md` (fixed/deferred/ratchet/audit) · `docs/PLATFORM_CAPABILITIES_OWNERSHIP.md` · `ARCHITECTURE_CHANGE_REQUEST.md`
8. Governance/ops: `BUSINESS_RULES.md`, `API_VERSIONING_POLICY.md`, `MOBILE_API_COMPATIBILITY_MATRIX.md`, `SECURITY_STANDARDS.md`, `LONG_TERM_PROTECTION.md`, `DATABASE_CHANGE_PROCESS.md`, `ALLOWED_DEPENDENCIES.md`, `TECH_DEBT_POLICY.md`, `OPERATIONS_GUIDE.md` (+ rest via PROJECT_INDEX)

## 2. Project progress — establish current state (as of 2026-06-05, HEAD `2746645`, LOCAL only)
- Read `ACS_CRM_2.0_MASTER_MEMORY.md` §8 (Implementation Status) + `docs/COMPLIANCE_GAPS_REGISTRY.md`.
- Run `git -C crm2 log --oneline -20` and `git -C crm2 status`.
- **Resequenced build order (user directive): ALL ADMINISTRATION first, THEN OPERATIONS.**
  - **DONE:** Verification Units · Clients · Products · CPV Mapping · **Rate Management** · **Location Management** (incl. full official all-India pincode import — 157k areas / 19.3k pincodes / 36 states, `country` added).
  - **NEXT admin:** **User Management** → Access Control → Templates → System.
  - **Then operations:** Cases → Tasks → Assignment → Verification Workspace → Reports → MIS → Billing → Dashboard/Field-Monitoring → workers.
- Local test PG: PG18 on `:5433` (`LC_ALL=C`); `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test`. Dev API (`:4000`) → DB `postgresql://postgres@127.0.0.1:54329/crm2_dev` — **new migrations must be `psql -f`'d into :54329 manually** (harness only applies to :5433). Web preview web-v2 `:5273` → api `:4000`.

## 3. Standing rules (do not violate)
- Architecture / data model / design / stack / engineering-standards / API-versioning are **FROZEN**. **Build only.** No audits, no redesigns. To change a frozen decision: STOP, propose a superseding ADR + get human + owner sign-off (`LONG_TERM_PROTECTION.md`).
- Act as **CTO + multi-agent team** (`BUILD_METHOD.md`): orchestrate, spawn specialist agents for parallel work, keep shared-config/interdependent edits inline, verify, gate, commit.
- Every change is **test-first**; a phase is done only when `pnpm verify` is green (typecheck → lint → format → no-suppressions → boundaries → test → build) + tests + CTO gate (`CTO_RULES.md`). Integration tests need `DATABASE_URL` (ephemeral Postgres; Docker is often down → use a local PG instance).
- Machine-enforced: no `any`/ts-suppressions/`eslint-disable`/`console.*`; centralized `@crm2/logger`; raw SQL only in repositories+migrations; FE via `@crm2/sdk` only; `/api/v2` versioned; mobile (`crm-mobile-native`) is a first-class `/api/v2` consumer — never break it. **Coverage is enforced (`coverage.enabled:true`); floors ratchet UP only.**
- **UI/scalability freezes apply to every new screen:** every list = server-side paginated (default 25; 25/50/100/200; ≤500 MIS; envelope `{items,totalCount,page,pageSize,totalPages,sort,filters}`) via the ONE **DataGrid** (`apps/web/src/components/ui/data-grid/`, TanStack Table) — no custom/raw tables; Created/Updated date-time cols + labelled headers; skeleton loaders; export only via DataGrid + one `@crm2/import-engine` (no per-module import/export). Build these once at the first operational list; the 6 pre-freeze admin tables retrofit later (gaps registry C-1..C-5).
- **No new architecture/pattern/framework/package** without a superseding ADR + Impact + Alternatives + Migration + CTO (`docs/ARCHITECTURE_GOVERNANCE.md`). **Default = reuse, never reinvent.** No new package — capabilities are app-internal (`@crm2/ui/DataGrid` / `@crm2/import-engine` are conceptual; `docs/PLATFORM_CAPABILITIES_OWNERSHIP.md`).
- Commit at green gates (author Mayur, conventional, no AI trailer). **Never push/deploy without explicit OK.** Every audit finding ends FIXED/DEFERRED/RATCHET/WONTFIX in `docs/COMPLIANCE_GAPS_REGISTRY.md` — never silently dropped.

## 4. First action this session
State the current phase (from §8 + git log) and the next concrete step, then proceed. If nothing else is specified, resume the build order.

---
*Keep this file current: when a phase completes or a freeze changes, update `ACS_CRM_2.0_MASTER_MEMORY.md` §8, the relevant doc, and the Claude memory files — so the next session stays consistent.*
