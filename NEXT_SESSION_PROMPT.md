CRM2 (v2) — CONTINUE THE FIELD-REPORT/PHOTO ENGINE BUILD → REMAINING = S4 Slice C + S5 (#9 CASE_REPORT
+ PDF/Word/Excel). Multi-agent Audit Panel + autonomous CTO. Act as CTO/orchestrator; cave mode; AUTONOMOUS
(decide+execute; standing "push and continue" auth — push verified+panel-passed slices with the trailer
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; only pause for architecture/stack
REOPEN or if the owner must genuinely choose). The owner steers actively — surface findings + a recommendation
at design checkpoints, don't barrel. Use AskUserQuestion for real forks.

STEP 0 — READ MEMORY FIRST. Read MEMORY.md + the always-load feedback files (use_karpathy_guidelines,
ask_before_acting, cave_mode, sql_live_db_apply, browser_verify_perform_actions) + feedback_crm2_autonomous_cto
+ project_crm2_multiagent_build_method (the 9-role panel + ledgers in crm2/docs/agents/*.md) +
project_acs_crm_v2_build (frozen). Then read project_crm2_operations_phase.md IN FULL — especially the
LAST ~10 entries (FIELD_REPORT S1→S2a→S2b→S3a→S3b→S3c b1/b2/b3, then S4 foundation→Slice A→Slice B, + the
v1-audit + ground-truth entries). Honor every DON'T-REGRESS + CARRY.

GIT: v2 in crm2/ (own .git; ALWAYS `cd crm2` before git/pnpm — cwd resets between turns).
**origin/main = a196c9a.** Verify `git log --oneline -6` (expect: a196c9a S4 Slice B async geocode queue+worker+DLQ ·
0c745f3 S4 Slice A on-view resolve+#7 caption · 3f61598 S4 foundation mig0065+ADR-0040 · bb0e1d1 S3c b3 NOC/DSA/BUILDER ·
ad45338 S3c b2 PROP_INDIV/APF · 0393777 S3c b1 OFFICE/BUSINESS/RCO). **next migration = 0066; next ADR = 0041.**

ENV (colima+docker; DBs/dev-API often down between sessions):
- `cd crm2 && colima start && docker compose up -d`; wait `pg_isready -h 127.0.0.1 -p 5433` AND `-p 54329`.
  Manually-applied dev migrations persist; migs 0001–0065 are applied on dev :54329 (mig 0065 = field-photo
  reverse-geocode: reverse_geocoded_address + freeze trigger + geo CHECK + reverse_geocode_dlq).
- Dev API :4000 → dev DB :54329 (db crm2_dev). **REDIS_QUEUE_URL is UNSET in dev → geocode runs in-process.**
  Restart if down (and ALWAYS after backend code changes — it does NOT hot-reload the compiled engine, bit me
  3×): `lsof -ti :4000 | xargs kill; sleep 2; set -a; . ./apps/api/.env; set +a; nohup pnpm --filter
  @crm2/api dev > /tmp/devapi.log 2>&1 &` then poll `curl -s -o /dev/null -w '%{http_code}'
  http://localhost:4000/api/v2/health` for 200 (~7s). x-test-auth in dev: header `x-test-auth: ROLE:uuid`
  (SUPER_ADMIN:00000000-0000-0000-0000-000000000001 ; FIELD_AGENT:00000000-0000-0000-0000-000000000002).
- Web preview :5273 via preview_start "web-v2" (serverId changes per session; admin auto-auth = SA). Vite HMR
  picks up SDK/FE changes; the dev API does NOT (restart it).
- VERIFY ORACLE: `cd crm2 && DATABASE_URL=postgres://postgres:postgres@localhost:5433/crm2_test pnpm verify`.
  DOCUMENTED ROTATING LOAD-FLAKE: a DIFFERENT unrelated api test file 5xx/socket-hangs/Parse-Errors each full
  run (this session hit cases.api, rates.api, reportTemplates.api, auth.api+verificationUnits.api on different
  runs) — ALWAYS re-run the flagged file ISOLATED with `--coverage.enabled=false` to confirm it's the flake
  (it always passes isolated). Single-file vitest hits a global coverage-threshold non-zero exit → use
  `--coverage.enabled=false` for isolated runs; the gate is the full `pnpm verify`.
- After any new route/sdk path: `pnpm openapi` (drift gate) + commit openapi.json. Run the FULL @crm2/sdk suite on
  any sdk edit (`pnpm --filter @crm2/sdk exec vitest run --coverage.enabled=false`).
- TRIPLE-WRITE every migration: file → :5433 (harness auto-applies on verify) → :54329 (manual
  `psql postgres://postgres:postgres@localhost:54329/crm2_dev -f <file>`).
- ⚠️ GEOCODE_CACHE TEST GOTCHA: geocode_cache is coordinate-keyed (6dp) + frozen — reusing the same lat/lng
  across tests returns the FIRST cached address. Use DISTINCT coords per test.
- Panel subagents that run `pnpm verify` WITHOUT DATABASE_URL get false env failures — the CTO's
  DATABASE_URL-set run is authoritative.

WHAT'S BUILT (the FIELD_REPORT template engine + photo reverse-geocode — ADR-0038/0039/0040):
- **FIELD_REPORT engine (S1–S3c COMPLETE):** config-driven Handlebars field-report engine replacing v1's ~180
  hardcoded templates. `report_layouts` extended (mig 0064: template_body + verification_type[=unit code] +
  FIELD_REPORT kind). `GET /api/v2/cases/:id/tasks/:taskId/field-report` (case.view, scope-404) → narrative +
  raw `sections`. **#6 card = COMBINED view** (raw fields + narrative) per task. Admin **Designer** (Handlebars
  body + variable catalog + vtype select + "Load standard template"). **Grammar helper library**
  `apps/api/src/modules/fieldReports/helpers.ts` = **32 helpers** (incl apfVacant). ⭐ render is
  `noEscape:true` PLAIN TEXT (literal quotes/`&`, matches v1) — **output-encoding is the CONSUMER's job** (#6 =
  React text node; **S5 PDF/Word/HTML MUST output-encode or stored-XSS — Security BLOCK-level**). **ALL 9 type
  defaults ported** in `packages/sdk/src/fieldReportDefaults.ts` (RESIDENCE/OFFICE/BUSINESS/RESIDENCE_CUM_OFFICE/
  PROPERTY_INDIVIDUAL[6 outcomes,no Shifted]/PROPERTY_APF[4: Positive/Negative/ERT/Untraceable, NEGATIVE STOP/
  VACANT split via {{#if (apfVacant …)}}]/BUILDER/DSA_CONNECTOR/NOC) — each = ONE body, {{#eq outcome}} branches
  (prod strings), variable catalog bound to prod field keys (FORM_DATA_PATH `<slug>.formData.<key>` +
  APPLICANT/TASK + outcome). columnKeys lowercase_snake ∉ FIELD_REPORT_HELPER_SET; helper-drift test
  (registered===SDK list, 32≡32) must stay green. SDK fieldReportDefaults.test auto-covers every entry. KYC
  report-gen DEFERRED (owner, later epic).
- **S4 PHOTO REVERSE-GEOCODE (foundation + Slice A + Slice B COMPLETE; ADR-0040, mig 0065):** ⭐ RULE
  (ADR-0034): **attachment ≠ photo** — `OFFICE_REF` (office reference doc, backend→mobile, octet-stream,
  ADR-0025) vs `FIELD_PHOTO` (verification photo, field→backend, multipart, ADR-0034); ONE `case_attachments`
  table + `kind` discriminator; **reverse-geocode is FIELD_PHOTO-ONLY** (office never geocoded). Device NEVER
  geocodes (server Google key `GOOGLE_GEOCODING_API_KEY`). mig 0065 = `reverse_geocoded_address` (frozen NULL→addr
  by a BEFORE-UPDATE trigger) + geo-shape CHECK + `reverse_geocode_dlq`. **Slice A** = on-view resolver
  `GET /cases/:id/field-photos/:attachmentId/address` (case.view, scope-404, reuses cache-first geocodeService,
  freeze-safe NULL-guarded write) + #7 caption (📍address + GPS±Nm + capture-time) + SDK. **Slice B** = dedicated
  async-on-upload queue `apps/api/src/platform/geocode/queue.ts` (Valkey→BullMQ 3-attempt + in-process
  fallback; injected processor `cases.reverseGeocodeFieldPhotoJob` + dead-letter at boot via http/registerJobs;
  worker at ROLE=worker boot) + DLQ writer + `GET /geocode/dlq` + `POST /geocode/dlq/replay` (SYSTEM_VIEW).

▶▶ REMAINING WORK (do in order):

**(1) S4 SLICE C — reverseGeocodedAddress into the report photo context.** The ONLY unfinished piece of S4. v1's
sealed report had a GAP (per-photo address was NOT in the report context — `reportContextBuilder`'s
ReportAttachmentContext had no address); v2 closes it. The data is now ready (mig 0065 frozen
`reverse_geocoded_address` + Slice A/B populate it + the #7 list/endpoint expose it). Slice C = surface each
field photo's frozen address (+ GPS + capture-time) in the CASE_REPORT's photo block so the printed/downloaded
client report shows the geocoded address per photo. **Slice C has NO standalone artifact until #9 exists** — so
it lands AS PART OF S5 (the report's photo section). Build it inside the S5 assembly engine: when composing the
report's photo gallery, pull `reverse_geocoded_address` (resolve-on-demand via the Slice A resolver if still
null) + geoLocation + capture-time for each FIELD_PHOTO. Track it explicitly so it isn't lost.

**(2) S5 — #9 CASE_REPORT + PDF/Word/Excel renderers (v1 System-B parity).** The client-facing downloadable
report. The #6/narrative engine (all 9 types) + #7 photos-with-address (incl Slice C) are its building blocks.
The #9 placeholder is `CaseReportSection` in `apps/web/src/features/cases/CaseDetailPage.tsx` (disabled
PDF/Word/Excel buttons). **CASE_REPORT is NOT yet a LAYOUT_KIND** (LAYOUT_KINDS = DATA_ENTRY/MIS/BILLING_MIS/
FIELD_REPORT). exceljs is already a dep (`platform/export/format.ts` toXlsx); NO PDF/docx lib yet.
**FIRST STEP (design checkpoint, NOT yet done — I tried to launch 2 Explore agents for this but the owner
redirected to S4):** investigate v1 System-B end-to-end — `CRM-BACKEND/src/services/{reportContextBuilder,
reportContextSchema,reportTemplateRenderer,PDFExportService}.ts` + `controllers/reportTemplatesController.ts`
(report context shape per case, output formats + libs, config model `report_templates`/Handlebars+Puppeteer,
photo embedding [base64? presigned?], **output-encoding/XSS**, branding/header/footer/tables). Then write
ADR-0041 (CASE_REPORT design + the renderer-stack CTO decision: PDF via puppeteer vs pdfkit vs @react-pdf; docx;
xlsx=existing exceljs) + a slice plan; surface the stack + format-scope recommendation. Then build sliced
(assembly engine [reuse per-task FIELD_REPORT narratives + raw sections + #7 photos-with-address incl Slice C] →
per-format renderers → wire the #9 buttons). **S5 #1 INVARIANT (Security BLOCK-level): every renderer MUST
output-encode the PLAIN-TEXT narrative + sections + field values** (they are noEscape plain text; a PDF/HTML/docx
sink interpolating them raw = stored-XSS). **ALSO surface RESULT-COHERENCE** (the CRM2 2.0 audit's #1 risk): the
client report must print the OFFICIAL backend result, not the FE/stale `cases.verification_outcome` — decide the
report's result source at S5 design.

**(3) OPTIONAL/cheap:** RESIDENCE S3b ERT byte-parity carry (ERT branch approximates v1's
{Applicant_Staying_Status_That_Clause} + omits {Political_Connection_Sentence}; CEO-judged bank-immaterial;
deferred to avoid regressing shipped RESIDENCE code — close only if the owner prioritizes byte-parity).

🚨 OUTAGE CARRY — RE-SPAWN PANEL TO RATIFY CTO-CONDUCTED LEDGER ENTRIES: subagent dispatch was 529-Overloaded for
much of the 2026-06-17 session. Real-subagent passes (no action needed): S3c b3 (Principal+CEO, +CEO ratified
b1+b2), S4 Slice A (Principal+Security+CEO+Design-Quality). **CTO-conducted, awaiting independent ratification:**
S4 **Slice B** — Principal + Reliability/SRE + Security + CEO (all 4). When subagent dispatch recovers, re-spawn
those 4 (read `git diff 0c745f3 a196c9a`, read their ledgers, confirm/append). If they find anything, fix-forward.

PROTECTED INVARIANTS / DON'T-REGRESS (verify before touching; full list in the memory files):
- Narrative + sections are PLAIN TEXT (noEscape) — EVERY consumer output-encodes (React for #6; **S5 sinks MUST
  or stored-XSS — Security BLOCK-level**).
- attachment(OFFICE_REF, backend→mobile) ≠ photo(FIELD_PHOTO, field→backend); reverse-geocode is FIELD_PHOTO-only;
  device NEVER geocodes (server key); reverse_geocoded_address frozen (DB trigger); geocode enqueue is fire-and-
  forget (never fails an upload); on-view resolveFieldPhotoAddress is NON-throwing (the worker throws-to-retry).
- FIELD_REPORT helpers are pure string transforms (no eval/IO/proto-walk); `str()` objects→'' makes optional
  args safe; columnKey lowercase_snake ∉ FIELD_REPORT_HELPER_SET; helper-drift test green (32≡32).
- The platform queue/engine never imports a feature module — inject processors/dead-letters at http/registerJobs
  (boot layer). Raw SQL only in repos. default-deny RBAC+scope (404 IDOR-safe). append-only audit. OCC (ADR-0019).
  no magic numbers/suppressions. FE perm gates MIRROR server; tokens-only / `.btn`(not phantom `.btn-primary`) /
  HexagonLoader / dialogs focus-trapped / collapsible cards `.btn-ghost`+aria-expanded.
- result-coherence: single-layer field result; FE result ≠ backend official result.

METHOD (per the multi-agent build method): build each slice as ONE vertical → `pnpm verify` green (re-run the
rotating-flake file isolated) → spawn the Audit Panel subset (≥ CEO + Principal; +Security if a new endpoint/
security model/output-encoding [S5 renderers ALWAYS need Security — output-encode is BLOCK-level]; +Reliability
if background jobs; +Design-Quality if FE touched) reading docs/agents/*.md + APPENDING a dated entry; resolve
FLAGs / any BLOCK stops the commit. If subagent dispatch 529s repeatedly, CTO-conduct the seats with direct
evidence + flag the ledger entries for re-spawn (precedent set this session) → for a representative path, live
HTTP E2E on :4000 AND browser-verify on :5273 (perform the action, 0 console errors, clean reload) → commit
(author Mayur, Co-Authored-By trailer) → push (standing auth) → update project_crm2_operations_phase.md with a
SLICE entry before moving on. CLEAN UP dev test data after each E2E.

START: cd crm2, bring env up (colima+docker, restart dev API, wait both DBs + :4000 + web preview),
confirm `git log` HEAD = a196c9a, read the report-engine + S4 memory entries, then OPEN S5 — investigate v1
System-B (Explore agents), write ADR-0041 + slice plan + the renderer-stack recommendation, surface the
result-coherence + output-encoding decisions, plan Slice C into the report's photo section, and GO.
