# CRM2 — Agent Org & Audit Panel (how we work)

**Status:** process SoT · extends `BUILD_METHOD.md` · the CTO orchestrator spawns this panel.

## Repo & version context (every agent + the CTO must hold this)

We build **CRM2 (v2)** — a **greenfield** rebuild in `crm2/`, with its **own git repo**
(`github.com/acsdeveloper2025/acs-crm-2`). It sits *inside* the v1 monorepo folder
`CRM-APP-MONOREPO-PROD/` but is a **separate repo** (v1 git-ignores it). **Three independent git repos
share that one directory:**

1. **v1 — legacy, in production.** Repo `acsdeveloper2025/CRM-APP-MONOREPO-PROD`; the live system =
   `CRM-BACKEND/` + `CRM-FRONTEND/`. ⚠️ `acs_db_final_version.sql` at the v1 root is the **v1** schema —
   **never audit v2 against it.** The v2 schema lives in `crm2/db/v2/migrations/` (+ live dev/test DBs).
2. **v2 — this build (greenfield).** Repo `acsdeveloper2025/acs-crm-2`; all work/review is under `crm2/`.
3. **mobile — the field-executive app.** `crm-mobile-native/`, repo `acsdeveloper2025/crm-mobile-native`,
   React-Native, **already developed and currently connected to v1** (`https://crm.allcheckservices.com/api/mobile`).
   It is a first-class `/api/v2` consumer to be **rebased onto v2 later** (`MOBILE_API_COMPATIBILITY_MATRIX.md`);
   the `/api/v2` contract must **never break the mobile app** (ADR-0012). Field executives use it daily.

Each agent ledger (`docs/agents/*.md`) carries this same context block at its head.

The lead session (Claude) is the **CTO / orchestrator** — decides, spawns, integrates, runs gates,
commits. It does not build features directly except trivial/verification-critical glue. Around it sit
two kinds of agents: **builders** (do work in parallel) and the **Audit Panel** (adversarially review
before every commit). Each Audit-Panel role has a **persistent ledger** so its judgement carries across
sessions — a new session re-spawns the same role, which reads its ledger first and continues.

---

## The Audit Panel (spawned before every commit on substantive work)

| # | Role | Owns (audits for) | Ledger |
|---|------|-------------------|--------|
| 1 | **CEO / Quality-Sentinel** | product fit · scope discipline (Karpathy) · ALL frozen-standard conformance · bugs/risks/edge-cases · the final BLOCK call | `docs/agents/ceo-quality-sentinel.md` |
| 2 | **Principal Engineer (Architecture & Code)** — *the CTO-level technical audit* | correctness · layering & boundaries (controller→service→repository, DB-only-in-repos, no-cross-feature) · pattern reuse vs reinvention · TS all-strict · structured errors · **no suppressions** · dependency rules · API/contract shape | `docs/agents/principal-engineer.md` |
| 3 | **Database & Data-Integrity Auditor** | migrations (forward-only · idempotent · applied to dev :54329 + test :5433) · schema/constraints/indexes · transactions · **OCC (ADR-0019)** · query correctness · **N+1** · append-only `audit_log` · the live-DB triple-write invariant | `docs/agents/database.md` |
| 4 | **Security Auditor** | RBAC **default-deny** + server-side scope (`userScope`/`dataScope`) · IDOR / ownership (`validateTaskRecordAccess`) · **injection** (raw SQL, `ORDER BY` interpolation) · authn/JWT · secrets (gitleaks) · PII/DPDP/consent | `docs/agents/security.md` |
| 5 | **Performance Auditor** | server pagination + `limit≤500` · indexes on sort/filter columns · query plans (`EXPLAIN`) · **N+1** · payload size · perf budgets (dashboard/case/workspace <2s · MIS <3s) · loading bands · background-job threshold (>8s) | `docs/agents/performance.md` |
| 6 | **Design & Quality-Consistency Auditor** | frozen design system/tokens (`COLOR_SYSTEM_FREEZE`, no hardcoded colors) · Responsive-First · **a11y** (axe gate 29, WCAG AA) · DataGrid / Management-List / Pagination standards · uppercase display · cross-screen UX consistency | `docs/agents/design-quality.md` |
| 7 | **API / Contract-Compatibility Auditor** | `/api/v2` **additive-only** versioning (ADR-0011) · **response-shape changes + EVERY consumer** (the array→envelope trap that BLOCKED the DataGrid slice — tsc + the harness both missed it) · the **web + mobile contract** (never break a field/status-code/idempotency-key/JWT shape mobile reads — ADR-0012, `MOBILE_API_COMPATIBILITY_MATRIX`) · SDK drift · OpenAPI | `docs/agents/api-contract.md` |
| 8 | **Caching & Scalability Auditor** | cache strategy/keys/TTL · **invalidation + cache-vs-DB consistency** · stampede / thundering-herd / hot-keys · Valkey usage · read-path scalability under load. **Pre-Valkey (now): audits cache-READINESS** — flags where caching will be needed, ensures new writes expose clean invalidation points, no premature/incoherent caching. Promote to full scope when Valkey/scope-cache lands. | `docs/agents/caching-scalability.md` |
| 9 | **Reliability & Observability Auditor (SRE)** | structured logging/metrics/traces · monitoring/alerting · **idempotency · retries · graceful degradation** (a health/diagnostics path must never 500) · background-job reliability · rate-limiting · DR/backup/restore. Much of this infra is PLANNED — audits readiness + the bits that exist. | `docs/agents/reliability-observability.md` |

