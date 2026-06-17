-- 0013_rate_management_flatten.sql — collapse Rate Management to ONE flat table (owner directive).
-- A rate IS a service-zone rate: one row = (client, product, verification_unit, location[pincode+area],
-- free-text rate_type, amount, effective dates). No separate rate-type catalog, eligibility, or
-- zone-rules tables. rate_type is free text the user adds. location is null for KYC units.
-- Forward-only, idempotent.

BEGIN;

-- 1. drop the eligibility gate (no catalog/eligibility anymore)
DROP TRIGGER IF EXISTS trg_rates_check_eligibility ON rates;
DROP FUNCTION IF EXISTS rates_check_eligibility();

-- 2. drop the old (rate_type_id-based) no-overlap exclusion + the FK column
ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_no_overlap;
ALTER TABLE rates DROP COLUMN IF EXISTS rate_type_id;

-- 3. flat columns: free-text rate_type + optional geography (a locations row = pincode+area)
ALTER TABLE rates
  ADD COLUMN IF NOT EXISTS rate_type   varchar(60),
  ADD COLUMN IF NOT EXISTS location_id integer REFERENCES locations(id);

-- 4. one active rate per (client, product, VU, location, rate_type) over a time range
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_no_overlap') THEN
    ALTER TABLE rates ADD CONSTRAINT rates_no_overlap EXCLUDE USING gist (
      client_id WITH =, product_id WITH =, verification_unit_id WITH =,
      (COALESCE(location_id, -1)) WITH =,
      (COALESCE(rate_type, '')) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rates_resolve
  ON rates (client_id, product_id, verification_unit_id, location_id) WHERE is_active;

-- 5. drop the now-unused extra tables (catalog / eligibility / zone rules)
DROP TABLE IF EXISTS service_zone_rules CASCADE;
DROP TABLE IF EXISTS rate_type_eligibility CASCADE;
DROP TABLE IF EXISTS rate_types CASCADE;

COMMIT;
