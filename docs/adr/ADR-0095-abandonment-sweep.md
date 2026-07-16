# ADR-0095 — Auto-revoke abandoned tasks (the abandonment sweep)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Owner decision:** yes (window, data-loss, trigger tier — see below)
- **Supersedes:** nothing. **Related:** ADR-0033 (rework/reassign), ADR-0044 (TAT), ADR-0030 (jobs), ADR-0027 (notifications)

## Context

Owner, 2026-07-16: *"for assign and inprogress task older than 45 days make them auto revoke so backend
user understand task auto revoke"*.

The device's 45-day retention sweep used to delete **any** task older than 45 days regardless of status.
So a job **ASSIGNED 46 days ago that the agent never did** simply vanished off the phone — and because
down-sync is incremental (`?lastSyncTimestamp=`), an unchanged task is never re-sent, so **it never came
back**. The agent silently lost work they still owed, and the office was never told. Reproduced on a
device (twice).

Mobile is already fixed: it now reaps terminal states only (`SUBMITTED`/`COMPLETED`/`REVOKED`). Its
failure mode is now safe — an old assigned task simply stays on the phone, visible and workable. This
ADR is the other half: **the server takes the task back and tells the office.**

It cannot live on the device. A device-side revoke only fires when *that* agent opens the app; an agent
on leave or with a lost phone would hold the task forever, and the backend user — the very person the
owner wants informed — would never hear about it. The server knows the age regardless.

## Decision

An **hourly sweep in the `api` role** revokes `ASSIGNED`/`IN_PROGRESS` tasks whose `assigned_at` is more
than **45 days** old, as a system actor, and notifies the office user who dispatched them.

**No migration. No new column. No new dependency. No mobile change.**

### 1. Window — flat 45 days, anchored on `assigned_at`

The owner's number, and it matches the device's retention constant, so the two rules cannot disagree.

**"Abandonment" is deliberately not "overdue"** (`platform/tat/overdue.ts`). Two different rules that must
never share a word again — the last time they did, four hand-typed copies of "overdue" drifted and two
screens disagreed about the same task (ADR-0044 follow-up, 2026-07-15):

| | OVERDUE | ABANDONMENT |
|---|---|---|
| means | the agent is late — chase them | nobody is coming — take it back |
| measured against | the task's own `tat_hours` | one flat 45-day window |
| reversible | yes, submitting clears it | no, it revokes |

They are *allowed* to disagree: a 4h-TAT task is overdue within the day and abandoned only at 45 days.

Rejected: a multiple of `tat_hours` — an URGENT 4h task would die at 7.5d while a LOW 48h one survived
90, which is unpredictable for the office.

Anchored on `assigned_at`, **not** `started_at`: `IN_PROGRESS` predates `started_at` by 42 migrations
(0010 vs 0052) with no backfill, so anchoring there would skip precisely the oldest rows this exists to
catch. There is deliberately **no** `tat_hours IS NOT NULL` leg (unlike `TASK_OVERDUE_SQL`) — legacy
re-work rows were born with a NULL TAT, and an abandoned one of those is exactly what must be swept.

### 2. Trigger — an hourly `setInterval` in the `api` boot

This is crm2's first periodic, unattended writer, which is why this ADR exists at all.

- **Not the BullMQ jobs engine (ADR-0030)** — it is dead in prod: no worker container
  (`infra/prod/docker-compose.yml` has it commented out), no Valkey in `docker-compose.aws.yml`, and
  `main.ts` gates `startJobWorker` on `ROLE==='worker'`. Its `jobs` row also requires
  `created_by NOT NULL REFERENCES users` — an unattended sweep has no user.
- **Not node-cron** — a new dependency for one timer.
- **Not host crontab** — the trigger would live outside the repo and outside code review. The prod box
  has no crontab today (`renew-cert.sh` is staging-only; ALB/ACM owns TLS on AWS).
- **Not lazy-on-read** — down-sync selects on a watermark (`COALESCE(ct.updated_at, cs.updated_at) > $2`),
  so a computed label never bumps `updated_at` and never reaches the device. And an un-written task stays
  `ASSIGNED`, so `assignTask`'s PENDING guard makes it unassignable. **A write is mandatory.**

**Hourly, not daily:** a deploy recreates the container and `restart: unless-stopped` re-anchors the
timer's phase, so a long interval on a frequently-deployed box could never fire. Hourly bounds that loss
to one tick against a 45-day window — which is why this needs no watermark table.

