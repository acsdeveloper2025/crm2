# Part 15 — Release Checklist

CRM2 · architecture FROZEN. Every box must be checked (or explicitly N/A with reason) before cutting a tag and deploying. Process: [`RELEASE_GUIDE.md`](./RELEASE_GUIDE.md).

## Tests & quality gates

- [ ] `pnpm verify` green locally.
- [ ] CI all green: typecheck, eslint, prettier, unit, integration, build, openapi, sdk, e2e.
- [ ] secret-scan, boundaries, no-suppressions, migration-idempotency all pass.
- [ ] Coverage met: repositories/services **≥90%**, overall **≥80%**.
- [ ] Golden-dataset regression pass ([`TEST_DATASET_STRATEGY.md`](../engineering/TEST_DATASET_STRATEGY.md)).

## API contract

- [ ] OpenAPI regenerated, **no drift** committed.
- [ ] SDK regenerated, **no drift** committed.
- [ ] Breaking API changes follow [`API_VERSIONING_POLICY.md`](../engineering/API_VERSIONING_POLICY.md).

## Database & migrations

- [ ] Migrations forward-only + **idempotent** (apply-twice clean).
- [ ] Reviewed per [`DATABASE_CHANGE_PROCESS.md`](../engineering/DATABASE_CHANGE_PROCESS.md) (DDL, impact, perf, backfill, matview re-create).
- [ ] expand→migrate→contract staging confirmed for high-risk schema changes.
- [ ] Gated migrate step verified (api depends on migrate success — atomic).

## Security

- [ ] Security review complete ([`SECURITY_STANDARDS.md`](../security/SECURITY_STANDARDS.md) / [`SECURITY_GUIDE.md`](../security/SECURITY_GUIDE.md)): authz/scope, input validation, secrets, RBAC default-deny.
- [ ] Dependency review — new/updated deps in [`ALLOWED_DEPENDENCIES.md`](../engineering/ALLOWED_DEPENDENCIES.md); no unvetted additions.

## Backup & rollback

- [ ] Recent **restore-tested** backup exists ([`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md)).
- [ ] Rollback path tested: prior image redeploy works; DB restore documented if schema changed.
- [ ] Feature-flag kill-switch verified for flagged changes.

## Performance

- [ ] Budgets met: dashboard/pipeline/case-open/workspace **<2s** ([`PERFORMANCE_STANDARDS.md`](./PERFORMANCE_STANDARDS.md)).
- [ ] No N+1 / query-count regressions on hot paths (EXPLAIN reviewed).

## Accessibility (PLANNED gate)

- [ ] axe scan clean on changed screens.
- [ ] Keyboard navigation works (focus order, no traps).
- [ ] Color contrast meets WCAG AA.

## Audit & compliance

- [ ] Audit records present for **money / assignment / review** flows (append-only, hash-chained intact).

## Rollout config

- [ ] Feature flags set correctly (high-risk = default OFF; canary/staged plan defined).
- [ ] Canary cohort + staged-rollout sequence agreed.

## Docs & approvals

- [ ] Release notes written (changes, migrations, flag state, rollback note).
- [ ] ADRs added/updated for architectural decisions.
- [ ] Conventional-commit history; author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`; no AI trailer.
- [ ] Human approval to deploy obtained (domain owner co-approval for money/assignment/review/reporting — [`DOMAIN_OWNERSHIP.md`](../governance/DOMAIN_OWNERSHIP.md)).

## Monitoring

- [ ] Monitoring/alerts in place for changed surfaces ([`OBSERVABILITY_STANDARDS.md`](./OBSERVABILITY_STANDARDS.md)).
- [ ] Post-deploy verification plan ready (health + synthetic flows).
