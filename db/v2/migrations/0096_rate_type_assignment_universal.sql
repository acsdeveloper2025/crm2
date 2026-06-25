-- 0096_rate_type_assignment_universal.sql — ADR-0069 (amends ADR-0067). Make rate_type_assignments
-- product/unit Universal-able: drop NOT NULL on product_id + verification_unit_id (NULL = Universal / all),
-- and make the unique key NULLS NOT DISTINCT so a Universal NULL row is a single value the bulk-set
-- ON CONFLICT upsert can dedupe (the default NULLS DISTINCT would let duplicate Universal rows in).
-- Forward-only, idempotent, re-run-safe. No money-path change. (PG18 supports NULLS NOT DISTINCT.)
-- Existing rows are all non-NULL → unaffected. The nullable FK columns keep their FK constraints (a NULL
-- value is simply not checked). idx_rta_combo (partial) is NULL-tolerant → untouched.

BEGIN;

ALTER TABLE rate_type_assignments ALTER COLUMN product_id           DROP NOT NULL;
ALTER TABLE rate_type_assignments ALTER COLUMN verification_unit_id DROP NOT NULL;

-- Swap the unique key to NULLS NOT DISTINCT (drop the old, re-add guarded — idempotent on re-run:
-- 0093 sees the constraint already present and skips, then this re-adds the NULLS-NOT-DISTINCT form).
ALTER TABLE rate_type_assignments DROP CONSTRAINT IF EXISTS uq_rate_type_assignment;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_rate_type_assignment') THEN
    ALTER TABLE rate_type_assignments
      ADD CONSTRAINT uq_rate_type_assignment
      UNIQUE NULLS NOT DISTINCT (client_id, product_id, verification_unit_id, rate_type_id);
  END IF;
END $$;

COMMIT;
