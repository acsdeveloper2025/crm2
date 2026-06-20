-- 0013_rate_management_flatten.sql — collapse Rate Management to ONE flat table (owner directive).
-- A rate IS a service-zone rate: one row = (client, product, verification_unit, location[pincode+area],
-- free-text rate_type, amount, effective dates). No separate rate-type catalog, eligibility, or
-- zone-rules tables. rate_type is free text the user adds. location is null for KYC units.
-- Forward-only, idempotent.

BEGIN;

-- 1. drop the eligibility gate (no catalog/eligibility anymore)
DROP TRIGGER IF EXISTS trg_rates_check_eligibility ON rates;
DROP FUNCTION IF EXISTS rates_check_eligibility();

-- 2-4. drop the old (rate_type_id-based) no-overlap + FK column; add the flat `rate_type` + `location_id`
--   columns + the new no-overlap EXCLUDE. `rate_type` is renamed to `client_rate_type` by 0083, and prod
--   RE-RUNS every migration on each deploy — so the rate_type column + its no-overlap key must be guarded
--   on the pre-rename state. A bare re-run would resurrect an empty `rate_type` column and rebuild
--   `rates_no_overlap` keyed on it (defeating the billing integrity guard). `location_id` is
--   rename-agnostic → always ensured. Runs on a fresh DB / first deploy; no-ops after the rename.
ALTER TABLE rates ADD COLUMN IF NOT EXISTS location_id integer REFERENCES locations(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'rates' AND column_name = 'client_rate_type') THEN
    ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_no_overlap; -- the old rate_type_id-based key
    ALTER TABLE rates ADD COLUMN IF NOT EXISTS rate_type varchar(60);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_no_overlap') THEN
      ALTER TABLE rates ADD CONSTRAINT rates_no_overlap EXCLUDE USING gist (
        client_id WITH =, product_id WITH =, verification_unit_id WITH =,
        (COALESCE(location_id, -1)) WITH =,
        (COALESCE(rate_type, '')) WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
      ) WHERE (is_active);
    END IF;
  END IF;
END $$;

-- 0012 re-adds the now-dead `rate_type_id` FK column on every re-run (ADD COLUMN IF NOT EXISTS); drop it
-- unconditionally (rename-agnostic) so it never lingers — by here the old rate_type_id-based no-overlap is
-- gone (dropped in the guard on a fresh DB; absent on a re-run), so the column drop is clean.
ALTER TABLE rates DROP COLUMN IF EXISTS rate_type_id;

CREATE INDEX IF NOT EXISTS idx_rates_resolve
  ON rates (client_id, product_id, verification_unit_id, location_id) WHERE is_active;

-- 5. drop the now-unused extra tables (catalog / eligibility / zone rules)
DROP TABLE IF EXISTS service_zone_rules CASCADE;
DROP TABLE IF EXISTS rate_type_eligibility CASCADE;
DROP TABLE IF EXISTS rate_types CASCADE;

COMMIT;
