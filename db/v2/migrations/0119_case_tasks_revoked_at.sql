-- 0119 — case_tasks.revoked_at: when the task was pulled off its agent.
--
-- Owner 2026-07-15: "show both TATs — the first field user with his name, and the 2nd user's TAT."
-- A revoke+reassign already produces two rows (the REVOKED original keeps its agent, its assigned_at
-- and its tat_hours; the replacement is a new row with a fresh clock), so both agents and both targets
-- are already stored. The one thing missing was WHEN the first agent stopped holding it — without it we
-- cannot say "held 6h of 24h", so the first agent's stretch was invisible on every screen.
--
-- The sibling of started_at (0052) / submitted_at (0081) / completed_at (0041): a per-task lifecycle
-- stamp. `updated_at` is NOT a substitute — any later write moves it.
--
-- Overdue is untouched: a REVOKED task is still never "out of TAT" (nobody is holding it) — see
-- apps/api/src/platform/tat/overdue.ts. `held` is a backward-looking fact, not a live breach.

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

COMMENT ON COLUMN case_tasks.revoked_at IS
  'When the task was revoked (pulled off its agent). NULL unless status = REVOKED. Set once by '
  'revokeTaskInPlace; with assigned_at it yields how long the agent actually held the task.';

-- Backfill from the append-only audit trail, which recorded the exact revoke moment
-- (appendAudit: after_data = {"status":"REVOKED", ...}). Accurate, not a guess from updated_at.
-- Idempotent: only fills rows that are REVOKED and still NULL. Earliest event wins if a task was
-- somehow revoked more than once (the first revoke is the one that ended the agent's hold).
UPDATE case_tasks ct
   SET revoked_at = a.first_revoked_at
  FROM (
    SELECT entity_id, min(created_at) AS first_revoked_at
      FROM audit_log
     WHERE entity_type = 'case_task'
       AND after_data->>'status' = 'REVOKED'
     GROUP BY entity_id
  ) a
 WHERE ct.id::text = a.entity_id
   AND ct.status = 'REVOKED'
   AND ct.revoked_at IS NULL;

-- A REVOKED row that predates the audit trail (or whose event was pruned) keeps revoked_at NULL — the
-- UI then shows no "held" figure rather than inventing one from updated_at.

-- Partial index: the only readers filter on the revoked set, which is a small slice of the table.
CREATE INDEX IF NOT EXISTS idx_case_tasks_revoked_at
    ON case_tasks (revoked_at)
 WHERE status = 'REVOKED';
