-- 0019_rates_concurrency.sql — OCC concurrency token for the rates table (ADR-0019, C-10).
-- rates is effective-dated (ADR-0018) and the 0013 flatten dropped its version column, so its
-- guarded updates (updateAmount / setActive / revise) ran without a concurrency token. This adds the
-- integer `version` token (backfill DEFAULT 1) so the guarded UPDATE (… SET …, version = version + 1
-- … WHERE id = $id AND version = $expected) can be wired in code per ADR-0019. rates keeps its OWN
-- domain history table `rate_history` (CONCURRENCY_AND_EDITING_STANDARD §2: effective-dated domains
-- keep their domain history), so NO audit_log wiring here. Forward-only, idempotent: the column is
-- added only if absent, so re-running never clobbers.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rates' AND column_name = 'version'
  ) THEN
    ALTER TABLE rates ADD COLUMN version integer NOT NULL DEFAULT 1;
  END IF;
END $$;

COMMIT;
