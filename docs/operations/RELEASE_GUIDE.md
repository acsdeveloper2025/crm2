# Part 1 — Release Guide

CRM2 · monorepo (pnpm + turbo) · architecture FROZEN. How code goes from a branch to production safely.

Cross-ref: [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) · [`DATABASE_CHANGE_PROCESS.md`](../engineering/DATABASE_CHANGE_PROCESS.md) · [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) · [`SECURITY_STANDARDS.md`](../security/SECURITY_STANDARDS.md) · [`PERFORMANCE_STANDARDS.md`](./PERFORMANCE_STANDARDS.md).

## Release flow

1. **Branch** off `main` (`feat/…`, `fix/…`, `chore/…`). No direct commits to `main`.
2. **Commit** conventional commits; author always `Mayur Kulkarni <mayurkulkarni786@gmail.com>`; **no AI trailer**.
3. **Local gate** — `pnpm verify` must pass before pushing.
4. **PR** → CI runs the full gate set; **all green required** (no admin merge over red).
5. **Review** — at least 1 human approval; release-affecting changes (migration, billing, assignment, reporting, security) need the domain owner's approval (see `DOMAIN_OWNERSHIP.md`).
6. **Merge** to `main` (squash; PR title = conventional commit).
7. **Deploy** — only via GitHub Actions, and **only after explicit human OK**. Never push/deploy autonomously.

## CI gates (must be green to merge)

`.github/workflows/ci.yml`, in order: **typecheck → eslint → prettier → unit → integration → build → openapi → sdk → e2e**, plus **secret-scan**, **boundaries** (package import rules), **no-suppressions** (no `eslint-disable`/`@ts-ignore`), **migration-idempotency** (migrations applied twice on `postgres:17`).

Coverage gates: repositories/services **≥90%**, overall **≥80%**. OpenAPI + SDK must show **no drift** (regenerate and commit).

## Versioning & release notes

- **Semver tags** `vMAJOR.MINOR.PATCH` cut from `main` after merge. MAJOR = breaking API/schema; MINOR = backward-compatible feature; PATCH = fix.
- API surface changes follow `API_VERSIONING_POLICY.md`.
- **Release notes** per tag: summary, user-facing changes, migrations included, feature-flag state, rollback note. ADRs updated for architectural decisions.
- **Approver:** the human owner (Mayur) approves the tag + deploy. Domain owner co-approves money/assignment/review/reporting changes.

## Migration safety (expand → migrate → contract)

Schema changes are **forward-only and idempotent** (`DATABASE_CHANGE_PROCESS.md`). High-risk changes ship across releases:

1. **Expand** — add new columns/tables/indexes, dual-write; old readers unaffected.
2. **Migrate** — backfill (staged, non-blocking), switch readers to new shape behind a flag.
3. **Contract** — drop old columns/code in a **later** release once nothing reads them.

The **gated migrate step** runs in the deploy pipeline **before** `api` starts — `api` depends on `migrate` completing successfully, so there is no schema/code mismatch window (atomic). A failed migrate aborts the deploy; the prior image keeps serving.

## Feature-flag rollout (high-risk)

Workspace, billing, reporting, and assignment changes ship **behind a feature flag, default OFF**. Sequence:

1. Deploy code flag-OFF → behavior unchanged in prod.
2. Verify health + synthetic flows pass.
3. Enable for a **canary** (internal/single role or client) → observe.
4. **Staged rollout** to remaining cohorts; watch error rate, latency budgets, audit completeness.
5. Full enable. Keep the flag one release for instant kill-switch, then contract.

Kill-switch: flip the flag OFF (live, no redeploy) if metrics regress.

## Post-deploy verification

- **Health** — `/api/health` 200; migrate step reported success; matviews refreshed.
- **Synthetic flows** — case open, assignment, workspace submit, finalize/review, billing, report generation; each within budget (dashboard/pipeline/case-open/workspace **<2s**).
- **Audit check** — money/assignment/review actions produced append-only audit records (`SECURITY_STANDARDS.md`).
- **Observability** — error rate, p95 latency, queue depth nominal (`OBSERVABILITY_STANDARDS.md`).

## Rollback

1. **Code-only change:** redeploy the **prior released image/tag** via GitHub Actions. Fast, no data steps.
2. **Schema changed:** because migrations are forward-only, do **not** auto-down. Redeploy prior image (expand/contract keeps it compatible) and, if a contract step already dropped data, follow **DB restore** in [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) (restore-tested backup → point-in-time). Author a compensating **forward** migration for the real fix.
3. **Feature-flagged change:** flip the flag OFF first — usually no redeploy needed.

Confirm rollback with the same post-deploy verification above.
