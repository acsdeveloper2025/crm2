# ADR-0041: CASE_REPORT Engine — server-side multi-format client report (PDF / Word / Excel)

- **Status:** Proposed (S5 design, 2026-06-17)
- **Date:** 2026-06-17
- **Implements:** ADR-0038 (template-report engine direction), reuses ADR-0039 (FIELD_REPORT engine), depends on ADR-0040 Slice C (photo reverse-geocode address in report context). Refines ADR-0037 (`report_layouts`).
- **Reference impl (v1):** `CRM-BACKEND/src/services/{reportContextBuilder,reportContextSchema,reportTemplateRenderer,PDFExportService}.ts` + `controllers/reportTemplatesController.ts`.

## Context

The case-detail page exposes a placeholder `CaseReportSection` with three disabled buttons — **PDF**, **Word**, **Excel** — that should produce the **client-facing case report**: case identity, applicants, per-task verification narratives, field photos with location + capture-time, totals/TAT, branded. v1 ships this as **PDF only** via Puppeteer; v2 extends to all three formats. This is the final S5 slice of the template-report engine, the lever that lets CRM2 deliver a Zion-equivalent downloadable report from a config-driven engine instead of v1's ~180 hardcoded templates and one-off PDF service.

The audit-mapped v1 gaps drive the v2 calls below:

