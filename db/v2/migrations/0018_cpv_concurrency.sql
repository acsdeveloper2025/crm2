-- 0018_cpv_concurrency.sql — OCC concurrency token for the CPV mapping tables (ADR-0019, C-10).
-- The two toggle-only enablement tables (client_products, client_product_verification_units)
-- lacked a `version` column, so their setActive toggles ran unguarded. This adds the integer
-- `version` token (backfill DEFAULT 1) so the guarded UPDATE (… SET version = version + 1 …
-- WHERE id = $id AND version = $expected) and the audit append can be wired in code per ADR-0019.
-- No created_by/updated_by columns are added: these tables never had them; the actor is captured
-- in the audit_log row (migration 0017). Forward-only, idempotent: the column is added only if
-- absent, so re-running never clobbers.

BEGIN;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['client_products', 'client_product_verification_units'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'version'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN version integer NOT NULL DEFAULT 1', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
