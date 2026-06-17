# Test Dataset Strategy (Part 10)

> **Architecture FROZEN.** Model: `Case → Task → Verification Unit`. This document
> defines the **permanent golden/regression dataset** used to validate every release.

## 1. Purpose

A single, **deterministic, version-controlled** dataset representing a realistic
operational slice of CRM2. It is the contract that every release is diffed
against. If a code change alters golden outputs (reports, MIS rollups, billing),
the diff is reviewed and either ratified or rejected — no silent behavior drift.

## 2. What the dataset contains

| Domain | Golden rows (minimum) |
|---|---|
| Clients | ≥3 (different billing configs) |
| Products | ≥4 across clients |
| Client–product mappings | covers each active client×product |
| CPV enablement | enables a subset of units per mapping (incl. a disabled one) |
| Verification units | **all 68** (9 `FIELD_VISIT` ∪ 59 `KYC_DOCUMENT`) — see `db/v2/seed/verification_units.seed.sql` |
| Cases | spanning every case status |
| Tasks | field + KYC, every status, **incl. reverification lineage** |
| Assignments | one per role across the 6-role hierarchy |
| Billing records | **commission (field)** and **invoice (KYC)** paths |
| Commission records | each commission outcome |
| Reports | each report type / outcome variant |

## 3. Determinism rules (hard)

- **Fixed IDs and timestamps** supplied via `@crm2/test-utils` fixtures.
- **No `Date.now()`, no random** anywhere in dataset construction — banned in golden code.
- Seeds and fixtures are pure functions of constant inputs → byte-identical every run.
- The ephemeral Postgres test harness (`packages/test-utils`) applies `db/v2/migrations`
  **top-to-bottom**, then loads the golden seed. Same schema + same seed = same DB.

## 4. Where it lives

- **SQL seed:** `db/v2/seed/` (golden rows, deterministic IDs/timestamps).
- **TS fixtures/factories/builders:** `@crm2/test-utils` — typed accessors and builders
  layered on the seed so tests reference golden entities by name, not magic IDs.
- Both are version-controlled and reviewed like production code.

## 5. Coverage obligations (must hold)

The dataset **must** cover, with explicit golden rows:

- **Every role's visibility scope** — SA / MGR / TL / BE / FE (+ KYC verifier read-only):
  each role sees exactly its scoped slice; a regression test asserts row-counts per role.
- **Each result outcome** — every verification result/outcome variant is represented.
- **Each billing path** — commission (field) and invoice (KYC), incl. a **reverification**
  task that bills fresh with lineage to its parent.

## 6. Golden regression (every release)

1. Spin up ephemeral PG, migrate, load golden seed.
2. Run repos/services against it; capture **outputs / reports / MIS rollups**.
3. **Diff** against committed golden snapshots.
4. Any diff blocks release until reviewed and ratified (snapshot updated intentionally).

Coverage gate (tracked separately): repos/services **≥90% overall, ≥80%** per file.

## 7. How the dataset grows

- **Each new domain adds golden rows** in the same PR that ships the domain.
- New result outcome → add a golden case/task exercising it.
- New billing path or role scope → extend coverage rows + per-role assertions.
- Growing the dataset is part of "done"; a domain with no golden coverage is incomplete.

## 8. Other consumers

- **DR restore drills** — restored DB is validated by replaying the golden regression
  (see `DISASTER_RECOVERY.md`).
- **Synthetic monitoring** — seeds non-prod canary environments from this dataset
  (see `MONITORING_STRATEGY.md`).

## 9. Cross-references

- `DISASTER_RECOVERY.md` — golden dataset validates restore drills.
- `RELEASE_CHECKLIST.md` — golden regression diff is a release gate.
- `MONITORING_STRATEGY.md` — synthetic monitoring seeds from this dataset.
