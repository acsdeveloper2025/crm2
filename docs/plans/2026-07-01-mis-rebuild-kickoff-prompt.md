# MIS Rebuild — new-session kickoff prompt (paste verbatim)

> Working artifact created 2026-07-01. Paste the block below into a fresh CRM2 session, or start the
> session with: *"Read `docs/plans/2026-07-01-mis-rebuild-kickoff-prompt.md` and execute it."*

---

You are the **CTO + multi-agent team** for CRM2 (ACS verification CRM, live on `crm.allcheckservices.com`).
Your mission this session: **design and build the NEW MIS (Management Information System) page from a clean
slate** — the DB schema, every field, the API, the UI, and the RBAC/security model — via **proper,
research-backed, multi-agent planning**. The old MIS was fully removed on 2026-07-01 (ADR-0083, mig 0108)
precisely because it had grown over-complicated (five layout "kinds", a bespoke `source_type→SQL` grammar,
an injection-boundary resolver, MIS / Billing MIS / office Data-Entry all tangled together). **Do not rebuild
that. Design something simpler, purpose-built, and secure.**

This is a **frozen-architecture, build-only** repo. Introducing MIS is a *new* feature (additive), but any
change to a frozen decision needs a **superseding ADR + CTO + owner sign-off**. Follow the governance.

## 0 — Operating rules (non-negotiable)
- Follow `CLAUDE.md` exactly (it OVERRIDES defaults): cave-mode minimal output; **surgical, no reinvention,
  no guessing**; test-first; `pnpm verify` green is the definition of done.
- **Ask before push / deploy / tag / merge / live-DB writes.** Commits: author `Mayur Kulkarni
  <mayurkulkarni786@gmail.com>`, conventional, **NO AI / Co-Authored-By trailer**, never `--no-verify`.
- Machine-enforced: no `any` / ts-suppressions / `eslint-disable` / `console.*`; `@crm2/logger` only; raw SQL
  **only** in repositories + migrations; FE talks to the API via `@crm2/sdk` only; `/api/v2` is versioned and
  **additive-only**; **never break mobile** (`crm-mobile-native`, separate repo, first-class `/api/v2`
  consumer — MIS is web-only, so this mostly means "don't touch shared contracts").
- **Next ADR = 0084. Next migration = 0109.**

## 1 — Mandatory pre-flight reads (in order, before designing anything)
**Repo source-of-truth:**
1. `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` (esp. §8 live status, §1–§7 freezes) →
   `SESSION_KICKOFF.md`.
2. Claude file-memory: read `~/.claude/projects/-Users-mayurkulkarni-Downloads-crm2/memory/MEMORY.md` +
   the 5 always-load rule files. Then read these topic files specifically:
   - `project_mis_report_layout_removal_2026_07_01.md` — **what was removed and why** (start here).
   - `project_mis_page_2026_06_19.md` — the old `/mis` page design (learn the intent, not the complexity).
   - `project_mis_dashboard_truthful_2026_05_27.md` + `project_data_entry_mis_truthful_2026_05_27.md` — v1 MIS.
   - `project_zion_source_materials.md` — Zion competitor MIS (see §3).
   - `project_commission_periodic_export_2026_07_01.md`, `project_billing_scope_export_only_2026_06_25.md`,
     `project_commission_rebuild_2026_06_18.md` — money columns + how commission/billing already work.
   - `project_field_report_snapshot_2026_06_30.md`, `project_field_report_fallback_2026_06_30.md` — the
     surviving report engines MIS will read alongside.

**ADRs (`docs/adr/`):**
   - **ADR-0083** (the removal — read fully) + the now-SUPERSEDED **ADR-0037** (old MIS layout engine) and
     **ADR-0049** (old MIS generation engine) — mine them for the field catalog + pitfalls, then improve on them.
   - ADR-0010 (reporting strategy: `v_`/`mv_` views, worker-refreshed), ADR-0015 (case-workspace &
     per-client+product reporting design), ADR-0022 (RBAC / `role_permissions` runtime model + scope),
     ADR-0036/0046 (commission dimensions), ADR-0081 (commission-summary periodic export — the closest live
     analog: a Billing read-model with grouping + period buckets + XLSX/CSV export), ADR-0041 (case report),
     ADR-0039/0079/0080 (field report + defaults + snapshot), ADR-0076/0082 (security).

**Standards / freezes (`docs/`):** `CASE_WORKSPACE_AND_REPORTING_FREEZE.md`, `DATAGRID_STANDARD.md`,
   `PAGINATION_AND_LOADING_STANDARDS.md`, `DESIGN_AND_STACK_FREEZE.md`, `ENGINEERING_STANDARDS.md`,
   `CI_CD_STANDARDS.md`, `COMPLIANCE_GAPS_REGISTRY.md` (B-16/B-18/B-19 = the reporting-engine backlog),
   `governance/` (`AGENT_RULES.md`, `CTO_RULES.md`, `BUILD_METHOD.md`).

## 2 — v1 + Zion ground-truth (READ — the field schema comes from here, not invention)
- **v1 repo (separate, untouched):** `/Users/mayurkulkarni/Downloads/CRM-APP-MONOREPO-PROD` — read its MIS /
  report-export / billing-MIS code for the real column set + logic.
