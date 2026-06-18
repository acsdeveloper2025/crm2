# ADR-0044: Task priority as a TAT (turnaround-time) SLA instead of an abstract enum

- **Status:** **Proposed** — requires CTO + domain-owner sign-off before any build (this supersedes a FROZEN decision; see [docs/governance/LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md)).
- **Date:** 2026-06-18
- **Owner request:** during the mobile↔v2 connection work, the product owner proposed expressing task priority as a **turnaround time** (4 / 6 / 8 / 12 / 24 / 48 hours) rather than the abstract `LOW / MEDIUM / HIGH / URGENT` labels.
- **Supersedes (if accepted):** the per-task priority enum established in ADR-0023 / migration `0037_case_task_dispatch_fields.sql`.

## Context

Today, task priority is a **task-level abstract enum**:

- `case_tasks.priority varchar(10) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT'))` (`0037`). There is **no `cases.priority`** — priority is per task.
- SDK `PRIORITIES = ['LOW','MEDIUM','HIGH','URGENT']` (`packages/sdk/src/cases.ts:56`), dispatched to the field app in the sync DTO and shown on the task card.
- Set at case/task creation in the web (`CaseCreatePage`, `AddTasksForm`).
- The field app's drag-reorder is a **separate, device-local** concept — per the owner decision (2026-06-18, implemented this session) the device's numeric reorder is the agent's personal ordering and **never** writes the office priority.

The weakness: `LOW/HIGH/URGENT` carries **no concrete commitment**. The office cannot say "this verification is due within 6 hours," there is no due date, no overdue detection, and no SLA reporting. Banks/clients contract on turnaround time, so the abstract label doesn't map to the real operational promise.

## Decision (proposed)

Replace the abstract priority with a **TAT (turnaround-time) SLA**:

1. Each task carries a **TAT bucket** — one of `4h / 6h / 8h / 12h / 24h / 48h` (exact set owner-confirmed) — and a derived **`due_at = assigned_at + tat_hours`**.
2. The bucket set is a **config-driven master table** (e.g. `tat_policies`), not a hard-coded enum, so the business can add/retire buckets without a deploy — consistent with the config-driven direction (CPV/rates).
3. **Overdue** = `now() > due_at`; this drives the MIS/dashboard SLA columns, overdue badges, and (optionally) escalation.
4. The field app's local drag-reorder is **unchanged** — it stays the agent's personal ordering and is orthogonal to TAT.

## Impact (the surface that must change — to be detailed in the build spec)

| Layer | Change |
|-------|--------|
| **DB** | `case_tasks`: add `tat_hours int` + `due_at timestamptz` (or compute `due_at` in views). New `tat_policies` master. Migrate the `priority` CHECK/enum (see Migration). |
| **SDK** | Replace/augment `Priority` with the TAT shape (`tatHours`, `dueAt`, `overdue`). Additive to avoid breaking consumers mid-migration. |
| **Web** | Case/task creation picks a TAT bucket; task/case views show `due_at` + overdue badge; MIS gains SLA/overdue columns. |
| **Mobile** (`/api/v2` consumer — **never break**, ADR-0011) | The sync DTO sends `priority` (string) today and the app displays + sorts on it. TAT must be **additive**: send `tatHours`+`dueAt` alongside a back-compat `priority`-shaped label, OR teach the app TAT (app rebuild + `min_supported_version`). The unmodified installed app must keep working. |
| **Commission/billing** | Unaffected — priority is not a commission input. |
| **Revisit/recheck** | Decide whether a new lineage task resets its TAT clock (likely yes, from the new `assigned_at`). |

## Alternatives considered

1. **Keep the enum, add a separate `due_at`/SLA field** — least disruptive; priority stays abstract and TAT rides alongside. Downside: two overlapping concepts confuse the operator.
2. **Replace enum with TAT outright** (the owner's idea) — cleanest single concept; downside: a breaking model change across web/MIS/mobile.
3. **Hybrid (recommended for migration safety):** TAT buckets are authoritative; derive a back-compat priority label (`4–6h→URGENT, 8–12h→HIGH, 24h→MEDIUM, 48h→LOW`) so legacy readers and the un-rebuilt mobile app keep working while the TAT fields roll out, then retire the label.

## Migration

- Forward, additive migration: add `tat_hours`/`due_at` + `tat_policies`; **map existing enum → default TAT** (owner-confirmed, e.g. `URGENT→4h, HIGH→8h, MEDIUM→24h, LOW→48h`); backfill `due_at` for open tasks from `assigned_at + mapped_tat`.
- Keep `priority` column populated (derived) through the transition; retire it only after web + MIS + a mobile release all read TAT.

## Consequences / risks

- **Mobile back-compat is the main risk** — must keep emitting a priority-shaped value (or gate on a rebuilt app via `min_supported_version`) so the field fleet isn't bricked. Additive-only per ADR-0011.
- Web + MIS rework (creation pickers, badges, SLA columns).
- A configurable bucket master is required if buckets must be business-editable.
- `due_at` semantics need a decision: **wall-clock vs business-hours** (the location/shift-window logic already models IST shift hours — TAT may want to honor it).

## Open questions (for sign-off)

1. Exact bucket set (is `4/6/8/12/24/48h` final? per client/product?).
2. Enum→TAT mapping for the backfill.
3. Task-level (as today) or also case-level TAT?
4. Wall-clock vs business-hours for `due_at`/overdue.
5. Does revisit/recheck reset the TAT clock?

## Sign-off required

Per the freeze, this proposal does **not** proceed to build until **CTO + domain-owner** approve and it is reconciled against the data model + MIS/billing owners. On approval, a build spec + plan are written and this ADR moves to *Accepted*.
