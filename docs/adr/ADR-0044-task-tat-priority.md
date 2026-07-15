# ADR-0044: Task TAT (turnaround-time) SLA — target TAT + completed-in band

- **Status:** **Accepted** — domain-owner sign-off 2026-06-18 (decisions locked + CTO defaults
  blessed); build spec + plan to follow, TAT built before the commission rebuild. Supersedes a FROZEN
  decision (the per-task priority enum, ADR-0023 / migration `0037`) and amends this ADR's own original
  "commission unaffected" stance — see [docs/governance/LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md).
- **Date:** 2026-06-18 (revised same day with locked decisions)
- **Owner request:** express task priority as a **turnaround time** (4 / 6 / 8 / 12 / 24 / 48 hours)
  rather than the abstract `LOW / MEDIUM / HIGH / URGENT` labels — AND, added 2026-06-18, **measure
  which TAT band the field executive actually completed each task in**, to drive a completion report
  and to feed field-executive commission (see ADR-0046).
- **Supersedes (if accepted):** the per-task priority enum (ADR-0023 / `0037_case_task_dispatch_fields.sql`).
- **Consumed by:** ADR-0046 (field-executive commission gains a **completed-in TAT band** dimension).

## Context

Today, task priority is a **task-level abstract enum**:

- `case_tasks.priority varchar(10) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT'))` (`0037`). No `cases.priority` — priority is per task.
- SDK `PRIORITIES = ['LOW','MEDIUM','HIGH','URGENT']` (`packages/sdk/src/cases.ts:56`), dispatched to the field app in the sync DTO and shown on the task card.
- Set at case/task creation in the web (`CaseCreatePage`, `AddTasksForm`).
- The field app's drag-reorder is a **separate, device-local** concept and never writes the office priority.

Two weaknesses: (1) `LOW/HIGH/URGENT` carries **no concrete commitment** — no due date, no overdue, no SLA reporting, even though banks/clients contract on turnaround time; (2) there is **no measure of how long the executive actually took** — `assigned_at`/`completed_at` exist on `case_tasks` (server-side `timestamptz`) but nothing computes elapsed time or buckets a completed task into a band. The existing "out of TAT" flag (ADR-0032, `tasks/repository.ts:13-19`) is a *breach predicate on open tasks only* (12/24/48/72h off `created_at`) and goes false at completion — it is **not** a completed-in classifier.

## Decision (locked 2026-06-18)

The TAT model has **two distinct concepts**, both using one shared, config-driven band set:

**A. Target TAT (assigned up front) — the office's SLA promise.**
1. Each task carries a **target TAT bucket** — one of `4h / 6h / 8h / 12h / 24h / 48h` — and a derived **`due_at = assigned_at + tat_hours`**.
2. The bucket set is a **config-driven master table** (`tat_policies`), not a hard-coded enum, so the business can add/retire buckets without a deploy (consistent with CPV/rates).
3. **Overdue** = `now() > due_at`; drives MIS/dashboard SLA columns and overdue badges.

