# Part 11 — Upgrade Policy

Status: architecture FROZEN. This policy governs how the frozen stack is upgraded
so it stays current **without unmanaged drift**. Every dependency change is
deliberate, reviewed, and reversible.

## Frozen Stack & Version Ledger

| Component | Frozen version | Upgrade trigger | Owner |
|---|---|---|---|
| Node | 22 LTS | LTS EOL approaching / security CVE | Platform |
| TypeScript | 5.7 | quarterly minor; major = ADR | Platform |
| React | 19 | major = ADR + golden-dataset test | Frontend |
| React Router | 7 | major = ADR | Frontend |
| TanStack Query | 5 | major = ADR | Frontend |
| Tailwind | v4 | major = ADR | Frontend |
| pnpm | 10 | major = ADR | Platform |
| Turbo | 2 | major = ADR | Platform |
| Vitest | 3 | major = ADR | Platform |
| Zod | 3 (Zod 4 deferred) | re-eval when Zod 4 ecosystem-stable | Platform |
| PostgreSQL | 17 (PG18 deferred) | re-eval at PG18 managed-GA | Data |
| Valkey | 8 | major = ADR | Platform |
| Docker / nginx | current stable | base-image CVE / quarterly | Infra |

### Tracked deviations (reconcile, do not let drift)
- **React**: `acs-web-v2` scaffold currently pins **React 18.3** → reconcile to **19**. Tracked.
- **pnpm**: repo `packageManager` currently **pnpm@9** → reconcile to **pnpm@10**. Tracked.

## Cadence
- **Monthly**: dependency review (audit advisories, available patch/minor bumps, drift check).
- **Quarterly**: planned minor bumps across the stack, batched and CI-verified.
- **Majors**: never ad hoc. Each major upgrade is **planned + ADR'd** before work starts.

## Major Upgrade Procedure (Node / React / PostgreSQL)
1. Open an ADR: motivation, breaking changes, rollback plan, owner, target window.
2. Branch + bump on a feature branch only.
3. **Test against the golden dataset** + run **full CI** (typecheck, lint, unit, integration, Part 23 query-count gates).
4. **Staged rollout**: staging → canary → production.
5. **Rollback plan** ready before rollout: revert commit + lockfile + image tag; PG majors require dump/restore-tested downgrade or pin-back path.
6. Close ADR with the verified outcome.

## Pinning Policy
- **Exact versions** in `package.json` (no `^`/`~` ranges for stack-defining deps).
- **Lockfile committed** (`pnpm-lock.yaml`); CI installs with `--frozen-lockfile`.
- **renovate/dependabot PLANNED** — once enabled, it raises PRs that still pass the same CI + ledger rules; it never auto-merges majors.

## Rules
- **Every dependency change** (add / remove / bump) goes through `ALLOWED_DEPENDENCIES.md` review. Nothing enters the tree unlisted.
- **Security patches are fast-tracked**: critical/high CVEs bypass the monthly cadence, but still run full CI + staged rollout.
- A bump that breaks CI or the golden-dataset run is blocked, not forced.

## Re-evaluation Triggers
- **Zod 4**: re-evaluate once Zod 4 is ecosystem-stable (resolver/library compatibility settled). Until then, stay on Zod 3.
- **PG18**: re-evaluate when PG18 reaches **managed-GA** on the target host. Until then, stay on PG17.
