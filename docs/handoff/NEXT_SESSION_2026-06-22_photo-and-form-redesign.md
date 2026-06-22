# Next-session kickoff — FE form-detail display (v1-structured) + field-photo display (GPS-Map-Camera-style) + downloads

_Paste the block below as the first message of the next session. Saved here for reference._

---

**CRM2 — build (multi-agent): (A) make the FE form-detail display structured like v1 (not "any field anywhere"), and (B) redesign the field-photo display in the GPS-Map-Camera style — map + detailed address + lat/long + timestamp overlay, per-image + bulk download with a strict naming convention, click-to-save, and an image refresh. Then CEO + CTO + Designer review.**

Architecture is FROZEN — build only; a change to a frozen decision needs a superseding ADR + CTO sign-off. Reuse, don't reinvent. Surgical, minimal, no guessing. Commit only at green gates; **never push/deploy without explicit OK.**

## BOOT — read in this order (don't bulk-read; route on demand)
1. `CLAUDE.md` → memory `MEMORY.md` + the 5 always-load rule files (esp. `feedback_use_karpathy_guidelines`, `feedback_no_guessing`, `feedback_browser_verify_perform_actions`, `feedback_ask_before_acting`, `feedback_cave_mode`, `feedback_follow_repo_structure`).
2. Memory: **`project_field_report_mapping_audit_2026_06_22`** (this whole stream — what shipped + open findings), `project_v2_native_mobile_contract_2026_06_20`, `project_mobile_v2_integration_fixes_2026_06_18`.
3. ADRs: **ADR-0039** (FIELD_REPORT engine) · **ADR-0057** (render canonicalization, shipped) · **ADR-0040** (field-photo reverse-geocode, frozen address, async/DLQ) · **ADR-0034** (device field-photo upload) · **ADR-0041** (case report engine).
4. The audit: `docs/audit-2026-06-22/` (README + layer1-4 + v1-report-contract-spec.md).

## WHAT ALREADY SHIPPED (2026-06-22, this stream — origin/main `836fed3`, mobile `feat/v2-native-sync` `afece69`)
- **ADR-0057** — FIELD_REPORT narrative now renders for v2-native device payloads (derive verbose outcome label from code+status field; recombine split `<base>Value/<base>Unit` periods; render-time only, stored data untouched). Verified E2E on a real device.
- **Issue 2** — field photos excluded from the general `/cases/:id/attachments` list (`kind IS DISTINCT FROM 'FIELD_PHOTO'`); they live only in the Field Photos card.
- **Mobile** — removed the redundant **Completed** tab (5-tab field nav); dashboard 4th card **Completed→Submitted**, sourced from the `dashboard_projection` cache (migration v21). Revoke rule confirmed correct (Assigned/In-Progress only, both layers).
- Full lifecycle (login→assign→in-progress→submit→revoke + sync) verified on the real device.

## OPEN ITEMS CARRIED OVER (check/decide)
- **Recurring SyncEngine stalled-cycle bug (HIGH VALUE):** on most app launches the periodic sync stalls; the watchdog detects it but never clears the lock — only force-stop+relaunch recovers. Worth its own fix (see `src/sync` SyncEngine watchdog/lock + the on-launch periodic-sync trigger). Hit ~5× this session and it blocks every device test.
- **Mobile APK not rebuilt for release** — the last device run was Metro/debug. A clean release build is pending.
- Local-DB FK corruption can accumulate from repeated restarts → sync-download FK fail; recover with `adb shell pm clear com.crmmobilenative` + full resync (backend payload is fine).
- SAVE-for-offline visual not demoed (its trigger is a long-press/swipe, not a button) — verify it if relevant.

## THE WORK — two features + a review pass

### A) Form-detail display = STRUCTURED like v1 (not "any field anywhere")
**Problem:** the web shows form data as a flat dump. The backend `buildSections` (`apps/api/src/modules/fieldReports/sections.ts`) does GENERIC introspection — one section per slug, every primitive field as an unordered `Label: value` row. v1 grouped the same fields into meaningful, ordered sections per verification type (Property & Personal Details, Employment/Office, TPC, Locality, Area Assessment, Conclusion, etc.) with proper labels.
**Do:** design a v1-faithful, per-type STRUCTURED form-detail view — grouped sections, sensible field order, human labels — replacing the flat dump on the web case-detail Field-Report card (`apps/web/.../CaseDetailPage.tsx`, the `sections[]` render). Decide where the grouping lives (a typed section map in the SDK like `fieldReportDefaults`, or backend `sections.ts`) so it's config-driven, not hardcoded per page. **Reference v1:** `CRM-APP-MONOREPO-PROD/CRM-BACKEND/src/utils/comprehensiveFormFieldMapping.ts` + `residenceCumOfficeFormFieldMapping.ts` + `createComprehensiveFormSections`, and the v1 frontend's form-detail view. Cover all 9 FIELD_VISIT types. Don't copy v1 verbatim — design it cleanly for us, but match its grouping/ordering.