1. **No `reverse_geocoded_address` on photos in v1 report context** — Slice A/B froze the address in `case_attachments`; CASE_REPORT closes the gap (Slice C).
2. **Result fragmentation** — v1 had four result columns and a client report that disagreed with the official backend decision (the CRM2 2.0 audit's #1 risk). v2 is **single-layer by design** (mig 0041 + 0052): `case_tasks.verification_outcome` is the official per-task result, `cases.verification_outcome` is the official per-case result. CASE_REPORT reads those columns directly — no precedence stack, no fragmentation possible.
3. **No Zod validation of the report context** — v1 casts to `Record<string,unknown>`; missing fields render blank. v2's render context is Zod-validated; missing required keys are a hard error.
4. **No case-scope check on v1's generate endpoint** — IDOR-able. v2 default-deny + case-scope-404.
5. **`{{{raw}}}` opt-out in v1 templates** — v2 forbids raw; auto-escape ON in the renderer + a CI gate over template bodies.

## Decisions

1. **Storage = extend `report_layouts`** (per ADR-0038, "reuse the engine"). Migration **0066** adds:
   - Widen the kind CHECK to include `CASE_REPORT`.
   - `page_size varchar(10)` and `page_orientation varchar(10)` — required for CASE_REPORT, null for the other kinds.
   - Coherence CHECK: `CASE_REPORT ⟺ (template_body IS NOT NULL AND page_size IN ('A4','LETTER','LEGAL') AND page_orientation IN ('portrait','landscape') AND verification_type IS NULL)`.
   - The existing `uq_report_layouts_active (client_id, product_id, kind, COALESCE(verification_type,'')) WHERE is_active` already enforces one active CASE_REPORT per (client, product).

2. **Templates = HTML+inline-CSS body** in `template_body`. Single Handlebars source per (client, product). Handlebars **auto-escape ON** (`noEscape: false`); the FIELD_REPORT plain-text narrative is interpolated via `{{narrative}}` and gets HTML-escaped on the boundary. **`{{{raw}}}` is forbidden** — a lint gate parses every saved template body and rejects triple-stash. **Security BLOCK-level invariant.**

3. **Assembly engine (Slice 1, server-side)** produces a Zod-validated `CaseReportContext`:
   ```
   case        { id, caseNumber, customerName, customerPhone, panNumber, applicantType,
                 trigger, priority, status, pincode, receivedDate, completedDate, tatDays,
                 verificationOutcome /* OFFICIAL — see below */ }
   client      { id, name, logoUrl, stampUrl, primaryColor, headerColor }
   product     { id, name }
   applicants  [ { id, name, mobile, role, panNumber } ]
   tasks       [ { id, verificationType, address, amount, outcome /* OFFICIAL per-task */,
                   narrative /* FIELD_REPORT engine output, plain text */,
                   sections /* raw fields from FIELD_REPORT engine */,
                   photos [ { id, url, photoType, lat, lng, accuracy,
                              reverseGeocodedAddress, captureTime } ] /* Slice C */ } ]
   totals      { totalTasks, completedTasks, positiveTasks, negativeTasks, tatDays, photoCount }
   generation  { generatedAt, generatedById, generatedByName }
   ```
   - The per-task `narrative` / `sections` are produced by the existing **FIELD_REPORT engine** — no duplication. CASE_REPORT is an aggregator, not a separate text engine.
   - Per-task `photos` includes the **frozen** `reverseGeocodedAddress` (resolve-on-demand via the Slice A resolver if still null). This is Slice C.
   - Zod-validated end-to-end. Missing required keys = 500 with a structured error (not a silent blank in the PDF).

4. **Result source — single-layer (v2-by-design).** Per task = `case_tasks.verification_outcome`; per case = `cases.verification_outcome`. Both are server-written on completion (mig 0041 + 0052) and are by definition the official result — there is no FE-mutable draft column in v2 (the v1 result-fragmentation is structurally absent). CASE_REPORT reads these columns directly; the DON'T-REGRESS "FE result ≠ backend official result" stays trivially satisfied as long as we don't read any FE-only field.

5. **Renderers — one assembly engine, three sinks.**

   - **PDF** = **Puppeteer** (per design checkpoint 2026-06-17). Single-page-pool (max 6 concurrent, 30s setContent + 60s page.pdf timeouts). HTML pulled from `template_body`, Handlebars-compiled against `CaseReportContext`, rendered with `printBackground:true`. Page size + orientation come from the layout row.

   - **Word (.docx)** = **`docx` npm package** (programmatic, no Chromium dep, no HTML→Docx conversion). Builds Sections + Paragraphs + Tables + Images from the **same** `CaseReportContext`. Images embedded from the existing `/attachments/:id/url` presigned bytes (server-side fetched, base64'd into the docx). No template authoring for docx in this slice — the docx layout is code-driven from the typed context (matches v1's lack of docx altogether).

   - **Excel (.xlsx)** = **`exceljs`** (already a v2 dep). Three-sheet workbook: (1) Case Summary (one row per case), (2) Per-Task Outcomes (one row per task with photo count + photo URLs as hyperlinks), (3) Photo Manifest (one row per photo with photoType, lat, lng, address, captureTime, taskId, photo URL). Photos are NOT embedded as binary — only listed/hyperlinked (file-bloat avoidance + cell-size limits).

6. **HTTP shape — single endpoint, format query.**
   ```
   GET  /api/v2/cases/:caseId/report.html         — the rendered HTML (slice 2a; case.view, scope-404)
   POST /api/v2/cases/:caseId/report              — enqueue a CASE_REPORT PDF JOB (slice 2b)
        — gate: `case.view`; scope: 404 IDOR-safe (fail-fast at enqueue + re-checked in the worker)
        — response: 202 + the PENDING JobView
   GET  /api/v2/jobs/:id  +  /api/v2/jobs/:id/result-url   — poll status + presigned download (REUSED)
   ```
   **PDF generation is ASYNC (owner decision, 2026-06-17)**, not a synchronous binary stream: it reuses
   the existing `jobs` engine (a new `CASE_REPORT` JobType), so it inherits the job tray, progress
   events, completion notification, and the own-job presigned-URL download — exactly like an EXPORT.
   The rendered PDF is stored in object storage at `case-reports/{userId}/{jobId}.pdf`; the FE polls the
   job and downloads via `/jobs/:id/result-url`. (Word/Excel slices will follow the same job shape.)

7. **Output-encoding — Security BLOCK-level invariants.**
   - PDF renderer: Handlebars `noEscape:false` (default escape ON). `{{narrative}}`, `{{sections.*}}`, every FIELD_REPORT plain-text value is HTML-escaped on the boundary. The lint gate over `template_body` forbids `{{{` (triple-stash) on any user-controlled key; only branding data URIs (`{{{client.logoUrl}}}`) are allowed in raw, guarded by a parser allow-list.
   - Docx renderer: text values flow through `docx`'s `TextRun` constructor — no HTML at all, no possible XSS sink. Images go through the binary buffer API.
   - Xlsx renderer: every value flows through `exceljs`'s cell value API. Free-text inputs are sanitized against **formula injection** (`escapeFormulaCell` — prefix `=`/`+`/`-`/`@` with a `'`). Image embedding NOT used.

8. **Audit + observability.**
   - **The `jobs` row IS the audit record** (no separate `case_reports_generated` table): each generation
     is a durable `jobs` row carrying `type=CASE_REPORT`, `created_by` (actor), `payload` (caseId),
     `result` ({storageKey, filename, caseId}), `status`, and the created/started/completed timestamps —
     append-mostly, own-user scoped, already queryable. Reusing it avoids a parallel audit table.
   - Server-side metrics (per-format render duration, Puppeteer pool wait, Chromium memory) — DEFERRED
     (Reliability FLAG, 2026-06-17): the observability tier isn't built yet; revisit when it lands.

9. **Build slices** (smallest verifiable verticals; each ends with a green panel + push):

   - **Slice 1 — Assembly engine (backend-only).** Mig 0066 (add CASE_REPORT kind + page_size/orientation). `CaseReportContext` (Zod schema in SDK). Assembly service in `modules/caseReports/service.ts` (composes context, calls FIELD_REPORT engine per task, applies result-coherence, includes photos with frozen+resolve-on-demand `reverseGeocodedAddress`). New endpoint `GET /api/v2/cases/:caseId/report/preview` returns JSON `CaseReportContext` (no renderer yet) for the FE Designer / debug. Panel: CEO + Principal + Security (RBAC/IDOR/PII surface) + DB.

   *(Slices were re-ordered during the build so a working renderer lands before the Designer that
   configures it — HTML→PDF first, Designer third.)*

   - **Slice 2a — HTML render (DONE, `bfb1488`).** A fresh auto-escape-ON Handlebars instance + the
     built-in `DEFAULT_CASE_REPORT_TEMPLATE` + helpers (`eq`/`nl2br`/`orDash`/`fmtDate`/`badge`) →
     `GET /cases/:id/report.html` (case.view, scope-404). The output-encoding SINK. FE "Preview (HTML)"
     button (blob-URL open). Panel: CEO + Principal + Security + Design-Quality — PASS.

   - **Slice 2b — PDF via async job (DONE, this commit).** `platform/pdf` Puppeteer wrapper (one lazy
     browser, FIFO concurrency gate, 30s/60s timeouts, relaunch-on-disconnect). `CASE_REPORT` JobType
     (mig 0067 widens `jobs.type`) + processor (assemble → renderHtml → htmlToPdf → object storage)
     injected at `registerJobs`. `POST /cases/:id/report` → 202 + JobView; download via the existing
     `jobs.resultUrl`. FE PDF button enqueues; JobsTray shows progress + download. Reconciles CEO FLAG-1
     (photos now case-scoped). Panel: CEO + Principal + Security + Reliability/SRE + Design-Quality — PASS.

   - **Slice 3 — Designer support (DONE, `a84456f`).** Admin Designer authors CASE_REPORT layouts: HTML
     body editor, variable catalog (`CASE_REPORT_VARIABLE_CATALOG`), page_size + page_orientation pickers,
     "Load default". **The RAW-OUTPUT lint gate** `RAW_OUTPUT_RE = /\{\{~?[{&]/` (server-authoritative on
     create+update, FE-mirrored) bans EVERY Handlebars escape-opt-out — `{{{ }}}`, `{{& }}`, and their
     `~` whitespace-control variants (two evasions the panel caught pre-commit). Panel: CEO + Principal +
     Security (BLOCKED×2 then RESOLVED) + Design-Quality.

   ⚠️ **Format model (revised during the build):** rather than a separate `DOCX`/`XLSX` JobType per
   format (the original spec), the renderers PARAMETERIZE the ONE `CASE_REPORT` JobType with a
   `format` payload field (`CASE_REPORT_FORMATS = ['pdf','docx',…]`). One processor branches to the
   right renderer; the storage key + filename carry `.${format}`; the job tray + `jobs.resultUrl`
   download are shared. DRY-er than 3 JobTypes (no extra `chk_jobs_type` / title-map / DOWNLOAD_TYPES
   entries). The endpoint is `POST /cases/:id/report?format=pdf|docx` (default pdf, 400 on unknown).

   - **Slice 4 — Docx renderer (DONE, this commit).** `docx` dep + a PROGRAMMATIC builder from
     `CaseReportContext` (`modules/caseReports/docx.ts`) — every value via `TextRun` (plain text, no
     markup parse → output-encoding is STRUCTURAL, not a gate); photos via `ImageRun` from the presigned
     bytes (15s-timeout fetch, degrade-to-caption + log on failure). `?format=docx` branch; FE "Word"
     button. Panel: CEO + Principal + Security (SSRF CLEARED) + Reliability/SRE + Design-Quality — PASS.

   - **Slice 5 — Xlsx renderer.** Programmatic exceljs workbook, formula-injection guard
     (`escapeFormulaCell`), `?format=xlsx` branch, FE "Excel" button. Panel: CEO + Principal + Security +
     Design-Quality.

   - **(Slice C is folded into Slice 1's assembly engine — no standalone slice.)**

## Consequences

### Positive

- One assembly engine, three sinks → no per-format duplication.
- Slice C closes the v1 photo-address gap automatically (already in context).
- Result-coherence fixed at the source (the context); all three sinks inherit it.
- Output-encoding is the renderer's job, not the template author's — auto-escape ON, raw forbidden, lint-gated.
- Schema-validated context (Zod) catches missing fields at the boundary, not in the rendered PDF.
- Admin Designer authors HTML templates per-client+product → mirrors v1's flexibility without v1's hardcoded text engine.

### Negative

- Chromium dep (Puppeteer) adds ~280MB + a slow cold start. Mitigated by a lazily-launched, reused browser. PDF rendering runs on the **worker** tier in prod (Valkey present → BullMQ); dev (no Valkey) runs it in-process after the 202 (Chromium work is out-of-process IPC, not a CPU-bound event-loop block).
- Generated PDFs persist in object storage (`case-reports/{userId}/`) with **no retention/cleanup yet** — a DPDP carry (ADR-0021): erasure should eventually purge them.
- The Puppeteer `--no-sandbox` flag is used (standard container posture; the input is our own escaped HTML). Run the worker as non-root + seccomp in prod (Reliability/Security carry).
- Docx layout is code-driven, not admin-authored — matches v1 (which has no docx at all), but means future docx style tweaks require a code change.
- The assembly engine pulls per-task FIELD_REPORT narratives in a loop; cases with many tasks may incur N FIELD_REPORT renders. Acceptable given report-generation is a low-frequency action; revisit if hot.

## Alternatives Considered

- **pdfkit (no Chromium)** — leaner (~5MB), faster cold start, but no admin-authored HTML templates (layout in code). Rejected at the design checkpoint (2026-06-17): owner picked Puppeteer for v1 parity + Designer authorability.
- **@react-pdf/renderer** — declarative React PDFs, mid-weight. Same authoring tradeoff as pdfkit; no admin Designer. Rejected for the same reason.
- **html-to-docx (HTML→Docx via mhtml)** — would let admins author one Handlebars HTML template and target both PDF + docx. Rejected: brittle conversion fidelity, heavy dep, and v2's docx layout is simple enough to do programmatically with `docx`. Revisit if cross-format authoring becomes valuable.
- **CASE_REPORT in a new table** (separate from `report_layouts`) — rejected: `report_layouts` already models per-(client,product,kind) versioning + OCC + Designer wiring. Adding two nullable columns is the minimum-delta path (ADR-0038 "reuse the engine").
- **Presigned bytes (S3) instead of streaming** — rejected for v2: matches v1; no MinIO/S3 retention or cleanup story is needed for an on-demand artifact.
- **Re-introducing FE/backend split via `task_backend_reviews`** — rejected: would import v1's result-fragmentation problem into v2. v2's single-layer model is the right answer; the audit's "official backend result" requirement is satisfied by always reading `verification_outcome`.

## Related ADRs

- [ADR-0019](./ADR-0019-concurrency-and-editing-standard.md) — OCC for layout rows.
- [ADR-0037](./ADR-0037-mis-layout-engine.md) — `report_layouts` schema.
- [ADR-0038](./ADR-0038-template-report-engine.md) — config-driven template-report engine direction.
- [ADR-0039](./ADR-0039-field-report-engine.md) — FIELD_REPORT engine (per-task narrative; reused per-task in CASE_REPORT).
- [ADR-0040](./ADR-0040-field-photo-reverse-geocode.md) — frozen `reverse_geocoded_address` on `case_attachments` (Slice C surfaces it in CASE_REPORT photo context).
