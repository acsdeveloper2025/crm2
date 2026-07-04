-- 0115: unique (case-insensitive) email per user — backs sign-in-with-email (ADR-0088 follow-up).
-- Partial: NULL emails are allowed to coexist (legacy rows created before email became required
-- at the API; the OTP gate warn-and-allows those users until an admin fills their email in).
-- Verified 0 duplicate emails on prod and staging before shipping.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq
  ON users (lower(email))
  WHERE email IS NOT NULL;
