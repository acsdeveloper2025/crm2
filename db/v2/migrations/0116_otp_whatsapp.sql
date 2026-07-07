-- 0116_otp_whatsapp.sql — add the WhatsApp delivery flag to login OTP challenges (ADR-0090).
-- Owner decision 2026-07-07: email + WhatsApp for ALL users (not field-gated); WhatsApp via AWS
-- End User Messaging (Social). `deliverOtp` fires a 3rd parallel leg; this column records whether
-- the WhatsApp leg went out for a given challenge (mirrors sent_email / sent_sms), so the resend
-- path can widen the delivered-channel set and the FE OTP step can show the masked WhatsApp target.
-- Forward-only, idempotent — safe to re-run.
ALTER TABLE auth_otp_challenges
  ADD COLUMN IF NOT EXISTS sent_whatsapp boolean NOT NULL DEFAULT false;
