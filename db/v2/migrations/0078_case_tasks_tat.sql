-- 0078_case_tasks_tat.sql — per-task target TAT + measured completed-in elapsed (ADR-0044).
-- tat_hours = the assigned target band; completed_elapsed_minutes = immutable elapsed assigned->completed.
-- Forward-only, idempotent. due_at/overdue/completed-in-band are DERIVED at read time (not stored).

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS tat_hours integer;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS completed_elapsed_minutes integer;

-- backfill target TAT from the legacy priority enum (ADR-0044 locked mapping), only where unset
UPDATE case_tasks SET tat_hours = CASE priority
    WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 8 WHEN 'MEDIUM' THEN 24 WHEN 'LOW' THEN 48 ELSE 24 END
  WHERE tat_hours IS NULL;

-- backfill measured elapsed for already-completed tasks (assigned->completed; fall back to created)
UPDATE case_tasks
  SET completed_elapsed_minutes =
    CEIL(EXTRACT(EPOCH FROM (completed_at - COALESCE(assigned_at, created_at))) / 60)::int
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND completed_elapsed_minutes IS NULL;
