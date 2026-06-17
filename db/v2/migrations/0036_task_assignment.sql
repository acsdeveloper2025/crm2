-- 0036_task_assignment.sql — Pipeline slice 2 (docs/specs/2026-06-11-pipeline-design.md §4).
-- (1) OCC on case_tasks assignment writes (CONCURRENCY standard — the ops carve-out activates
--     for assignment): `version` guards assign/unassign/bulk-assign; 409 STALE_UPDATE on mismatch.
-- (2) Append-only task_assignment_history (B-20 residual): every assignment event is a row —
--     reassignment never overwrites history. Immutable via audit_log_block_mutation() (0017).
-- (3) Indexes the Pipeline list actually sorts/filters on (created_at default sort, assigned_at
--     date filter). Forward-only, idempotent.

BEGIN;

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_case_tasks_created_at ON case_tasks (created_at);
CREATE INDEX IF NOT EXISTS idx_case_tasks_assigned_at ON case_tasks (assigned_at);

CREATE TABLE IF NOT EXISTS task_assignment_history (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id              uuid        NOT NULL REFERENCES case_tasks(id) ON DELETE CASCADE,
  case_id              uuid        NOT NULL,
  action               varchar(20) NOT NULL,
  assigned_to          uuid        REFERENCES users(id),
  previous_assigned_to uuid        REFERENCES users(id),
  visit_type           varchar(20),
  distance_band        varchar(20),
  bill_count           integer,
  assigned_by          uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_task_assignment_action CHECK (action IN ('ASSIGNED', 'REASSIGNED', 'UNASSIGNED'))
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_history_task
  ON task_assignment_history (task_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_task_assignment_history_immutable ON task_assignment_history;
CREATE TRIGGER trg_task_assignment_history_immutable
  BEFORE UPDATE OR DELETE ON task_assignment_history
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

COMMIT;
