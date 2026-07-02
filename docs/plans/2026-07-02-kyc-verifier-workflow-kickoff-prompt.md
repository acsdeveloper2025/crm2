# KYC-verifier office-task + export workflow — new-session kickoff prompt (paste verbatim)

> Working artifact created 2026-07-02. Paste the block below into a fresh CRM2 session, or start the
> session with: *"Read `docs/plans/2026-07-02-kyc-verifier-workflow-kickoff-prompt.md` and execute it."*

---

You are the **CTO + multi-agent team** for CRM2 (ACS verification CRM, live on `crm.allcheckservices.com`).
Your mission this session: **deeply audit, then fix and improve the KYC-verifier office-task workflow** —
how an office/KYC task is created and assigned to a KYC verifier, his login + dashboard, how he sees the
tasks assigned to **him only**, and his core job: **export the tasks assigned to him, verify them from
outside sources over any medium, and relay the result back to the backend over any medium (email / WhatsApp /
anything)**. Critically: the **KYC verifier NEVER closes / completes / finalizes a task in his login** — he
only exports (and must not re-export an already-exported task). Produce a **deep audit + a plan** via proper,
research-backed, multi-agent work, then **STOP for owner + CTO sign-off before building.**

This is a **frozen-architecture, build-only** repo. New capability is additive; any change to a frozen
decision needs a **superseding ADR + CTO + owner sign-off** (`docs/governance/LONG_TERM_PROTECTION.md`).
**No guessing — verify every claim against the live code + DB (things change; today is later than the ADRs).**

## 0 — Operating rules (non-negotiable)
- Follow `CLAUDE.md` exactly (it OVERRIDES defaults): cave-mode minimal output; **surgical, no reinvention,
  no guessing**; test-first; `pnpm verify` green is the definition of done.
- **Ask before push / deploy / tag / merge / live-DB writes.** Commits: author `Mayur Kulkarni
  <mayurkulkarni786@gmail.com>`, conventional, **NO AI / Co-Authored-By trailer**, never `--no-verify`.
- Machine-enforced: no `any` / ts-suppressions / `eslint-disable` / `console.*`; `@crm2/logger` only; raw SQL
  **only** in repositories + migrations; FE talks to the API via `@crm2/sdk` only; `/api/v2` versioned +
  **additive-only**; **never break mobile** (`crm-mobile-native`, separate repo, first-class `/api/v2`
  consumer — the KYC verifier is a WEB role, but mobile shares the case/task contract, so don't touch it).
- **Next ADR = 0085. Next migration = 0110.**

## 1 — Mandatory pre-flight reads (in order, before designing anything)
**Repo source-of-truth:** `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` (§8 live status + §1–§7
freezes) → `SESSION_KICKOFF.md`.

**Claude file-memory:** read `~/.claude/projects/-Users-mayurkulkarni-Downloads-crm2/memory/MEMORY.md` + the
5 always-load rule files. Then **grep the memory dir** for the relevant topic files:
`kyc`, `office`, `assign`, `assignee`, `notification`, `export`, `verifier`, `revoke`, `rework`, `workspace`.
Start with: `project_kyc_unit_access_2026_06_26.md`, `project_assignee_pool_territory_2026_06_27.md`,
`project_assign_notification_fix_2026_06_30.md`, `project_notification_delivery_audit_2026_07_01.md`,
`project_mobile_roundtrip_audit_2026_06_24.md` (KYC workflow cluster), `project_import_export_coverage_2026_06_22.md`,
`project_mobile_form_source_of_truth.md`, and the just-shipped `project_mis_rebuild_2026_07_01.md` (the export
engine / read-model / scope patterns to reuse).

**ADRs (`docs/adr/`):** the assignment / KYC / office / lifecycle / notification / export set —
- **ADR-0073** (KYC-unit assignment eligibility — `user_kyc_unit_access`), **ADR-0024** (eligible-assignee
  pool), **ADR-0078** (assignee pool = territory/unit, not hierarchy), **ADR-0070** (removed `verification_units.kind`;
  `worker_role` is the discriminator).
- **ADR-0022 / 0072** (RBAC `role_permissions` runtime model + CLIENT+PRODUCT scope), **ADR-0032** (two-layer
  outcome: device/submit vs office result; submit==complete), **ADR-0025 / 0033** (task lifecycle, complete,
  revoke, revisit/rework).
- **ADR-0027** (notification producers + delivery), **ADR-0055 / 0056** (revoke-before-reassign, field rate
  type auto-derived), and the KYC-workflow audit ADRs **ADR-0061 / 0062** (KYC doc-evidence + APF alignment).
- **ADR-0081** (commission-summary read-model + export) and **ADR-0084** (the MIS rebuild — predefined
  report-type + code-owned allow-list + `platform/export` sync/413 + scope reuse; the export/read-model
  pattern to mirror if a KYC-verifier export view is built).

**Standards / freezes (`docs/`):** `ENGINEERING_STANDARDS.md`, `CI_CD_STANDARDS.md`, `DATAGRID_STANDARD.md`,
`PAGINATION_AND_LOADING_STANDARDS.md`, `IMPORT_EXPORT_STANDARD.md`, `CASE_WORKSPACE_AND_REPORTING_FREEZE.md`,
`COMPLIANCE_GAPS_REGISTRY.md`, `governance/` (`AGENT_RULES.md` · `CTO_RULES.md` · `BUILD_METHOD.md`).

## 2 — Ground-truth: read the ACTUAL flow — local code + git + remote code + DB (do not invent)
- **Local code** — trace the real KYC-verifier path end-to-end:
  - RBAC: `packages/access/src/permissions.ts` — the `KYC_VERIFIER` role's `ROLE_PERMISSIONS` (what can he
    do today? — verify whether he has `case.view`, `page.dashboard`, and whether he has `data.export` /
    `field_review.complete` / `case.assign` or NOT).
  - Office/KYC task creation + assignment: `apps/api/src/modules/cases/*` + `modules/tasks/*` — how a task
    becomes OFFICE (`visit_type='OFFICE'`, KYC `worker_role`) and how it's assigned to a specific KYC verifier
    (the office assignment pool + `user_kyc_unit_access` grant, ADR-0073/0024/0078). `platform/scope/*`
    (KYC_VERIFIER hierarchy = SELF → he sees only his).
  - His login / dashboard / task views: `apps/web/src/features/{auth,dashboard,cases,pipeline,tasks}/*` —
    what a `KYC_VERIFIER` actually sees after login; how tasks assigned to HIM surface today.
  - Export: `apps/api/src/platform/export/*` + the Universal DataGrid export + `data.export` perm — can a
    KYC verifier export today? Is there ANY per-task export tracking (exported-flag / who / when)?
  - Lifecycle + statuses: `case_tasks.status` enum + the transitions (who sets ASSIGNED / SUBMITTED /
    COMPLETED); confirm the KYC verifier does NOT complete (the code comment frames KYC_VERIFIER as the
    external relay that "never completes" — verify it still holds).
  - Notifications: `apps/api/src/modules/notifications/*` — which producers fire to a KYC verifier on assign.
