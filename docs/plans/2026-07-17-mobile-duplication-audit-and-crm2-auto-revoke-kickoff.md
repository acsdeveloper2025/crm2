# Kickoff — 2026-07-17 · TWO items: (A) mobile duplication/dead-code audit · (B) crm2 auto-revoke

Two pieces of work, **two different repos**. A is the owner's priority; B is a carry-over that is
fully scoped and ready to build.

| | Item | Repo |
|---|---|---|
| **A** | Audit duplicated logic & dead code — *"in mobile app we save lot of duplicate funcion dead code or 2 or 3 copies of one code function we want to audit this in detail"* | ⚠️ **`crm-mobile-native`** (`/Users/mayurkulkarni/Downloads/crm-mobile-native`) — NOT crm2 |
| **B** | Auto-revoke stale ASSIGNED/IN_PROGRESS tasks — *"for assign and inprogress task older that 45 days make them auto revoke so backend user understand task auto revoke"* | ✅ **`crm2`** (server-side) |

**State at handoff (2026-07-16):**
- Mobile `main` = **`c53ad83`**, 6 commits, ⚠️ **UNPUSHED**. package.json says v1.0.73; last release
  **v1.0.81**. No version bump. The Save gate / consent gate / card changes need an install to reach agents.
- crm2 `main` = `16224d0`, clean. Next ADR = **0095**, next migration = **0120** (re-verify).
- Mobile gates: `npm run typecheck` · `npm run lint:src` · **8** `npm run contract:*` suites — all green.
- ⚠️ Mobile mig **23** (`sync_status` on `task_list_projection`) is in `df9d2e2` and self-applies on app upgrade.

---

# PART A — Mobile: audit duplicated logic & dead code

## A1. Why this is worth a session: it already cost us

**Not** a cleanliness exercise. Every item below was found *by accident* while fixing something else on
2026-07-15/16, and each had already produced a real defect or a wasted debug cycle. The pattern is
consistent: **a rule hand-typed into N places drifts, and the copy nobody tests is the one that lies.**

### Confirmed — FIXED this session (this is the shape of what to hunt)

| # | Duplication | What it cost |
|---|---|---|
| 1 | **"is this form complete?"** = Submit's validator + `formProgress`'s own re-implementation (**4 of 10 condition operators**, single-condition only) + **no copy at all in Save** | Save shipped with ZERO validation → an incomplete form entered the read-only Saved tab and became a trap. Fixed → one `evaluateFormCompleteness`. |
| 2 | **"5 photos / 1 selfie"** hard-coded in **4 places** (screen badges ×2, `FormSubmissionService`, `SubmitVerificationUseCase`) | Latent; any change would have drifted. Fixed → `MIN_VERIFICATION_PHOTOS` / `MIN_SELFIE_PHOTOS`. |
| 3 | **dashboard count SQL** in **2 copies** (`rebuildAll`, `rebuildDashboard`) — **already drifted**: the Bug-31 `is_saved` exclusion was in ONE | ASSIGNED/IN_PROGRESS cards changed value depending on which rebuild ran last. Fixed → `DASHBOARD_COUNTS_SELECT`. |
| 4 | **`task_list_projection` writer** in **2 copies** differing only by a `WHERE` | The pair that let `sync_status` be forgotten → a red **"Pending Upload"** on ~92 fully-synced cards. Fixed → `TASK_LIST_PROJECTION_INSERT` + mig 23. |
| 5 | 🔴 **`listOldTerminalTaskIds` — DEAD, and a near-twin of the live `listOldTaskIdsHybrid` directly above it** | **The worst kind.** It *read* as the retention rule. It was edited to change cleanup behaviour, the device test deleted nothing, and only then was it found to have **zero callers** — a full wasted cycle. Deleted. |
| 6 | **`clearAutoSave()`** — exists, exported on the context, **zero callers**; `SubmitVerificationUseCase`'s comment claims *"FormUploader deletes it after successful sync"* — **FormUploader contains no such code** | Auto-save PII (names, family, employment, GPS) persists indefinitely. **STILL OPEN** — see A3. |

**crm2 precedent (same week, same disease):** the "overdue" rule had **four** hand-typed copies; **two
had drifted**, so two screens disagreed about the same task. Fixed with one `TASK_OVERDUE_SQL`
(`platform/tat/overdue.ts`) imported everywhere — **copy that pattern.**

### Deliberately NOT unified — do not "fix" these

- **`formatRelative` exists twice** (`DiagnosticsScreen` → now `utils/relativeTime`, and
  `NotificationCenter`). **Genuinely different contracts**: notifications are always past and want
  *"just now"*; diagnostics needs a **signed** direction ("14m from now"). Forcing one breaks the other.
  **Similar ≠ same. Prove the contract matches before merging.**
