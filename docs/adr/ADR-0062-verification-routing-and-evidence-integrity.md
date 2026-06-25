# ADR-0062 — Verification task routing & evidence integrity

**Status:** Accepted · **Owner-confirmed** (2026-06-24) · **Shipped** (2026-06-24, origin/main `5fb9d37`
[16/17], `cf405b6` [05], `86e5308` [07]; deploys green incl. external-HTTPS smoke). **Extends/refines:**
ADR-0024 (field/office assignment pools), ADR-0025 (generic desk finalize), ADR-0050 (office two-actor
relay, OFFICE flat commission). **Migration:** `0090` (drops the phantom PROPERTY_APF NEGATIVE outcome).
**Closes:** registry A2026-0623-05 / -16 / -17 / -07 (the KYC-workflow + APF cluster of the 2026-06-23
mobile round-trip audit).

## Context

The 2026-06-23 mobile verification round-trip audit found that a verification task could be **mis-routed**
and **finalized without evidence**, and that the device outcome catalog could advertise an outcome the app
has no form for:

- A verification unit's `kind` deterministically implies who does it and how: the chain
  `kind → worker_role → assignment pool` is 1:1 (DB CHECK in migration `0001` + `assignment_pool_roles`
  in `0039`): `FIELD_VISIT → FIELD_AGENT → FIELD`, and `KYC_DOCUMENT` / `DESK_DOCUMENT → KYC_VERIFIER →
  OFFICE`. But the operator-chosen `visitType` was **never validated against the unit's kind** at create
  or assign — only the assignee's role was checked against the visit pool. So a KYC document unit could be
  routed to a field agent (FIELD), or a field-visit unit handed to a desk verifier (OFFICE) (A2026-0623-05).
- KYC_DOCUMENT units carry `required_attachments = [{type:DOCUMENT, min:1}]`, but that column was **never
  read anywhere** — a KYC verification could be finalized with **zero document evidence** (A2026-0623-16).
- The mobile reference feed (`verification_unit_outcomes`, migration `0069`) advertised a top-level
  **NEGATIVE** outcome for PROPERTY_APF, but the device has no APF NEGATIVE form and v1 never had one — v1
  captures a negative APF *result* via the `constructionActivity` routing **inside the single APF form**
  (`SEEN → positive verdict`; `STOP / VACANT → negative verdict` on `finalStatus` / `finalStatusNegative`),
  which the current app already does and the backend already renders. The phantom feed entry would surface
  a formless NEGATIVE option once the outcome-sync (A2026-0623-02) is fixed (A2026-0623-07).
- The web case-detail "Field Report" card mapped **all** tasks under a FIELD-only header, including desk
  (KYC/DESK_DOCUMENT) tasks with a misleading "No field submission yet" empty state (A2026-0623-17).

## Decision

1. **A unit's kind binds its visit type — server-enforced.** A new pure helper
   `visitTypeForKind(kind)` (`@crm2/sdk`) maps `FIELD_VISIT → FIELD`, every other kind → `OFFICE`. The API
   validates the operator's `visitType` against the requested unit's kind at **create** (`cases/service.
   addTasks` via `repo.unitKindByIds`), **single-assign** (`cases/service.assignTask` via
   `repo.taskUnitKind`), and **bulk-assign** (`tasks/service.bulkAssign` via the unit kind on
   `tasksForAssignment`). A mismatch is rejected with **400 `VISIT_TYPE_UNIT_MISMATCH`** (bulk marks the
   row `NOT_ASSIGNABLE`). The owner chose the **strict** binding (kind decides the visit type) over a
   one-directional guard.

2. **Required document evidence is enforced at completion.** `cases/service.completeTask` calls the new
   `repo.taskDocumentRequirement(taskId)` and rejects with **400 `DOCUMENTS_REQUIRED`** when the unit's
   `required_attachments` DOCUMENT `min` is not met by the task's non-deleted office-reference
   (`kind='OFFICE_REF'`) attachments. This is naturally KYC-only: FIELD_VISIT units have
   `required_attachments = []` (`requiredDocs = 0`), so a field submission is never blocked.

3. **PROPERTY_APF has no top-level NEGATIVE outcome.** We keep v1's routing — a negative APF result is the
   `constructionActivity = STOP / VACANT` verdict inside the one form, not a separate outcome/form.
   Migration `0090` removes the phantom `NEGATIVE` row from `verification_unit_outcomes` (re-numbered) so
   the feed = `[POSITIVE, ENTRY_RESTRICTED, UNTRACEABLE]`, matching the device and v1. No mobile change; the
   backend report still renders a negative verdict from `finalStatus` (canonicalize + the APF template
   already handle it).

4. **The web Field Report card is FIELD-only.** `CaseTaskView` exposes `unitKind`; the case-detail report
   card filters to `FIELD_VISIT` tasks (pure `fieldVisitTasks()` helper). Desk tasks no longer render
   under the "Field Report" header (KYC report-gen is deferred, ADR-0039).

## Consequences

### Positive

- Tasks cannot be mis-routed (a document unit to the field, or an address unit to a desk), and a KYC
  verification cannot be closed without its document evidence — both server-enforced, not UI-only.
- The mobile outcome catalog matches the device forms and v1; fixing the outcome-sync (A2026-0623-02) later
  will not surface a formless APF NEGATIVE option.
- The "Field Report" card no longer mislabels desk work.

### Negative

- The strict kind↔visit binding changed long-standing test fixtures: the suite had encoded the old
  decoupling (≈13 "desk finalize" tests assigned a FIELD_VISIT unit OFFICE). These were reworked to proper
  KYC units **with** document evidence (parameterized seed helpers + an `attachDoc` helper; the shared
  `driveToAwaitingCompletion` / `settle` helpers now attach a doc) across the cases, billing, and dashboard
  suites — a one-time cost, but it makes the desk tests semantically correct.
- Operators must route a task with the correct visit type for its unit; a mismatched request now fails
  fast (400) instead of silently creating an unworkable task.

## Alternatives Considered

- **Bind only KYC→FIELD (block the clearly-broken direction, allow FIELD_VISIT→OFFICE).** Rejected by the
  owner: a field address unit done at a desk is equally nonsensical; strict is correct.
- **Add a dedicated PROPERTY_APF NEGATIVE form/outcome.** Rejected: v1 has no such form and captures the
  negative result via construction-activity routing; adding one would diverge from v1 for no gain. (See the
  owner decision in the registry under A2026-0623-07.)
- **Implement the full `required_attachments` engine (arbitrary types/counts).** Deferred: only the
  DOCUMENT-min path is needed today (KYC); the check reads the column generically so it extends later.

## Related ADRs

- **ADR-0024** — field/office assignment pools (the pool↔visit-type mapping this binds against).
- **ADR-0025 / ADR-0050** — generic desk finalize + office two-actor relay (the desk-completion path that
  decision 2 now gates on document evidence).
- **ADR-0061** — KYC verifiers scoped by assignment, not territory (sibling KYC-workflow fix from the same
  audit; both close A2026-0623 KYC findings).
- **ADR-0039** — field-report engine (KYC report-gen deferred; the basis for the Field Report card filter).
