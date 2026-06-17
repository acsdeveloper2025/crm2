-- 0054_task_lineage.sql — task lineage + office task-intervention RBAC (ADR-0033, ADR-0032 slice 3).
-- Two v1-parity office interventions on a settled/revoked task, BOTH lineage-linked to the parent and
-- BOTH gated by the new `task.rework` perm (BACKEND_USER + MANAGER; SUPER_ADMIN via grants_all):
--   • REVISIT (parent COMPLETED) — the client asks for more after delivery → a NEW task cloning the
--     completed parent re-opens the case (→ IN_PROGRESS) and is billed SEPARATELY (slice 5 reads
--     task_origin='REVISIT'). The device-side REVOKE already exists (slice 2c-1, task.execute).
--   • REASSIGN-AFTER-REVOKE (parent REVOKED) — a field user revoked the task; the office dispatches a
--     REPLACEMENT task (new row, parent_task_id=revoked, SAME task_origin, born ASSIGNED). NO extra
--     commission — it is the redo of unpaid/revoked work, not additional scope.
-- Columns:
--   • case_tasks.parent_task_id  — self-FK lineage (nullable; ORIGINAL tasks have none). ON DELETE NO
--                                  ACTION: lineage is immutable and there is no case_tasks delete path.
--   • case_tasks.task_origin     — ORIGINAL (default, backfills existing rows) / REVISIT. (RECHECK was
--                                  collapsed into REVISIT for v2 — KYC is a unit subtype here, not a
--                                  separate engine; a real distinction would re-add it in a 1-line mig.)
--   • idx_case_tasks_parent      — partial index for the lineage lookup (most tasks are ORIGINAL).
-- The frozen RBAC §8 named a backend revoke; the owner corrected it (2026-06-15): the backend NEVER
-- revokes — revoke is the device's, and a completed task is reworked via REVISIT, a revoked one via
-- REASSIGN. So there is NO `task.revoke` perm. Mirrors @crm2/access ROLE_PERMISSIONS (parity-tested).
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

-- ── Task lineage ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE case_tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES case_tasks(id) ON DELETE NO ACTION;

ALTER TABLE case_tasks
  ADD COLUMN IF NOT EXISTS task_origin varchar(20) NOT NULL DEFAULT 'ORIGINAL';

ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_tasks_task_origin;
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_tasks_task_origin
  CHECK (task_origin IN ('ORIGINAL', 'REVISIT'));

CREATE INDEX IF NOT EXISTS idx_case_tasks_parent
  ON case_tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

-- At most ONE OPEN revisit per parent (ADR-0033): the service pre-checks, but a partial UNIQUE index
-- is the race backstop — two concurrent revisits of the same COMPLETED parent must not both insert a
-- billable child (double-bill). Only an ACTIVE revisit child occupies the slot; once it completes or
-- is revoked it leaves the predicate, so a later revisit is allowed. The 23505 maps to 409
-- ACTIVE_REVISIT_EXISTS (branched on the constraint name; the task-number UNIQUE keeps its own 409).
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_tasks_active_revisit
  ON case_tasks (parent_task_id)
  WHERE task_origin = 'REVISIT' AND status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS');

-- ── RBAC: office task intervention — revisit + reassign-after-revoke (BACKEND_USER + MANAGER;
--    SUPER_ADMIN via grants_all). NO backend revoke (owner correction 2026-06-15). ────────────────
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('BACKEND_USER', 'task.rework'),
  ('MANAGER',      'task.rework')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
