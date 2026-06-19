# ADR-0047: Two-stage task completion — SUBMITTED (field) then COMPLETED (office)

- **Status:** **Proposed** — domain-owner sign-off 2026-06-18 (CTO + domain-owner). Build spec +
  plan to follow. **Supersedes ADR-0032** (the "submit == complete" single-terminal decision) and
  **partially restates the commission *gate*** of ADR-0036/ADR-0046 (this ADR sets *when* commission
  fires; ADR-0046 sets *how much*). Supersedes a FROZEN decision — see
  [docs/governance/LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md).
- **Date:** 2026-06-18 (rebased on the as-built commission rebuild 2026-06-19)
- **Builds on:** [ADR-0046](./ADR-0046-commission-location-and-tat-dimensions.md) — **BUILT + merged**
  (commission now PERSISTED on the task: `case_tasks.commission_amount` stamped at completion via
  `stampCommissionSnapshot` reusing `COMMISSION_LATERAL`; read-model `COALESCE(ct.commission_amount,
  com.commission_amount)`). This ADR rebases on that: it **moves the stamp from COMPLETE to SUBMIT** and
  widens the commission read-gate — it does **not** re-derive or re-anchor the live lateral.
  [ADR-0048](./ADR-0048-rate-lateral-location-rank.md) fixed RATE_LATERAL (client bill) — still untouched here.
- **Design spec:** [docs/specs/2026-06-18-submitted-completed-lifecycle-design.md](../specs/2026-06-18-submitted-completed-lifecycle-design.md)

## Context

ADR-0032 collapsed the field and office terminals into one: the device's "Submit Verification" posts
the form and the task is driven **straight to `COMPLETED`** in the same call (`submit == complete`,
`verification-tasks/service.ts submitForm` → `completeTaskByDevice`). Consequences the owner wants to
undo:

- The **field executive's terminal** (they finished their visit) and the **office's terminal** (the
  report + official result are recorded) are the **same state** — there is no accountability split
  between "field work done" and "office work done."
- **Field commission and client billing both fire at the single COMPLETED instant.** The owner wants
  the field executive credited the moment they **submit**, and the **client billing** (the deliverable
  is finalized) credited when the **office completes** the task.
- The mobile app shows the agent's submitted task as "Completed", conflating it with the office's
  completion.

The model the owner requires is two distinct completions for two actors:

```
PENDING → ASSIGNED → IN_PROGRESS → SUBMITTED → COMPLETED
                                   ▲           ▲
                       field agent submits     office adds report + official result
                       (mobile "Submitted")    (web; existing complete flow)
                       → field commission      → client billing (bill amount)
                       → field "submitted" count  → "completed" count
```

The current schema already permits a vestigial `SUBMITTED_FOR_REVIEW` status (migration 0037) that **no
code path produces** (verified: no `task_backend_reviews`, no `backend_review_enabled` flag, no
`/backend-review` queue on this repo — that epic is v1-only). The office per-task complete endpoint
(`POST /cases/:id/tasks/:taskId/complete`, perm `field_review.complete`) **already accepts that state →
COMPLETED and records `verification_outcome` + remark + `completed_by`** — i.e. the office "add report +
result" step already exists. `case_tasks.completed_by` is already captured but read by nothing in
billing today. Commission is **read-derived** (no ledger): two SQL laterals (`RATE_LATERAL` = client
bill amount; `COMMISSION_LATERAL` = field payout keyed on `assigned_to`), "triggered" only by a
`status = 'COMPLETED'` filter in the read-models.

## Decision

We will split task completion into two real stages and credit each actor at its own stage.

1. **New task status `SUBMITTED`** (field-done). It **replaces** the vestigial `SUBMITTED_FOR_REVIEW`,
   which is **removed** from the `case_tasks` CHECK constraint, the SDK status enum, the office
   complete-guard, and the dashboard/field-monitoring read-models. (Safe: no row holds
   `SUBMITTED_FOR_REVIEW` — a precondition the migration verifies before narrowing the CHECK.)
2. **Device submit writes `SUBMITTED`, not `COMPLETED`.** The device form-submit (and the device
   `/start`→`/complete` path) lands the task in `SUBMITTED` and stamps a new `submitted_at`. The device
   no longer reaches `COMPLETED`.
3. **Office turns `SUBMITTED → COMPLETED`** via the **existing** per-task complete flow
   (`POST /cases/:id/tasks/:taskId/complete`, perm `field_review.complete`, the Case-Detail
   `CompleteForm`), which records the report/official result + `completed_by` + `completed_at`. Reuse —
   do not build a new endpoint. The complete-guard's from-set becomes `{ASSIGNED, SUBMITTED}`.
