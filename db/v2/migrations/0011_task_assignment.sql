-- 0011_task_assignment.sql — Task Assignment (operations, ADR-0015 §1.3b / §4 step 1).
-- A case_task is assigned to a field/KYC executive with the assignment-time attributes that
-- drive the field visit and billing: visit type (SITE / NO_VISIT desk), distance band
-- (LOCAL / OGL), and bill count. Assignment is a state on the task (assigned_to already
-- exists from 0010); these columns capture the rest. Reassignment overwrites in place
-- (assignment history lands with the append-only audit chain — deferred). Forward-only.

ALTER TABLE case_tasks
  ADD COLUMN IF NOT EXISTS visit_type     varchar(20),
  ADD COLUMN IF NOT EXISTS distance_band  varchar(10),
  ADD COLUMN IF NOT EXISTS bill_count     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_by    uuid,
  ADD COLUMN IF NOT EXISTS assigned_at    timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_visit_type') THEN
    ALTER TABLE case_tasks
      ADD CONSTRAINT chk_case_task_visit_type
      CHECK (visit_type IS NULL OR visit_type IN ('SITE', 'NO_VISIT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_distance_band') THEN
    ALTER TABLE case_tasks
      ADD CONSTRAINT chk_case_task_distance_band
      CHECK (distance_band IS NULL OR distance_band IN ('LOCAL', 'OGL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_bill_count') THEN
    ALTER TABLE case_tasks
      ADD CONSTRAINT chk_case_task_bill_count CHECK (bill_count >= 0);
  END IF;
END $$;
