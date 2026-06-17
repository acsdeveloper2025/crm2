-- 0055_field_photo_attachments.sql — device FIELD-PHOTO columns on case_attachments (ADR-0034,
-- ADR-0032 slice 2c-2). The office reference-doc table (0042, ADR-0025 B2) is extended in place with
-- a `kind` discriminator + nullable device-photo metadata, rather than a parallel table. Office rows
-- keep kind='OFFICE_REF' (the default backfills existing rows) and leave the new columns null.
--   • kind            — OFFICE_REF (office reference doc) / FIELD_PHOTO (device verification photo).
--   • operation_id    — device idempotency key, stored '<base>:<fileIndex>' (v1 parity); a replay
--                       (same base) returns the cached rows. Partial-UNIQUE → at-most-once per file.
--   • photo_type      — 'verification' | 'selfie' (the device's photoType field).
--   • geo_location    — JSONB {latitude, longitude, accuracy, timestamp} captured at the photo.
--   • client_sha256   — the device-computed hash (transit verification; validated ^[0-9a-f]{64}$ or
--                       null). The existing `sha256` column carries the authoritative SERVER hash.
--   • hash_verified   — client_sha256 == server sha256 (logged, never rejected on mismatch).
--   • submission_id   — groups photos from one form submission.
--   • thumbnail_key   — object-storage key of the 200×200 thumbnail (null if thumbnailing failed).
--   • verification_type — the form type the photo belongs to (residence/office/…).
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

ALTER TABLE case_attachments
  ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'OFFICE_REF';
ALTER TABLE case_attachments DROP CONSTRAINT IF EXISTS chk_case_attachments_kind;
ALTER TABLE case_attachments ADD CONSTRAINT chk_case_attachments_kind
  CHECK (kind IN ('OFFICE_REF', 'FIELD_PHOTO'));

ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS operation_id      text;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS photo_type        varchar(20);
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS geo_location      jsonb;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS client_sha256     text;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS hash_verified     boolean;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS submission_id     text;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS thumbnail_key     text;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS verification_type varchar(50);

-- At-most-once per (device upload, file index): the idempotency key is unique when present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_attachments_operation
  ON case_attachments (operation_id) WHERE operation_id IS NOT NULL;

-- Replay lookup is by the base operation id (split before the ':'); index the field-photo rows.
CREATE INDEX IF NOT EXISTS idx_case_attachments_field_task
  ON case_attachments (task_id) WHERE kind = 'FIELD_PHOTO';

COMMIT;
