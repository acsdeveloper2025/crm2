# ADR-0075: Bake the GPS-Map-Camera overlay into field-photo downloads

- **Status:** Accepted
- **Date:** 2026-06-26
- **Extends:** ADR-0060 (field-photo GPS overlay + downloads) · ADR-0034 (device field-photo upload) · ADR-0040 (reverse-geocode).

## Context

ADR-0060 renders each field photo's GPS overlay (a Google Static-Maps thumbnail + reverse-geocoded address
+ lat/long + capture time) as a **separate DOM band** in the web Case Detail "Field Photos" card, and bakes
the map into the **case report** (base64 data URI). It deliberately left the **download** paths —
`GET /cases/:id/field-photos/:attachmentId/download` (single) and `GET /cases/:id/field-photos.zip` (bulk) —
streaming the **raw stored JPEG**, with the overlay living only in the browser.

Owner feedback (2026-06-26): a saved/shared field photo must be **self-contained** — when you open the
downloaded file (single or bulk), it should show the location + map **burned into the image**, exactly like
the *GPS Map Camera* phone app the field agents are used to. With the overlay web-only, a downloaded photo is
just a bare image with no location context.

The data and the seam already exist: every FIELD_PHOTO carries `geo_location` (lat/long/accuracy/timestamp,
ADR-0034) + a frozen `reverse_geocoded_address` (ADR-0040), the static map is available via the existing
`getStaticMapProvider().thumbnail(lat,lng)` (ADR-0060), and `sharp` is already the field-photo image tool
(ADR-0034, `platform/photo.ts`). So this is a presentation change on the download path, not new infrastructure.

## Decision

**Composite the same overlay band onto the bottom of the JPEG at download time** (single + bulk), server-side
with `sharp`, in a new `composeFieldPhotoOverlay()` in `platform/photo.ts`. The band mirrors the web
`PhotoOverlay` content: a square static-map inset (left) + `photoType · unitName` + the bold full address +
`Lat …, Long … (±Nm)` + the capture time (rendered in **IST**, the field zone / server TZ), white on a
semi-transparent black band. No migration, no new dependency, no new route — same endpoints, composited bytes.

- **The stored artifact stays RAW.** Only the *download copy* is composited; the evidence object in storage
  (the metadata-stripped original, ADR-0034) is never mutated. The web keeps its interactive DOM overlay
  (the Maps deep-link stays clickable); the report path is unchanged.
- **Fail-open, always.** A download must never break. If the photo has no coords/address (nothing to show),
  if the static map is unavailable (`thumbnail → null`, same fail-open as ADR-0060 — a text-only band still
  bakes), or if `sharp` throws on a non-image/corrupt buffer, `composeFieldPhotoOverlay` returns the
  **original bytes unchanged**. The overlay degrades, the photo always downloads.
- **Bulk zip** composites each photo the same way before the archiver appends it.

We rejected **baking the overlay into the stored artifact on upload**: it would destroy the raw evidence
photo (ADR-0034 keeps the metadata-stripped original as the chain-of-custody artifact) and couple the
overlay's look to historical rows. Compositing on read keeps the evidence pristine and lets the overlay style
evolve. We also rejected **rendering the band via Puppeteer/HTML** (the report path): per-photo Chromium
renders are far heavier than a `sharp` SVG composite for the same result.

## Consequences

### Positive
- Downloaded field photos (single + bulk) are self-contained — map + location burned in, GPS-Map-Camera style.
- Reuses the existing data, static-map seam, and `sharp`; no migration, dependency, or route change.
- Raw evidence artifact preserved; web + report unchanged.

### Negative
- Each download now does a `sharp` composite (+ one static-map fetch per photo). For a large bulk zip this is
  CPU/memory work done concurrently — bounded by the field-photo-per-case count; flagged with a `ponytail:`
  note to go sequential / cache if a case ever carries very many photos.
- The baked band depends on the **same `GOOGLE_GEOCODING_API_KEY` + Static Maps API** as the web overlay
  (ADR-0060). If that's misconfigured in an environment, the map inset is omitted (text-only band) — the same
  graceful degrade the web shows; **fixing the key/enablement is an ops task, separate from this code.**
- The download is re-encoded JPEG (quality 86), so it is not byte-identical to the stored original (expected).

## Alternatives Considered
- **Bake on upload into the stored artifact** — rejected (destroys raw evidence; freezes the look).
- **Keep downloads raw, overlay web-only (status quo, ADR-0060)** — rejected by owner; the saved file must carry the location.
- **Puppeteer/HTML render per photo** — rejected (much heavier than a `sharp` SVG composite for an identical band).

## Related ADRs
- ADR-0060 (the overlay + download contract this extends) · ADR-0034 (upload + `sharp` `platform/photo.ts`) · ADR-0040 (reverse-geocode address) · ADR-0026 (location ingest).
