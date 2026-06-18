-- 0068_notification_crud_parity.sql — mobile notification CRUD parity (ADR-0027, mobile compat).
-- The v1 field app manages its own feed: soft-delete (trash) + restore, per-task mute
-- (WhatsApp-style, optional TTL), and per-user delivery preferences. v2 shipped only
-- list / read / mark-all-read; this adds the rest ADDITIVELY (ADR-0011). The feed stays
-- append-only EXCEPT `read_at` (existing) and now `deleted_at` (trash).
--   • notifications.deleted_at      — NULL = visible in feed; non-null = in trash (restorable).
--   • notification_mutes            — per-user suppression of a task's notifications; UPSERT on
--                                     (user_id, task_id) refreshes expires_at (re-mute is idempotent).
--                                     case_id kept nullable for the web case-level mute (mobile = task only).
--   • notification_preferences      — single JSON row per user (channel/type delivery toggles).
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

-- Trash (soft-delete) on the existing append-only feed.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Visible-feed read path: newest-first per recipient with trashed rows excluded.
CREATE INDEX IF NOT EXISTS idx_notifications_user_active
  ON notifications (user_id, created_at DESC) WHERE deleted_at IS NULL;

-- Per-task mute. At least one target; mobile always sets task_id. Active = expires_at NULL or future.
CREATE TABLE IF NOT EXISTS notification_mutes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  case_id    uuid,
  task_id    uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_notification_mutes_target CHECK (case_id IS NOT NULL OR task_id IS NOT NULL)
);
-- One active mute row per (user, task): re-muting UPSERTs the TTL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_mutes_user_task
  ON notification_mutes (user_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_mutes_user
  ON notification_mutes (user_id);

-- Per-user delivery preferences (one row; JSON of channel/type toggles).
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
