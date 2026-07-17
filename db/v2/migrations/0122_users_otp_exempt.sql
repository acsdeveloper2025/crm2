-- 0122_users_otp_exempt.sql — per-user new-device OTP exemption (review-only).
--
-- Google Play's reviewer must sign into the login-gated field app, but every
-- FIELD_AGENT login triggers the ADR-0088 new-device OTP gate and the reviewer
-- cannot receive the code sent to the account's email/phone. This flag, checked
-- in auth.login's OTP branch, exempts a SINGLE named reviewer account so it logs
-- in with username + password only.
--
-- Security surface is deliberately minimal: there is NO API and NO UI that sets
-- this column. It is flipped true ONLY by a manual, audited UPDATE on the one
-- reviewer account, so no request path can ever exempt an account. Defaults
-- false; every real agent keeps the OTP gate unchanged.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_exempt boolean NOT NULL DEFAULT false;

COMMIT;
