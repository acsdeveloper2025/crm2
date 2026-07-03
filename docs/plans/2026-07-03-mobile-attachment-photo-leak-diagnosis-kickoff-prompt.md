# Kickoff prompt — Diagnose & fix: field PHOTOS leak into the mobile "Attachments" view + the task-creation ATTACHMENT doesn't load (CASE-000024)

> Paste the block below as the first message of a **new session**. Modelled on the billing/keyboard-nav kickoffs.
> This is a **DIAGNOSE-FIRST bug hunt** (systematic-debugging), not a free build: reproduce → root-cause → surgical
> fix → regression test → verify on the mobile round-trip. A strong lead is already recorded in §2 — **verify it
> against the real data before changing code; do not fix blind.**

---

You are the CTO + multi-agent team for CRM2 (ACS verification CRM, live on crm.allcheckservices.com). Mission this
session: **fix a mobile bug in the "Attachments" surface** the owner observed on **CASE-000024**:

1. **Field-captured PHOTOS are showing under the "Attachment" button on mobile.** Attachments and photos are
   **separate concepts** and must not be mixed — the Attachments view should show only the office/creation-time
   reference documents, never the field agent's on-visit verification photos.
2. **The ATTACHMENT that was attached at task-creation time does NOT load** in that same mobile view.

Root-cause both, fix surgically (crm2 API is the prime suspect — see §2), regression-test, and confirm the mobile
round-trip. **No guessing — verify every claim against the code AND the CASE-000024 data before asserting it.**

## 0 — Rules (from CLAUDE.md, override defaults)
cave-mode (minimal tokens); **systematic-debugging** (reproduce first, form a hypothesis, prove it against real data,
then the smallest root-cause fix — one guard in the shared query, not a patch per caller); surgical/reuse-never-reinvent;
**test-first**, a phase is done only when **`pnpm verify` is green** (typecheck→lint→format→no-suppressions→boundaries→test→build)
+ the **API integration tests are green** (needs the `:5433` test DB, `LC_ALL=C`) + the relevant **Playwright e2e** if any
web surface is touched. **Ask before push/deploy/live-DB writes** (push→main auto-deploys to prod + runs migrations);
commits author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, **no AI trailer**, never `--no-verify`,
secret-sweep before push. No `any`/suppressions/`console.*`; centralized `@crm2/logger`; **raw SQL only in
repositories + migrations**; FE→API via `@crm2/sdk` only; **`/api/v2` is versioned + additive-only — NEVER break
mobile** (`crm-mobile-native`, separate repo, first-class `/api/v2` consumer). Next mig = `0113`, next ADR = `0087`.

## 1 — Pre-flight reads (in order)
CLAUDE.md → PROJECT_INDEX.md → CRM2_MASTER_MEMORY.md §8 → SESSION_KICKOFF.md. Then the domain SoT:
Claude memory **`project_attachment_vs_photo_terminology.md`** (the attachment⟂photo/selfie distinction — the load-bearing
invariant; note it was written for **v1** and v1 used *two* tables, but **v2 unified them into ONE `case_attachments`
table with a `kind` discriminator** — verify against current code), **`project_mobile_form_source_of_truth.md`** (mobile
form/photo invariants: 5 photos + selfie mandatory), **`project_mobile_roundtrip_audit_2026_06_24.md`** + **ADR-0061/0062**
(mobile round-trip fixes, incl. attachment/photo IDORs), **ADR-0075** (field-photo GPS overlay/downloads),
**ADR-0085** (KYC verifier attachments — the OFFICE_REF reference-doc path), **ADR-0054** (v2-native mobile contract),
`project_field_photo_overlay_download_2026_06_26.md`, and `project_geocoding_and_watermark.md`.

## 2 — Ground truth already mapped (VERIFY, then extend)

**The v2 data model — ONE table, a `kind` discriminator** (`db/v2/migrations/0042_case_attachments.sql` + the migration
that adds `kind`/`photo_type`): `case_attachments` holds BOTH concerns:
- `kind = 'OFFICE_REF'` → an office/admin/creation-time **reference document** (the "attachment"). Uploaded web-side
  (`cases` POST `/:id/attachments`, `case.create`) or at KYC task creation. **Read-only on mobile.**
