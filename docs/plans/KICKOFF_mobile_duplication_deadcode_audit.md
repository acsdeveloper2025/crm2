# Kickoff — MOBILE: audit duplicated logic & dead code

- **Date:** 2026-07-16 · **Repo:** ⚠️ **`crm-mobile-native` — a SEPARATE repo** at
  `/Users/mayurkulkarni/Downloads/crm-mobile-native` (NOT crm2; this kickoff lives in crm2's
  `docs/plans/` only because that is where the owner's kickoffs live).
- **Mobile HEAD at handoff:** `c53ad83` (6 commits on `main`, **unpushed**, v1.0.73 in package.json /
  v1.0.81 released). crm2 `main` = `aae105e`.
- **Owner's ask (verbatim):** *"in mobile app we save lot of duplicate funcion dead code or 2 or 3
  copies of one code function we want to audit this in detail in new session"*

---

## 1. Why this is worth a session: it already cost us

This is **not** a hypothetical cleanliness exercise. Every item below was found *by accident* while
fixing something else on 2026-07-15/16, and each one had already produced a real defect or a wasted
debug cycle. The pattern is consistent: **a rule hand-typed into N places drifts, and the copy nobody
tests is the one that lies.**

### 1.1 Confirmed — FIXED this session (use these as the shape of what to hunt)

| # | Duplication | What it cost |
|---|---|---|
| 1 | **"is this form complete?"** existed as Submit's validator + `formProgress`'s own re-implementation (**4 of 10 condition operators**, single-condition only) + **no copy at all in Save** | Save shipped with ZERO validation → an incomplete form entered the read-only Saved tab and became a trap. Fixed → one `evaluateFormCompleteness`. |
| 2 | **evidence minimum "5 photos / 1 selfie"** hard-coded in **4 places** (screen badges ×2, `FormSubmissionService`, `SubmitVerificationUseCase`) | Latent; any change would have drifted. Fixed → `MIN_VERIFICATION_PHOTOS` / `MIN_SELFIE_PHOTOS`. |
| 3 | **dashboard count SQL** in **2 copies** (`rebuildAll`, `rebuildDashboard`) — **already drifted**: the Bug-31 `is_saved` exclusion was in ONE | ASSIGNED/IN_PROGRESS cards changed value depending on which rebuild ran last. Fixed → `DASHBOARD_COUNTS_SELECT`. |
| 4 | **`task_list_projection` writer** in **2 copies** differing only by a `WHERE` | The pair that let `sync_status` be forgotten → a red **"Pending Upload"** on ~92 fully-synced cards. Fixed → `TASK_LIST_PROJECTION_INSERT` + mig 23. |
| 5 | 🔴 **`listOldTerminalTaskIds` — DEAD, and a near-twin of the live `listOldTaskIdsHybrid` sitting directly above it** | **The worst kind.** It *read* as the retention rule. It was edited to change cleanup behaviour, the device test deleted nothing, and only then was it found to have **zero callers** — a full wasted cycle. Deleted. |
| 6 | **`clearAutoSave()`** — exists, exported on the context, **zero callers**; the comment in `SubmitVerificationUseCase` claims *"FormUploader deletes it after successful sync"* — **FormUploader contains no such code** | Auto-save PII (names, family, employment, GPS) persists indefinitely; the only purge needs a manual tap in Profile. **STILL OPEN** — see §3. |

**crm2 precedent (same week, same disease):** the "overdue" rule had **four** hand-typed copies; **two
had drifted**, so two screens disagreed about the same task. Fixed by one `TASK_OVERDUE_SQL` imported
everywhere (`platform/tat/overdue.ts`) — **copy that pattern.**

### 1.2 Deliberately NOT unified — do not "fix" these

- **`formatRelative` exists twice** (`DiagnosticsScreen` → now `utils/relativeTime`, and
  `NotificationCenter`). They have **genuinely different contracts**: notifications are always past and
  want *"just now"*; diagnostics needs a **signed** direction ("14m from now"). Forcing one would break
  the other. **Similar ≠ same. Prove the contract matches before merging.**
- **`FILTER_TABS`** in `TaskListScreen` looks dead (its "Completed" chip is never rendered) — it is
  **NOT**: it is a lookup table used at ~:200/:248 to resolve the active tab from route params.
  It was nearly deleted on that assumption. **Verify callers before deleting — grep the whole repo,
  including `.tsx`.**

## 2. Method (do this, in order)

1. **Use a real tool, not a hand-rolled grep.** A naive "exported but only appears in one file" scan
   was attempted at handoff and produced garbage (it flagged `ApiClient`, `AuthService`…). Reach for
   **`knip`** or **`ts-prune`** (dev-dependency, or `npx`), which understand the module graph. No new
   runtime dependency, no ADR needed for a dev tool — but check `docs/governance` before adding one.
2. **Triage every candidate into: DEAD (delete) · DUPLICATE (unify) · DIFFERENT-ON-PURPOSE (document
   why, leave).** Nothing gets silently dropped.
3. **For each DUPLICATE, diff the copies before unifying** — the interesting finding is usually that
   they *already disagree* (items 3 and 4 above). Record which copy was right.
4. **For each DEAD candidate, prove it**: `grep -rn "<symbol>" src --include='*.ts' --include='*.tsx'`
   (⚠️ in zsh those `--include` globs need quoting or they error out) **plus** the tool's verdict.
   Then delete — deletion over addition.
5. **One definition, imported.** Extract to the layer that owns the rule (`utils/`, `platform/`), not
   to whichever file happened to need it first.
6. **Leave a runnable check** behind any non-trivial extracted rule. The repo has **no jest** (frozen
   stack): contract tests are `node --experimental-strip-types` scripts named `*.contract.test.ts` with
   an `npm run contract:<name>` script. There are now **8**; copy `src/utils/fieldStatus.contract.test.ts`
   as the smallest template. **Every test must FAIL on revert — verify it, don't assume.**
7. **Pure logic must be extractable to be testable.** Anything importing `react-native` cannot be
   loaded by the contract harness — that is *why* `relativeTime`/`fieldStatus` are in `utils/`.

## 3. Known-open items to fold into this audit

- 🔴 **`clearAutoSave` is dead + its comment lies** (item 6). The post-ack cleanup was clearly designed
  (the comment, the function, a 7-day purge in `DataCleanupRepository.clearCacheAndSyncTables`) and
  **never wired up**; that purge is only reachable via a manual tap in `DataCleanupManager`. Auto-save
  blobs therefore live forever. **DPDP retention exposure** — the consent notice the agent accepts
  promises retention limits. Decide: wire it into FormUploader's ack path, or delete the dead function
  and own the retention story elsewhere. **Owner has not ruled.**
- **Evidence counting still isn't one predicate**: `SubmitVerificationUseCase` counts via
  `listForSubmission` (includes ABANDONED/SKIPPED) while the screen, the self-heal and
  `FormSubmissionService` filter through `isCountableAttachment` / `countCapturedPhotos`. Pre-existing;
  a 5-photos-incl-1-SKIPPED task is "incomplete" to one and submittable to the other.
- **`SaveDraftUseCase` reads through the async projection** (`getTaskById` → `task_detail_projection`,
  rebuilt asynchronously) — the same staleness `AutoSubmitSavedTasksUseCase` explicitly bypasses for
  bug 37/39. The draft path never got that fix.
- **The autosave pair is not redundant**: `useFormAutosave` awaits the DB write *then* the store write,
  so a DB failure means neither copy is written. And `getAutoSavedForm` **strips the timestamp**, making
  the "use whichever draft is newer" branch unreachable — restore always takes the DB copy.

## 4. Rules for this session

- **Cave mode**; act as CTO (decide + execute) — but **ask before push / release / tag**.
- ⚠️ **Mobile is a first-class `/api/v2` consumer — never break the contract.** Device-only work.
- **Deleting is the point, but a wrong delete is a regression**: prove zero callers, and prefer the
  boring order — extract & unify first (green), delete second (green), never both blind in one step.
- **Verify on the device, not by reading.** Every claim in §1 that mattered was wrong at least once
  until it was run — including two phantom "findings" that had to be retracted.
- Commits: author `mayur2605 <mayurkulkarni786@gmail.com>` (match existing history), conventional,
  **no AI trailer**, never `--no-verify`, commit only at green gates.
- Gates: `npm run typecheck` · `npm run lint:src` · all `npm run contract:*` (8 suites).

## 5. Definition of done

A written inventory where **every** duplicated rule and dead symbol ends in DEAD / UNIFIED /
DIFFERENT-ON-PURPOSE — none silently dropped; each unification has one definition plus a contract test
that fails on revert; each deletion is proven callerless; the drift found along the way is recorded
(which copy was wrong, and what it would have broken); gates green; nothing pushed without the owner's OK.
