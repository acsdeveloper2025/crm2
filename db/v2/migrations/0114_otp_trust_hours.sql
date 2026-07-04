-- 0114_otp_trust_hours.sql — per-role trusted-device window for the login OTP (ADR-0088 amendment,
-- owner 2026-07-04). FIXED window: trust expires N hours after the last successful OTP on that
-- device, regardless of activity ("input OTP every 24 hours"); re-verifying resets the clock.
-- Office/web roles = 24h (one code per device per ~day); FIELD_AGENT = 720h (30 days) so the
-- mobile app, once its OTP screen ships, costs ~1 SMS per agent per month, not per day.
-- Forward-only, idempotent; seed re-applies on a re-run — do not edit post-ship.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS otp_trust_hours integer NOT NULL DEFAULT 24;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_otp_trust_hours') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_otp_trust_hours
      CHECK (otp_trust_hours >= 1 AND otp_trust_hours <= 8760); -- 1 hour .. 1 year
  END IF;
END $$;

UPDATE roles SET otp_trust_hours = 720 WHERE code = 'FIELD_AGENT';
