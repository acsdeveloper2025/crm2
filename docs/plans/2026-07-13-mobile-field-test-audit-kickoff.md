# Kickoff — Mobile field-agent live-test: audit & diagnose 4 issues (AUDIT-FIRST)

> Paste into a fresh session. **This is DIAGNOSE-FIRST**: root-cause each issue with code evidence,
> present findings + proposed fixes for owner sign-off, and DO NOT change code / release / write live DB
> until approved. Work as CTO + multi-agent team (spawn parallel reader agents per issue).

## Context — what happened
Live field test of the **CRM2 mobile app** (`crm-mobile-native` — the React Native app; a **separate repo**
from crm2, a first-class `/api/v2` consumer). We installed it on **one real field agent's device** and
assigned **one real task**. The task **assigned + delivered OK**, and the agent **completed and submitted**
it. During the run he reported **4 issues** (below).

- The case: **CASE-000002-1 · RESIDENCE VERIFICATION · TAFSEER AHMED TEHRIR AHMED KHAN**, address Mira Road
  East / Naya Nagar / Geeta Nagar, Mira Bhayandar, Maharashtra 401107; captured **Mon 13 Jul 2026 ~06:55–06:59
  PM IST**; **5 field photos with GPS overlays present and synced**.
- Environment: **CONFIRM FIRST** — which env the device points at (prod `crm.allcheckservices.com` vs
  staging). Inspect that env's live data for CASE-000002 to ground the diagnosis.

## The 4 issues to audit + diagnose

### 1) Session logs the field user out ~every 10 minutes (idle-logout wrongly applied to mobile)
- We added an **idle-logout** timeout; on the field agent's phone it logs him out roughly every ~10 min.
- **Intended behavior:** idle-logout must **NOT** apply to field / mobile users. A field agent should stay
  signed in and only re-authenticate about **every 30 days** (long device-trust window).
- Investigate: the mobile session/token lifetime + idle-timeout logic; the API access/refresh token TTL,
  `tokens_valid_after` kill-switch (ADR-0076), the **per-role trust windows + deviceId trust** from OTP login
  (ADR-0088 / memory `project_otp_auth_2026_07_04`). Where is the ~10-min idle timeout, does it (wrongly)
  cover the mobile/field role, and what governs the 30-day field window? Propose a fix giving field users a
  ~30-day session with no idle logout, **without weakening web idle-logout** (web `idle-logout.spec.ts`).

### 2) Newly-assigned task doesn't reach the "Assign" tab until app restart
- Task arrived → it **showed in Notifications** (push). Pressing **"Sync task"** did **NOT** move it into the
  **Assign tab** immediately — the Sync button spun for a while and nothing appeared. Only after **fully
  restarting the app** did the task appear in the Assign tab.
- Investigate: the mobile **sync-pull / task-fetch** flow and the **Assign-tab query + cache invalidation**.
  Why does a cold start surface the task but manual "Sync task" doesn't? (sync not actually pulling
  assignments, stale local query not re-run, cache/observer not invalidated, or a race between the push
  notification and the sync). Propose a fix so "Sync task" reliably pulls **and surfaces** new assignments
  with no restart.

### 3) Captured photos can't be deleted
- On the device, deleting a captured field photo does nothing — the photo stays.
- Investigate the mobile **photo capture + delete** path (op-sqlite rows + on-device file/thumbnail storage;
  mind the **attachment-vs-photo** distinction, memory `project_attachment_vs_photo_terminology`, and the GPS
  watermark/overlay pipeline). Why doesn't delete remove the DB row / file / UI tile? Propose the fix.

### 4) Submission slow / stuck: CASE-000002 still "In Progress", report not (fully) generated
- The agent **submitted CASE-000002**, but server-side it still shows **In Progress** (expected **Submitted**)
  and the **field report is not fully generated** — even though **all 5 photos synced and show properly**.
- Note the contradiction to resolve: the admin case-detail view shows the photos **and** a label
  "**GENERATED REPORT · STANDARD RESIDENCE**", yet status is still In Progress and the owner says the report
  isn't really generated. Determine whether that is a **finalized** report or just a preview / fallback
  template (FIELD_REPORT falls back to 9 built-ins, ADR-0079), and why the **status transition** and
  **report snapshot** didn't complete.
- Trace the full pipeline: mobile **sync-queue upload** of the completion/submission (idempotency —
  `project_idempotency_4xx_no_cache`) → API **submit/complete** endpoint → **status transition**
  (In Progress → Submitted) → **FIELD_REPORT snapshot frozen at submission** (ADR-0080) + report-generation
  job (BullMQ / `platform/jobs`). Did photos upload but the completion mutation never land / partially land?
  Is the report job never enqueued, failing, or ordered after the status check? **Inspect CASE-000002's live
  server state**: the case row status, its `verification_tasks`, the `field_report` row, attachments/photos,
  and the sync/outbox + job-queue state.

## Where to look
- **Mobile repo `crm-mobile-native`** (separate from crm2 — **find it on this machine**, likely under
  `~/Downloads/` as a sibling of crm2; ask the owner if unsure). Device-side of issues 1–4: auth/session +
  idle-timeout, sync queue + task pull + Assign-tab query, photo capture/delete, submission upload.
- **crm2 API** (`/Users/mayurkulkarni/Downloads/crm2`): `apps/api/src/modules/{auth,verification-tasks,cases,
  caseReports,fieldReports}`, the submit/complete endpoints + status transitions, FIELD_REPORT generation,
  `platform/jobs` (BullMQ), token/session + `tokens_valid_after` config, per-role trust windows.
- **Read first:** `CLAUDE.md` → `CRM2_MASTER_MEMORY.md` §8. **Load memory:** the `start-mobile` skill +
  `project_otp_auth_2026_07_04`, `project_security_hardening_2026_06_27`, `project_field_report_snapshot_2026_06_30`,
  `project_field_report_fallback_2026_06_30`, `project_mobile_form_source_of_truth`,
  `project_idempotency_4xx_no_cache`, `project_attachment_vs_photo_terminology`. ADRs: 0054 (mobile contract),
  0076 (security), 0079/0080 (field report), 0088 (OTP). Live-DB/ops access is in `secrets/CREDENTIALS.md`
  (SSH → prod RDS via the EC2 box; staging `crm2_db` container) — read-only for the CASE-000002 inspection.

## Deliverable (STOP for owner sign-off)
For **each** of the 4 issues: **root cause** (code evidence, file:line, which repo/layer), **proposed fix**
(and whether it needs a **mobile release**, an **API change**, a **migration**, or just **config**), and
**risk / blast-radius** — never break the `/api/v2` mobile contract (additive-only); mobile ships are
release-gated. Confirm the environment and report CASE-000002's live state. Present all 4 diagnoses + fixes
first; only build slice-by-slice after approval.

## Standing rules
Cave mode (minimal tokens) · **ask before push / deploy / tag / merge / live-DB writes** (the build itself =
autonomous CTO: decide + execute) · test-first, `pnpm verify` green for API changes · surgical / minimal, no
guessing · never break mobile · update `CRM2_MASTER_MEMORY.md` §8 + Claude memory at ship.
