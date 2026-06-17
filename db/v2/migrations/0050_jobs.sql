-- 0050_jobs.sql — background-job spine (B-7 / ADR-0030).
-- A durable record of long-running work (export ≥10k, large import, future report/MIS/billing).
-- Producers INSERT a PENDING row + dispatch; the runner (in-process in dev/tests, a BullMQ worker
-- on Valkey in prod) flips it RUNNING → SUCCEEDED|FAILED and writes `progress`/`stage`/`result`.
-- Own-user scoped at the query layer (WHERE created_by = actor) — a job is personal background work,
-- identity not a permission, exactly like notifications (0045). Append-mostly: only the runner
-- mutates status/progress/result; the app never hard-deletes (retention is a later purge job).
-- Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         varchar(40) NOT NULL,
  status       varchar(20) NOT NULL DEFAULT 'PENDING',
  -- 0..100 real progress (no fake %); the runner sets it per canonical stage map.
  progress     int NOT NULL DEFAULT 0,
  stage        text,                              -- human-readable current stage, e.g. 'Fetching rows'
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb, -- the job input (resource, filters, format…); never PII bytes
  result       jsonb,                             -- on success, e.g. {"storageKey":"…","filename":"…","rowCount":N}
  error        text,                              -- on failure, the AppError code/message (no stack)
  created_by   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,  -- the owner
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz,
  CONSTRAINT chk_jobs_type CHECK (type IN ('EXPORT', 'IMPORT')),
  CONSTRAINT chk_jobs_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT chk_jobs_progress CHECK (progress BETWEEN 0 AND 100)
);

-- Own-user job tray: newest-first per owner.
CREATE INDEX IF NOT EXISTS idx_jobs_owner_recent ON jobs (created_by, created_at DESC);

-- Background-job completion reaches the user through the existing bell (0045). Widen the type +
-- action_type CHECKs to carry JOB_COMPLETED / JOB_FAILED and a DOWNLOAD action (payload.jobId →
-- the FE fetches the result download URL). Drop-and-recreate the CHECKs (forward-only).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_type CHECK (type IN (
  'CASE_TASK_ASSIGNED', 'CASE_TASK_REASSIGNED', 'TASK_COMPLETED',
  'TASK_SUBMITTED_FOR_REVIEW', 'TASK_REVOKED', 'CASE_ASSIGNED', 'SYSTEM',
  'JOB_COMPLETED', 'JOB_FAILED'
));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_action_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_action_type CHECK (
  action_type IS NULL OR action_type IN ('OPEN_CASE', 'OPEN_TASK', 'NAVIGATE', 'DOWNLOAD')
);

COMMIT;