### B) Field-photo display = GPS-Map-Camera style (designed for us), with downloads
Target look = gpsmapcamera.com (see the owner's reference photo): each photo has a bottom overlay containing a **map inset**, **detailed address**, **lat/long**, and **timestamp**. Build OUR branded version — not a copy.
1. **Overlay per photo:** a Google **map inset** (static map thumbnail of the lat/long, bottom corner) + **detailed reverse-geocoded address** (FULL: building/area/locality/sub-area/city/state/PIN/country — e.g. "D1, Yashaswi Nagar, Dhokali, Thane West, Mumbai, Maharashtra 400607, India") + **Lat/Long** (6 dp) + the **capture timestamp** with timezone (e.g. "Monday, 22/06/2026 01:54 PM GMT +05:30").
2. **Detailed address fetch:** the current ADR-0040 reverse-geocode stores a single frozen string — make the fetch DETAILED (Google `formatted_address` + components, or a richer stored shape). Keep the frozen-address invariant (immutable once set; async/DLQ). Decide: store the richer address vs. fetch components on view.
3. **Download — strict naming convention** = `<caseId/caseNumber>_<VID/VTid>...` (caseId + verification-task id in the filename; include a photo identifier/type/index for uniqueness):
   - a **download button below each image**;
   - a **single "Download all" side button** for the whole case — same naming convention (zip the set);
   - **click an image → open fullscreen → save** → same naming convention.
4. **Image refresh:** a refresh control to re-fetch presigned URLs (they expire) / re-render — a fresh session must be able to reload images.

Surfaces: web case-detail **Field Photos card** (`apps/web/.../CaseDetailPage.tsx`, `MobileReportSection`/field-photos render; SDK `packages/sdk/src/cases.ts` FieldPhoto + the `/cases/:id/field-photos` read-model in `apps/api/.../cases/repository.ts`). The case-report/template-report (ADR-0041) PDF/print render may also need the overlay — confirm scope with the owner.

### C) Review + speed
- Build via the **multi-agent BUILD_METHOD** (`docs/governance/BUILD_METHOD.md`) — fan out specialist agents on disjoint files (form-grouping, photo-overlay, address-fetch, download/zip, refresh).
- **After the build, run independent CEO + CTO + Designer review agents** (the owner's standard gate) — adversarially verify against the deployed code + a real artifact (a real geo-tagged photo + a real form submission).
- **Don't stop at tests** — browser-verify on the web preview AND device-verify the photo overlay/address with a real submission.

## ENVIRONMENT
- Local: `docker compose up -d dev-db minio minio-init`; api `:4000` (`.env` → crm2_dev, admin/admin123); web `pnpm --filter @crm2/web dev` (`:5273`, vite proxy `/api`→`:4000`). Gate: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm verify`. CI `ci` workflow (e2e/Playwright) is NOT in `pnpm verify` — check it too before push.
- Reusable dev data in crm2_dev: active FIELD_REPORT layout (id 1, RESIDENCE, HDFC/Home Loan); case **CASE-000007** (`16398ba6-4811-40d1-bb8b-40fdfe3bff95`) with a real submitted RESIDENCE task (CASE-000007-1) + 6 geo-tagged photos (lat 19.2227 / lng 72.9831, reverse-geocoded to a Thane address). Field users smokefa/Smoke@12345, smokefb/Field@12345.
- Device E2E (when needed): re-apply the temp dev config in `crm-mobile-native/src/config/index.ts` (`development` → `http://localhost:4000/api/v2` + `ws://localhost:4000`; network_security_config already permits localhost cleartext), `adb -s RZ8M813301M reverse tcp:4000 tcp:4000` + `tcp:8081 tcp:8081`, start Metro, login smokefa. **REVERT that config before any mobile commit/push.** GPS reverse-geocode needs `GOOGLE_GEOCODING_API_KEY` (the dev box has one → addresses resolve live).

**FIRST ACTION:** read memory + the ADRs above; restate the two features (A form-grouping, B photo-overlay+downloads+refresh) + the review pass; then launch the multi-agent build and report a plan before large edits.
