-- 0057_task_assignment_history_prev_idx.sql — supporting index for the sync down-sync delta query
-- (ADR-0035, lifecycle slice 2c-2 tail). `/api/v2/sync/download` populates `revokedAssignmentIds`
-- (tasks the device user was assigned but no longer is — reassigned/unassigned away) by filtering
-- task_assignment_history on `previous_assigned_to` + `created_at`. The table is append-only and
-- grows unbounded; the existing index is (task_id, created_at DESC) which does not serve this
-- predicate. Forward-only, idempotent.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_task_assignment_history_prev
  ON task_assignment_history (previous_assigned_to, created_at);

COMMIT;