**B. Completed-in TAT band (measured at completion) — NEW; what commission consumes.**
4. At completion, **elapsed = `completed_at − assigned_at`** is classified into the same band set, producing a **completed-in band** per task. The assign/complete/band trio is surfaced in a completion read-model (the "which TAT did he complete in" table the owner asked for).
5. **Clock:** elapsed is measured against **server-receipt `completed_at` (`= now()` at submit)**, not device field-completion time — accepted trade-off (an offline/late-sync agent looks slower; revisit with a device-completion timestamp later if it skews bands). Elapsed is **wall-clock** (not business-hours) for now.
6. **Snapshot principle:** because `tat_policies` is editable and commission depends on the band, the resolved completed-in band (and the commission amount) must be **snapshotted at the billing/finalize moment** (consistent with ADR-0036's CARRY note) so historical figures don't shift when policies change.

The field app's local drag-reorder is **unchanged** — it stays the agent's personal ordering, orthogonal to TAT.

## Locked answers to the original open questions

1. **Bucket set:** `4/6/8/12/24/48h`, **global** (not per client/product for now), **configurable** via `tat_policies`.
2. **Enum→TAT backfill:** `URGENT→4h, HIGH→8h, MEDIUM→24h, LOW→48h` (default; owner may revise at sign-off).
3. **Granularity:** **task-level** (as today), consistent with per-task commission. No case-level TAT.
4. **Wall-clock vs business-hours:** **wall-clock** for both `due_at` and the completed-in elapsed; business-hours is a future refinement (IST shift-window logic already exists if needed).
5. **Revisit/recheck:** the TAT clock **resets per task** — each lineage task has its own `assigned_at → completed_at`, so its own target `due_at` and its own completed-in band. (Commission is per-task, so this is coherent.)
6. **Completion clock (added):** **server-receipt `now()`** (decision 5 above).
7. **Scope (added):** **full** — build both A (target TAT) and B (completed-in band). Not measurement-only.

## Impact (surface to change — detailed in the build spec)

| Layer | Change |
|-------|--------|
| **DB** | `tat_policies` master (band set, configurable, effective-dated). `case_tasks`: add `tat_hours int` + derive/store `due_at`; record the completed-in band (store elapsed and/or the snapshotted band at completion). Keep `priority` populated through the transition (Migration). |
| **SDK** | Augment `Priority` with the TAT shape (`tatHours`, `dueAt`, `overdue`) and add the completed-in fields (`assignedAt`/`completedAt`/`completedTatBand`/elapsed) to the relevant task views (note: the Pipeline `TaskView` currently lacks `completedAt`/`startedAt`). Additive only. |
| **Web** | Case/task creation picks a target TAT bucket; task/case views show `due_at` + overdue badge; MIS gains SLA/overdue columns; a **completion (assign/complete/band) report** is added; `tat_policies` admin. |
| **Mobile** (`/api/v2` consumer — **never break**, ADR-0011) | TAT is **additive**: send `tatHours`+`dueAt` alongside a back-compat `priority`-shaped label (Alt 3 below). The unmodified installed app must keep working. Completion already posts `completed_at` (server-stamped) — no new mobile field required for the band (server-receipt clock). |
| **Commission/billing** | **AMENDED — was "unaffected".** Field-executive commission gains a **completed-in TAT band** dimension (ADR-0046); the resolver and `commission_rates` config key on the band. The band is snapshotted at finalize. |
| **Revisit/recheck** | Per-task clock reset (locked Q5). |

## Alternatives considered

1. **Keep the enum, add a separate `due_at`/SLA field** — least disruptive; priority stays abstract, TAT rides alongside. Downside: two overlapping concepts confuse the operator.
2. **Replace enum with TAT outright** — cleanest single concept; downside: a breaking model change across web/MIS/mobile.
3. **Hybrid (CHOSEN for migration safety):** TAT buckets are authoritative; derive a back-compat priority label (`4–6h→URGENT, 8–12h→HIGH, 24h→MEDIUM, 48h→LOW`) so legacy readers and the un-rebuilt mobile app keep working while TAT fields roll out, then retire the label.

## Migration

- Forward, additive: add `tat_policies` + `tat_hours`/`due_at` on `case_tasks`; **map existing enum → default TAT** (`URGENT→4h, HIGH→8h, MEDIUM→24h, LOW→48h`); backfill `due_at` for open tasks from `assigned_at + mapped_tat`.
- Keep `priority` populated (derived) through the transition; retire only after web + MIS + a mobile release all read TAT.
- The **completed-in band is computable retroactively** for historical completed tasks (`assigned_at`/`completed_at` already exist), so the completion report and back-history commission analysis can cover past tasks — but persisted commission stays snapshot-at-finalize going forward.

## Consequences / risks

- **Mobile back-compat is the main risk** — keep emitting a priority-shaped value (Alt 3) or gate a rebuilt app via `min_supported_version`. Additive-only per ADR-0011.
- **Server-receipt clock** can overstate elapsed for offline completions — accepted now; a device-completion timestamp is the documented future fix.
- Web + MIS rework (creation pickers, badges, SLA columns, the completion report).
- A configurable bucket master (`tat_policies`) is required.

## Sign-off required

**APPROVED 2026-06-18** — domain-owner signed off on this revision (decisions + CTO defaults). A build
spec + plan are written next; the TAT system is built before the commission rebuild. ADR-0046
(commission) is drafted next and depends on concept **B** (the completed-in band) here. Reconciliation
with the data-model + MIS/billing owners happens in the build spec.

---

## Amendment — 2026-07-15: ONE overdue predicate, `revoked_at`, and the held-time view

Owner-reported live defect + the fixes that followed. **The decision above is unchanged**; this records
how it is actually implemented, and corrects two drifts from it. Prod `8419b47`, migration **0119**.

### 1. "Out of TAT" has exactly ONE definition — `platform/tat/overdue.ts`

```sql
TASK_OVERDUE_SQL =
  status IN ('PENDING','ASSIGNED','IN_PROGRESS')   -- only work still OWED
  AND tat_hours IS NOT NULL                        -- no target ⇒ nothing to breach (fails OPEN)
  AND assigned_at IS NOT NULL                      -- the clock starts at ASSIGNMENT
  AND now() > assigned_at + (tat_hours * interval '1 hour')
```

The rule had been hand-copied into **four** modules and two had drifted. Field Monitoring counted
**SUBMITTED** work against the agent and measured it against a **hard-coded 24h** instead of the task's
own `tat_hours` — so it reported an agent "Overdue 1" for a task he had already delivered, while
Pipeline reported 0 for the same task. Two screens, two answers, one question.

**SUBMITTED is excluded by design:** once the agent submits, he has delivered; any further delay is the
back office's. **`tat_hours` is per-task**, never a global default. Pipeline, tasks, field-monitoring and
dashboard now all import the one constant — a fifth caller must reuse it, not re-type it.

### 2. Re-work tasks are born with a TAT (`REWORK_TAT_HOURS = 24`)

Both lineage INSERTs (revisit-of-COMPLETED, reassign-after-REVOKED) omitted `tat_hours`, and the column
has no DEFAULT (mig 0078) — so **every re-work task was born NULL and was permanently invisible to
Out-of-TAT**, however long an agent held it. Owner decision: a re-work task gets a **fresh full window**,
the same default the web sends for a new task.

### 3. `revoked_at` (mig 0119) — the first agent's stretch is no longer erased

A revoke+reassign already produced two rows, each with its own agent and its own target. But a REVOKED
task is never `overdue` (nobody holds it), so the TAT badge never rendered and **the first agent's time
vanished on every screen**. `case_tasks.revoked_at` — the sibling of `started_at` / `submitted_at` /
`completed_at` — closes that. `updated_at` is NOT a substitute: any later write moves it. Backfilled from
the append-only audit trail (`after_data.status = 'REVOKED'`), which held the exact moment.

Pipeline renders **`held 6h 13m / 24h`** on the revoked row, red only if the agent had **already** breached
before the revoke. **`overdue` is untouched** — `held` is backward-looking, not a live breach. Exposed as
`heldMinutes` (not hours): every pre-rounding lies — CEIL turns an exact 6h hold into "7h"; FLOOR renders a
24h55m breach as a clean "24h". The read guards `revoked_at >= assigned_at` and fails to NULL, because a
money-adjacent screen must never print a nonsense number.

### Corrections to this ADR's own text

- **`due_at` is NOT stored**, despite §Impact ("derive/store due_at") and §Migration ("backfill due_at").
  The implementation deliberately went the other way (mig 0078: *"due_at/overdue/completed-in-band are
  DERIVED at read time"*). Deriving is correct — re-assignment moves the clock, and a stored value would
  go stale. The ADR text was never reconciled; it is now.
- **Re-assignment restarts the clock**, unguarded: `assignTask` sets `assigned_at = now()`, so moving an
  overdue task to another agent clears the breach instantly, with no trace (overdue is derived, never
  stored). Correct for judging the *new* agent; it also means a breach can be erased by re-assigning.
  Not changed here — flagged for the owner.
- **"Completed in 24h" ≠ "Out of TAT"**, and nothing compares a *completed* task against its own target:
  the completed-in band buckets actual elapsed against the shared `tat_policies` list and never reads
  `ct.tat_hours`. A task promised 4h and completed in 20h renders a plain "24h", indistinguishable from
  one that hit a 24h target. **There is no "did this completed task meet its TAT?" answer anywhere.**
  Deferred — see the registry.
