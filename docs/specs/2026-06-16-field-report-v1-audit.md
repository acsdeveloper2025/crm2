# V1 Field-Report Deep Audit — for the v2 template-report engine (2026-06-16)

Backing evidence for **ADR-0039**. Three parallel read-only audits of v1
(`CRM-BACKEND`, `CRM-FRONTEND`, `crm-mobile-native`). Owner ask: the v2 field report must show
**both the raw submitted fields AND the generated narrative**, replicate the **generation logic**, and
carry the **per-photo reverse-geocoded address + capture details**. This doc records exactly what v1
does (file:line) so v2 captures it deliberately.

---

## A. Two report systems in v1 (don't conflate)

| | **System A — narrative remark** | **System B — Handlebars PDF** |
|---|---|---|
| Entry | `TemplateReportService.generateTemplateReport()` | `reportTemplateRenderer.renderToPdfBuffer()` |
| Templates | **hardcoded TS string literals** (9 type tables, ~1380 lines) | DB `report_templates.html_content` (admin Handlebars HTML) |
| Engine | regex `{Field}` substitute + ~30 JS helper closures | Handlebars compile + Puppeteer → PDF |
| Output | plain narrative **text** → `template_reports` table + object storage | **PDF** buffer (on-demand) |
| Key | (verificationType × outcome) | admin picks by client/product |

