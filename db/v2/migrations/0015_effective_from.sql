-- 0015_effective_from.sql — user-settable temporal usability gating for master data (ADR-0017).
-- Adds `effective_from timestamptz NOT NULL DEFAULT now()` to the seven master-data tables.
-- A row is USABLE when `is_active AND effective_from <= now()`. `is_active` stays the off-switch;
-- there is NO effective_to here (rates keeps its own model, ADR-0016). Existing rows backfill
-- effective_from = created_at so current data behaviour is unchanged.
-- Forward-only, idempotent: each column is added + backfilled ONLY if it does not yet exist, so
-- re-running never clobbers a user-set future effective_from.

BEGIN;

-- One guarded add+backfill per table (idempotent; backfill runs only on first add).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'verification_units', 'clients', 'products', 'rate_types',
    'locations', 'users', 'report_templates'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'effective_from'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN effective_from timestamptz NOT NULL DEFAULT now()', t);
      EXECUTE format('UPDATE %I SET effective_from = created_at', t);
    END IF;
  END LOOP;
END $$;

-- Index the gate predicate on the two read-hot / large tables (locations ~157k rows; users = login).
CREATE INDEX IF NOT EXISTS idx_locations_effective_from ON locations (effective_from);
CREATE INDEX IF NOT EXISTS idx_users_effective_from ON users (effective_from);

COMMIT;