The CEO holds final BLOCK authority; any specialist may recommend BLOCK and the CTO must resolve it.
**Lazy instantiation:** spawn a role only when its subsystem is present in the diff — e.g. Caching/Reliability
audit cache- and reliability-*readiness* now and graduate to full audits when Valkey / workers / observability land.

## Which auditors for which change (the CTO picks the relevant subset — not every role every time)

| Change kind | Panel |
|-------------|-------|
| Backend data / list / endpoint | CEO · Principal Eng · DB · Security · Performance · **API/Contract** · **Caching** |
| New/changed API response shape or contract | CEO · Principal Eng · **API/Contract** (+ the domains it touches) |
| Migration / schema | CEO · DB · Security · Performance |
| Frontend / UI / component | CEO · Principal Eng · Design-Quality (· Security if it touches data/permissions) |
| Workers / jobs / error-handling / infra | CEO · Principal Eng · **Reliability** (· DB/Performance as relevant) |
| Read-heavy / list / hot-path | + **Caching** (cache-readiness now; full cache audit once Valkey lands) |
| Cross-cutting (config, shared lib, platform) | CEO · Principal Eng (+ the domains it ripples into) |
| Docs / standards only | CEO (· Design-Quality if it changes a design/UX standard) |

**Always at least CEO + Principal Engineer on any code change.** Run the panel before every commit on
substantive work and at end of session. They are **non-coding** — they review and write to their ledger;
the CTO applies fixes.

## Ledger protocol (this is the cross-session memory)

Every Audit-Panel agent, on spawn, is instructed to:
1. **Read its ledger** (`docs/agents/<role>.md`) + the SoT docs it owns, to recover prior findings/decisions.
2. **Audit** the current `git diff` (+ named files) adversarially, evidence-based, cite `file:line`.
3. **Return** a tight verdict: `PASS | FLAG | BLOCK` + MUST-FIX / SHOULD-FIX / confirmations / notes.
4. **Append a dated entry** to its ledger: slice name + commit, verdict, each finding and its disposition
   (FIXED / DEFERRED / RATCHET / WONTFIX), and any OPEN items it is carrying forward.

The CTO passes the ledger path in the spawn prompt and ensures the agent appended before the commit lands.
Ledgers are **git-tracked** → they persist across sessions and machines. Cross-cutting findings still land
in `docs/COMPLIANCE_GAPS_REGISTRY.md` (the institutional ledger); the per-role ledgers are the *specialist's*
running memory and rationale.

## Reusable spawn charter (template the CTO fills per role)

> You are the **<ROLE>** for CRM2 (v2), a NON-coding adversarial auditor. Repo:
> `/Users/mayurkulkarni/Downloads/CRM-APP-MONOREPO-PROD/crm2`.
> 1. READ your ledger `docs/agents/<role>.md` (prior findings/decisions) + your SoT docs: <list>.
> 2. AUDIT this slice: <one-line scope>. Run `git -C <repo> diff` + read <files>. Focus on YOUR domain
>    (see AGENT_ORG.md row). Be adversarial; cite file:line; try to break it.
> 3. RETURN: VERDICT (PASS/FLAG/BLOCK) · MUST-FIX (file:line or none) · SHOULD-FIX · confirmations · notes.
> 4. APPEND a dated entry to `docs/agents/<role>.md`: slice + commit, verdict, findings + disposition,
>    OPEN items carried forward. Do NOT edit any other file.

## Builders (spawned for parallel work, not audit)

Platform · Database · Backend · Frontend · Security-hardening · QA · plus ad-hoc research / codebase-exploration.
Brief each with the frozen facts + deliverable + absolute path; never let two builders edit the same shared
file. Mechanical mirrors (e.g. one module per agent) parallelize well; cross-cutting edits stay inline with the CTO.

---
*Process doc. The frozen ARCHITECTURE/design/stack are governed by `MASTER_MEMORY` + ADRs + the freeze docs;
this file governs HOW the team operates, not WHAT is built.*
