-- CRM2 — add Country to the location catalog (Admin: Location Management).
-- Migration 0006 · forward-only · idempotent.
-- The official India Post directory is country-scoped (India); we keep country explicit
-- so the catalog can extend beyond India later. Rule: a pincode may map to MANY areas
-- (enforced by uq_locations on (pincode, area)); area carries its own city/state/country.

BEGIN;

ALTER TABLE locations ADD COLUMN IF NOT EXISTS country varchar(100) NOT NULL DEFAULT 'India';

CREATE INDEX IF NOT EXISTS idx_locations_state_city ON locations (state, city) WHERE is_active;

COMMIT;
