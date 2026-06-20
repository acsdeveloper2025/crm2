# ADR-0053: Multi-applicant batch dedupe + post-creation applicant add

- **Status:** **Accepted** — owner-directed 2026-06-20 (owner + CTO). Additive to the case-creation flow
  ([ADR-0023]); does not change a frozen decision. ADR number **0053** is used (not 0051/0052, which are
  reserved for the parked `design-audit-wip` inline-grid / button-affordance ADRs) to avoid a number
  collision on merge.
- **Date:** 2026-06-20
- **Migration:** `0087_case_applicant_dedupe.sql` — additive, idempotent (`ADD COLUMN IF NOT EXISTS`),
  re-run-safe (no DROP/ADD CHECK, so it cannot become a migrate-rerun deploy blocker like the 0037/0083 traps).

## Context

A case may have multiple applicants — one primary (`APPLICANT`) plus co-applicants (`CO_APPLICANT`),
stored 1:N in `case_applicants` (added at ADR-0023 / mig 0010; `company_name` at mig 0040). The
case-creation form (`CaseCreatePage.tsx`) lets the operator add co-applicants and offers a mandatory
**dedupe gate**: a Search must run before Create is enabled, and the operator records a decision
(`NO_DUPLICATES_FOUND` or `CREATE_NEW` + rationale) which is persisted on the case
(`cases.dedupe_decision` / `dedupe_rationale` / `dedupe_matched_case_numbers[]`).

Two problems drive this ADR:

1. **Co-applicants bypass dedupe (a blind spot).** The Search button sends **only the primary
   applicant's** name/mobile/pan (`CaseCreatePage.tsx` builds the dedupe body from `primary.*`). The
   file's own comment claims *"matches across all applicants"*, but the code does not — a co-applicant
   who is a known duplicate is never checked against the database. (The backend dedupe SQL *does* scan
   every applicant row in the DB; it is the **input** that is limited to the primary.)

2. **Applicants are write-once; there is no way to add one after creation.** No API route
   (`/cases/:id/applicants` does not exist), no UI (CaseDetailPage shows applicants read-only), no code
   path mutates `case_applicants` after the create transaction (the table has no `updated_at`). If a
   co-applicant surfaces mid-verification, the only option today is to abandon and recreate the case.
   Naively bolting on an "add applicant" path would also re-open the dedupe blind spot, because the
   case-level decision was captured once at creation and a later add would escape it.

The owner directed: make dedupe cover **all** applicants at creation, **and** allow adding an applicant
after creation **with dedupe still enforced** for the late addition.

## Decision

We will treat dedupe as covering the **full applicant set**, captured atomically at creation and
re-captured per applicant on any later add. Editing or removing applicants stays out of scope.

### 1. Batch dedupe at creation — front-end orchestrated, **no API change**

The Search action runs the existing `POST /cases/dedupe` **once per applicant that has at least one
identifier** (typically 1–3 calls), reusing the endpoint unchanged. Results are merged client-side and
rendered **grouped by which of the operator's applicants matched** (e.g. *"Applicant 1 (Ravi) → 2
matches; Co-applicant 1 (Sita) → no matches"*); the existing `matchType` tags (PAN/MOBILE/NAME) stay on
each result row.

The decision stays **case-level and binary** (one case ⇒ one `dedupe_decision`): if **any** applicant
matches, the decision is `CREATE_NEW` and a rationale (≥5 chars) is required; if **all** applicants are
clean, the decision is `NO_DUPLICATES_FOUND`. Adding or editing **any** applicant re-arms the single gate
(forces a re-Search), exactly as the primary-only gate does today.

Search keys remain **name / mobile / pan** (strong identity). **Company is not a search key** — it is
collected and stored, but an OR-match on employer would flood results with unrelated people at the same
company. (Consistent with current behaviour; the backend already supports company should we revisit.)

### 2. Post-creation applicant add — new endpoint with dedupe-on-add

We will add `POST /api/v2/cases/:id/applicants` (guard **`CASE_CREATE`** — the same actor who creates
cases). Body: a single applicant `{ name, mobile?, pan?, companyName? }` plus the dedupe outcome
`{ dedupeDecision, dedupeRationale?, dedupeMatches? }` — mirroring the create-case dedupe contract for one
applicant.

- **Dedupe-on-add is advisory and mirrors creation.** The CaseDetailPage "Add applicant" inline form
  first calls the existing `/cases/dedupe` for the new applicant; if it matches, the operator must supply
  a rationale; then it POSTs. The server re-validates: a decision is always required, and
  `CREATE_NEW` requires a non-empty rationale (same rule as create-case).