It is registered in `main.ts`'s `ROLE==='api'` branch, **not** `registerJobs()`: `createApp` calls that
too, so a timer there would fire in every test process and double-fire the day the worker container is
uncommented. (There is only ever one `api` container — `container_name: crm2_api` is a fixed literal, so
Docker cannot run two. "Blue-green" is a misnomer the repo's own audit already filed.)

### 3. Reason — a free string, not a master row

`case_tasks.remark` has no FK/CHECK and both existing revoke paths already write a plain string there.
`AUTO_REVOKE_REASON = 'AUTO-REVOKED — NO ACTION FOR 45 DAYS'`, uppercase to match the office path (which
uppercases via zod; the sweep calls the repository directly and bypasses that).

**Rejected: a new `revoke_reasons` row.** That table's only reader filters `is_active = true` and feeds
the **field agent's** revoke picker — an active row would let an agent claim their own task was
"auto-revoked", and an inactive row would be invisible to the only reader that exists.

**Rejected: an `auto_revoked` column.** The string is the flag. Add a column when someone needs to
filter/report on auto-revokes.

### 4. Actor — a nil-UUID system principal, no seeded user

`case_tasks.updated_by` is `uuid` with **no foreign key** (mig 0010:62 — contrast `assigned_to uuid
REFERENCES users(id)` two lines above), deliberately so the dev/test synthetic actor ids work. So the
sweep records `SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'`: a valid UUID literal, no
`users` row, no fake person.

It **must** be a UUID — the same id feeds `updated_by` (uuid), the audit row (text) and the case rollup's
`cases.updated_by` (uuid); the string `'SYSTEM'` raises 22P02.

**Not `...0001`** — that is the seeded SUPER_ADMIN *login account*; attributing an unattended sweep to it
would put a real human's name on the audit row.

**Rejected: seeding a SYSTEM user (a migration).** It buys only the device's "By: SYSTEM" line — the
office never renders `updated_by` at all. The display join degrades cleanly instead: `LEFT JOIN` → NULL →
the payload omits `revokedByName` → the device simply doesn't render the "By:" line.

### 5. No auto-reassign — the notification is the deliverable

The revoked row can never be re-assigned in place (`assignTask` requires `PENDING`); a human dispatches a
replacement via `reassignRevokedTask` (ADR-0033). Nothing in the system knows who to pick, and
auto-picking an agent for work that already sat 45 days would hide the exact fact the sweep exists to
reveal. The owner's words — *"so backend user understand"* — make surfacing the point.

So the sweep notifies **`assigned_by`** (the office user who dispatched it) — the device revoke path's
recipient, not the office path's, which notifies the agent. It **also** notifies `assigned_to`, whose
device drops the task on `TASK_REVOKED`.

It calls `caseRepository.revokeTaskInPlace` directly, **not** `casesService.revokeTask`: that resolves a
scope for its actor, and scope fail-closes an unknown role to SELF — a system actor would match no task
and silently revoke nothing. Going direct still reuses the audit row, the `revoked_at` stamp (mig 0119)
and the case-status rollup. Per-row, catching errors: the UPDATE's own
`WHERE status IN ('ASSIGNED','IN_PROGRESS')` is the race backstop and throws 409 on a task submitted
between the SELECT and the UPDATE — that row is skipped, not clobbered, and one race cannot abort the
batch.

## Consequences

**Accepted — an IN_PROGRESS auto-revoke destroys the agent's un-uploaded photos and form drafts** on that
device (the existing `TASK_REVOKED` path wipes local artifacts, ignoring pending-sync state). Owner
confirmed explicitly: at 45 days it is right to take the work back. This is the existing revoke
behaviour, unchanged — the sweep just triggers it without a human.

**The first run is a batch.** Every task already past the window revokes at once, each firing
notifications, so a per-tick cap (`ABANDON_SWEEP_BATCH = 200`, oldest first) drains the backlog across
ticks instead of one thundering herd.

**A task whose `assigned_by` is NULL auto-revokes with nobody told** — `notifyTaskLifecycle` no-ops on a
null recipient. Notifying `assigned_to` as well hedges it. Worth a count before shipping.

**Mobile: nothing to change** (verified end to end). The revoke bumps `updated_at`, so the task re-enters
the incremental watermark; `assigned_to` is deliberately kept, so it arrives as an UPDATE, not a purge;
the payload already carries `isRevoked`/`revokedAt`/`revokeReason`; and the device's own 45-day sweep
reaps it on the next pass because `REVOKED` is in its terminal set.

## Verification

`apps/api/src/platform/tat/__tests__/abandonSweep.api.test.ts` — 9 checks against real Postgres. Each
guard is revert-verified: dropping the status filter (the original bug — reap any old task) fails 4;
moving the window to 0 **or** 90 days fails the absolute-window test. That test exists because the
relative ones (`TASK_ABANDONED_DAYS ± 1`) moved with the constant and left 45→0 green.
</content>