4. **Billing splits across the two stages, on the as-built PERSISTED-snapshot model (ADR-0046 §4):**
   - **Field commission is frozen at `SUBMITTED`.** Move the `stampCommissionSnapshot(q, taskId)` call
     from the COMPLETE transition to the **SUBMIT** transition (the device-submit writer this ADR splits
     out of `completeTaskByDevice`). The helper anchors `COALESCE(ct.completed_at, now())` → at submit
     `completed_at` is NULL → `now()` (the submit moment) — correct. **Do NOT re-stamp at the office
     COMPLETE** (the snapshot is already frozen; COMPLETE is the client-bill leg only).
   - **Submit-in TAT band (decision (a)):** add `case_tasks.submitted_elapsed_minutes` (mirror of
     `completed_elapsed_minutes`, stamped at submit), and have the submit-time snapshot derive the band
     from it (a submit-anchored variant — extend `COMMISSION_LATERAL`'s anchor/elapsed to
     `COALESCE(ct.submitted_at, ct.completed_at, now())` / `COALESCE(ct.submitted_elapsed_minutes,
     ct.completed_elapsed_minutes)` so the single lateral resolves correctly for both submit-stamping and
     office-only tasks). Else band-specific commission rates would never resolve at submit.
   - **Commission read-gate** moves from `status = 'COMPLETED'` to **`status IN ('SUBMITTED','COMPLETED')`**
     in the **one** shared `buildBillingWhere` (listCases + breakdown) and the `caseTasks` inline gate.
     Because the read-model already `COALESCE(ct.commission_amount, com.commission_amount)`, once the
     snapshot is stamped at submit + the gate includes SUBMITTED, field commission shows with no further
     lateral change.
   - **Client billing (bill amount, RATE_LATERAL) stays gated on `COMPLETED`** — null the bill side for
     SUBMITTED-but-not-COMPLETED rows (`CASE WHEN ct.status='COMPLETED' THEN rt.bill_amount END`). No
     office-user payout; the "FE" side is the client charge, fired at COMPLETE. RATE_LATERAL untouched
     (fixed by ADR-0048).
5. **Case rollup:** `SUBMITTED` counts as **active** (the case stays `IN_PROGRESS` until the office
   completes all tasks). `AWAITING_COMPLETION` and `finalizeCase` keep their current meaning. No new
   case status. The "submitted, awaiting office" worklist is a task-status filter, not a case status.
6. **Mobile** (`crm-mobile-native`, separate repo): add `SUBMITTED` to the status enum, **remove** the
   `SUBMITTED_FOR_REVIEW → COMPLETED` sync-download normalization, write `SUBMITTED` on submit, and add
   a **"Submitted"** tab/filter/projection bucket distinct from "Completed". No mobile DB migration
   (status is free-text). Ships as a new release (v1.0.71+).
7. **Revoke & revisit (no transition change):** revoke remains allowed **only** while `ASSIGNED` or
   `IN_PROGRESS` (office BE + FE; the field device-revoke stays within these states). A **`SUBMITTED`**
   or **`COMPLETED`** task is **NOT revocable** — the only redo is a **REVISIT** (the office creates a
   new lineage-linked task, same/different data + assignee, **billed separately**; existing
   `revisitTask`, ADR-0033). The mobile **Save** (local draft, "Saved" tab, still ASSIGNED/IN_PROGRESS)
   vs **Submit** (→ `SUBMITTED`) distinction stays. Field commission is therefore non-reversible by
   design — no post-submit revoke exists.

## Consequences

### Positive

- Clean field/office accountability: "Submitted" = field executive's work; "Completed" = office's
  report+result. Two independent counts for MIS.
- The field executive is credited (commission + count) the moment they submit — matching the owner's
  productivity/billing intent — while the **client** is billed only when the deliverable is finalized.
- Reuses the existing office complete endpoint, `completed_by`, the read-derived commission model, and
  rate management. Net-new surface is small (one status value, one timestamp, gate changes, mobile UI).

### Negative / Risks

- **Removing `SUBMITTED_FOR_REVIEW` is a contract narrowing** (not additive — exception granted by this
  superseding ADR + sign-off). Safe only with zero existing rows; the migration verifies first.
- **Commission-gate change overlaps ADR-0046** (same laterals/read-models). Resolved: **ADR-0046 lands
  first**; this lifecycle change rebases on its laterals. The status/lifecycle/mobile work proceeds in
  parallel; the billing-gate edit waits for ADR-0046.
- `submitted_at` is a new column; field-commission date windows and dashboards must read it.

### Resolved (owner, 2026-06-18)

- **Mobile rollout — no coordination needed:** the app is not live and has no current users (being
  reconnected to v2), so emitting the new `SUBMITTED` value is safe to ship directly (no version-gate /
  feature flag / forced-update sequencing).
- **Revoke policy:** a `SUBMITTED` task is **not revocable**; redo is REVISIT (separate bill). Field
  commission is therefore non-reversible — no stickiness logic needed (Decision §7).
- **FE-throughput metric:** deferred (`completed_by` already captured; add later if needed).

## Alternatives considered

- **Reuse `SUBMITTED_FOR_REVIEW` as the value (label "Submitted")** — backward-compatible (old apps
  normalize it to Completed), no CHECK migration. Rejected by the owner in favor of a clean `SUBMITTED`
  value with `SUBMITTED_FOR_REVIEW` removed; the rollout-coordination cost is moot since the app is not
  live / has no current users.
- **Pay an office/FE user a per-task commission** — rejected: the "FE" side is the client bill amount
  (existing rate management by client+product), not a payout to the completing user.
- **Persisted commission ledger fired by a status trigger** — rejected: forfeits the current
  read-derived idempotency; revisit/revoke stay free under the read-model approach.
