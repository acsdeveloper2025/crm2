-- 0076_notification_delivery_lifecycle.sql — per-recipient delivery lifecycle for notifications (ADR-0027).
-- Restores the v1 delivery-side lifecycle the v2 feed lacked (v1 had sent_at/delivered_at/delivery_status;
-- v2 tracked only read_at). The feed is already per-recipient (one row per user), so this adds the
-- "was it sent / did it reach a device" axis alongside the existing "was it read" axis.
--   notifications.sent_at        — when the live delivery legs were attempted (socket emit + FCM).
--   notifications.delivered_at   — optimistic "reached a device": FCM accepted >=1 token (as v1).
--   notifications.delivery_status— PENDING -> SENT -> DELIVERED (FAILED/ACKNOWLEDGED reserved for a
--                                  future client-confirmed-receipt path; no client posts one today).
-- Additive: existing rows backfill to PENDING (delivery state was never recorded pre-0076); the feed
-- read-path (read_at, unread count) is untouched. Forward-only, idempotent.

BEGIN;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_status varchar(20) NOT NULL DEFAULT 'PENDING';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notifications_delivery_status') THEN
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_delivery_status
      CHECK (delivery_status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'ACKNOWLEDGED'));
  END IF;
END $$;

COMMIT;
