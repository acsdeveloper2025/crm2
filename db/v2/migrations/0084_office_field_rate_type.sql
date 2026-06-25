-- ADR-0050 (office commission): desk/office work earns a FLAT commission, keyed by a third
-- field-rate-type value 'OFFICE' (auto-stamped on OFFICE tasks). One change:
--   Widen case_tasks.field_rate_type CHECK to allow 'OFFICE' (was LOCAL/OGL only).
--
-- The OFFICE assignment pool stays KYC_VERIFIER (the office executive, set in 0039). That role
-- is INTENTIONALLY read-only on task completion: the office exec only relays the task to the
-- authorised external source over email and forwards the response back — it never closes the
-- task. The report + close is done by BACKEND_USER (+ MANAGER/TEAM_LEADER, granted in 0085),
-- which the complete endpoint allows by permission + scope (completion is NOT assignee-bound).
-- Idempotent (re-run safe).
DO $$
BEGIN
  -- field_rate_type domain: LOCAL | OGL | OFFICE (still nullable for unassigned tasks).
  -- Phase C (0094) FK-converts field_rate_type → rate_type_id and DROPS the column; once it's gone this
  -- block (which ADDs a CHECK referencing field_rate_type) must no-op on re-run, or it hard-errors.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'case_tasks' AND column_name = 'field_rate_type') THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_field_rate_type') THEN
      ALTER TABLE case_tasks DROP CONSTRAINT chk_case_task_field_rate_type;
    END IF;
    ALTER TABLE case_tasks
      ADD CONSTRAINT chk_case_task_field_rate_type
      CHECK (field_rate_type IS NULL OR field_rate_type IN ('LOCAL', 'OGL', 'OFFICE'));
  END IF;
END $$;
