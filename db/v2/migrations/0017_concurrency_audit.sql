-- 0017_concurrency_audit.sql — Optimistic Concurrency Control + generic append-only audit (ADR-0019, C-10).
-- Adds an integer `version` concurrency token to the editable master-data tables that lack one
-- (verification_units already has it), and a generic, IMMUTABLE audit_log for change history.
-- The guarded UPDATE (… SET …, version = version + 1 … WHERE id = $id AND version = $expected) and
-- the audit append are wired in code per module (Users is the first; others follow in their slices).
-- Forward-only, idempotent: columns/objects are added only if absent, so re-running never clobbers.
-- NOTE: hash-chaining + monthly partitioning + off-DB copy (the §1 production-hardening on top of
-- append-only) are deferred and tracked — this immutable append-only log satisfies the C-10 contract.

BEGIN;

-- 1) version token on the editable master tables that lack one (backfill DEFAULT 1).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['clients', 'products', 'locations', 'users', 'report_templates'];
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

-- 2) Generic append-only audit/change log (master data). One row per create/update/(de)activate.
CREATE TABLE IF NOT EXISTS audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type   text        NOT NULL,
  entity_id     text        NOT NULL,
  action        text        NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'ACTIVATE')),
  actor_id      text,
  before_data   jsonb,
  after_data    jsonb,
  version_after integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);

-- 3) Immutability: append-only. Block UPDATE/DELETE at the DB so history can never be rewritten.
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% is not permitted)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

COMMIT;
