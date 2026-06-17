# Architecture Change Request (ACR) — Template

> Copy this file to `docs/acr/ACR-NNNN-<slug>.md` to propose any change to a **LOCKED** decision
> (see `docs/FROZEN_DECISIONS_REGISTRY.md`). An ACR is **rejected** unless all sections are complete
> AND a superseding ADR + CTO approval (+ domain owner) accompany it. Process:
> `docs/ARCHITECTURE_GOVERNANCE.md` §4. This is the only way to change a frozen decision — agents
> must otherwise **reuse the approved pattern**.

- **ACR ID:** ACR-NNNN
- **Title:**
- **Author / date:**
- **Frozen decision(s) affected:** (registry row #(s) + ADR)
- **Status:** Draft → Under CTO Review → Approved / Rejected

## 1. Problem
What concrete problem requires changing a frozen decision? (evidence, not preference)

## 2. Current State
How it works today (the frozen pattern), with file/ADR references.

## 3. Proposed Change
The exact change. What becomes the new locked decision.

## 4. Alternatives
Every alternative considered (including "do nothing" / "reuse existing"), and why each was rejected.
A change is not justified if an existing approved pattern can solve the problem.

## 5. Impact
Modules, packages, DB, API, mobile (`MOBILE_API_COMPATIBILITY_MATRIX.md`), CI, and docs affected.
Blast radius + who/what depends on the current decision.

## 6. Risks
Technical, operational, security, data-integrity, and timeline risks.

## 7. Migration Plan
Step-by-step path from current → proposed, including data migration, dual-run, and cutover. Forward-
only migrations only.

## 8. Rollback Plan
How to revert safely if the change fails (and the point of no return, if any).

## 9. ADR Reference
The superseding ADR (`docs/adr/ADR-NNNN-*.md`). Registry update: old row → `SUPERSEDED → ADR-NNNN`,
new row added. `FREEZE_LOCK_REPORT.md` + enforcement (lint/dep-cruiser/CI/tests) updated in the same
change.

## 10. Approvals
- [ ] CTO
- [ ] Domain owner (`DOMAIN_OWNERSHIP.md`)
- [ ] Enforcement updated (so the new decision can't silently drift either)
