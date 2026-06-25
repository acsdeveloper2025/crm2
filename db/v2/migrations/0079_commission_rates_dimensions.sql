-- 0079_commission_rates_dimensions.sql — commission_rates gains location, product,
-- verification-unit, and TAT-band dimensions, decoupled from the client rate (ADR-0046).
-- rate_type is retained as an OPTIONAL executive classification label (no longer a resolution
-- key) — kept in the no-overlap key as COALESCE(rate_type,'') so existing rows never collide.
-- The GiST no-overlap EXCLUDE + resolve index generalize to the coalesced dimension tuple.
-- Existing rows: all new columns NULL => the "applies generally" default for their (user, client).
-- Additive, forward-only, idempotent. Preserves effective-dating + OCC.
BEGIN;

ALTER TABLE commission_rates
  ADD COLUMN IF NOT EXISTS location_id          integer REFERENCES locations (id),
  ADD COLUMN IF NOT EXISTS product_id           integer REFERENCES products (id),
  ADD COLUMN IF NOT EXISTS verification_unit_id integer REFERENCES verification_units (id),
  ADD COLUMN IF NOT EXISTS tat_band             integer;            -- tat_hours | -1 overflow | NULL=any

-- `rate_type` is renamed to `field_rate_type` by 0083, which Phase C (0094) then FK-converts to
-- `rate_type_id` and DROPS. Since prod RE-RUNS every migration on every deploy, this rate_type-touching
-- block must NOT execute once the rename OR the FK conversion has happened (it would reference a column
-- that no longer exists → hard error). Guard it on the pre-rename state AND the absence of the Phase C FK:
-- it runs on a fresh DB / the first deploy (before 0083), then no-ops on every subsequent re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'commission_rates' AND column_name = 'field_rate_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'commission_rates' AND column_name = 'rate_type_id') THEN
    ALTER TABLE commission_rates ALTER COLUMN rate_type DROP NOT NULL;

    ALTER TABLE commission_rates DROP CONSTRAINT IF EXISTS commission_rates_no_overlap;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rates_no_overlap') THEN
      ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_no_overlap EXCLUDE USING gist (
        user_id WITH =,
        (COALESCE(location_id, -1)) WITH =,
        (COALESCE(client_id, -1)) WITH =,
        (COALESCE(product_id, -1)) WITH =,
        (COALESCE(verification_unit_id, -1)) WITH =,
        (COALESCE(tat_band, 0)) WITH =,
        (COALESCE(rate_type, '')) WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
      ) WHERE (is_active);
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_commission_rates_resolve;
CREATE INDEX IF NOT EXISTS idx_commission_rates_resolve
  ON commission_rates (user_id, location_id, client_id, product_id, verification_unit_id, tat_band)
  WHERE is_active;

COMMIT;
