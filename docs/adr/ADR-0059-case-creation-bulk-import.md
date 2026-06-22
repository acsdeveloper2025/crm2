# ADR-0059: Case-Creation bulk import (Excel/CSV)

- **Status:** Proposed — design finalised 2026-06-22 from the C1–C5 dependency audit + owner scope
  decisions; ready to build on greenlight (no code written yet).
- **Date:** 2026-06-22

## Context

`docs/IMPORT_EXPORT_STANDARD.md` §4 lists **Case Creation** as a mandatory import surface; it does not
exist (audit `docs/audit-2026-06-22/import-export/A6`, registry IE-DEFER-3). Admins onboard cases in
bulk (a bank hands over a spreadsheet of verifications) — today each is keyed by hand.

A read-only 5-domain audit (`docs/audit-2026-06-22/case-upload/` C1–C5) mapped the entire create flow
and every dependency. The findings that shape this design:

- **A case is a tree, not a row:** `cases` header + **N applicants** (`case_applicants`) + **N tasks**
  (`case_tasks`, each linked to one applicant). Cardinality 1→N→N.
- **Create is non-atomic:** `POST /cases` (case + applicants, one tx) then `POST /cases/:id/tasks`
  (tasks, one tx). A task failure after the case insert leaves a **task-less shell** (C1).
- **`caseService.create` runs NO dedupe** — it trusts the payload's `dedupeDecision`; the search-first
  gate is **web-UI-only** (`CaseCreatePage.tsx`). An importer must run dedupe itself (C5).
- **The CPV-enablement gate is authoritative:** a task's unit must be CPV-enabled for the case's
  client+product → `400 UNIT_NOT_ENABLED` (C2).
- **Case creation needs NO pricing.** `client_rate_type` + all amounts are read-time (billing/MIS);
  `field_rate_type` is **server-derived**. The only create-time pricing gate, `NO_FIELD_COMMISSION`,
  fires **only when a FIELD task is assigned** (C3).
- **Assignment is optional and pulls in the whole dependency web** (pool-role + hierarchy + territory
  scope + a commission rate at the task location). A **PENDING** (unassigned) task needs none of it (C4).
- **The cases API takes numeric ids only** — the importer resolves everything by human CODE/NAME:
  `clients.code`, `products.code`, `verification_units.code` (all UNIQUE), `users.username`, and
  pincode+area → `locations` via the existing `findByPincodeArea` (rates import).

Frozen-area + new surface → this ADR governs the build. Constraints: additive `/api/v2`, the one import
engine (`platform/import`), raw SQL only in repositories, never break the mobile contract (ADR-0054).

### Owner scope decisions (2026-06-22)
1. Support **both** assignment modes — default PENDING, **optional** `Executive` column assigns at import.
2. Support **multi-applicant / multi-task from v1** via a row grouping key.

## Decision

Build Case-Creation import on the existing universal import engine, resolving by code/name and reusing
the audited create + dedupe + assign paths so every frozen invariant holds.

### 1. Row model — grouped (one row per case·applicant·task)

A **`Reference Number`** column groups rows into one case. Within a group: each distinct applicant
(by `Applicant Name` + identity) becomes a `case_applicant`; the first/`Primary? = Y` applicant is the
primary; each row is one task linked to that row's applicant. A single-applicant single-task case is the
degenerate one-row group (no Reference Number needed → one case per row).

| Column | Resolve | Required | Scope |
|---|---|---|---|
| Reference Number | groups rows → one case | optional (blank ⇒ one case/row) | case |
| Client Code | `clients.code`→id (USABLE) | ✅ | case (consistent within a group) |
| Product Code | `products.code`→id (USABLE, global) | ✅ | case |
| Backend Contact No | as-is (10–15 digits) | ✅ | case |
| Applicant Name | `toUpper` | ✅ | applicant (dedupe key) |
| Applicant Mobile / PAN / Company | as-is | optional (≥1 identifier recommended) | applicant (dedupe keys) |
| Applicant Type | enum (APPLICANT/CO_APPLICANT) | ✅ | applicant |
| Primary? | Y/N | optional (default first row) | applicant |
| Verification Unit Code | `verification_units.code`→id, **CPV-enabled** (USABLE) | ✅ | task |
| Visit Type | enum FIELD/OFFICE | ✅ | task |
| Address | as-is | ✅ when FIELD | task |
| Pincode + Area | `findByPincodeArea`→location id (both-or-neither) | ✅ when FIELD | task |
| Trigger | as-is | optional | task |
| Target TAT | `tat-policies` bucket (ADR-0044) | optional | task |
| Executive | `users.username`→id (USABLE) | optional → assign-at-import | task |
| Allow Duplicate (Y/N) + Dedupe Rationale | → `dedupeDecision`/`dedupeRationale` | conditional (see §3) | applicant |

