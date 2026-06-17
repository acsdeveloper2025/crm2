-- 0016_cpv_effective_from.sql — extend the Effective-From temporal standard (ADR-0017) to the CPV
-- enablement join tables, so a client-product link and a unit enablement can be scheduled to go
-- live on a future date (client/product/unit onboarding). USABLE ⇔ is_active AND effective_from <= now().
-- Forward-only, idempotent: add + backfill ONLY if the column does not yet exist (never clobbers a
-- user-set future effective_from on re-run).

BEGIN;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['client_products', 'client_product_verification_units'];
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

COMMIT;