- **git:** `git log --oneline -40`; and `git log -p` over the KYC/office/assignment/export/notification files
  to see how the current flow evolved + any half-built pieces.
- **remote code + DB (read-only — NEVER write to the live DB):** the prod box (`49.50.119.155:2232` root,
  `/opt/crm2` — see `project_crm2_v2_deploy_2026_06_17.md` / `project_prod_disk_full_db_outage_2026_06_26.md`).
  Over SSH inspect the LIVE state: existing `KYC_VERIFIER` users, their `user_kyc_unit_access` grants, the
  OFFICE/KYC `case_tasks` (status distribution, assignees), whether any export/exported artifact exists, and
  how the prod `role_permissions` grants the KYC verifier. Compare with `crm2_dev`. (Prod DB user =
  `$POSTGRES_USER`, not "postgres".)

## 3 — Business logic to understand + encode (the KYC verifier's role — the crux)
Map the FULL loop and pin every rule against the code/DB:
- **Office task creation** — how an office/KYC task is created (visit_type OFFICE, KYC unit/worker_role) and
  assigned to a specific KYC verifier (ADR-0073 grant + office pool). Who creates it (backend/manager)?
- **He sees only HIS tasks** — KYC_VERIFIER scope = SELF; confirm case/task visibility limits him to tasks
  assigned to him, no wider.
- **His CORE job = EXPORT his assigned tasks** — verify externally (any medium) and relay the result to the
  backend (email / WhatsApp / any medium), all **OUTSIDE the app**. Decide: reuse an existing list scoped to
  him, or a **new KYC-verifier view**. He needs a clean "these are my tasks to export" surface.
- **He NEVER closes / completes / finalizes in his login** — reconcile with the existing model (permissions
  show no `field_review.complete`; the office/backend records the official result later). Confirm + design so
  the UI offers him NO complete/close action — export only.
- **No double-export** — he must not export an already-exported task. Design an **export-tracking** model
  (per-task exported flag / timestamp / by-whom, likely an append-only export-audit record) so the "to
  export" list excludes already-exported, and re-export is either blocked or an explicit re-export with a
  reason. Decide where this lives (a column, a `task_export_events` table, or reuse the export-job/audit).