The **"logic"** the owner means lives entirely in **System A**. v2 unifies both onto ONE config-driven
Handlebars engine (`report_layouts` FIELD_REPORT for the #6 narrative; CASE_REPORT for the #9 PDF).

Files: `CRM-BACKEND/src/services/TemplateReportService.ts` (System A, ~3200 lines),
`reportTemplateRenderer.ts` + `reportContextBuilder.ts` + `reportContextSchema.ts` (System B),
`src/controllers/templateReportsController.ts`, `src/utils/formTypeDetection.ts` (outcome parser).

---

## B. The combined view — raw fields + photos + narrative (the owner's #1 ask)

**v1 already does this on one screen:** `CRM-FRONTEND/src/components/forms/OptimizedFormSubmissionViewer.tsx`
(expandable), top→bottom:
1. **Header summary** (L131-238): form-type title, status/validation/outcome badges, agent, submitted-time,
   photo count, "{N} sections, {M} fields", Expand/Collapse.
2. **Form Data** (L243-296): one block per section, raw fields as inline `Label: value` rows.
3. **Verification Photos** (L299-318): geo-tagged photos (`VerificationImages`).
4. **Template-Based Report** (L320-326): `TemplateReportCard.tsx` — the generated narrative prose
   (`whitespace-pre-wrap`) + a "Report Details" grid (generatedAt / type / outcome / templateUsed) +
   a Regenerate button.

Mounted in `CaseDetailPage.tsx:453` (forms tab) and `FieldReviewDecisionForm.tsx:75` (reviewer sees
fields+narrative while deciding).

**v2 decision (#6 Field Report card):** mirror this — a per-task accordion: header (type/outcome/agent/
time/counts) → **raw form fields (sectioned)** → **photos (with geo caption, §D)** → **narrative**. S1
shipped only the narrative render; S2 adds the raw-fields panel + the photo captions to the same card.

---

## C. Per-type fields + generation logic (System A)

### C1. Per-type form fields differ ~30-50%
Field catalog: `CRM-BACKEND/src/utils/comprehensiveFormFieldMapping.ts` (4917 lines) — per-type
`FormFieldDefinition[]` (`{id,name,label,type,isRequired,section,order,formTypes?}`):
RESIDENCE L29 (53 fields), OFFICE L570 (39), BUSINESS L937, PROPERTY_APF L1498, PROPERTY_INDIVIDUAL
L1884, NOC L2239, BUILDER L2705, DSA_CONNECTOR L3268, RESIDENCE_CUM_OFFICE L3801. Registry
`VERIFICATION_TYPE_FIELDS` L4636; lookup `getFormFieldDefinitions(type, formType)` L4651.
- Shared spine (~15 fields): address locatable/rating, locality, structure, landmarks 1-4, dominated
  area, neighbour feedback, political connection, met-person, TPC ×2, observation, finalStatus.
- Type-specific: RESIDENCE → household/stay; OFFICE → employment/firm; PROPERTY → construction/ownership.

**Raw-field display** is NOT schema-driven at render — `createComprehensiveFormSections(formData)`
(L4700+) **introspects the actual `formData` keys**: skip system fields, camelCase→Title Case
(`toLabel` L4646, acronym fixups TPC/NOC/APF/RERA), bucket into sections by regex, emit `FormSection[]`.
Attached to each submission at the API (`mobileFormController.ts:1999`+ list endpoint, builder L4700).
FE renders generic sectioned `Label: value` (no per-type React layouts).

**v2 decision:** render raw fields by **introspecting `case_tasks.form_data`** (generic sectioned
key→label), exactly like v1 — do NOT hardcode per-type layouts. The per-type catalog (labels/sections/
order) is optional config later; S2 ships the generic renderer.

### C2. Template selection: (type × outcome)
9 types. Outcome key sets:
- 7 standard types (RES/OFF/BUS/RCO/BUILDER/NOC/DSA) — **8 keys**: `POSITIVE_DOOR_OPEN`,
  `POSITIVE_DOOR_LOCKED`, `SHIFTED_DOOR_OPEN`, `SHIFTED_DOOR_LOCKED`, `NSP_DOOR_OPEN`,
  `NSP_DOOR_LOCKED`, `ERT`, `UNTRACEABLE`.
- PROPERTY_APF — **5**: `POSITIVE`, `NEGATIVE_STOP`, `NEGATIVE_VACANT`, `ERT`, `UNTRACEABLE`.
- PROPERTY_INDIVIDUAL — **6**: door-open/locked × positive/nsp + ERT + UNTRACEABLE (no SHIFTED).

Outcome string computed at submit time (`formTypeDetection.ts:446` `detectFormTypeEnhanced`, driven by
`formData.verificationOutcome||outcome||finalStatus` + `UNIVERSAL_OUTCOME_MAPPING` table + per-type door
field), persisted, then **re-parsed defensively** by `getTemplateKey` (`TemplateReportService.ts:1507-1987`,
~480 lines of substring matching + per-type door-state tiebreak).

**v2 decision:** the device `verificationOutcome` rides in `form_data` (evidence). Templates branch on it
via `{{#eq outcome "POSITIVE_DOOR_OPEN"}}` — **one template per (type) with outcome conditionals**,
collapsing v1's ~180 flat templates to ~9. Do NOT re-parse prose; treat the device outcome as the key.
A small normalizer maps the device's outcome string to a stable token (config, not a 480-line parser).

### C3. The generation LOGIC — derived "smart" placeholders (the priority)
All logic is JS closures in `mapFormDataToTemplateVariables` (`TemplateReportService.ts:2046-3220`),
producing ~30 derived placeholders; **no template-language branching** — values are pre-baked strings
(often `''`), then a **whitespace-collapse pass** (L1420-1422) removes the gaps:
```js
tpl.replace(/[ \t]{2,}/g,' ').replace(/[ \t]+(\n|$)/g,'$1');
```

**Helper inventory v2's engine must support** (as Handlebars helpers and/or COMPUTED catalog columns):
- **Value transforms:** `ordinal` (1→1st; floors), `lc`/`capFirst` (sentence-casing — mobile sends
  title-case), `pluralizePeriod` ("5 Year"→"5 Years", "1 Year" unchanged, "Ground" passthrough),
  `formatIsoDate` (YYYY-MM-DD from **local** parts — NOT toISOString, avoids IST→UTC shift),
  `formatAreaSqFeet` ("N sq. feet" / "Not provided"), `ownershipTypeText` (strip "Are/Is ").
- **All-or-nothing composites** (return `''` unless all inputs present): `workingProfileText(name,status,
  company)`, `currentCompanyOperatingSentence`, the staying+working join.
- **Enum→prose mappers** (data-driven lookups): `callRemarkText`, `callConfirmationText`,
  `dominatedAreaText`, `politicalConnectionText`, `documentShownText/Sentence`, `metPersonConfirmationText`,
  `setupText`, `businessLocationText`, `sittingLocationText`, applicant working/staying status.
- **Graceful joins:** `tpcLabel` / `tpcPairTextApf` (no dangling " and ", no "Not provided Not provided").
- **Clause wrappers** (drop whole clause when empty): `existsClause`, `sentenceClause`, nameplate
  ternaries (sighted → `shows the name "X"` / not sighted).
- **APF verdict-coherence** (the most complex): `activityVerdictSentence` + `verdictOverrideNote` —
  reconcile agent verdict vs natural construction verdict ("despite the plot being vacant, completed as
  Positive…").
- **Field aliasing:** `safeGet` tries key / lowercase / snake_case; empty-default-then-fallback chain.
- **`getCustomerName`** anti-test-data guard (test/door/positive/report → fall back to met-person).
- **`Final_Status`** = finalStatus || verificationOutcome || 'Positive' (closing "marked as {Final_Status}").

**v2 decision:** S1 already ships `{{#eq}}` + the whitespace-collapse pass + HTML-escape + proto-off. The
remaining helpers ship as a **versioned Handlebars helper library** (one slice), plus a `COMPUTED` source
type in the variable catalog for the all-or-nothing/verdict-coherence composites (the slice-1 SOURCE
CARRY). v2 stores templates in `report_layouts` (config, editable) — fixes v1's hardcoded-TS weakness.

### C4. v1 weaknesses to NOT carry
Hardcoded TS templates (deploy-to-edit); two non-unified systems; stringly-typed outcome re-parsed 3×
(DSA `Open` vs `Opened` bug; "entry restricted" ∌ "ert"); confidence-scoring heuristic fallbacks;
unescaped `new RegExp('{'+key+'}')`; ~1000-line per-type formData hand-remap in the controller;
`Final_Status` silently defaults Positive; the narrative reads FE outcome, never the backend
`task_backend_reviews` decision (result fragmentation — v2 must pick the authoritative result source for
the sealed report deliberately).

---

## D. Photos — reverse-geocoded address + capture details (owner's image ask)

### D1. Architecture inverted 2026-05-31 (`0e88068` "save raw geotagged photos, drop on-device watermark")
- **Old era (≤v1.0.46):** phone burned a details strip into the photo bottom on-device via
  `react-native-view-shot` (`WatermarkPreviewScreen.tsx` / `WatermarkReStamper.tsx`, both DELETED).
- **Current:** phone saves **RAW geotagged JPEG** (EXIF stripped, GPS in DB only); the
  **reverse-geocoded address is resolved server-side and shown as a CAPTION below the image — never
  burned into pixels.** Capture must stay fast/offline → mobile must NOT reverse-geocode at capture.

Even in the burned era the strip carried GPS (DMS + decimal), accuracy, customer·task identity,
date/time, altitude/speed/heading, branding — **but the address was ALWAYS a web caption, never burned.**

### D2. Reverse geocoding — Google, server-side, async-on-upload, frozen
- `reverseGeocodeHelper(lat,lng)` — `mobileLocationController.ts:687-767`: Google Geocoding API
  (`GOOGLE_GEOCODING_API_KEY`), returns `results[0].formatted_address` (single string), Redis 30-day cache.
- Trigger: on attachment upload, `verificationAttachmentController.ts:624` enqueues
  `enqueueReverseGeocode`; BullMQ worker `queues/reverseGeocodeQueue.ts:95-145` writes
  `verification_attachments.reverse_geocoded_address` (idempotent, **frozen** once set), DLQ on failure.
- On-view fallback: `geocodeController.ts:116-199` (`GET /attachments/:id/address`) resolves once + caches.

### D3. Photo metadata shape
Device `geoLocation` jsonb: `{latitude, longitude, accuracy, altitude, speed, heading, timestamp}` +
`photo_type` (selfie|verification) + `clientSha256` (evidence tamper-seal, `CameraService.ts:297`) +
`verificationType`. GPS mandatory (capture aborts without a fix). Backend store:
`verification_attachments.geo_location` jsonb + `reverse_geocoded_address` column (the old
`gps_latitude/longitude` cols are dropped/dead).

### D4. v1 display (caption/card below image)
`FormPhotosGallery.tsx:44-115`: image → "Location Details" card: coords `toFixed(6)`, `Accuracy ±Nm`,
**`Address: {geoLocation.address}`**, `Captured {relative time}`; + a "Photo Details" card (size/dims/
device); thumbnails overlay accuracy. `FormLocationViewer.tsx`: GPS card + reverse-geocoded address +
Google-Maps embed + open-in-maps links. `OptimizedFormSubmissionViewer.tsx:315` passes
`geoLocation.address` down. **Gap in v1:** the per-photo address does NOT flow into the sealed report
(`reportContextBuilder.ts` `ReportAttachmentContext` L71-86 has photoType/lat/lng/captureTime/url but
**no address field**).

### D5. v2 decision
v2 already has a Field Photos gallery (#7, photoType+unitName caption) + a server-side geocode module
(`apps/api/src/modules/geocode/`). To reach parity:
1. **Persist the full geo metadata** on ingest (`geoLocation` incl. altitude/speed/heading/accuracy/
   timestamp) + a `reverse_geocoded_address` column, resolved **async-on-upload + frozen** (write-once,
   on-view fallback) — replicate the BullMQ/freeze/DLQ pattern (v2 has Valkey + a jobs module).
2. **#7 gallery caption** under each photo: reverse-geocoded address (headline), GPS `toFixed(6)`,
   accuracy `±Nm`, capture date/time, photoType, + optional altitude/speed/heading + a maps link.
3. **#6 / #9 report:** include the per-photo `reverseGeocodedAddress` in the report photo context —
   **closing v1's own gap** (v1 never printed it in the sealed report).
4. **Preserve the rule:** capture stays fast/offline — never block capture on geocoding; resolve
   server-side, render as caption. (This is an INGEST-side slice; depends on the field-submission ingest
   §5 being built — currently v2 photos arrive via the existing attachment path.)

---

## E. Resulting v2 slice plan (post-audit)
- **S1 (DONE, `863b19e`):** FIELD_REPORT engine — config templates, Handlebars `{{#eq}}` + escape +
  whitespace-collapse, per-task render endpoint, narrative only.
- **S2:** FE Field Report **designer** (Handlebars body + variable-catalog builder) + wire the **#6 card
  as the COMBINED view** (raw form-data fields sectioned + photos-with-geo-caption + narrative).
- **S3 (helper library):** port v1's ~30 derived-placeholder helpers as a versioned Handlebars helper set
  + a `COMPUTED` catalog source for composites; seed v1's templates as config rows (~9 per-type with
  outcome conditionals).
- **S4 (photo geocoding):** reverse-geocode-on-upload + frozen column + #7 caption + report photo context
  (closes v1's sealed-report address gap). Tied to the field-submission ingest slice (§5).
- **S5:** #9 CASE_REPORT + PDF/Word/Excel renderers (System B parity: branding, photos, tables).
- **Deferred:** KYC report-gen epic.
