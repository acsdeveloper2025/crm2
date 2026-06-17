# CRM2 — Build Method (Multi-Agent, Claude = CTO)

**How this project is built.** Architecture, data model, design system, and tech stack are **FROZEN** — work is build-only. Pairs with `AGENT_RULES.md`, `CTO_RULES.md`, `BUILD_GUIDE.md`, `docs/CI_CD_STANDARDS.md`.

## Operating model
A multi-agent engineering team. The lead (Claude) acts as **CTO / orchestrator — not a feature-builder**.

- **CTO (lead, main thread):** reviews designs/code/DB/APIs/tests/security/RBAC/perf/naming/standards; orchestrates the work; runs the gates; commits; and **stops anything that violates a frozen decision**. The CTO builds only trivial or verification-critical glue directly.
- **Specialist agents (spawned on demand):** Platform · Database · Backend · Frontend · Security · QA, plus ad-hoc documentation / research / codebase-exploration agents. Each agent is given the frozen facts it needs, a precise deliverable + exact output path, and returns a short confirmation.
- **Audit Panel (standing oversight, independent of the builders) — full charter in `docs/AGENT_ORG.md`:** a panel of non-coding watchdogs the CTO spawns before every commit on substantive work (and at end of session) to AUDIT the `git diff` **adversarially**. Members (9): **CEO / Quality-Sentinel** (product · scope · ALL frozen standards · bugs/risks · final BLOCK), **Principal Engineer** (architecture/boundaries/correctness — the CTO-level technical audit), **Database & Data-Integrity**, **Security**, **Performance**, **Design & Quality-Consistency**, **API / Contract-Compatibility** (additive-only · response-shape changes + all consumers · never-break-mobile · SDK drift), **Caching & Scalability** (cache strategy/invalidation/consistency — readiness mode pre-Valkey), **Reliability & Observability / SRE** (logging/metrics · idempotency · graceful degradation · jobs · DR — readiness mode pre-workers). The CTO spawns the relevant subset per change (matrix in AGENT_ORG.md) — **always at least CEO + Principal Engineer on code; + API/Contract on any endpoint/contract change; spawn Caching/Reliability when their subsystem is in the diff (lazy instantiation)**. Each role keeps a **persistent ledger** at `docs/agents/<role>.md` it reads first and appends to (the panel's cross-session memory; a later session re-spawns the role and continues). Each returns PASS/FLAG/BLOCK + file:line evidence; the CTO resolves FLAGs (or logs FIXED/DEFERRED/RATCHET/WONTFIX in `docs/COMPLIANCE_GAPS_REGISTRY.md`) before committing; any BLOCK stops the commit. The panel never writes code.

## How a unit of work runs
1. **Scope** from `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` (everything frozen there stays frozen).
2. **Fan out** independent pieces to specialist agents **in parallel** — e.g. document sets, per-file generation, codebase exploration, per-module slices that don't share state.
3. **Keep inline (do not delegate)** anything verification-critical or interdependent: shared config (`tsconfig`/`eslint`/`turbo`), cross-cutting code edits, or any change that ripples (enable a strict flag, then fix the fallout). Never let two agents edit the same shared file in parallel.
4. **Brief every agent** with: the frozen facts (so it can't invent), the deliverable + absolute path, "mark unbuilt infra PLANNED, no invented numbers", and "verify against real files".
5. **CTO verifies** each agent's output (files exist, accurate, cross-linked), wires the master/index/memory docs itself, then runs the gate `pnpm verify` (typecheck → lint → format → no-suppressions → boundaries → test → build) **plus** the CTO gate in `CTO_RULES.md`.
6. **Audit-Panel review** on substantive work (`docs/AGENT_ORG.md`): the CTO spawns the relevant auditors over the diff (CEO + Principal Engineer always on code; + DB/Security/Performance for backend/data/schema; + Design-Quality for UI). Each reads its ledger, returns PASS/FLAG/BLOCK + file:line, and appends a dated entry to `docs/agents/<role>.md`. The CTO resolves FLAGs (or logs them FIXED/DEFERRED/RATCHET/WONTFIX in `COMPLIANCE_GAPS_REGISTRY`) before committing; any BLOCK stops the commit.
7. **Commit at the green gate** — local, author Mayur Kulkarni, conventional commit, no AI trailer. **Never push or deploy without explicit human approval.**

## Per-module build loop
Build order: **Verification Units (done) → Clients → Products → CPV → Cases → Tasks → Assignment → Verification Workspace → Reports → MIS → Billing**, then Dashboard, Field Monitoring, Admin, workers.

Each module is **test-first** and ships its tests in the same change (recipe: `BUILD_GUIDE.md`):
`migration → contracts (zod/SDK) → repository → service → controller → routes → RBAC → SDK methods → web feature (tokens) → tests`. Coverage: repositories/services ≥ 90%, overall ≥ 80%. Then the CTO gate → next phase. Mobile is a first-class `/api/v2` consumer — consult `MOBILE_API_COMPATIBILITY_MATRIX.md` before Cases/Tasks/Workspace.

## Don't
- Don't reopen frozen architecture / design / data-model / stack — escalate to the human.
- Don't parallelize edits to the same shared config or source file.
- Don't claim a phase complete without `pnpm verify` green + tests + the CTO gate.
- Don't push or deploy without explicit approval.

## Why it works
Independent fan-out gives speed and breadth; the CTO gate gives correctness and consistency; `pnpm verify` makes "done" mean something. Tooling enforces discipline (`docs/CI_CD_STANDARDS.md`), so scale doesn't erode quality.
