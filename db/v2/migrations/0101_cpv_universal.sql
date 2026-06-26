-- 0101_cpv_universal.sql — ADR-0074. A CPV mapping (client+product → verification unit) can be
-- "Universal (all units)": verification_unit_id becomes NULLABLE, NULL = all units (mirrors rates /
-- rate_type_assignments). The unique key swaps to NULLS NOT DISTINCT (PG18, like mig 0096) so a single
-- Universal NULL row per client_product dedupes. The available-units resolver returns every active unit
-- when a Universal CPV exists. Forward-only, idempotent.

BEGIN;

-- Acquire ACCESS EXCLUSIVE on the cpvu table WITH A RETRY before the DDL, so a rolling deploy never hangs:
-- the still-serving old api reads it (case-creation availableUnits) and would block the ALTERs. lock_timeout
-- fails each attempt fast; retry until a gap opens, then hold the lock for the rest of the txn (see 0097/0098).
DO $$
DECLARE attempts int := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      LOCK TABLE client_product_verification_units IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempts := attempts + 1;
      IF attempts >= 40 THEN
        RAISE EXCEPTION 'client_product_verification_units: ACCESS EXCLUSIVE not acquired after % tries (old api still reading?)', attempts;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $$;

ALTER TABLE client_product_verification_units ALTER COLUMN verification_unit_id DROP NOT NULL;

-- Swap uq_cpvu to NULLS NOT DISTINCT so two Universal (NULL) rows for the same client_product collide.
ALTER TABLE client_product_verification_units DROP CONSTRAINT IF EXISTS uq_cpvu;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_cpvu') THEN
    ALTER TABLE client_product_verification_units
      ADD CONSTRAINT uq_cpvu UNIQUE NULLS NOT DISTINCT (client_product_id, verification_unit_id);
  END IF;
END $$;

COMMIT;
