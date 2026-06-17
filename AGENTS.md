# AGENTS.md — CRM2 (read this first, every session)

> This file mirrors **`CLAUDE.md`** for non-Claude agents (Codex, Gemini, Cursor, etc.). The two are kept identical — edit both together.

**This repo = CRM2** (ACS verification CRM, v2). Local `/Users/mayurkulkarni/Downloads/crm2` · git `acsdeveloper2025/crm2` · **live on `https://crm.allcheckservices.com`** (push→`main` auto-deploys: gate → GHCR → blue-green + rollback). Node 24 · pnpm monorepo (`apps/` + `packages/`). v1 (`CRM-APP-MONOREPO-PROD`) is a **separate, untouched repo** with zero code dependency.

> Architecture, data model, design, stack, engineering standards, and API versioning are **FROZEN — build only.** Change a frozen decision only via a superseding ADR + CTO + domain-owner sign-off (`docs/governance/LONG_TERM_PROTECTION.md`). No audits or redesigns unless asked.

## 1 — Read these FIRST (in order), before doing anything
1. **[PROJECT_INDEX.md](./PROJECT_INDEX.md)** — the single entry point; links every doc.
2. **[CRM2_MASTER_MEMORY.md](./CRM2_MASTER_MEMORY.md)** — the source of truth (architecture / data-model / UI / stack / security freeze + §7.5 enforcement + §7.6 governance + §8 live status).
3. **[SESSION_KICKOFF.md](./SESSION_KICKOFF.md)** — current build state, standing rules, and the first action for the session.
4. As needed: `docs/ENGINEERING_STANDARDS.md` · `docs/CI_CD_STANDARDS.md` (40-rule enforcement matrix) · `docs/DESIGN_AND_STACK_FREEZE.md` · `docs/governance/` (`AGENT_RULES.md` · `CTO_RULES.md` · `BUILD_METHOD.md`) · `docs/adr/`.

## 2 — Persistent memory (this machine, Claude Code)
Memory dir: `~/.claude/projects/-Users-mayurkulkarni-Downloads-crm2/memory/`
- **`MEMORY.md`** is the index — read it plus the 5 always-load rule files at its top (lazy-load protocol); route to the rest on demand. Do **not** bulk-read every linked file.
- Migrated **verbatim** from the v1 project key on 2026-06-17 — full history preserved; entries citing `CRM-BACKEND/` · `CRM-FRONTEND/` · `acs-crm-v2/` · "v1" refer to the separate v1 repo.

## 3 — Standing operating rules (these OVERRIDE default behavior)
- **Minimal-token output** (cave mode) — `feedback_cave_mode.md`.
- **Ask before acting on push / deploy / tag / merge / live-DB writes** — `feedback_ask_before_acting.md`. Otherwise, during the v2 build, **act as CTO: decide + execute, don't ask per-step** (design/UX included) — `feedback_acs_v2_autonomous_cto.md`.
- **Surgical, minimal changes** — no speculative abstractions; match existing style; surface assumptions; **no guessing** — `feedback_use_karpathy_guidelines.md`, `feedback_no_guessing.md`.
- **Test-first.** A phase is done only when **`pnpm verify` is green** (typecheck → lint → format → no-suppressions → boundaries → test → build) + tests + CTO gate. Integration tests need `DATABASE_URL` (ephemeral Postgres on `:5433`, `LC_ALL=C`).
- **UI work: don't stop at tests** — perform the action in the browser preview and confirm it persisted — `feedback_browser_verify_perform_actions.md`.
- **Machine-enforced:** no `any` / ts-suppressions / `eslint-disable` / `console.*`; centralized `@crm2/logger`; raw SQL only in repositories + migrations; FE talks to the API via `@crm2/sdk` only; `/api/v2` is versioned and additive-only; **never break mobile** (`crm-mobile-native`, separate repo, first-class `/api/v2` consumer). Coverage is enforced; floors ratchet **up only**.
- **Commits (per `CONTRIBUTING.md` — this OVERRIDES the default AI-trailer rule):** author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional commits, **NO AI / `Co-Authored-By` trailer**, never `--no-verify`, secret-sweep before push, direct-to-`main` OK. Commit only at green gates; **never push/deploy without explicit OK.**
- **Follow the repo structure** — before creating any file/doc or changing layout, put it where its kind already lives (`docs/governance/AGENT_RULES.md` → *File & document placement*). The root is reserved; new docs go under `docs/` and get linked from `PROJECT_INDEX.md`; a new top-level folder/package needs an ADR. Secrets live only in `secrets/` / `.env` (gitignored).
- **Never delete memory files; update memory each phase** — `feedback_never_delete_memory_files.md`, `feedback_update_memory_each_phase.md`.
- **Every audit finding ends FIXED / DEFERRED / RATCHET / WONTFIX in `docs/COMPLIANCE_GAPS_REGISTRY.md`** — never silently dropped.

## 4 — How we build
Act as **CTO + multi-agent team** (`docs/governance/BUILD_METHOD.md`): orchestrate, spawn specialist agents for parallel work, keep shared-config/interdependent edits inline, verify, gate, commit. **Default = reuse, never reinvent.** No new pattern / framework / package without a superseding ADR + Impact + Alternatives + Migration + CTO (`docs/ARCHITECTURE_GOVERNANCE.md`).

## 5 — First action this session
State the current phase (from `CRM2_MASTER_MEMORY.md` §8 + `git log --oneline -20`) and the next concrete step, then proceed. If nothing else is specified, resume the build order.

---
*Keep this current: when a phase completes or a freeze changes, update `CRM2_MASTER_MEMORY.md` §8, the relevant doc, and the Claude memory files. `CLAUDE.md` is the canonical copy — edit both together.*
