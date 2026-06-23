# Next-session kickoff — push the mobile sync fix, then fix the local-DB FK-corruption (the real stall trigger)

_Paste the block below as the first message of the next session. Saved here for reference._

---

**CRM2 — continue the mobile sync stream + a couple of wrap-up decisions.** Architecture FROZEN — build
only; reuse, surgical, no guessing; **never push/deploy without explicit OK**; ask before live-DB/destructive ops.

## BOOT (in order, route on demand)
1. `CLAUDE.md` → memory `MEMORY.md` + the 5 always-load rule files.
2. Memory (this stream): `project_mobile_syncengine_stalled_cycle_fix_2026_06_22`,
   `project_crm2_devstack_migration_2026_06_23`, `project_field_photo_gps_overlay_form_grouping_2026_06_22`,
   `project_field_report_mapping_audit_2026_06_22`.
3. ADRs as needed: **0060** (field-photo overlay/downloads — Shipped) · 0040/0034/0041 (photo/report) · 0054 (v2-native mobile).

## WHAT SHIPPED / LANDED last session (2026-06-22/23)
- **ADR-0060** (web): v1-grouped field-report sections (all 9 types) + GPS-Map-Camera photo overlay
  (server-side Static-Maps proxy, per-image/zip downloads, refresh) + same overlay in the ADR-0041 report.
  **SHIPPED to prod** (origin/main `e58d711`, deploy+ci green, security-reviewed clean).
- **Mobile SyncEngine stalled-cycle fix** — **COMMITTED** `feat/v2-native-sync` `0e76579` (NOT pushed).
  Root cause: in-memory `syncInProgress` lock reset only in `_doSync` finally → a wedged await stuck it
  `true`, and every trigger/recovery gated on it → permanent stall until force-stop; + a TOCTOU in
  `performSync`. Fix: claim the lock synchronously (close TOCTOU) + bound `_doSync` via new pure
  `runWithTimeout` so performSync's finally always releases it + force-release on detected stall + abort the
  download pagination loop. Runner-free test `npm run contract:sync-lock` (4/4). typecheck/lint green.
  **Device-verified clean** (RZ8M813301M, `pm clear` → login smokefa → policy-accept → 2 syncs both
  "Downloaded Updates 5", lock released between them, no stall).
- **Local dev-stack migration** — the crm2 dev API was unknowingly running on the OLD `acs-crm-v2`
  containers (port collision). Migrated `crm2_dev`/`crm2_test`/bucket onto the real `crm2_*` containers,
  renamed bucket `acs-v2-dev`→`crm2-dev` (+ local `.env`), verified, removed the acs-crm-v2 stack + dead v1
  containers, STOPPED (kept) the v1 `crm_*`. **Dev stack is now `crm2_dev_pg` :54329 / `crm2_test_pg` :5433
  / `crm2_minio` :9000 (bucket `crm2-dev`).** Backups at `~/crm2-migration/` (61M; delete when confident).

## PENDING ITEMS (decide / do)
1. **Push the mobile sync fix?** `0e76579` is committed-not-pushed on `feat/v2-native-sync`. Pushing the
   branch is owner-gated; a release (signed build + staged canary) is separately gated. → decide push.
2. **`src/config/index.ts` dev→localhost — commit or keep local?** Left UNCOMMITTED. Owner: dev APK is
   separate and should hit localhost; but it reverses the prior committed "deployed dev server" decision —
   confirm, then either `chore(config): point the development build at the local dev stack` or leave local.
3. **[HIGH] Fix the local-DB FK-corruption** — the REAL trigger of the sync stall. On the device, a sync
   cycle wedges in the op-sqlite layer (all HTTP <0.1s) when the local DB is FK-corrupted (accumulates over
   repeated restarts); `pm clear` recovers it. The SyncEngine fix only BOUNDS/recovers a wedge (20min
   hard-timeout + warm-start force-release) — it does NOT prevent the corruption. Next: root-cause + fix the
   sync-download transaction (`SyncDownloadService.upsertTaskFromServer` + the stale-row migration / FK
   ordering in `DatabaseService.transaction`) so a sync-download can't leave orphaned FK rows.
4. **Mobile APK not rebuilt for release** — the fix ran via Metro/debug; a clean signed release build is pending.
5. **SAVE-for-offline visual not demoed** (minor, carried over).
6. **Docs commit** — ADR-0060 marked Shipped + README index + this handoff were committed last session
   (crm2 `docs:` commit); push with the next batch if not already pushed.
7. **Backups `~/crm2-migration/`** — delete once the migrated dev stack is confirmed solid over a few sessions.

## ENVIRONMENT (carried from last session — may still be live)
- crm2 dev API `:4000` (migrated crm2_* stack: crm2_dev DB :54329, MinIO :9000 bucket `crm2-dev`,
  admin/admin123; field users smokefa/Smoke@12345, smokefb/Field@12345). Web preview as usual.
- Gate: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm verify` (+ the CI `ci` e2e workflow). Mobile: `npm run contract:sync-lock` (+ `typecheck`/`lint`; the repo has NO jest, frozen).
- Device (when needed): RZ8M813301M is a debug+Metro build; `src/config/index.ts` dev→localhost (uncommitted),
  `adb -s RZ8M813301M reverse tcp:4000 tcp:4000 + tcp:8081`, Metro running, login smokefa via adb (ESCAPE
  (keyevent 111) between fields, NOT BACK — BACK exits the app). RN console only reaches the in-app LogBox.
  If a sync wedges → `adb shell pm clear com.crmmobilenative` (the FK-corruption recovery) → re-login.

**FIRST ACTION:** read memory + the pending list; confirm (1) whether to push the mobile fix and (2) the
config-commit decision; then start **#3 (the FK-corruption fix)** via systematic debugging — reproduce on
the device, root-cause the sync-download FK ordering, fix, and verify a sync survives repeated restarts
without `pm clear`.
