# ADR-0013: Governance & Engineering Standards

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

A banking field-verification platform must stay maintainable, secure, auditable,
recoverable, and understandable for 5–10 years across changing contributors. Rules
that live only in prose are not followed; rules that live only in code are not
discoverable. We need a single, machine-enforced governance regime.

## Decision

**Adopt a permanent governance + engineering-enforcement regime, enforced by
tooling and recorded in versioned documents.**

- **Machine-enforced quality gates** (CI fails on violation; not docs-only):
  TypeScript all-strict (incl. `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`); ESLint
  banning `any`, `@ts-ignore/nocheck/expect-error`, **all `eslint-disable`**,
  `console.*`, TODO/FIXME/HACK/TEMP, magic numbers (business layer), FE raw
  fetch/axios, controller→repository imports; Prettier; husky + lint-staged;
  Vitest coverage (repos/services ≥90, overall ≥80); dependency-cruiser
  (circular + import-boundary + layering); gitleaks secret scanning; knip
  dead-code; centralized `@crm2/logger`; structured `AppError`/`ErrorCode`.
  Full map: **`docs/CI_CD_STANDARDS.md`** (40-rule enforcement matrix).
- **Governance documents** are the durable memory and are cross-linked from the
  **`PROJECT_INDEX.md`**: ADRs (`docs/adr/`), `BUSINESS_RULES.md`,
  `API_VERSIONING_POLICY.md`, `DATABASE_CHANGE_PROCESS.md`, `SECURITY_STANDARDS.md`,
  `DISASTER_RECOVERY.md`, `DATA_RETENTION_POLICY.md`, `DOMAIN_OWNERSHIP.md`,
  `LONG_TERM_PROTECTION.md`, `TEST_DATASET_STRATEGY.md`, `UPGRADE_POLICY.md`,
  `PERFORMANCE_STANDARDS.md`, `OBSERVABILITY_STANDARDS.md`, `MONITORING_STRATEGY.md`,
  `OPERATIONS_GUIDE.md` + `runbooks/`, `RELEASE_GUIDE.md` + `RELEASE_CHECKLIST.md`,
  `TECH_DEBT_POLICY.md`, `ALLOWED_DEPENDENCIES.md`.
- **No business rule lives only in code** (`BUSINESS_RULES.md`); **no dependency
  without justification** (`ALLOWED_DEPENDENCIES.md`); **every domain has an owner**
  (`DOMAIN_OWNERSHIP.md`); **frozen elements change only via a superseding ADR +
  CTO + domain-owner sign-off** (`LONG_TERM_PROTECTION.md`).

## Consequences

### Positive

- Discipline is enforced by machines, not memory; "why" is discoverable via ADRs;
  onboarding starts from one index. Debt and drift cannot accumulate silently.

### Negative

- Up-front and ongoing tooling/maintenance cost; stricter contributor workflow.

## Alternatives Considered

- **Convention + code review only** — rejected: unenforceable at scale and over
  time; the v1 incident history shows silent drift reaches production.

## Related ADRs

- ADR-0011 / ADR-0012 — API + mobile governance.
- ADR-0004 / ADR-0005 / ADR-0007 — the data-access, repository, and naming
  standards that these gates enforce.
