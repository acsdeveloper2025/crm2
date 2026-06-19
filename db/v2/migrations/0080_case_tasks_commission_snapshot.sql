-- 0080_case_tasks_commission_snapshot.sql — persist the field executive's resolved commission on the
-- task at completion (ADR-0046 §4 "snapshot at finalize", persisted form; owner 2026-06-19).
-- The amount is resolved via COMMISSION_LATERAL at the completion moment (point-in-time) and stamped
-- here so it is authoritative and immune to later rate edits/deletes. The billing read-model prefers
-- this column (COALESCE) for completed tasks, falling back to the live lateral for pre-migration rows.
-- Additive, nullable (NULL = not yet stamped / pre-migration), forward-only, idempotent.
BEGIN;

ALTER TABLE case_tasks
  ADD COLUMN IF NOT EXISTS commission_amount numeric(12,2) CHECK (commission_amount >= 0);

COMMIT;