- `docs/specs/2026-06-16-v1-report-mapping.md`, `docs/specs/v1-ground-truth/field-keys-by-type.tsv`,
  `docs/specs/2026-06-11-v1-zion-case-task-creation-audit.md`, `docs/specs/2026-06-16-field-report-v1-audit.md`.
- **Zion competitor MIS** (adopt the UX, never the platform): the fully-transcribed audit at
  `docs/acs-simplification-audit-2026-06-04/ZION_CRM_REVERSE_ENGINEERING_AUDIT_2026-06-04.md` (+ the two
  companion audits in that folder). Key Zion surfaces: **MIS Reports (`ExportTrigger.aspx`)**, **Billing MIS
  (`ExportReport.aspx`)**, and the **bank-mandated ~95-column MIS schema** (AXIS `.xls`: 2 TAT pairs
  CPV+sampling, 3-tier status, CASE TYPE FRESH/CREDIT-REFER/RE-VERIFICATION/RENEWAL, LOS APPLICATION ID,
  CPC/CITY/REGION/ZONE, ~45 doc-count columns incl REVISIT+TOTAL). Raw files (only if the audit is
  insufficient): `/Users/mayurkulkarni/Desktop/acs/Zion/SOFT/`.

## 3 — Web research (use WebSearch/WebFetch; cite sources in the design doc)
Study how mature CRMs implement MIS/reporting so we borrow proven patterns, not reinvent:
- **Salesforce** — Report Builder, **Custom Report Types**, standard vs matrix vs summary vs **Joined
  Reports**, field pickers, filters/cross-filters, groupings + summary formulas, **dashboards**, row-level
  security / sharing rules, scheduled + exported reports.
- **Zoho CRM Analytics**, **HubSpot custom report builder**, **Microsoft Dynamics 365 / Power BI** embedded
  reporting — column/field selection, saved reports, role-scoped data, export/scheduling.
- **Verification / RCU / field-investigation-agency MIS** specifically (bank TAT reports, doc-count/outcome
  rollups) — this is our actual domain; find how it's modeled.
Distill: what's the *minimum* good report model (predefined report types + configurable columns/filters +
grouping + export + saved views + role-scoped rows) that covers ACS's needs without the old grammar-engine.

## 4 — Multi-agent method (spawn specialists; you orchestrate + adversarially review)
Run this as a **CEO + CTO + specialist team** (per `docs/governance/BUILD_METHOD.md`). Use the
`brainstorming` skill FIRST, then `writing-plans`, then subagent-driven build. Spawn parallel agents for
independent work and monitor/aggregate their findings. Roles to cover (as agents or hats):
- **CEO** — business intent, scope, priorities, what "MIS" must answer for ACS operations/clients/finance;
  which reports matter most; MVP vs later.
- **CTO** — architecture + governance: reuse existing patterns (billing read-model, DataGrid, export engine,
  `platform/scope`, jobs), decide DB shape (view/mv vs table), write the **superseding ADR-0084**, guard
  against reinventing the removed engine; no new package/framework without ADR + Impact + Alternatives.
- **DB architect** — schema + **migration 0109** (fields, indexes, `mv_`/`v_` vs table; refresh strategy per
  ADR-0010); every field typed and named per the naming standard (snake_case SQL).
- **Designer** — UX/UI per the design + DataGrid + loading freezes; mobile-responsive (mobile-up); the
  filter→generate→paginated-table→export flow; saved views; empty/loading/error/permission states.
- **Security** — RBAC (new perm, scope-guarded queries → out-of-scope = 0 rows, never IDOR/403), **server-side
  money-gating** (rate/commission columns only for billing.view holders, at BOTH rows + export), and **SQL
  safety** (NO string-interpolated columns — the old resolver was the injection boundary; prefer a fixed,
  code-owned column allow-list, bound params only), PII exposure review.
- **Domain/Billing** — reuse the existing commission/rate laterals (do NOT fork), match `/billing` numbers.
- **QA / adversarial reviewer** — refute the design + hunt gaps before build; then TDD the implementation.

## 5 — Deliverables (produce, then STOP for owner + CTO sign-off BEFORE building)
1. A **design doc** (`docs/specs/2026-07-…-mis-rebuild-design.md`) + **ADR-0084** (superseding ADR-0037/0049):
   scope, the report model chosen (with web-research citations + v1/Zion field schema), rejected alternatives
   (incl. "revive the old engine"), the DB shape, the API contract (`/api/v2/mis`, additive), the RBAC/security
   model, and the UI spec.
2. **DB**: migration `0109` + the field list (mapped to v1/Zion columns + our data model).
3. **API + SDK**: `/api/v2` routes (rows + export), `@crm2/sdk` types + client methods, OpenAPI regen.
4. **UI**: the MIS page using the universal DataGrid + export-as-job + saved views.
5. A **phased TDD build plan** (vertical slices; each slice ends `pnpm verify` GREEN).

**Gate:** present the design + plan and get explicit owner sign-off before writing feature code (frozen-repo
governance). Then build slice-by-slice, `pnpm verify` green per slice, update `CRM2_MASTER_MEMORY.md` §8 +
the ADR + Claude memory each phase, and **ask before the first push/deploy** (push→main auto-deploys to live
prod; integration tests need the ephemeral Postgres on `:5433`, `LC_ALL=C`).

Start by stating the current phase (from `CRM2_MASTER_MEMORY.md` §8 + `git log --oneline -20`), then begin the
pre-flight reads.
