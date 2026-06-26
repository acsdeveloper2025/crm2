-- 0098_rate_universal_product_unit.sql — ADR-0071. Rates gain Universal product + Universal
-- verification unit: a rate scoped to ALL products / ALL units of a client (NULL = Universal),
-- mirroring rate_type_assignments (ADR-0069) and commission_rates dimensions (ADR-0050, mig 0079/0094).
-- product_id + verification_unit_id become NULLABLE; the no-overlap EXCLUDE COALESCEs both to -1 (like
-- the existing location/rate_type terms) so a Universal row and a specific row never collide while two
-- equal Universal rows still do. The billing resolver (RATE_LATERAL + cases TASK_VIEW_COLS/ratePreview)
-- wildcards both dims, most-specific wins (a specific rate ALWAYS outranks a Universal one).
-- Forward-only, idempotent. Applied once by the tracked runner; guarded for the 3× rerun test.

BEGIN;

-- Acquire ACCESS EXCLUSIVE on rates WITH A RETRY before the DDL, so a rolling deploy never hangs: the
-- still-serving old api holds brief ACCESS SHARE reads on rates (the billing rate resolver), which would
-- block ALTER COLUMN / the EXCLUDE rebuild below indefinitely. lock_timeout makes each attempt fail fast;
-- retry until a gap opens (its reads are sub-ms), then hold the lock for the rest of the transaction so the
-- ALTERs never re-wait. After ~40 tries we give up → the deploy goes RED and rolls back rather than wedging.
DO $$
DECLARE attempts int := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      LOCK TABLE rates IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempts := attempts + 1;
      IF attempts >= 40 THEN
        RAISE EXCEPTION 'rates: ACCESS EXCLUSIVE not acquired after % tries (old api still reading?)', attempts;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $$;

ALTER TABLE rates ALTER COLUMN product_id           DROP NOT NULL;
ALTER TABLE rates ALTER COLUMN verification_unit_id DROP NOT NULL;

-- Re-key the no-overlap EXCLUDE onto the COALESCEd product/unit so Universal (NULL) rows participate
-- (NULL≠NULL would otherwise let duplicate Universal rows slip past the exclusion). Drop-then-guarded-add.
ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_no_overlap;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_no_overlap') THEN
    ALTER TABLE rates ADD CONSTRAINT rates_no_overlap EXCLUDE USING gist (
      client_id WITH =,
      (COALESCE(product_id, -1)) WITH =,
      (COALESCE(verification_unit_id, -1)) WITH =,
      (COALESCE(location_id, -1)) WITH =,
      (COALESCE(rate_type_id, -1)) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;

COMMIT;
