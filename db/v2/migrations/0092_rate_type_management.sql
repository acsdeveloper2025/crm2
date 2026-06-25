-- 0092_rate_type_management.sql — ADR-0064 Phase A. Promote the rate_types catalog (mig 0014) to a
-- managed master-data entity: add name/description/category/version, backfill name for the 18 seeds,
-- and add the OFFICE row (desk/location-less commission band). Forward-only, idempotent, re-run-safe.
-- NO FK / resolution changes here (that is Phase C, mig 0094).

BEGIN;

ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS name        varchar(100);
ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS category    varchar(10) NOT NULL DEFAULT 'FIELD';
ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS version     integer     NOT NULL DEFAULT 1;

-- category CHECK (guarded so the re-run does not error on a duplicate constraint).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rate_types_category') THEN
    ALTER TABLE rate_types
      ADD CONSTRAINT chk_rate_types_category CHECK (category IN ('FIELD', 'OFFICE'));
  END IF;
END $$;

-- Seed the human label from the code for any row that lacks one (the 18 from mig 0014); admin can edit.
UPDATE rate_types SET name = code WHERE name IS NULL;

-- name is required going forward (now backfilled on every existing row → safe + idempotent).
ALTER TABLE rate_types ALTER COLUMN name SET NOT NULL;

-- OFFICE: the desk/KYC band — location-less commission keys on it (Phase C). Idempotent.
INSERT INTO rate_types (code, name, category, sort_order)
VALUES ('OFFICE', 'Office', 'OFFICE', 5)
ON CONFLICT (code) DO NOTHING;

COMMIT;
