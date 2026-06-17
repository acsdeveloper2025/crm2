# CTO_RULES.md

CRM2 (v2) greenfield monorepo. Architecture, data model, design, and stack are **FROZEN**
(see `ACS_CRM_2.0_MASTER_MEMORY.md`, `docs/DESIGN_AND_STACK_FREEZE.md`,
`docs/COLOR_SYSTEM_FREEZE.md`, `docs/UPPERCASE_DISPLAY_STANDARD.md`).
This file defines the CTO review role and the approval gate every module must pass before the
next build-order phase starts.

## 1. CTO Role

- Reviews: designs, code, DB, APIs, tests, security, RBAC, performance, architecture compliance,
  naming, engineering standards.
- Does **NOT** build features.
- Has authority to **STOP** any change that violates a frozen decision.
- **Cannot override** the frozen architecture / data model / design / stack — those are immutable.
  Any change there requires the **human owner**, not the CTO.

## 2. The CTO Approval Gate

A module is **NOT complete** until ALL boxes pass:

- [ ] **Architecture compliance** — `Case → Task → Verification Unit` model; modular monolith;
      repository pattern; raw pg (no Prisma); no layer-skips (`controller → service → repository`).
- [ ] **Data access** — raw SQL only in repositories/migrations; views/matviews via view
      repositories; no SQL in controllers/services/UI (dependency-cruiser green).
- [ ] **Security / RBAC** — 6-role permission-code gating; default-deny scope (deny if scope
      indeterminable); record-level access on detail routes; audit records exist for
      assignment / review / approval / billing / commission / master-data (verified by tests).
- [ ] **Data integrity** — immutable + append-only financial / verification / review / assignment
      history; soft delete; transactions for case / task / assignment / billing / commission.
- [ ] **Tests** — unit + integration present; coverage repos/services ≥ 90%, overall ≥ 80%;
      `pnpm verify` green.
- [ ] **Naming standards** — snake (DB) / camel (TS) / kebab (routes) / UPPER_SNAKE (const);
      `idx_` `uq_` `fk_` `v_` `mv_` `trg_` `fn_`.
- [ ] **Design system** — tokens only (no hardcoded colors); loading / empty / error / permission
      states on every page; a11y (keyboard, focus, ARIA, contrast); uppercase display is
      visual-only (`docs/UPPERCASE_DISPLAY_STANDARD.md`).
- [ ] **Performance** — dashboard / pipeline / case-open / workspace < 2s; N+1 query tests on
      hot lists.
- [ ] **Tooling gates green** — typecheck, eslint, prettier, no-suppressions, boundaries
      (circular + controller→repo + cross-feature), secret-scan, coverage, migration idempotency
      (per `docs/CI_CD_STANDARDS.md` enforcement matrix).
- [ ] **Contract** — OpenAPI + SDK regenerated if API changed (no drift).
- [ ] **Observability** — requestId / duration / status / userId on APIs;
      start / finish / retry / failure on jobs.
- [ ] **Dependencies** — any new package present in `ALLOWED_DEPENDENCIES.md` with justification.

## 3. Phase Progression

Only after the gate passes for a module may the **next build-order phase begin**
(order per `ACS_CRM_2.0_MASTER_MEMORY.md`). No exceptions.

## 4. Escalation

Violations of frozen decisions are **hard-blocks**. The CTO documents the violation and **stops the
work** — the change does not proceed until the human owner resolves it.

---
**References:** `docs/CI_CD_STANDARDS.md` (enforcement matrix) ·
`AGENT_RULES.md` · `docs/ENGINEERING_STANDARDS.md`
---

## Long-Term Governance & Operations (2026-06-04 freeze)

