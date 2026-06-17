# ADR-0034: Device field-photo upload (multipart + sharp)

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

ADR-0032 slice 2c-2 completes the field-execution ingest spine with the device's
**photo/evidence** upload on `/api/v2`. The device (crm-mobile-native, on
`/api/mobile` until the slice-6 rebase) posts photos as **multipart/form-data**
(`POST /api/mobile/verification-tasks/:taskId/attachments`): a `files[]` array
plus form fields `photoType`, `operationId`, `clientSha256`, `geoLocation`
(JSON), `verificationType`, `submissionId`, and an `Idempotency-Key` header.
This shape is **locked** (ADR-0012) — the `/api/v2` endpoint must accept it
byte-compatibly so the slice-6 rebase is path-only.

Two gaps in v2:
- **No multipart parser.** Office reference uploads (ADR-0025 B2) are raw
  `octet-stream`; `express.raw()` cannot parse `multipart/form-data`.
- **No device-photo schema.** `case_attachments` (mig 0042) holds only office
  reference docs — no geo, photo type, idempotency key, or evidence-hash columns.

v1 also runs server-side image work (sharp thumbnails) and computes a server-side
SHA-256 as the authoritative evidence hash (IT Act §65B), verifying it against the
client hash (logged, never rejected, for rollout safety).

## Decision

We add **`multer`** (multipart) and **`sharp`** (image processing) — both
CTO-approved in `ALLOWED_DEPENDENCIES.md` — and build
**`POST /api/v2/verification-tasks/:id/attachments`** in the `verification-tasks`
module, gated `task.execute` with the same `assigned_to = actor` ownership bind
(→ 404) as the other device endpoints.

- **multer** is memory-storage only (bytes flow to the ADR-0021 storage seam,
  never disk), with a bounded file count and per-file size limit.
- **sharp** (lazy-imported in `platform/photo`) auto-orients, **strips
  EXIF/metadata** (defensive — the client also strips), bounds the decode
  (`limitInputPixels`, decompression-bomb defense), and produces a 200×200
  thumbnail. Thumbnail failure is non-fatal (the stripped original still stores).
  Field photos carry a tighter size cap (`MAX_FIELD_PHOTO_BYTES`, 15 MiB) and a
  bounded batch (`MAX_FIELD_PHOTOS`, 10) than the 25 MiB office-document path.
- **Schema:** extend `case_attachments` (mig 0055) rather than a second table —
  a `kind` discriminator (`OFFICE_REF` default / `FIELD_PHOTO`) plus nullable
  device columns (`operation_id`, `photo_type`, `geo_location`, `client_sha256`,
  `hash_verified`, `submission_id`, `thumbnail_key`, `verification_type`). The
  existing `sha256` column carries the **server** hash (authoritative); office
  rows are untouched.
- **Idempotency** mirrors v1: `operation_id = '<base>:<fileIndex>'` (partial
  UNIQUE); a replay (same base, `split_part(operation_id,':',1)`) returns **200**
  with the cached rows — it does **not** re-store. Unlike start/complete/revoke,
  there is **no 409-as-success**: a genuine conflict is a real failure the device
  retries (the idempotency key makes the retry safe).
- **Hash:** `client_sha256` is validated `^[0-9a-f]{64}$` (else null, never
  rejected); `hash_verified` = client == server; a mismatch is logged, not
  rejected (rollout safety).
- **Response** is the locked `{success, message, data:{attachments, failed,
  caseId, taskId, verificationType, submissionId}}` envelope (the device's shape),
  not the v2 raw-JSON convention — isolated to this device endpoint.

## Consequences

### Positive

- The device photo path is ready on `/api/v2`; slice 6 is a path-only rebase.
- Server-side EXIF strip + evidence hash hold even if a future client skips them.
- One attachments table (office + field) with a clear `kind` discriminator.

### Negative

- Two new runtime deps. `sharp` carries native (libvips) binaries; `multer`
  buffers in memory (bounded). Both are lazy/scoped to the upload path.
- The endpoint can't be validated against a real device until slice 6 — covered
  by contract tests asserting the locked field names + response shape + replay.

## Alternatives Considered

- **Reuse `express.raw()` (octet-stream), one file at a time.** Rejected: breaks
  the locked multipart contract (`files[]` + form fields) → not a path-only rebase.
- **A separate `verification_attachments` table (v1 shape).** Rejected: the
  kickoff scoped reuse of `case_attachments`; a `kind` discriminator + nullable
  columns avoids a parallel table and a second storage/list path.
- **No sharp (client EXIF-strip only, no server thumbnail).** Rejected by the
  owner — full v1 parity (defensive server strip + thumbnail) was chosen.

## Related ADRs

- ADR-0032 — the lifecycle slice this completes (2c-2).
- ADR-0021 — the object-storage seam reused for bytes + thumbnails.
- ADR-0025 — the office reference-attachment table (B2) extended here.
- ADR-0012 — the locked mobile contract this endpoint reproduces.
