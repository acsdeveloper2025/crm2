-- 0022_import_log.sql — Universal import audit record (IMPORT_EXPORT_STANDARD §7, B-14).
-- Every import (preview is read-only and NOT logged; only a confirmed import) writes one permanent,
-- append-only row: who imported what file, how many rows total/succeeded/failed, and how long it took.
-- Per-row writes still append to audit_log via the domain repository (free), so a confirmed import is
-- traceable both as a batch (here) and row-by-row (audit_log CREATE rows). Forward-only, idempotent.
-- Reuses audit_log_block_mutation() (0017) for append-only immutability.

BEGIN;

CREATE TABLE IF NOT EXISTS import_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource      text        NOT NULL,
  file_name     text,
  total_rows    integer     NOT NULL,
  success_rows  integer     NOT NULL,
  failed_rows   integer     NOT NULL,
  duration_ms   integer     NOT NULL,
  actor_id      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_log_resource ON import_log (resource, created_at DESC);

-- Append-only: block UPDATE/DELETE at the DB (reuses the generic guard from 0017).
DROP TRIGGER IF EXISTS trg_import_log_immutable ON import_log;
CREATE TRIGGER trg_import_log_immutable
  BEFORE UPDATE OR DELETE ON import_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

COMMIT;