- `kind = 'FIELD_PHOTO'` → a **device verification photo** captured by the field agent (`photo_type ∈ {verification,selfie}`),
  uploaded via `verification-tasks` POST `/:id/attachments` (written `kind='FIELD_PHOTO'`, carries GPS/watermark).

**The mobile "Attachments" endpoint** = `GET /api/v2/verification-tasks/:id/attachments` (`task.execute`-gated → the field
agent) → `verification-tasks/service.ts:162 listAttachments` (its JSDoc literally says *"List the office REFERENCE
docs for an owned task"*) → `casesRepository.attachmentsForDeviceTask(taskId, userId)` in
**`apps/api/src/modules/cases/repository.ts`**.

**⚠ THE PRIME SUSPECT (strong hypothesis — verify, don't assume):** `attachmentsForDeviceTask`'s query is missing the
`kind='OFFICE_REF'` filter that every sibling query has. Current shape:
```sql
SELECT ca.id, ca.original_name, ca.mime_type, ca.file_size, ca.created_at, ca.storage_key
  FROM case_attachments ca
  JOIN case_tasks ct ON ct.case_id = ca.case_id
 WHERE ct.id = $1 AND ct.assigned_to = $2 AND ca.deleted_at IS NULL
   AND (ca.task_id IS NULL OR ca.task_id = ct.id)          -- NO `AND ca.kind = 'OFFICE_REF'`
 ORDER BY ca.created_at DESC
```
Compare the siblings that DO discriminate (all in `cases/repository.ts`):
- `dashboard`/count query: `... AND ca.kind = 'OFFICE_REF' ...` (`~:1013`).
- web `listAttachments`: `... AND ca.kind IS DISTINCT FROM 'FIELD_PHOTO' ...` (`~:1698`).
- field-photo queries: `... AND ca.kind = 'FIELD_PHOTO' ...` (`~:1724/1756`).
⇒ Because `attachmentsForDeviceTask` doesn't restrict `kind`, it returns **FIELD_PHOTO rows too** → **symptom 1** (photos
show under the mobile Attachment button). This is a **crm2-side query bug**; the likely surgical fix is one guard:
`AND ca.kind = 'OFFICE_REF'`. **Confirm this is really the query the mobile hits, and that adding the guard doesn't hide
a legitimately task-linked OFFICE_REF doc.**

**Symptom 2 (creation attachment "does not load") — OPEN, investigate:** with the `kind` filter added, does the
task-creation OFFICE_REF doc actually come back? Check **how/where creation-time OFFICE_REF rows are written** — with
`task_id` set, or case-level (`task_id IS NULL`)? The device query's `AND (ca.task_id IS NULL OR ca.task_id = ct.id)`
returns case-level docs and docs pinned to THIS task, but **excludes a doc pinned to a *different* task in the same
case**. Determine (against CASE-000024) whether the creation doc is (a) present but drowned out by the leaked photos
(so "doesn't load" = a rendering artifact that symptom-1's fix clears), (b) linked to a task_id that the WHERE excludes,
(c) never persisted, or (d) failing to presign (`storage.signedUrl`) / mis-mapped on the device. Don't assume — trace it.

**Mobile side (`crm-mobile-native`, SEPARATE repo — read-only inspection unless the fix must land there):** find the
screen behind the "Attachment" button and which endpoint it calls. Confirm it consumes
`GET /api/v2/verification-tasks/:id/attachments` and renders the returned rows verbatim (so the server fix is
sufficient), vs. doing its own local merge of device photos into that list (which would need a mobile-side fix too,
owner-release-gated per ADR-0054). The field agent's *own* captured photos belong in the **form/gallery** surface, never
the Attachments list.

## 3 — Method (systematic-debugging)
(A) **Reproduce & localize first.** Pull CASE-000024's `case_attachments` rows (kind, task_id, case_id, deleted_at,
photo_type, original_name) from the DB it lives in (prod is read-only to you — if you can't reach prod, reproduce the
shape on the `:5433` test DB / `crm2_dev` by seeding: create a case, attach an OFFICE_REF doc at creation, assign +
device-upload FIELD_PHOTOs, then call `GET /verification-tasks/:id/attachments` and observe FIELD_PHOTO rows leaking).
Confirm symptom 1 (photos returned) and characterize symptom 2 (is the OFFICE_REF row returned or not, and why).
(B) **Root-cause both** precisely (query missing `kind` filter; task/case linkage for the creation doc). Write the
one-line failing assertion first. (C) **Fix at the shared source** (the repository query) — surgical; keep the IDOR/
ownership guards (`ct.assigned_to = $2`) intact; don't regress the KYC verifier's OFFICE_REF path (ADR-0085) or the
web/case attachment + field-photo endpoints (they already discriminate correctly — leave them). (D) **Regression test:**
extend `verification-tasks`/`cases` `__tests__` — a task with BOTH an OFFICE_REF creation doc AND ≥1 FIELD_PHOTO must
return ONLY the OFFICE_REF doc from the device attachments endpoint (assert the photo is absent AND the doc present),
and the field-photo endpoints still return the photos. (E) `pnpm verify` green + API tests green (`:5433`, `LC_ALL=C`).
(F) **Verify the mobile round-trip** — per `feedback_browser_verify_perform_actions`, don't stop at tests: exercise the
real endpoint (and, if reachable, the device path) and confirm the Attachments view shows only the doc and the doc loads.
Spawn parallel reader agents for the discovery (crm2 attachment/photo query map · the creation-time OFFICE_REF write
path · the mobile Attachments screen + its endpoint) so the change-sites are `file:line`-exact before editing.

## 4 — Tooling / local stack (reuse the console-audit memory verbatim)
colima + docker compose (or native brew Postgres: dev `:54329` `crm2_dev`, test `:5433` `acs_v2_test`, `LC_ALL=C`,
`createdb` if missing); API bg `pnpm --filter @crm2/api dev` (:4000, `apps/api/.env`); web via Claude Preview `web`
(:5273 → `/api` proxy 4000). Login: in-page `fetch POST /api/v2/auth/login` → tokens under `j.tokens` → seed
`localStorage` `acs.accessToken`/`acs.jti`/`acs.sessionStartedAt` → reload. admin/admin123; a FIELD_AGENT (device-role,
`task.execute`) is needed to hit `/verification-tasks/:id/attachments` as the mobile would — mint one via admin
`POST /users/:id/generate-temp-password {deliver:'view'}` or the `x-test-auth` seam in tests. Migrations via
`db/v2/migrations/` + the tracked runner (`migrate.sh`, `schema_migrations`).

## 5 — Deliverables + gate
- A written **root-cause** for BOTH symptoms (verified against CASE-000024's data / a faithful repro), the surgical fix,
  and a regression test that fails before / passes after. Prefer the crm2-side query guard; only touch
  `crm-mobile-native` if the mobile genuinely merges photos in client-side (then it's a separate, owner-release-gated
  change — ADR-0054).
- Each slice: `pnpm verify` green + API integration green (`:5433`) + the attachment/photo endpoints re-audited (device
  Attachments = OFFICE_REF only; field-photo endpoints = FIELD_PHOTO only; KYC OFFICE_REF path unbroken; IDOR guards
  intact) + mobile round-trip confirmed.
- Register the finding + disposition in `docs/COMPLIANCE_GAPS_REGISTRY.md`; update `CRM2_MASTER_MEMORY.md` §8 + the
  Claude memory (`project_attachment_vs_photo_terminology.md` → note the v2 unified-table + the fix). **Ask before
  pushing; never write the prod DB without explicit OK.**

Start by stating the current phase (`CRM2_MASTER_MEMORY.md` §8 + `git log --oneline -20`), then **verify the §2 prime
suspect against the code + CASE-000024's actual `case_attachments` rows** before writing any fix — reproduce first.

```

```
