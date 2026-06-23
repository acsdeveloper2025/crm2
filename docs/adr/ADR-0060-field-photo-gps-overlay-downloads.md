# ADR-0060 — Field-photo GPS-Map-Camera overlay, static-map proxy, and downloads

**Status:** Accepted · **Shipped** (2026-06-22, origin/main `e58d711`; deploy + ci GREEN, external HTTPS
smoke 200, security-reviewed clean) · **Owner-confirmed** (2026-06-22) · **Extends:** ADR-0034 (device
field-photo upload), ADR-0040 (reverse-geocode, frozen address), ADR-0041 (case report engine).
**Migration:** none. **New dependency:** `archiver` (API, server-side zip streaming).

## Context
The web case-detail "Field Photos" card showed each photo as a thumbnail with a one-line truncated
address + a coords link. The owner wants a **GPS-Map-Camera-style** presentation (ref: gpsmapcamera.com):
a per-photo bottom overlay with a **map inset**, the **full reverse-geocoded address**, **lat/long
(6 dp)**, and the **capture timestamp with timezone** — plus real download affordances: a per-image
download, a "Download all" for the case, click-to-fullscreen-and-save, and an image **refresh** (the
display URLs are presigned and expire). The generated case report (ADR-0041) should carry the same
overlay.

We already store everything the overlay needs: `case_attachments.geo_location` (lat/lng/accuracy/
timestamp, ADR-0034) and the frozen `reverse_geocoded_address` (Google `formatted_address`, ADR-0040).
The two genuinely-new pieces are (1) a map thumbnail and (2) download/zip plumbing.

## Decisions

