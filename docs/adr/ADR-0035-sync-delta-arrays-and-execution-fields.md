# ADR-0035: Sync down-sync delta arrays + per-task execution fields

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

`GET /api/v2/sync/download` (ADR-0012 locked mobile contract, lifecycle slice 2c)
serves the field device one row per assigned task plus a `{ success, message, data }`
envelope whose `data` carries delta arrays (`revokedAssignmentIds`, `deletedTaskIds`,
`deletedCaseIds`) and whose per-task objects carry execution fields (`completedAt`,
`inProgressAt`, `savedAt`, `isSaved`, `formData`, `attachmentCount`).

Until now these were stubbed: the delta arrays were hardcoded `[]` (placeholder from
the read-model slice, ADR-0012) and the per-task execution timestamps were omitted.
This is the slice 2c-2 tail — populating them now that the lifecycle (assign / reassign /
device start / complete / revoke) produces the underlying state.

A re-audit of the **authoritative device consumer** (`crm-mobile-native`,
`src/sync/SyncDownloadService.ts` + `SyncConflictResolver.ts`, read-only reference)
established exactly how the device consumes each field — see Decision. The risk the
kickoff flagged ("device consumption under-specified") is resolved by that audit.

## Decision

**1. `revokedAssignmentIds` = purge-orphan signal.** Emit the UUIDs of tasks the device
user *was* assigned but no longer is (reassigned or unassigned away) since the watermark.
Source: append-only `task_assignment_history` rows where `previous_assigned_to = device
user`, `created_at > cutoff`, and the task's **current** `assigned_to IS DISTINCT FROM`
the user (covers REASSIGNED-away and UNASSIGNED; excludes reassigned-then-back, which
still flows in `cases`). The device matches these on its local `verification_task_id`
column (= the task UUID) and **purges** the orphan (it has fallen out of the
`assigned_to = me` `cases` filter, so it would otherwise rot locally). The `cases`
upsert set and this purge set are **disjoint by construction** (current `assigned_to = me`
vs `≠ me`), so there is no upsert/purge race on the device.

**2. `deletedTaskIds` / `deletedCaseIds` stay `[]`.** v2 has no hard task or case delete.
Critically, a **REVOKED-but-still-assigned** task is NOT a purge: it keeps
`assigned_to = me` and reaches the device through `cases` with `isRevoked = true`, which
drives the device's *keep-the-row* cleanup (deletes attachments/forms, keeps the task
visible as revoked). Putting it in `revokedAssignmentIds` would wrongly purge the row.

**3. Execution fields: emit `completedAt` (← `case_tasks.completed_at`) and `inProgressAt`
(← `case_tasks.started_at`).** The device's `SyncConflictResolver` preserves local pending
state (it checks `sync_status` / `local_updated_at` and keeps local edits when an upload
is in flight), so emitting these is safe; they re-hydrate completion/start time after a
local wipe (recovery / retention / reinstall). Omitted when null (v1 wire).

**4. Do NOT emit `formData`.** `case_tasks.form_data` holds the device's **own** submitted
verification evidence (slice 2c-2b). The device has **no conflict resolution** on the
incoming `formData` → it would blindly overwrite the local `tasks.form_data_json`. There
is zero benefit (it is the device's own data echoed back) and a real UX-corruption risk if
any device code reads `form_data_json` as the current draft. Device drafts live in the
`form_submissions` table, untouched either way. `isSaved`/`savedAt` are mobile-only
concepts with no v2 source — left device-owned (`isSaved` stays hardcoded `false`; the
conflict resolver preserves a local `is_saved = 1`).

**5. Compute the delta on the first page only (offset 0).** The device restarts every sync
cycle at offset 0 (it persists the watermark only after a full cycle), and the device-side
purge is idempotent + `recentlyCleaned`-deduped, so repeating the (otherwise unbounded)
history query per page is wasteful.

**6. Supporting index (mig 0057).** `task_assignment_history` is append-only and grows
unbounded; its existing index is `(task_id, created_at DESC)`, which does not serve the
`previous_assigned_to` predicate. Add `idx_task_assignment_history_prev
(previous_assigned_to, created_at)`.

No SDK contract change (the `MobileSyncTask` / `MobileSyncDownload` types already declared
these fields optional) and no new route — so no OpenAPI surface change.

## Consequences

- The slice-6 mobile rebase stays **path-only**: the wire shape, keys, and id semantics
  are byte-compatible with what the device already consumes.
- `revokedAssignmentIds` now correctly cleans up reassigned-away tasks on the device,
  closing the orphan-rot gap.
- **DON'T-REGRESS:** `revokedAssignmentIds` carries reassigned/unassigned-away task UUIDs
  ONLY — never a revoked-but-still-mine task (that flows via `cases` + `isRevoked`); the
  `cases` filter and the revoked set must stay disjoint; `formData` must NOT be echoed to
  the device; the delta is offset-0-only because the device cycles from offset 0.
- **CARRY:** if the device ever resumes a cycle from offset > 0 (it does not today), the
  offset-0-only delta would be missed — revisit if the device's cycle semantics change.
