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
  -- Phase C (0094) FK-converts client_rate_type → rate_type_id; the managed catalog gains `category` (0092).
  -- Gate this legacy free-text-rate_type setup on the PRE-managed-catalog state so a post-conversion re-run
  -- does NOT resurrect `rate_type` + a stale no-overlap (it must run only on fresh-DB pass-1, before 0092/0094).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'rates' AND column_name = 'client_rate_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'rate_types' AND column_name = 'category') THEN
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

-- 0012 re-adds the now-dead `rate_type_id` FK column (ADD COLUMN IF NOT EXISTS). On fresh-DB pass-1 the
-- block above added the transient `rate_type` free-text column → drop the dead `rate_type_id` then (0094
-- re-adds it as the real FK + backfills from client_rate_type). After Phase C (0094) `rate_type_id` is the
-- LIVE FK and `rate_type` is gone → the guard below SKIPS, preserving the FK + its data (else a re-run
-- would drop the FK and 0094 can't re-backfill — client_rate_type is gone → all rates lose their rate type).
-- Marker: `rate_type` exists only transiently on fresh-DB pass-1, between this block and the 0083 rename.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'rates' AND column_name = 'rate_type') THEN
    ALTER TABLE rates DROP COLUMN IF EXISTS rate_type_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rates_resolve
  ON rates (client_id, product_id, verification_unit_id, location_id) WHERE is_active;

-- 5. drop the now-unused extra tables. service_zone_rules + rate_type_eligibility are 0012-only and always
-- dead → drop unconditionally. BUT `rate_types` was PROMOTED to the managed FK catalog (Phase A, mig 0092
-- adds `category`) + is FK'd by rate_type_assignments (0093) and rates/commission_rates/case_tasks (0094).
-- Dropping it CASCADE on every re-run would wipe the catalog (resetting ids + admin edits) and CASCADE-drop
-- those FKs/assignment rows. Guard the catalog drop on the PRE-managed state (no `category`): it drops only
-- the legacy 0012 catalog on fresh-DB pass-1 (0014 re-creates it right after), then no-ops forever after 0092.
DROP TABLE IF EXISTS service_zone_rules CASCADE;
DROP TABLE IF EXISTS rate_type_eligibility CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'rate_types' AND column_name = 'category') THEN
    DROP TABLE IF EXISTS rate_types CASCADE;
  END IF;
END $$;

COMMIT;
