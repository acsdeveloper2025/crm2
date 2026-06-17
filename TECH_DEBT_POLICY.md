# Tech Debt Policy (Part 16)

> **FROZEN.** Tech debt **cannot accumulate indefinitely.** Every cycle pays it down.

## 1. Core rule

Each sprint/iteration allocates **maintenance effort to debt paydown — target ~20%**
of capacity *(ratify)*. This budget is reserved, not discretionary: it is spent on
register items, not absorbed by feature work.

## 2. Debt register (where it's tracked)

- Single source of truth: **GitHub issues labeled `tech-debt`**.
- Mirrored summary in **`DEBT.md`** at repo root (human-readable index of open items,
  owner, severity, target date) — regenerated from issues, not hand-maintained.
- Every register item has an **issue ID** (e.g. `CRM2-142`).

## 3. Recording debt (hard rules)

- **No `TODO` / `FIXME` in code — banned** (enforced by lint/CI).
- Deferred work is recorded as an **issue-linked reference** in code or PR:
  e.g. `// deferred: CRM2-142 — N+1 in case rollup`.
- A reference with no live issue is a CI failure.

## 4. Classification

Each item carries:

- **Severity** — `critical` / `high` / `medium` / `low` (operational/security impact).
- **Interest** — rate at which the cost grows if unpaid (e.g. blocks scaling, compounds
  per feature, security exposure). High-interest items are prioritized regardless of severity.

## 5. Ownership & target dates (hard rule)

- Every **known-debt item has an owner and a target date.** No orphan debt.
- An item past its target date is escalated at the next review and either re-dated
  (with reason) or pulled into the current cycle's budget.

## 6. Review cadence

- **Per cycle:** review the register, confirm budget spend, re-prioritize by interest.
- **Per release:** confirm no new banned references slipped in; reconcile `DEBT.md`.

## 7. Budget per cycle

- ~20% capacity *(ratify)* reserved for debt.
- Unused budget does not roll over into features; it is a floor, not a ceiling.

## 8. Already-tracked debt (seed register)

| Item | Class |
|---|---|
| React 18 → 19 reconciliation | upgrade |
| pnpm 9 → 10 | upgrade |
| OpenAPI / SDK generation pending | tooling |
| Playwright E2E + axe a11y pending | testing |
| N+1 query harness pending | performance |
| knip-reported forward-API exports | hygiene |

Each is filed as a `tech-debt` issue with owner + target date before this policy is
considered satisfied.

## 9. Cross-references

- `docs/CI_CD_STANDARDS.md` — lint gate bans `TODO`/`FIXME`; checks issue-linked refs.
- `UPGRADE_POLICY.md` — governs the React and pnpm upgrade items above.

## Coverage ratchet (opened 2026-06-05 by the freeze-compliance audit)
The coverage gate was configured at 90/85 but **never executed** (`@vitest/coverage-v8` absent,
`--coverage` not run) — actual was api-v2 85.7% lines / 59.4% branch, sdk 48%. Fixed: provider
installed, `coverage.enabled:true` (always-on, enforced in `pnpm test`/CI), SDK transport test
added (sdk → 100% lines). **Enforced floors now:** api-v2 lines/stmts 85 · funcs 90 · branch 58;
sdk 90/90/65; logger 95/80/80. **Obligation:** ratchet each toward repos/services ≥90 + branch
≥85 as tests are added (esp. api-v2 controller/repo error branches). Never lower a floor without
CTO sign-off; raise floors when a module's coverage rises so it cannot regress.
