-- 0046_notification_tokens.sql — FCM device token registry (ADR-0027 phase 2).
-- The device registers its FCM token via POST /api/v2/auth/notifications/register; push producers send
-- to a user's active tokens. `platform` is UPPERCASE-only (the v1 CHECK — the device sends UPPERCASE).
-- `token` is unique: a re-register upserts (a token can migrate to a new user/device). A token FCM
-- rejects as unregistered is deactivated (is_active=false), never hard-deleted.
-- Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token      text NOT NULL,
  platform   varchar(10) NOT NULL,
  device_id  text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_tokens_token UNIQUE (token),
  CONSTRAINT chk_notification_tokens_platform CHECK (platform IN ('IOS', 'ANDROID', 'WEB'))
);

-- Push fan-out reads a user's live tokens.
CREATE INDEX IF NOT EXISTS idx_notification_tokens_user_active
  ON notification_tokens (user_id) WHERE is_active;

COMMIT;
