-- CRM2 — Location catalog seed (official All-India Pincode Directory).
-- Source: Dept of Posts "All India Pincode Directory" (data.gov.in), fetched from the
-- Feb-2025 Wayback snapshot; trimmed+deduped to (pincode, area, city, state) in
-- db/v2/seed/locations_india.tsv.gz (157,072 rows · 19,300 pincodes · 36 states/UTs).
-- country defaults to 'India'. Idempotent: ON CONFLICT (pincode, area) DO NOTHING.
-- Run from the repo root: psql "$DATABASE_URL" -f db/v2/seed/locations.seed.sql
BEGIN;
CREATE TEMP TABLE _loc_stage (pincode text, area text, city text, state text);
\copy _loc_stage FROM PROGRAM 'gzip -dc db/v2/seed/locations_india.tsv.gz' WITH (FORMAT text)
INSERT INTO locations (pincode, area, city, state, country)
SELECT pincode, area, city, state, 'India' FROM _loc_stage
ON CONFLICT (pincode, area) DO NOTHING;
DROP TABLE _loc_stage;
COMMIT;