1. **Address detail = keep the frozen `formatted_address` (NO schema change).** Google's
   `formatted_address` already IS the detailed building→country string (e.g. "D1, Yashaswi Nagar,
   Dhokali, Thane West, Mumbai, Maharashtra 400607, India"). We display it in full (multi-line) instead
   of truncating. We do **not** add a `reverse_geocoded_components` column — it would duplicate the
   string, complicate the freeze trigger, and add a migration for no display gain. ADR-0040's frozen /
   async / DLQ invariants are untouched.

2. **Map inset = a server-side Google Static Maps proxy (`platform/staticmap`).** A new seam mirroring
   `platform/geocode`: coord → PNG thumbnail, **key-gated and null-degrading**. It **reuses
   `GOOGLE_GEOCODING_API_KEY`** (Static Maps is a sibling Maps-Platform API on the same project key) —
   no new env var. The **key stays server-side** (ADR-0040 invariant); the browser never holds it. If
   the key is unset or Static Maps is not enabled on it, every lookup returns `null` and the overlay
   degrades to a coordinate placeholder. Chosen over a browser Leaflet/OSM map (new FE dep + 3rd-party
   tile egress + would still need a key for Google) and over an inline fake mini-map (not a real map).

3. **New routes (additive, `/api/v2`, all `case.view`, scope-guarded → 404 IDOR-safe):**
   - `GET /cases/:id/field-photos/:attachmentId/staticmap` → proxies the Static Maps PNG for that
     photo's coords (`image/png`, cached). 404 when no coords / unavailable → FE placeholder.
   - `GET /cases/:id/field-photos/:attachmentId/download` → streams the photo bytes with
     `Content-Disposition: attachment; filename="<convention>"` (server owns the filename).
   - `GET /cases/:id/field-photos.zip` → streams a zip of all the case's field photos via `archiver`,
     each entry named by the convention. Empty set → 404.

4. **Filename convention** (single source of truth = the server): `<caseNumber>_<taskNumber>_<NN>[_<photoType>].<ext>`,
   e.g. `CASE-000007_CASE-000007-1_01_HOUSE.jpg`. `NN` = 1-based per-case sequence (stable ordering by
   `created_at, id`); `photoType` sanitised (`[^A-Za-z0-9]+`→`_`); `ext` from the stored mime/original
   name. The single-image download, the zip entry, and the fullscreen "save" all resolve to the SAME
   name because they all flow through the server `Content-Disposition` / archiver entry name. (The
   web therefore needs no client-side filename logic and no new SDK field.)

5. **Downloads go through authed API routes, NOT browser-side renaming of cross-origin presigned URLs.**
   A presigned MinIO/S3 URL is cross-origin and can't reliably carry a `download` filename (CORS) and the
   browser can't attach the bearer token to an `<img>`/`<a>`; the authed bytes routes sidestep both and
   let the server set the filename. Display still uses the existing presigned `/attachments/:id/url`.

6. **Report overlay (ADR-0041).** `CaseReportPhoto` gains `mapImage: string | null` — a base64 **data
   URI** of the static-map thumbnail, fetched server-side during assembly (only when coords exist; null
   in tests / when unkeyed). Inlining as a data URI keeps the Google key out of the preview HTML and
   prints under Puppeteer with no external fetch. The default report template renders the same overlay
   (map inset + full address + lat/long + capture time).

7. **Image refresh (web).** A refresh control invalidates the photo list + per-photo presigned-URL
   queries so a stale session re-signs and re-renders. No server change.

## Consequences / invariants
- No DB migration; `reverse_geocoded_address` stays the frozen single source for the address.
- Static map + the Google key are **server-only**; both the overlay inset and the report data URI are
  produced server-side. Missing key → graceful coordinate placeholder, never a broken page.
- `archiver` is the only new dependency; it is used solely for the case zip stream in the controller
  (business logic — the scope-guarded entry list — stays in the service, unit-testable without streaming).
- All three routes are `case.view` + scope-guarded, consistent with the existing field-photo routes.

## Review dispositions (CEO / CTO / Designer pass, 2026-06-22)
- **FIXED — report fetch latency (CTO Major):** `caseReports` assembly batched the per-photo presign +
  Static Maps fetch in bounded-parallel (concurrency 8) so the *synchronous* `/report.html` + `/preview`
  endpoints no longer carry serial N×timeout external-API tail latency.
- **FIXED — non-token color literals (Designer Major):** the photo overlay band + map placeholder + the
  per-photo download chip now use the app's `bg-foreground/NN` scrim token (not `bg-black/*`); the
  coords link uses `text-white underline` (not the one-off `text-sky-300`). White text + `border-white/*`
  over a photo are kept as intentional, sanctioned overlay chrome.
- **FIXED — IDOR coverage (CTO Minor):** added a scoped-user → 404 test across download / zip / staticmap.
- **FIXED — a11y nits (Designer):** `aria-busy` on the download / download-all / save controls; the
  trigger image uses `alt=""` (the wrapping button is labelled).
- **DEFERRED — zip buffers all photo bytes (CTO Minor):** bounded in practice by the per-task upload cap
  (≤10 photos × 25 MiB); acceptable for a verification case. A future streaming archive (object → archiver)
  would cap the pathological many-task case.
- **DEFERRED — scope-leg nuance (CTO Minor):** `fieldPhotoForGeocode` (staticmap/address) uses the
  `task_id IS NULL OR EXISTS` leg vs `listFieldPhotoFiles`'s EXISTS-only. Latent only — a FIELD_PHOTO
  always carries `task_id` (device write path). Left as-is to avoid changing the pre-existing shared
  address route.
- **ACCEPTED — filename repeats the case number** (`<caseNumber>_<taskNumber>_…`, and `taskNumber`
  already embeds the case number): traceable + unique, matches the owner's `<caseNumber>_<VTid>` intent.
- **OPS NOTE — prod Static Maps:** verify the live `GOOGLE_GEOCODING_API_KEY` has the **Static Maps API**
  enabled (separate toggle from Geocoding). If not, the inset silently degrades to the coordinate
  placeholder. Confirmed enabled on the dev key (live-verified 200 PNGs).