- **Status guard:** allowed only while the case status is `NEW` or `IN_PROGRESS`. A `COMPLETED` or
  `CANCELLED` case is a frozen record → `409` (e.g. `CASE_NOT_OPEN`).
- The added applicant is always `CO_APPLICANT`, `is_primary = false` (the primary is fixed at creation
  and protected by the `uq_case_one_primary` partial unique index).

### 3. Storage — dedupe verdict on the `case_applicants` row (no new table)

Migration `0087` adds three nullable/defaulted columns to `case_applicants`:

```sql
ALTER TABLE case_applicants
  ADD COLUMN IF NOT EXISTS dedupe_decision varchar(30),
  ADD COLUMN IF NOT EXISTS dedupe_rationale text,
  ADD COLUMN IF NOT EXISTS dedupe_matched_case_numbers text[] NOT NULL DEFAULT '{}';
-- CHECK added separately, guarded so a re-run does not error:
--   dedupe_decision IS NULL OR dedupe_decision IN ('NO_DUPLICATES_FOUND','CREATE_NEW')
```

Semantics:
- **`dedupe_decision IS NULL`** ⇒ a **creation-time** applicant; its dedupe is the case-level record on
  `cases` (unchanged, still authoritative for the original set).
- **`dedupe_decision` non-NULL** ⇒ an applicant **added post-creation**, carrying its **own** verdict
  (decision + rationale + matched case numbers) on its row.

This keeps the change additive and join-free, and preserves the existing `cases.dedupe_*` model intact.
The `CHECK` is added as a separate guarded statement (not a `DROP/ADD` on an existing constraint) so the
prod migrate-rerun-every-deploy behaviour cannot turn it into a deploy blocker.

### 4. Out of scope (explicitly)

**Editing** and **removing** applicants after creation are not part of this ADR. Tasks bind to a specific
`applicantId` (removal would orphan them), and editing an applicant's identity would silently bypass the
dedupe that was recorded for it. If needed later, they warrant their own ADR.

## Consequences

### Positive

- Closes the co-applicant dedupe blind spot — every applicant is checked at creation.
- A forgotten co-applicant can be added without abandoning and recreating the case, and the addition is
  still deduped and audited.
- Minimal surface: batch-at-creation is front-end only (reuses the existing endpoint); the only new API
  is the single add-applicant route; storage is three additive columns, no new table, no join.
- **Mobile unaffected** — it is a read consumer of applicants; a new `CO_APPLICANT` row syncs down
  additively. No mobile endpoint changes; the never-break-mobile invariant holds.
- The dedupe gate cannot be bypassed: the original set is captured atomically at creation, and every
  later add carries its own decision + rationale.

### Negative

- Batch search issues N requests (one per applicant) rather than one. N is small (1–3 in practice);
  acceptable, and avoids an API change. A future batch endpoint can collapse it if needed.
- The same existing case can appear under more than one of the operator's applicants (e.g. it matches
  applicant 1 by mobile and applicant 2 by name). This is intentional — the grouping shows *why* each
  applicant flagged — but the reviewer sees the case listed twice.
- Dedupe provenance is now split: original applicants on `cases.dedupe_*`, later additions on
  `case_applicants.dedupe_*`. A reader must know NULL ⇒ "covered by the case-level record".

## Alternatives Considered

- **Per-applicant dedupe gate at creation** (each applicant its own Search + clear + rationale) —
  rejected: higher friction and fights the one-decision-per-case data model; the create decision is
  inherently case-level (one case, one `dedupe_decision`).
- **Keep primary-only dedupe (status quo)** — rejected: leaves the co-applicant duplicate hole open.
- **New `case_applicant_dedupe_events` table** for add-events — rejected as over-built for the need;
  three columns on `case_applicants` capture the verdict with no join. (Revisit if multi-event history
  or applicant edit/audit is ever required.)
- **New backend batch-dedupe endpoint** (accepts an applicants array, returns per-applicant groups) —
  deferred: more API/OpenAPI/test surface for marginal benefit at small N; front-end orchestration over
  the existing endpoint is more additive.
- **Include company as a dedupe search key** — rejected (owner): weak identity; an OR-match floods
  results with unrelated same-employer cases.

## Related ADRs

- [ADR-0023] — case-task dispatch fields + applicant targeting (tasks bind to a specific applicant). This
  ADR extends dedupe to all applicants and adds the post-creation applicant path that targeting consumes.
- [ADR-0050] — Add-Tasks / rate-type model; tasks bind to `applicantId` (the reason edit/remove is out of
  scope here).

[ADR-0023]: ./ADR-0023-case-task-dispatch-fields-and-applicant-targeting.md
[ADR-0050]: ./ADR-0050-commission-exact-match-rate-type-key.md
