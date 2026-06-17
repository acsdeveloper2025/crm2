-- 0065_field_photo_reverse_geocode.sql — frozen reverse-geocoded address for field photos (ADR-0040,
-- S4). v1 parity (CRM-BACKEND verification_attachments + reverseGeocodeQueue + reverse_geocode_dlq),
-- adapted to v2's case_attachments (kind='FIELD_PHOTO', uuid ids). The DEVICE never geocodes — it sends
-- raw {latitude,longitude,accuracy,timestamp} in geo_location (already stored at upload); the SERVER
-- reverse-geocodes async-on-upload (platform/geocode queue) and freezes the result here. on-view
-- write-through backfills any row the worker missed (Valkey outage / pre-feature rows).
--   • reverse_geocoded_address — Google formatted_address, frozen NULL→address by a BEFORE-UPDATE
--     trigger (evidence integrity: an attached photo's address can never be silently rewritten).
--   • geo CHECK — v1 chk_*_geo_location_shape: geo_location is NULL or carries numeric lat+lng.
--   • reverse_geocode_dlq — dead-letter for geocode jobs that exhaust BullMQ retries; admin-replayable.
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto on verify) → dev:54329 (psql -f).

BEGIN;

ALTER TABLE case_attachments
  ADD COLUMN IF NOT EXISTS reverse_geocoded_address text;

-- v1 parity: a present geo_location must carry numeric latitude + longitude (else it is NULL).
ALTER TABLE case_attachments DROP CONSTRAINT IF EXISTS chk_case_attachments_geo_location_shape;
ALTER TABLE case_attachments ADD CONSTRAINT chk_case_attachments_geo_location_shape
  CHECK (
    geo_location IS NULL
    OR (
      (geo_location ? 'latitude')
      AND (geo_location ? 'longitude')
      AND jsonb_typeof(geo_location -> 'latitude') = 'number'
      AND jsonb_typeof(geo_location -> 'longitude') = 'number'
    )
  );

-- Freeze: allow exactly one transition NULL → address. Any later change (address → different, or
-- address → NULL) is blocked at the DB so verification evidence cannot be re-written silently.
CREATE OR REPLACE FUNCTION case_attachments_freeze_geocoded_address() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reverse_geocoded_address IS NOT NULL
     AND NEW.reverse_geocoded_address IS DISTINCT FROM OLD.reverse_geocoded_address
  THEN
    RAISE EXCEPTION
      'case_attachments.reverse_geocoded_address is immutable once set (attachment id=%)', OLD.id
      USING HINT = 'The reverse-geocoded address is frozen for evidence integrity.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_attachments_freeze_address ON case_attachments;
CREATE TRIGGER trg_case_attachments_freeze_address
  BEFORE UPDATE ON case_attachments
  FOR EACH ROW EXECUTE FUNCTION case_attachments_freeze_geocoded_address();

-- Dead-letter queue: reverse-geocode jobs that exhausted retries (Google outage / billing lapse).
-- Admin-replayable; the attachment stays address-less (on-view fallback still tries) until replayed.
CREATE TABLE IF NOT EXISTS reverse_geocode_dlq (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES case_attachments(id) ON DELETE CASCADE,
  latitude      numeric(10, 7) NOT NULL,
  longitude     numeric(11, 7) NOT NULL,
  error         text NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  replayed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_reverse_geocode_dlq_attachment
  ON reverse_geocode_dlq (attachment_id);
-- One open DLQ row per attachment (a replay clears replayed_at; re-fail re-inserts a fresh open row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_reverse_geocode_dlq_open
  ON reverse_geocode_dlq (attachment_id) WHERE replayed_at IS NULL;

COMMIT;
