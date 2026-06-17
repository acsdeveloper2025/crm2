# ADR-0040 — Field-photo reverse-geocode (frozen address, async pipeline, DLQ)

**Status:** Accepted (2026-06-17) · **Supersedes/extends:** ADR-0026 (reverse-geocode seam)
**Epic:** S4 (field-report engine). **Migration:** 0065. **Owner-confirmed** design (2026-06-17).

## Context
Field photos carry a GPS fix captured at the shutter (`case_attachments.geo_location` jsonb, already
stored at ingest). The client report and the #7 gallery must show a human **address** per photo. We
mirror v1 (CRM-BACKEND `verification_attachments` + `reverseGeocodeQueue` + `reverse_geocode_dlq`),
adapted to v2's `case_attachments` (kind=`FIELD_PHOTO`, uuid ids).

Ground truth from v1 (read-only audit, 2026-06-17):
- The **device never reverse-geocodes** — `react-native-vision-camera` saves a raw (EXIF-stripped,
  **un-watermarked**) JPEG; `@react-native-community/geolocation` captures `{latitude, longitude,
  accuracy, altitude, speed, heading, timestamp}` at capture; the app uploads raw lat/lng via
  multipart. The address is overlaid by the **web at view time** from the stored coords.
- The **server** reverse-geocodes async-on-upload (BullMQ `reverse-geocode-backfill`, Google
  Geocoding, 3 retries), writes a **frozen** `reverse_geocoded_address`, with an **on-view
  write-through fallback** and a **DLQ** on retry-exhaustion.
- v2 already has the pieces: the Google geocode platform seam (`platform/geocode`, key-gated,
  null-degrades), a cache-first `geocodeService.reverse` + `geocode_cache`, a coord-only
  `GET /geocode/reverse`, and a BullMQ/Valkey jobs engine with an in-process fallback. The mapping
  (`case_id`/`task_id`/`submission_id`) already matches v1. **The gap is the freeze column + the
  async resolve/persist layer + surfacing.**

## Scope — `FIELD_PHOTO` ONLY (attachment ≠ photo)
`case_attachments` holds two distinct flows behind a `kind` discriminator (ADR-0034 / mig 0055):
- **`OFFICE_REF`** = office reference documents, uploaded raw octet-stream by the office and
  **downloaded BY the device** (backend → mobile, ADR-0025). No GPS. **Never reverse-geocoded.**
- **`FIELD_PHOTO`** = verification photos captured by the field executive and uploaded multipart
  (field/mobile → backend, ADR-0034). Carries `geo_location`.

Reverse-geocode applies **only to `kind='FIELD_PHOTO'`**. The resolver, the on-upload enqueue, the
on-view write-through, and the #7 caption MUST filter `kind='FIELD_PHOTO'`; the office octet-stream
upload path (ADR-0025) MUST NOT enqueue geocode. Mig 0065's column/CHECK/freeze sit on the shared
table (mig-0055 pattern) and are inert for `OFFICE_REF` rows (geo NULL → CHECK passes; address never
set → freeze never fires), but the *behavior* is photo-only by rule.

## Decision
1. **Schema (mig 0065, this ADR's foundation):** add `case_attachments.reverse_geocoded_address text`;
   a v1-parity geo-shape CHECK (`geo_location` NULL or numeric lat+lng); a **BEFORE-UPDATE freeze
   trigger** allowing exactly one transition NULL→address (evidence integrity — an attached photo's
   address can never be silently rewritten); and a `reverse_geocode_dlq` table (uuid attachment FK,
   one open row per attachment, admin-replayable).
2. **Dedicated geocode queue (NOT the generic jobs engine):** a lightweight `platform/geocode`
   queue mirroring v1's `reverseGeocodeQueue` and the jobs-engine degradation contract — Valkey
   present → a BullMQ worker (retries + DLQ on exhaustion); absent → in-process after the HTTP
   response (dev/tests need no Valkey). Chosen over a `GEOCODE` JobType because that engine emits
   user-facing progress + completion notifications (built for export/import) — noise for a silent
   per-photo background task.
3. **Resolve = idempotent + write-through-safe:** load the attachment; if address already set →
   return it; if no geo → null; else `geocodeService.reverse` (cache-first + Google) → persist via
   `UPDATE … SET reverse_geocoded_address WHERE id=$ AND reverse_geocoded_address IS NULL`
   (NULL-guarded, freeze-safe). The SAME resolve serves on-upload (via the queue) and on-view.
4. **On-view fallback:** the #7 gallery / report fetches a per-attachment address; a null one
   resolves+persists on first view (the recovery net for Valkey outages + pre-feature rows).
5. **Surfacing:** #7 caption = address + GPS (lat/lng) + accuracy(±Nm) + capture-time (derived from
   `geo_location.timestamp` — no new column) + photoType. The field-report/#9 photo context gains
   `reverseGeocodedAddress` (closes v1's own gap where the sealed report lacked per-photo address).

## Consequences / invariants
- Address is **frozen** at the DB level (trigger), not just app-level — tamper-evident.
- A missing key / Google miss degrades to raw coords + a Maps link; it never breaks a page or fails
  an upload (geocode is fire-and-forget; the photo is the evidence).
- DLQ captures only hard retry-exhaustion (not plain "no result"); admin-replayable.
- The device MUST NOT geocode (server-only key); re-assert on any mobile change.

## Build slices
- **Foundation (this commit):** migration 0065 + ADR. Schema-level freeze/CHECK/DLQ are valid standalone.
- **Slice A:** resolver + on-view write-through endpoint + #7 caption (SDK/repo/FE) — the user-visible feature.
- **Slice B:** dedicated async-on-upload queue + worker + DLQ insert + admin replay (pre-warm + reliability).
- **Slice C:** `reverseGeocodedAddress` in the #9 CASE_REPORT photo context (lands with S5).