- **`FILTER_TABS`** in `TaskListScreen` looks dead (its "Completed" chip never renders) — it is **NOT**:
  it is a lookup used at ~:200/:248 to resolve the active tab from route params. It was nearly deleted
  on that assumption. **Verify callers before deleting — grep the whole repo, including `.tsx`.**

## A2. Method (in order)

1. **Use a real tool, not a hand-rolled grep.** A naive "exported but appears in one file" scan was
   attempted at handoff and produced garbage (flagged `ApiClient`, `AuthService`…). Use **`knip`** or
   **`ts-prune`** (dev-dep or `npx`) — they understand the module graph. Dev tool ≠ runtime dep, but
   check `docs/governance` before adding one.
2. **Triage every candidate: DEAD (delete) · DUPLICATE (unify) · DIFFERENT-ON-PURPOSE (document, leave).**
   Nothing silently dropped.
3. **Diff the copies before unifying** — the interesting finding is usually that they *already disagree*
   (#3, #4). Record which copy was right and what the drift would have broken.
4. **Prove each DEAD candidate**: the tool's verdict **plus**
   `grep -rn "<symbol>" src --include='*.ts' --include='*.tsx'` (⚠️ zsh needs those globs quoted or it
   errors). Then delete — deletion over addition.
5. **One definition, imported**, in the layer that owns the rule (`utils/`, `platform/`) — not whichever
   file needed it first.
6. **Leave a runnable check** behind any non-trivial extracted rule. **No jest** (frozen stack): contract
   tests are `node --experimental-strip-types` scripts named `*.contract.test.ts` + an
   `npm run contract:<name>` script. There are **8**; `src/utils/fieldStatus.contract.test.ts` is the
   smallest template. **Every test must FAIL on revert — verify it, don't assume.**
7. **Pure logic must be extractable to be testable** — anything importing `react-native` cannot load in
   the contract harness. That is *why* `relativeTime`/`fieldStatus` live in `utils/`.

## A3. Known-open items to fold into this audit

- 🔴 **`clearAutoSave` is dead + its comment lies** (#6). The post-ack cleanup was clearly designed (the
  comment, the function, a 7-day purge in `DataCleanupRepository.clearCacheAndSyncTables`) and **never
  wired up**; that purge is reachable only via a manual tap in `DataCleanupManager`. Auto-save blobs
  live forever. **DPDP retention exposure** — the consent notice promises retention limits. Decide: wire
  it into FormUploader's ack path, or delete the dead function and own retention elsewhere. **Owner has
  not ruled.**
- **Evidence counting still isn't one predicate**: `SubmitVerificationUseCase` counts via
  `listForSubmission` (includes ABANDONED/SKIPPED) while the screen, the self-heal and
  `FormSubmissionService` filter through `isCountableAttachment` / `countCapturedPhotos`. Pre-existing; a
  5-photos-incl-1-SKIPPED task is "incomplete" to one and submittable to the other.
- **`SaveDraftUseCase` reads through the async projection** (`getTaskById` → `task_detail_projection`) —
  the same staleness `AutoSubmitSavedTasksUseCase` explicitly bypasses for bug 37/39. The draft path
  never got that fix.
- **The autosave pair is not redundant**: `useFormAutosave` awaits the DB write *then* the store write,
  so a DB failure writes neither. And `getAutoSavedForm` **strips the timestamp**, making the "use
  whichever draft is newer" branch unreachable — restore always takes the DB copy.

## A4. Definition of done (A)

A written inventory where **every** duplicated rule and dead symbol ends DEAD / UNIFIED /
DIFFERENT-ON-PURPOSE — none silently dropped; each unification has one definition plus a contract test
that fails on revert; each deletion is proven callerless; the drift found along the way is recorded;
gates green; nothing pushed without the owner's OK.

---

# PART B — crm2: auto-revoke stale ASSIGNED / IN_PROGRESS tasks

## B1. Why this exists

The mobile 45-day retention sweep (`listOldTaskIdsHybrid`) had **no status filter**, so a task
**ASSIGNED 46+ days ago that the agent never did** was **deleted off the device** — and because
down-sync is incremental (`GET /sync/download?lastSyncTimestamp=`), an unchanged task is never re-sent,
so **it never came back**. The agent silently lost work they still owed; the office was never told.
Verified on a device: a 46-day task was auto-deleted on app start (reproduced twice).

The owner's fix is better than "don't delete": **the server auto-revokes it**, so a backend user SEES
`auto-revoked` and can reassign.

## B2. What to build (server side)

Auto-revoke `ASSIGNED` / `IN_PROGRESS` case_tasks past the window, **reliably and centrally**.

**Why server, not device (decided 2026-07-16):** a device-side revoke only fires when *that* agent opens
the app. If they are on leave or lost the phone, the task stays assigned forever — and the backend user,
the very person the owner wants informed, is never told. The server knows the age regardless.

**Settle with the owner BEFORE building:**
1. **Window** — reuse 45 days (mobile's retention) or shorter? Different concepts: "stop showing it on
   the phone" vs "this agent is not doing it". Reclaim should probably happen *well before* purge. **Ask.**
2. **Trigger** — cron/scheduled job vs lazy-on-read. Only a cron informs the office when nobody opens anything.
3. **The revoke reason** — `revokeTask(taskId, reason)` takes a **string from the active revoke-reason
   master list** (A2.4 widened it from an enum). An auto-revoke reason likely must EXIST in master data
   or the write fails/attributes wrongly. Check `GET /reference/revoke-reasons` + the seed. New master
   row (e.g. "Auto-revoked — no action for N days") vs a dedicated column?
4. **Audit actor** — `revoked_by` needs a principal. System/service user, or NULL + a flag? The audit
   trail is append-only — get it right first time.
5. **Auto-reassign or wait for a human?** Owner said "so backend user understand" → surfacing is the
   point; auto-reassign probably NOT wanted.

**Governance:** changes task lifecycle on a frozen surface → expect a **superseding ADR + CTO sign-off**
(`docs/governance/LONG_TERM_PROTECTION.md`, `docs/ARCHITECTURE_GOVERNANCE.md`). `/api/v2` is additive-only.

## B3. ✅ Mobile side — ALREADY DONE (commit `5f515d6`). Do NOT redo.

`listOldTaskIdsHybrid` now reaps **terminal states only**:

```sql
AND status IN ('SUBMITTED', 'COMPLETED', 'REVOKED')
```

- The device **no longer silently deletes live ASSIGNED / IN_PROGRESS work**. Safe failure: an old
  assigned task stays on the phone, visible and workable, until the server revokes it.
- Once B ships, an auto-revoked task arrives as **REVOKED** via down-sync and is reaped by that same
  45-day query. **No mobile change needed** — the contract is just "set status=REVOKED and let it sync".
- Guards unchanged: `sync_status='SYNCED'`, no un-synced attachment/submission, no queue item.
  Un-uploaded evidence is never deleted.

⚠️ That commit is **unpushed** — confirm it is merged before relying on it.

## B4. Where to look (crm2)

- `apps/api/src/modules/tasks/` — lifecycle + revoke path.
- Revoke reasons master: `GET /reference/revoke-reasons`.
- `case_tasks`: `status`, `assigned_at`, `updated_at`, `submitted_at`, `completed_at`, `revoked_at`
  (mig 0119 added `revoked_at` for the TAT/held-time work — **read that first**, it is the closest
  precedent for "a status transition the office must understand").
- Mobile consumer (read-only for you): `SyncDownloadService`, `MobileSocketService` — a `TASK_REVOKED`
  WS push already wipes local data + alerts the agent. **An auto-revoke hits that same path — check the
  agent-facing copy still makes sense when no human revoked it.**

## B5. Definition of done (B)

A stale ASSIGNED / IN_PROGRESS task is auto-revoked server-side on a schedule; a backend user can see
**that it was auto-revoked** (when + why) and reassign; the transition is auditable; it down-syncs as
REVOKED where the existing sweep reaps it; the agent-facing revoke alert reads sensibly for a system
revoke; `pnpm verify` green + tests + CTO gate; ADR recorded; `docs/COMPLIANCE_GAPS_REGISTRY.md` updated.

---

# Shared rules & landmines

- **Cave mode**; act as CTO (decide + execute) — but **ask before push / deploy / tag / release /
  live-DB writes**.
- ⚠️ **Mobile is a first-class `/api/v2` consumer — never break the contract.**
- **MIGRATION BEFORE CODE** (crm2) — deploys do NOT run migrations.
- **The append-only audit guard blocks deletes on prod** (a test-case delete was blocked; backups in
  `~/crm2-prod-backups/`).
- **Verify on real data/device, not by reading.** Every claim in this file that mattered was wrong at
  least once until it was run — including two phantom "findings" that had to be retracted, and one
  "fix" applied to dead code.
- **Deleting is the point (A), but a wrong delete is a regression**: prove zero callers; extract & unify
  first (green), delete second (green) — never both blind in one step.
- Commits: mobile author `mayur2605 <mayurkulkarni786@gmail.com>` (match existing history), crm2
  `Mayur Kulkarni <mayurkulkarni786@gmail.com>`; conventional; **no AI trailer**; never `--no-verify`;
  commit only at green gates.
