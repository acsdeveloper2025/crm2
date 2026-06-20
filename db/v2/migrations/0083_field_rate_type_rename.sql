-- ADR-0050: name the two rate types explicitly and consistently.
--   * CLIENT rate type (LOCAL/OGL) → resolves the client BILL (Rate Management):
--       rates.rate_type            → rates.client_rate_type
--   * FIELD-EXECUTIVE rate type (LOCAL/OGL, set by the office at assignment) → resolves the executive
--     COMMISSION (Commission Management); historically called `distance_band` on the task:
--       commission_rates.rate_type → commission_rates.field_rate_type
--       case_tasks.distance_band   → case_tasks.field_rate_type
-- Postgres RENAME COLUMN auto-updates the dependent EXCLUDE/CHECK constraint + index expressions, so no
-- constraint recreation is needed. Idempotent (re-run safe).
DO $$
BEGIN
  -- CLIENT rate type
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'rates' AND column_name = 'rate_type') THEN
    ALTER TABLE rates RENAME COLUMN rate_type TO client_rate_type;
  END IF;

  -- FIELD-EXECUTIVE rate type (commission config)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'commission_rates' AND column_name = 'rate_type') THEN
    ALTER TABLE commission_rates RENAME COLUMN rate_type TO field_rate_type;
  END IF;

  -- FIELD-EXECUTIVE rate type (per-task, set at assignment) — was `distance_band`
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'case_tasks' AND column_name = 'distance_band') THEN
    ALTER TABLE case_tasks RENAME COLUMN distance_band TO field_rate_type;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_distance_band') THEN
    ALTER TABLE case_tasks RENAME CONSTRAINT chk_case_task_distance_band TO chk_case_task_field_rate_type;
  END IF;

  -- FIELD-EXECUTIVE rate type (append-only assignment history, 0036) — was `distance_band`
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'task_assignment_history' AND column_name = 'distance_band') THEN
    ALTER TABLE task_assignment_history RENAME COLUMN distance_band TO field_rate_type;
  END IF;
END $$;
