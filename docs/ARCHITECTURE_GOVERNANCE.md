# Architecture Governance (CRM2)

> **Purpose: protect CRM2 from architecture drift.** The architecture is frozen and the
> build phase is active with multiple agents/developers working in parallel. The biggest risk is no
> longer design — it is **competing patterns, frameworks, libraries, and standards** creeping in.
> This document is the permanent governance that prevents that. It is **not** a redesign.
>
> SoT companions: **`FROZEN_DECISIONS_REGISTRY.md`** (what is locked) · **`FREEZE_LOCK_REPORT.md`**
> (how each is enforced) · **`docs/COMPLIANCE_GAPS_REGISTRY.md`** (what is partial/deferred/ratchet/
> fixed — institutional memory) · `docs/adr/` (why) · `ARCHITECTURE_CHANGE_REQUEST.md` (how to
> propose a change) · `LONG_TERM_PROTECTION.md` · `MASTER_MEMORY` §7.6.

## 1. The frozen decisions
Every locked decision is listed in **`FROZEN_DECISIONS_REGISTRY.md`** with its ADR, enforcement,
owner, and freeze date. Treat that registry as authoritative. If a decision is in the registry, it
is **LOCKED**.

## 2. No-new-architecture rule (permanent)
**No agent or developer may introduce any of the following without the change process in §4:**
new architecture pattern · new framework · new ORM · new data-access strategy · new state-management
solution · new table/grid framework · new design system · new component library · new authentication
strategy · new API pattern · new logging framework · new testing framework · new package
architecture · new folder architecture.

**Default behaviour: reuse the approved pattern. Do not reinvent.** When an approved pattern exists
(see the registry + the reference module `apps/api/src/modules/verificationUnits/`), use it.
Introducing a competing approach — even a "better" one — is drift and is forbidden without approval.

## 3. Protected baselines (summary — registry is authoritative)
- **Architecture:** `Case → Task → Verification Unit`. Reintroducing Verification-Type,
  Document-Type, a dual KYC engine, or a separate KYC Queue is forbidden without an ADR (ADR-0002).
- **Stack (backend):** Node 22 LTS · TypeScript · PostgreSQL 17 · Valkey 8 · Repository pattern.
  **(frontend):** React 19 · Tailwind v4 · shadcn/ui · TanStack Query · **TanStack Table**.
  **Testing:** Vitest · Playwright. **Build:** pnpm · Turbo. **Logging:** `@crm2/logger`. Any
  replacement requires an ADR + approval.
- **Data access:** Repository pattern; raw SQL only in repositories + migrations. Prisma and direct
  DB access in services/controllers are forbidden.
- **Design system:** 80% Twenty CRM / 10% Linear / 10% Salesforce; light-first, dark optional;
  shadcn + Tailwind + `@crm2/ui-theme` tokens. Forbidden: neobrutalism, glassmorphism, heavy
  gradients, decorative motion.
- **DataGrid:** the one `@crm2/ui/DataGrid` (app-internal, TanStack Table). No AG Grid, no alternative
  grid, no custom/duplicate table frameworks for operational tables.
- **Naming:** snake_case (DB) · camelCase (TS) · kebab-case (routes) · UPPER_SNAKE_CASE (env +
  domain codes).
- **Quality:** TypeScript strict, ESLint strict, Prettier, coverage gates, secret scanning,
  dependency boundaries, circular-dependency checks. **These cannot be weakened** (a lower coverage
  floor or a disabled gate requires CTO sign-off; see `TECH_DEBT_POLICY.md` ratchet rule).

## 4. Change process (all five are mandatory)
An architecture-level change is **forbidden** unless **all five** exist:
1. **ADR** (a new, superseding ADR in `docs/adr/` using `_template.md`).
2. **Impact Analysis** (what breaks, what migrates, blast radius).
3. **Alternative Comparison** (what else was considered and why rejected).
4. **Migration Plan** (+ rollback plan).
5. **CTO approval** (and the domain owner from `DOMAIN_OWNERSHIP.md`).

The proposal is written as an **Architecture Change Request** (`ARCHITECTURE_CHANGE_REQUEST.md`
template). Without all five, the change is rejected at review and CI/governance.

## 5. Exception process
A temporary deviation (e.g. a spike, a vendor constraint) requires: a written exception note in the
ACR, an explicit **expiry/condition**, CTO sign-off, and a tracked removal task. No silent or
permanent exceptions. An expired exception is a build blocker.

## 6. How a change lands (once approved)
New superseding ADR merged → registry updated (old row → `SUPERSEDED → ADR-NNNN`, new row added; rows
are never edited in place or deleted) → `FREEZE_LOCK_REPORT.md` + affected standards docs updated →
enforcement (lint/dep-cruiser/CI/tests) updated in the same change → MASTER_MEMORY §7.6 + memory
updated. Drift detection: code review + the dependency-cruiser/lint/coverage gates + this governance.

---
*Governance only. No architecture/data-model/UI change. Change this document's rules only via a
superseding ADR + CTO + owner (`LONG_TERM_PROTECTION.md`).*