- **Statuses / views for him** — the owner wants an **"Assign" (to-export) page** and an **"Exported" page**.
  Decide whether "exported" is a new task sub-state, a derived view over the export-tracking record, or a
  filter — WITHOUT breaking the shared `case_tasks.status` contract or mobile (prefer a derived/side-record
  over a new hard status if it touches the mobile contract).
- **Notifications** — he's notified when a task is assigned to him (ADR-0027 `CASE_ASSIGNED`/`TASK_ASSIGNED`);
  consider notifying on re-assign / revoke / re-export-needed. Confirm the producers actually fire for
  KYC_VERIFIER assignees (the ADR-0027 completion fixed missing producers — verify KYC path).

## 4 — The specific questions to answer (from the owner)
1. How do we **create an office task for a KYC verifier** and assign it to him?
2. **KYC-verifier login screen + dashboard** — how does he see the tasks assigned to him?
3. Which page shows his **to-export tasks** — reuse an existing list scoped to him, or **create a new
   KYC-verifier view**?
4. How does he **export only his assigned tasks**, and how do we ensure an **already-exported task is not
   exported again**?
5. What **statuses / views** for him — **Assign (to-export)** vs **Exported** (an "assign page" + an
   "exported page")?
6. **Notifications** for assignment (and re-work) to the KYC verifier.
7. Reconcile all of it with the invariant: he **EXPORTS only, verifies externally, relays externally, and
   NEVER closes/completes in his login.**

## 5 — Multi-agent method (spawn specialists; you orchestrate + adversarially review)
Run as **CEO + CTO + specialist team** (`docs/governance/BUILD_METHOD.md`). Use the `brainstorming` skill
FIRST (ask the owner the few decisive scope forks — e.g. new view vs reuse; export-tracking shape; is
"exported" a status or a derived view), then `writing-plans`, then subagent-driven build. Spawn parallel
agents for independent audit work and monitor/aggregate:
- **Auditor(s)** — map the current KYC/office/assignment/export/notification code + the live DB state.
- **CTO** — architecture + governance: reuse (scope, `platform/export`, DataGrid, notifications, the MIS
  read-model pattern), decide the export-tracking + status model, guard the mobile/`case_tasks` contract,
  write any superseding/extending ADR.
- **Security** — RBAC (does KYC_VERIFIER need a new scoped export perm? default-deny), scope (he sees/export
  ONLY his tasks → out-of-scope = 0 rows, never IDOR), no accidental widening, PII in the export (DPDP).
- **Designer** — the KYC-verifier login/dashboard + the Assign/Exported views per the design + DataGrid +
  loading freezes; empty/loading/error/permission states; the "export, don't complete" affordances.
- **Domain** — the real KYC office loop (external verify + external relay); align with the mobile-form /
  outcome-catalog SoT and ADR-0032 (KYC verifier never completes).
- **QA / adversarial reviewer** — refute the plan + hunt gaps (double-export races, re-assign after export,
  scope leaks) before build; then TDD.

## 6 — Deliverables (produce, then STOP for owner + CTO sign-off BEFORE building)
1. A **deep AUDIT doc** (`docs/specs/2026-07-…-kyc-verifier-workflow-audit.md` or `docs/audit/`): the current
   state (create → assign → notify → he-sees → export → external verify → external relay → backend records
   result), every business rule pinned to code/DB evidence, and the gaps (export-dedup, statuses, views,
   notifications, RBAC).
2. A **DESIGN doc + ADR-0085** (if a decision): the KYC-verifier view(s) (Assign + Exported), the
   export-scoping + **dedup / export-tracking** model, the status model (derived vs new sub-state — mobile-safe),
   notifications, RBAC (new perm if needed, default-deny), and the DB shape + **migration 0110** if required.
3. **API + SDK** plan (`/api/v2` additive), **UI** plan (login/dashboard + the two views on the Universal
   DataGrid + export-as-job), and a **phased TDD build plan** (vertical slices; each ends `pnpm verify` GREEN).

**Gate:** present the audit + design + plan and get **explicit owner sign-off before writing feature code**
(frozen-repo governance). Then build slice-by-slice, `pnpm verify` green per slice, update
`CRM2_MASTER_MEMORY.md` §8 + the ADR + Claude memory each phase, and **ask before the first push/deploy**
(push→main auto-deploys to live prod; integration tests need the ephemeral Postgres on `:5433`, `LC_ALL=C`).

Start by stating the current phase (from `CRM2_MASTER_MEMORY.md` §8 + `git log --oneline -20`) and the
current KYC-verifier state (from a quick code + DB scan), then begin the pre-flight reads.
