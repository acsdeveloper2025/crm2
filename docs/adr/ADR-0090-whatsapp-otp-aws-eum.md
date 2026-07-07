# ADR-0090: WhatsApp OTP delivery via AWS End User Messaging (Social)

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

ADR-0088 shipped new-device login OTP with two delivery legs: email (live via SES,
ADR-0089) and SMS via Fast2SMS. The SMS leg is **inert** — India TRAI DLT registration
for the transactional SMS route is blocked, so SMS OTP cannot deliver. Field agents and
any user without reliable email need a working second channel. Owner decision (2026-07-07):
**email + WhatsApp for ALL ~400 users** (office + field), both channels on every OTP —
not field-gated. Accepted cost ≈ ₹1,470/mo.

## Decision

Add **WhatsApp as a third OTP delivery leg** via **AWS End User Messaging (Social)** —
`SendWhatsAppMessage`, same `ap-south-1` account/IAM/bill as the rest of the platform.

- New seam `apps/api/src/platform/whatsapp.ts` mirrors the SMS seam (`sms.ts`) contract and
  the SES transport's lazy AWS-SDK pattern (`@aws-sdk/client-socialmessaging`, dynamic
  import so other deployments never load it). Best-effort: a send failure never throws into
  the login path.
- `deliverOtp` (auth/service.ts) fires the WhatsApp leg in the same `Promise.all` as email
  and SMS — same code on every channel. `whatsappConfigured()` is true only when
  `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_TEMPLATE_NAME` are set (deferred activation: the
  code ships inert; WABA + Meta Business Verification + template approval + env are the
  deploy steps).
- Migration 0116 adds `auth_otp_challenges.sent_whatsapp` (mirrors `sent_email`/`sent_sms`)
  so the resend path widens the delivered-channel set and the FE OTP step shows the masked
  WhatsApp target. `sentTo` gains a `whatsapp` field (additive — mobile `.passthrough()`).
- Credentials resolve via the SDK default chain (prod EC2 instance role) or the static AWS
  keys already on the staging box; region is shared with SES (`SES_REGION`).
- No new endpoint; `/api/v2` unchanged (additive-only). The Fast2SMS SMS leg is LEFT in
  place (inert) — WhatsApp is added alongside, not a replacement.

## Consequences

### Positive
- A working, high-open-rate second OTP channel for all users; unblocks the SMS-dead gap.
- AWS-native — one region, one bill, enterprise SLA; reuses the SES/S3 SDK precedent.
- Same deferred-activation safety as email/SMS: prod ships inert, activates by env flip.

### Negative
- **Meta Business Verification is required** (all-users volume exceeds Meta's 250/24h
  unverified cap) — an external, owner-side gate on activation.
- WhatsApp per-message + AWS fee (~₹0.32/OTP); ~96% of cost is the 200 backend users'
  daily 24h re-OTP. Expected and accepted.
- Adds `@aws-sdk/client-socialmessaging` to the api image.

## Alternatives Considered
- **Twilio WhatsApp** — 2.5× the AWS per-message fee; new vendor, separate bill.
- **AiSensy** — cheaper Meta rate but an unproven new vendor and integration.
- **AWS SNS** — SMS route is DLT-dead (same block as Fast2SMS); push is redundant with FCM
  and a weak 2FA channel.
- **Wait for DLT unblock** — indefinite; leaves users on email-only.

## Related ADRs
- ADR-0088 — OTP login (the gate this extends).
- ADR-0089 — SES API transport (the AWS-SDK lazy-import pattern mirrored here).
- ADR-0021 — the seam pattern (interface-first, deferred activation).
