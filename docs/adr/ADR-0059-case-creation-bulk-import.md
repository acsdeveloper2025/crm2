# ADR-0059: Case-Creation bulk import (Excel/CSV)

- **Status:** Proposed
- **Date:** 2026-06-22

## Context

`docs/IMPORT_EXPORT_STANDARD.md` §4 lists **Case Creation** as a mandatory import surface, but it
does not exist (the 2026-06-22 import/export coverage audit, `docs/audit-2026-06-22/import-export/A6`,
registry IE-DEFER-3). Admins onboard cases in bulk (a bank hands over a spreadsheet of verifications) —
today every case is keyed by hand. This is the single highest-frequency missing admin workflow.

Case creation is **not** a flat row. A case = `client` + `product` + **N applicants** + **N case-tasks**,
where each task references one applicant and carries its own verification unit, visit type, address,
location (pincode/area), trigger, priority and target-TAT. Three frozen decisions constrain it:

- **ADR-0053** — creation runs a **search-first dedupe gate** that matches a new applicant across ALL
  existing cases; the UI forces a dedupe verdict before it will create. A blind bulk insert would
  bypass that gate and manufacture duplicate cases.
- **ADR-0056** — a task requires a **visit type**, and a FIELD task requires a **FIELD location**; the
  commission **field-rate is auto-derived** from the executive, never supplied by the caller.
- **ADR-0058** — display-text is stored uppercase via the SDK `toUpper` transform; any import must run
  through the SDK Create schema so the transform + all validation apply (no bypass).

The `cases`/`tasks` modules are also under concurrent parallel-session development, so the wiring
(routes/controller) must land without colliding.

## Decision

We will add a Case-Creation bulk import on the **existing universal import engine**
(`apps/api/src/platform/import`), reusing the existing `CreateCaseSchema` + the audited case-create
service path so ADR-0053/0056/0058 are enforced for free. We ship it in **two increments**:

### v1 — one row = one case (one applicant, one task) — RECOMMENDED FIRST

The common bulk-onboarding shape: each spreadsheet row is a complete case with a single applicant and a
single verification task. Columns (all resolved by CODE/NAME, never numeric id):

| Column | Maps to | Notes |
|---|---|---|
| Client Code | `clientId` (resolve) | required |
| Product Code | `productId` (resolve) | required |
| Applicant Name | applicant | required; `toUpper` |
| Applicant Type | applicant type enum | required |
| Phone | applicant phone | dedupe key |
| Verification Unit Code | `verificationUnitId` (resolve) | required; must be CPV-enabled for client+product |
| Visit Type | task visit type (ADR-0056) | required |
| Address | task dispatch address | required for FIELD |
| Pincode + Area | task location (resolve → `pincodeId`) | required for FIELD (ADR-0056) |
| Trigger | task trigger | |
| Priority / Target TAT | task target-TAT bucket (ADR-0044) | |
| Allow Duplicate | dedupe override (default `false`) | see Dedupe below |

The per-request `buildCaseImportSpec()` preloads the client/product/unit code→id maps + resolves the
location per row (mirroring `cpv`/`commissionRates`/`rates` imports), maps each row to
`CreateCaseInput`, and the engine's confirm calls the **existing** `caseService.create` per row — so
dedupe, the ADR-0056 visit-type/location requirement, the field-rate derivation, and `toUpper` all run
unchanged. Each created case writes its normal audit + the import_log batch record (§7). A failed row
(unknown code, dedupe block, validation) is reported per-row and never blocks the others.

### Dedupe (ADR-0053) in bulk

The import is **search-first, like the UI**: for each row the create path runs the cross-case dedupe
match. A match → the row is **reported as a per-row error** (`column: Applicant Name`, message naming
the matched case) and **NOT created** — unless that row's **`Allow Duplicate` = true**, which records
the same explicit override the UI verdict provides. No duplicate case is ever created silently.

### v2 — grouped multi-applicant / multi-task (future)

A `Reference Number` column groups rows: rows sharing a ref collapse into one case; distinct
(applicant) within a ref → multiple applicants; distinct (applicant, unit) → multiple tasks. Deferred
until v1 ships and is validated (the grouping/ordering logic is the only added complexity; the
per-entity resolve + dedupe are identical).

### RBAC + wiring

Gated `CASE_CREATE` (the same authority as `POST /cases` — import creates cases, never a weaker generic
perm; mirrors the users-import `USER_MANAGE` rule). New isolated file `cases/import.ts`; the route +
controller method are added to `cases/routes.ts`/`controller.ts` (coordinate with the parallel cases
session to avoid a merge race). SDK `cases.importTemplate/importPreview/importConfirm` (additive). Web:
an Import button on the Cases page wired to the existing `ImportModal`. Bank-MIS / client-specific
column maps (standard §4 "optional") stay out of scope.

## Consequences

### Positive
- Closes the §4 Case-Creation import gap with zero new pattern/package — pure reuse of the import engine
  + `CreateCaseSchema` + the case-create service, so all frozen invariants hold automatically.
- Dedupe is honoured, not bypassed; duplicates surface in the preview/error file before any write.
- v1 covers the high-frequency single-applicant onboarding; multi-applicant stays in the UI until v2.

### Negative
- v1 cannot express a multi-applicant or multi-task case in one upload (must use the UI or wait for v2).
- A large file ( ≥ the import job threshold) runs as a background job; the per-row dedupe search makes
  case import heavier than master-data import (acceptable — it reuses the same bounded engine + job tier).
- Touches `cases/routes.ts`/`controller.ts`, which has concurrent WIP — must be sequenced with that session.

## Alternatives Considered

- **Blind bulk insert (skip the dedupe gate)** — rejected: violates ADR-0053; manufactures duplicate
  cases, the exact thing the search-first gate exists to prevent.
- **A bespoke case-import implementation** — rejected: the frozen IMPORT_EXPORT_STANDARD §8 mandates the
  one engine; a domain only plugs in columns + schema + resolve + processor.
- **Grouped multi-row model as v1** — rejected for v1: the grouping/ordering logic adds real complexity
  and risk; ship the single-row v1 first, add grouping as v2 once proven.
- **Numeric-id columns** — rejected: ids are unstable/unknown to admins; resolve by human CODE/NAME like
  every other import.

## Related ADRs
ADR-0053 (multi-applicant batch dedupe), ADR-0056 (visit-type + FIELD location + derived field-rate),
ADR-0058 (input-uppercase), ADR-0044 (target-TAT). Realises `IMPORT_EXPORT_STANDARD.md` §4/§8.
Registry: supersedes the IE-DEFER-3 deferral for Case Creation.