The file carries **no** rate/commission/rate-type/`field_rate_type` value (all derived/read-time).

### 2. Atomic create per case-group

Add a thin additive service `caseService.createWithTasks(input, userId)` that wraps the existing
case+applicant insert and the task insert in **one transaction** (composing existing repo functions — no
new pattern), so a group fully succeeds or fully fails (no task-less shells; fixes the C1/D-3 partial-
failure trap for the import path). The processor calls it once per group.

### 3. Dedupe (the importer runs it — C5)

For every applicant in the file the importer calls `caseRepository.searchDuplicates` (the same scope-free
function the UI uses) on its identity keys (name/mobile/pan), EXACT match across ALL cases, **plus an
intra-file pass** (two new rows aren't in the DB yet). Verdict per applicant:
- no match → `dedupeDecision = NO_DUPLICATES_FOUND`.
- match + `Allow Duplicate = N` (or blank) → **per-row error** (reported in preview + the error file).
- match + `Allow Duplicate = Y` + `Dedupe Rationale` (≥5 chars) → `CREATE_NEW` with that rationale + the
  importer-computed `dedupeMatchedCaseNumbers`.
- match + `Allow Duplicate = Y` + missing rationale → per-row error (mirrors the server 400).

### 4. Optional assignment (when `Executive` is set)

A PENDING task is the default. When `Executive` is given, assignment runs **after** the case is created,
through the **per-row-tolerant** Pipeline `bulkAssign` path (NOT `addTasks`'s atomic-throw path), so one
ineligible row never aborts the batch. Preview re-checks eligibility (USABLE user + pool-role for the
visit type + hierarchy + FIELD territory scope + a commission rate at the location) and surfaces
`INELIGIBLE_ASSIGNEE` / `NO_FIELD_COMMISSION` per row before confirm. The importer must resolve units
through **USABLE** semantics (`availableUnits`), not the raw `allUnitsEnabled` (C2/D-1).

### 5. Flow, RBAC, wiring

Standard engine flow: Download Template → Upload → **Preview** (resolve all codes; CPV-enablement;
dedupe matches; assignment eligibility if `Executive` — no writes) → **Confirm** (atomic per-group
create + optional assign; import_log audit) → result + downloadable error file. Both `.xlsx` and `.csv`.
Gated `CASE_CREATE` (same authority as `POST /cases`). New isolated `cases/import.ts`; route + controller
added to `cases/routes.ts`/`controller.ts` (sequence with any concurrent cases work). SDK
`cases.import{Template,Preview,Confirm}` (additive). Web: an Import button on the Cases page → the
existing `ImportModal`. Bank-MIS / client-specific column maps (standard §4 "optional") stay out of scope.

## Consequences

### Positive
- Closes the §4 Case-Creation gap with **zero new pattern/package** — pure reuse of the import engine +
  the create/dedupe/assign paths, so dedupe, CPV-enablement, ADR-0056 conditionals, ADR-0058 uppercase
  and the assignment eligibility model all hold automatically.
- PENDING-by-default keeps the simple case dependency-free; the optional `Executive` adds assignment
  without a separate import; multi-applicant is supported from v1 via grouping.
- The atomic `createWithTasks` path removes the task-less-shell failure mode for imports.

### Negative
- Grouped multi-row parsing + intra-file dedupe + per-group atomic create is more importer logic than a
  master-data import (bounded — still the same engine + repo functions).
- Assign-at-import surfaces real per-row failures (`INELIGIBLE_ASSIGNEE`, `NO_FIELD_COMMISSION`); the
  preview must make these legible so an admin can fix the row or leave the task PENDING.
- Touches `cases/routes.ts`/`controller.ts`; must be sequenced with any concurrent cases work.

## Alternatives Considered
- **Blind insert (skip dedupe)** — rejected: violates ADR-0053; manufactures duplicates.
- **Single-applicant-only v1** — rejected by the owner: multi-applicant is needed from the start.
- **Assign-only via `addTasks`** — rejected: its single-transaction throw aborts the whole batch on one
  bad assignee; use the per-row-tolerant `bulkAssign` path instead.
- **Numeric-id columns / a bespoke importer** — rejected: resolve by human code/name; reuse the one engine.

## Related ADRs
ADR-0053 (multi-applicant batch dedupe), ADR-0056 (visit-type + FIELD location + derived field-rate),
ADR-0024/0033 (assignment eligibility), ADR-0044 (target-TAT), ADR-0058 (uppercase). Realises
`IMPORT_EXPORT_STANDARD.md` §4/§8; supersedes the IE-DEFER-3 deferral. Audit: `docs/audit-2026-06-22/case-upload/`.
