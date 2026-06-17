# ADR-0023 — Case/Task dispatch fields + per-task applicant targeting

- **Status:** Proposed (owner-approved field placements 2026-06-11; pending build)
- **Date:** 2026-06-11
- **Amends:** ADR-0002 (Case→Task→VU — adds task→applicant link + dispatch attributes; the core model is unchanged). Companion spec: `docs/specs/2026-06-11-case-creation-and-pipeline-model-design.md`. Audit: `docs/specs/2026-06-11-v1-zion-case-task-creation-audit.md`.

## Context

v2's case/task model is deliberately minimal (client+product, applicants, CPV units → bare task rows). The OPERATIONS phase must let the existing **unmodified** field mobile app (`crm-mobile-native`, separate repo) work against v2 — ADR-0012's never-break-mobile rule. The locked field-dispatch contract (audit §3) is the data the device reads from `/sync/download`; several fields it **renders to the field agent** have no home in v2 today:

- `addressStreet` (the agent navigates by it) — v2 has only `pincode_id`/`area_id` FKs (scope), no address.
- `notes` (the bank's trigger instruction) — absent.
- `verificationTaskNumber` — absent (v2 cases auto-number, tasks don't).
- `priority` — absent.
- `backendContactNumber` (the office number the agent calls) — absent.
- `customerName` / `customerPhone` / `customerCallingCode` / `applicantType` — v2 has applicants but no task→applicant link, so a task can't say *whom* it verifies.

Additionally, the owner requires that in v2 (multiple applicants + co-applicants per case) **task creation must let the operator choose which applicant/co-applicant the task is for** — and the dispatched customer identity must follow that choice. v1 has a `verification_tasks.applicant_type` column for this but never writes it at creation (the device falls back to the case-level name) — v2 will do it correctly.

Fields that v1 *appears* to send but are **dead on the wire** (`SELECT c.*` over columns that don't exist: city/state/pincode-string/lat/lng/email) are NOT captured — sending `''`/undefined matches v1 exactly.

## Decision

We will add the dispatch fields in their cleanest v2 home, and link each task to exactly one applicant.

| Field | Home | Rule |
|---|---|---|
| Dispatch address | `case_tasks.address` text NOT NULL | per-task free text (mirrors v1's only real address) |
| Trigger / `notes` | `case_tasks.trigger` text NOT NULL DEFAULT `''` | per-task (fixes v1's case-vs-task_description split-brain) |
| Task number | `case_tasks.task_number` varchar(30) NOT NULL, UNIQUE (case_id, task_number) | `case_number || '-' || seq` (e.g. `CASE-000001-1`); display-only for the device |
| Priority | `case_tasks.priority` varchar(10) NOT NULL DEFAULT `'MEDIUM'` CHECK (LOW/MEDIUM/HIGH/URGENT) | per-task |
| Applicant targeting | `case_tasks.applicant_id` uuid NOT NULL, FK→case_applicants(id) | **one applicant per task** (picked at task creation); "both" = two tasks |
| Office contact | `cases.backend_contact_number` varchar(20) NOT NULL | required create input, FE-prefilled from the creator's `/me` phone (`users.phone`) |
| Calling code | `case_applicants.calling_code` varchar(40) | auto-generated `CC-<epoch>-<rand>` per applicant; dispatched per task via `applicant_id` |

**Derived at dispatch (no storage):** `customerName` ← targeted applicant `name`; `customerPhone` ← applicant `mobile`; `customerCallingCode` ← applicant `calling_code`; `applicantType` ← applicant `applicant_type`; `verificationType` ← `verification_units`; `client{}` ← `clients`.

**Skipped (byte-safe — dead on v1's wire):** `customerEmail`, `addressCity`, `addressState`, `addressPincode`, `latitude`, `longitude`.

**Task-creation contract change:** `AddTasksSchema` moves from `{units:[{verificationUnitId, quantity}]}` to explicit per-task specs `{tasks:[{verificationUnitId, applicantId, address, trigger, priority}]}`. Quantity becomes "add N task rows." `verificationUnitId` stays CPV-gated; `applicantId` must belong to the case.

**Status enum extension:** `case_tasks` status gains `SUBMITTED_FOR_REVIEW` and `REVOKED` (added now so the later ingest/review legs don't re-migrate). Transitions enforced in repository code (v2 keeps logic in repos, no transitions table).

**TOCTOU ratchet:** every task status writer added later (start/complete/finalize) MUST bump `version` in the same UPDATE (Pipeline carry).

Migration **0037**, forward-only + idempotent guards, applied to dev :54329 + test :5433 (no v2 prod yet).

## Consequences

### Positive
- The unmodified mobile app works against v2 — every device-rendered field carries a real value; no contract break.
- Per-task applicant targeting is explicit and correct (v1 never wrote it) → the agent always sees the right customer; co-applicant tasks are first-class.
- Per-task `address`/`trigger`/`priority` fix v1's data-quality bugs (NULL task trigger, case-level-only address) at the source.
- Calling code on the applicant gives per-applicant separation for free and stays consistent with how name/phone/type derive.
- No new tables; all additive columns — frozen architecture (Case→Task→VU) intact.

### Negative
- The task-creation contract changes shape (units×qty → explicit specs) — but the only consumer is the v2 web create flow, updated in the same slice (no mobile caller; mobile does not create tasks).
- `applicant_id`/`address`/`task_number` NOT NULL require a backfill for existing dev rows before the constraint is set (v2 dev data is disposable; plan resets the test DB).
- Task number `case#+suffix` diverges visually from v1's `VT-000127` (owner's choice) — safe because the device only displays the string, never parses it.

## Alternatives Considered
- **Structured address table** — rejected; v1 only ever sent free-text street, extra structure adds scope without serving the contract.
- **Case-level address/trigger/priority** — rejected; loses per-task differentiation (a case with RESI + OFFICE units needs different addresses) the device needs per task.
- **`VT-` sequence + trigger (v1 parity task number)** — viable, but the owner chose case#+suffix; display-only so no functional difference.
- **Multiple applicants per task (join table)** — rejected; the device shows ONE customerName, and "both" is cleanly expressed as two tasks. Revisit only if a single task must formally cover 2+ people.
- **Materialized sync projection** — deferred; the dispatch read-model is a live scoped query (byte-compatible, reuses the scope seam); a `mv_` is a later optimization behind the same endpoint, never a contract change.

## Related ADRs
- ADR-0002 — the Case→Task→VU model this amends.
- ADR-0012 — mobile first-class consumer; this ADR is how v2 honors the locked contract.
- ADR-0015 / CASE_WORKSPACE freeze — the workspace + two-layer result the later ingest/review legs build on.
- ADR-0019 — OCC/version; the TOCTOU ratchet extends it to task status writers.
- ADR-0022 — the scope seam the dispatch read-model must compose (level TASK).
