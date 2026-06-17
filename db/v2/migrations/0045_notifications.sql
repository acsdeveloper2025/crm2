-- 0045_notifications.sql — in-app notification feed (ADR-0027 Phase 1).
-- Append-only per-user feed: the durable backing for the bell/badge and the mobile
-- GET /api/v2/notifications contract. Rows are INSERTed by producers (case-task assigned,
-- task completed / submitted-for-review, …) and only ever mutate `read_at` (mark-read);
-- the app never UPDATEs other columns and never hard-deletes (retention is a later purge job).
-- Own-user scoped at the query layer (WHERE user_id = actor) — identity, not a permission.
-- Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE, -- the recipient
  type        varchar(40) NOT NULL,
  title       text NOT NULL,
  body        text,
  -- action target ids the client navigates to (e.g. {"caseId":"…","taskId":"…"}); never PII.
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type varchar(20),
  read_at     timestamptz,                       -- NULL = unread
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_notifications_type CHECK (type IN (
    'CASE_TASK_ASSIGNED', 'CASE_TASK_REASSIGNED', 'TASK_COMPLETED',
    'TASK_SUBMITTED_FOR_REVIEW', 'TASK_REVOKED', 'CASE_ASSIGNED', 'SYSTEM'
  )),
  CONSTRAINT chk_notifications_action_type CHECK (
    action_type IS NULL OR action_type IN ('OPEN_CASE', 'OPEN_TASK', 'NAVIGATE')
  )
);

-- Feed read: newest-first per recipient.
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON notifications (user_id, created_at DESC);

-- Unread-count badge: partial index over only the unread rows.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id) WHERE read_at IS NULL;

COMMIT;