Full map: `ACS_CRM_2.0_MASTER_MEMORY.md` §7.6. **Decisions** → `docs/adr/` (ADR-0001..0019; change a frozen decision only via a superseding ADR + CTO + domain-owner sign-off — `LONG_TERM_PROTECTION.md`). **Business rules** → `BUSINESS_RULES.md` (no rule lives only in code). **API/contract** → `API_VERSIONING_POLICY.md`, `DOCUMENTATION_AS_CODE.md`. **DB change** → `DATABASE_CHANGE_PROCESS.md`. **Security** → `SECURITY_STANDARDS.md`, `SECURITY_GUIDE.md`. **Resilience** → `DISASTER_RECOVERY.md` (quarterly restore drill), `DATA_RETENTION_POLICY.md`. **Ownership** → `DOMAIN_OWNERSHIP.md`. **Quality/ops** → `TEST_DATASET_STRATEGY.md`, `PERFORMANCE_STANDARDS.md`, `OBSERVABILITY_STANDARDS.md`, `MONITORING_STRATEGY.md`, `OPERATIONS_GUIDE.md` + `runbooks/`, `RELEASE_GUIDE.md` + `RELEASE_CHECKLIST.md`, `UPGRADE_POLICY.md`, `TECH_DEBT_POLICY.md`.

---

## Architecture governance gate (FROZEN 2026-06-05)
SoT: `docs/ARCHITECTURE_GOVERNANCE.md`, `docs/FROZEN_DECISIONS_REGISTRY.md`, `FREEZE_LOCK_REPORT.md`,
`ARCHITECTURE_CHANGE_REQUEST.md`.
- The build risk is **drift**. Reject any change that introduces a competing pattern/framework/
  library/standard against a LOCKED registry decision unless it arrives with **all five**: (1) a
  superseding ADR, (2) Impact Analysis, (3) Alternative Comparison, (4) Migration + Rollback Plan,
  (5) CTO approval (+ domain owner). Missing any one → reject.
- Registry rows are append-only: supersede (old row → `SUPERSEDED → ADR-NNNN`, new row added) — never
  edit-in-place or delete. Enforcement (lint/dep-cruiser/CI/tests) updates in the SAME change so the
  new decision can't drift either. Temporary exceptions need a written expiry + tracked removal.

---

## Responsive-First web design (FROZEN 2026-06-05) — SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`
Reject any screen that is not responsive-first. Every web page must work at **320 / 768 / 1024 / 1440**
with no horizontal overflow and no desktop-only workflow: grids `grid-cols-1 md:…` (never bare
`grid-cols-N`), nav → hamburger/Sheet `<lg`, dialogs `w-full`+scroll/Sheet, filters `flex-wrap`, tables
desktop-grid → tablet-condensed → mobile card/list (interim tables `overflow-x-auto`). Playwright
viewport tests (320/768/1024/1440) are part of definition-of-done (CI gates 49–50). Pre-freeze screens
are a retrofit cohort (COMPLIANCE_GAPS). Scope = WEB UI only (not offline/mobile-app/mobile-workflow).

## Concurrency & editing governance (FROZEN 2026-06-05) — SoT `docs/CONCURRENCY_AND_EDITING_STANDARD.md`
Reject any edit path that is last-write-wins or rolls its own concurrency. ONE behaviour: Optimistic
Concurrency Control — `version`-guarded UPDATE → **409 STALE_UPDATE** on a stale write, updates require
the expected version (else 400), reads return version, every change appends an immutable audit/history
row, bulk = per-row OCC partial-success, FE shows a Conflict dialog (no silent overwrite). No pessimistic
locks across user think-time. CI gates 51–53; ADR-0019. Pre-freeze modules retrofit (COMPLIANCE C-10).

## Import / Export governance (FROZEN 2026-06-05) — SoT `docs/IMPORT_EXPORT_STANDARD.md`
Reject any PR that adds a per-module export or a bespoke import flow. There is ONE export path
(DataGrid) and ONE import engine (`@crm2/import-engine`, app-internal — a real package needs an ADR).
This prevents 20 divergent export/import implementations. Build is DEFERRED (COMPLIANCE_GAPS_REGISTRY
B-13/B-14); the standard is LOCKED now so the first implementation is the reusable one.
