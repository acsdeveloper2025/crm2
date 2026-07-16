# Kickoff — CRM2: auto-revoke stale ASSIGNED / IN_PROGRESS tasks

- **Date:** 2026-07-16 · **Repo:** ✅ **`crm2`** (this repo, `/Users/mayurkulkarni/Downloads/crm2`) — server-side.
  The **mobile half is already done and verified** (see §3); do not redo it.
- **Owner's ask (verbatim):** *"for assign and inprogress task older that 45 days make them auto revoke so
  backend user understand task auto revoke"*
- **Severity:** 🟠 today a stale assignment lives forever. Nobody is told, nothing reclaims it.

---

## 1. Why this exists (the bug that produced the ask)

The mobile app runs a 45-day retention sweep. Its query (`listOldTaskIdsHybrid`,
`crm-mobile-native/src/repositories/DataCleanupRepository.ts`) had **no status filter**, so a task
**ASSIGNED 46+ days ago that the agent never did** was **deleted off the device** — and because
down-sync is incremental (`GET /sync/download?lastSyncTimestamp=`), an unchanged task is never
re-sent, so **it never came back**. The agent silently lost work they still owed; the office never
learned. Verified on a device: a 46-day task was auto-deleted on app start (twice).

The owner's fix is better than "don't delete": **the server should auto-revoke it**, so a backend user
SEES `auto-revoked` and can reassign. The device then reaps it normally as REVOKED.

## 2. What to build (server side, this repo)

Auto-revoke `ASSIGNED` / `IN_PROGRESS` case_tasks whose age exceeds the window, **reliably and
centrally** — NOT on the device.

**Why server, not device (decided 2026-07-16):** a device-side revoke only fires when *that* agent
opens the app. If they are on leave or lost the phone, the task stays assigned forever — and the
backend user, the very person the owner wants informed, is never told. The server knows the age
regardless of the device.

**Design questions to settle with the owner BEFORE building:**
1. **Window** — reuse 45 days (mobile's retention) or a separate, shorter one? They are different
   concepts: "stop showing it on the phone" vs "this agent is not doing it". A task should probably be
   reclaimed *well before* it would have been purged. **Ask.**
2. **Trigger** — cron/scheduled job vs lazy-on-read. Cron is the only one that informs the office when
   nobody opens anything.
3. **The revoke reason** — `revokeTask(taskId, reason)` takes a **string from the active revoke-reason
   master list** (A2.4 widened it from an enum). So an auto-revoke reason row likely must EXIST in
   master data, or the write fails/attributes wrongly. Check `GET /reference/revoke-reasons` and the
   seed. Decide: new master row (e.g. "Auto-revoked — no action for N days") vs a dedicated column.
4. **Who is the actor?** `revoked_by` / audit needs a principal. A system/service user, or NULL with a
   distinguishing flag? The audit trail is append-only (see §5) — get this right the first time.
5. **Does it re-enter the assignment pool** automatically, or wait for a human? Owner said "so backend
   user understand" → surfacing it is the point; auto-reassign is probably NOT wanted.

**Governance:** this changes task lifecycle behaviour on a frozen surface. Expect a **superseding ADR +
CTO sign-off** (`docs/governance/LONG_TERM_PROTECTION.md`, `docs/ARCHITECTURE_GOVERNANCE.md`).
`/api/v2` is additive-only. Next ADR = **0095**, next migration = **0120** (per file-memory index —
re-verify before use).

## 3. ✅ Mobile side — ALREADY DONE (2026-07-16, uncommitted). Do NOT redo.

In `crm-mobile-native` (separate repo), `listOldTaskIdsHybrid` now reaps **terminal states only**:

```sql
AND status IN ('SUBMITTED', 'COMPLETED', 'REVOKED')
```

Meaning:
- The device **no longer silently deletes live ASSIGNED / IN_PROGRESS work**. Safe failure: an old
  assigned task simply stays on the phone, visible and workable, until the server revokes it.
- Once this server work ships, an auto-revoked task arrives as **REVOKED** via down-sync and is reaped
  by that same 45-day query. **No mobile change is needed when you ship this** — the contract is just
  "set status=REVOKED and let it sync".
- Every safety guard is unchanged and still applies: `sync_status='SYNCED'`, no un-synced attachment,
  no un-synced form_submission, no pending queue item. Un-uploaded evidence is never deleted.

**So the only thing missing is the server-side revoke.** Verify the mobile branch is committed/merged
before relying on it.

## 4. Where to look (crm2)

- `apps/api/src/modules/tasks/` — task lifecycle + revoke path (`repository.ts`, service, controller).
- Revoke reasons master: `GET /reference/revoke-reasons` (mobile reads it for the dropdown).
- `case_tasks` columns: `status`, `assigned_at`, `updated_at`, `submitted_at`, `completed_at`,
  `revoked_at` (mig 0119 added `revoked_at` for the TAT/held-time work — read that first, it is the
  closest precedent for "a status transition the office must understand").
- `docs/adr/` · `CRM2_MASTER_MEMORY.md` §8 (live status).
- Mobile's consumer side (read-only for you): `SyncDownloadService`, `MobileSocketService`
  (`TASK_REVOKED` WS push already exists → the app wipes local data + alerts the agent; **an
  auto-revoke will hit that same path — check the agent-facing copy still makes sense when no human
  revoked it**).

## 5. Landmines (learned the hard way, 2026-07-15/16)

- **MIGRATION BEFORE CODE** — deploys do NOT run migrations.
- **The append-only audit guard blocks deletes on prod** (a test-case delete was blocked; backups in
  `~/crm2-prod-backups/`).
- **N hand-typed copies drift — always.** This exact session found: the overdue rule in 4 copies (2 wrong),
  the mobile dashboard count SQL in 2 copies (Bug-31 fix in only one), the task_list_projection writer in
  2 copies (one missing `sync_status`), and a **dead** `listOldTerminalTaskIds` that looked like the real
  retention rule — editing it changed nothing and cost a full debug cycle. **One definition, imported.**
  If you add an "is this task stale?" rule, write it ONCE (see `platform/tat/overdue.ts` +
  `TASK_OVERDUE_SQL` as the precedent to copy).
- **Verify on real data, not by reading.** Every claim in this file that mattered was wrong at least once
  until it was run.

## 6. Definition of done

A stale ASSIGNED / IN_PROGRESS task is auto-revoked server-side on a schedule; a backend user can see
**that it was auto-revoked** (and ideally when + why) and can reassign; the transition is auditable; it
down-syncs to the device as REVOKED where the existing 45-day sweep reaps it; the agent-facing revoke
alert reads sensibly for a system revoke; `pnpm verify` green + tests + CTO gate; ADR recorded and the
registry updated (`docs/COMPLIANCE_GAPS_REGISTRY.md`).

## 7. Standing rules

Cave mode · act as CTO (decide + execute) · **ask before push / deploy / tag / live-DB writes** ·
test-first, every regression test must FAIL on revert · **never break mobile** (`crm-mobile-native` is a
first-class `/api/v2` consumer) · commits: `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional,
**no AI trailer**, never `--no-verify`.
