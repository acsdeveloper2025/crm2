-- 0011_task_assignment.sql — Task Assignment (operations, ADR-0015 §1.3b / §4 step 1).
-- A case_task is assigned to a field/KYC executive with the assignment-time attributes that
-- drive the field visit and billing: visit type (SITE / NO_VISIT desk), distance band
-- (LOCAL / OGL), and bill count. Assignment is a state on the task (assigned_to already
-- exists from 0010); these columns capture the rest. Reassignment overwrites in place
-- (assignment history lands with the append-only audit chain — deferred). Forward-only.

ALTER TABLE case_tasks
  ADD COLUMN IF NOT EXISTS visit_type     varchar(20),
  ADD COLUMN IF NOT EXISTS bill_count     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_by    uuid,
  ADD COLUMN IF NOT EXISTS assigned_at    timestamptz;

-- `distance_band` is renamed to `field_rate_type` by 0083, which Phase C (0094) then FK-converts to
-- `rate_type_id` and DROPS. prod RE-RUNS every migration on each deploy, so guard this block on BOTH the
-- pre-rename state (field_rate_type absent) AND the absence of the Phase C FK (rate_type_id) — else a
-- post-conversion re-run resurrects an empty `distance_band` + the stale `chk_case_task_distance_band`.
-- Runs on a fresh DB / first deploy; no-ops after the rename AND after the FK conversion.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'case_tasks' AND column_name = 'field_rate_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'case_tasks' AND column_name = 'rate_type_id') THEN
    ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS distance_band varchar(10);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_distance_band') THEN
      ALTER TABLE case_tasks
        ADD CONSTRAINT chk_case_task_distance_band
        CHECK (distance_band IS NULL OR distance_band IN ('LOCAL', 'OGL'));
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_visit_type') THEN
    ALTER TABLE case_tasks
      ADD CONSTRAINT chk_case_task_visit_type
      CHECK (visit_type IS NULL OR visit_type IN ('SITE', 'NO_VISIT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_bill_count') THEN
    ALTER TABLE case_tasks
      ADD CONSTRAINT chk_case_task_bill_count CHECK (bill_count >= 0);
  END IF;
END $$;
