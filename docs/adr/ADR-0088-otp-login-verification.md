# ADR-0088: OTP login verification — new-device second factor via email + SMS (Fast2SMS)

- **Status:** Accepted (owner design decisions 2026-07-04; built + verified the same day — production activation waits on SES + Fast2SMS provisioning, §Deploy steps)
- **Date:** 2026-07-04
- **Amends:** [ADR-0014](./ADR-0014-authentication-session-management.md) (login flow gains an OTP leg) · [ADR-0076](./ADR-0076-security-hardening-rate-limit-token-revocation-resource-guards.md) (logger redaction extended to OTPs).
- **Relates:** ADR-0021 (the provider-seam pattern this copies) · ADR-0043/0045 (server-driven login gates) · ADR-0022 (per-role config columns) · ADR-0054 (mobile contract — additive only).

## Context

Logins today are password (+ optional TOTP MFA) only. The owner wants OTP verification on login for
both web and mobile users, with two delivery channels — SMS via Fast2SMS and email — while keeping
SMS spend minimal. Owner decisions (2026-07-04, recorded verbatim):

1. **Model:** OTP as a **second factor on new/unrecognized devices only** (trusted-device memory) —
   not on every login.
2. **Scope/channel:** all roles; every OTP event sends the **same code on both channels at once**
   (email + SMS, whichever contact fields the user has).
3. **Email relay:** **AWS SES** (SMTP interface — the existing ADR-0021 mailer seam unchanged;
   domain verification + SMTP creds are a deploy step).
4. **Cost caps:** **no global or per-user daily caps for now**; keep per-code security limits and a
   visible daily-send metric.
5. **Trust window (owner, later on 2026-07-04):** a **FIXED per-role window** — trust expires N
   hours after the device's last OTP **regardless of activity** ("input OTP every 24 hours"), so a
   borrowed/temp device self-expires within a day. Office roles **24 h** (one code per device per
   day); **FIELD_AGENT 720 h (30 days)** so the mobile app, once its OTP screen ships, costs ~1 SMS
   per agent per month. Supersedes the original 180-day sliding window (mig 0114,
   `roles.otp_trust_hours`, editable in role admin).

Existing machinery this must reuse, not duplicate: the `mustChangePassword`/`mustEnrollMfa`/
`mustAcceptPolicies` server-driven gate pattern; the `mfaCode`-in-login challenge shape
(`MFA_REQUIRED` 401 → client re-submits login with the code); scrypt + JWT pair + per-account
lockout + per-IP login limiter (ADR-0014/0076); the ADR-0021 deferred-activation provider seam
(mailer live, inert until `SMTP_HOST`); `users.phone` (mig 0025) + `users.email`; web per-browser
`deviceId` (ADR-0045) and mobile `deviceId` already sent at login; per-role config columns
(`password_expiry_days`, `idle_logout_minutes`).

Fast2SMS (verified against docs.fast2sms.com 2026-07-04): `POST https://www.fast2sms.com/dev/otp/send`,
header `authorization: <API_KEY>`, body `mobile` (10-digit), `otp_id` (an OTP template configured in
the Fast2SMS panel — DLT approval lives there, not in our code), and optional **`otp`** = a
caller-supplied code, which is what lets one code serve both channels. Success = `{return:true,
status_code:200, request_id}`.

## Decision

### 1. Model — challenge on untrusted devices, inside `login()`

After the password verifies (and lockout/MFA checks), if **all** of: the role has
`otp_login_required`, the presented `deviceId` is not trusted for this user, and the user is **not
TOTP-enrolled** (an authenticator is a stronger second factor — those users keep the existing
`mfaCode` path and cost zero SMS) → the login is challenged.

### 2. Contract — no new endpoints; mirror the MFA challenge exactly

- `LoginSchema` gains additive optional **`otpCode`** (next to `mfaCode`).
- Challenged login **without** `otpCode` → create-or-reuse the active challenge, deliver the code,
  respond **401 `{error:'OTP_REQUIRED', sentTo:{email:<masked>|null, sms:<masked>|null}}`**.
- Re-submitting login without `otpCode` while a challenge is live = **resend**: the **same code** is
  re-delivered only if the 60 s cooldown has passed and the challenge has been sent < 3 times;
  otherwise no send occurs (response unchanged). A resend never mints a new code or a new SMS while
  the old code is valid.
- Login **with** `otpCode` → verify: success mints tokens **and trusts the device**; a wrong code
  increments the per-code attempt counter (5 → challenge invalidated) **and** counts toward the
  account lockout (same rule as wrong `mfaCode`, AUTHENTICATION-01).
- No `deviceId` presented (raw API caller) → never trusted, challenged every login.
- Mobile fleet safety (ADR-0054): everything is additive; the **per-role flag is the release gate**
  — `FIELD_AGENT` seeds OFF and is flipped ON in role admin (no deploy) once the updated app ships
  an OTP screen. Web enforcement starts immediately for office roles.

### 3. Delivery — both channels, one code, two seams

- **Email:** the existing `getMailer()` (ADR-0021). SES SMTP creds go into each box's `.env`
  (`SMTP_HOST=email-smtp.ap-south-1.amazonaws.com`, port 587, SES SMTP user/pass, `MAIL_FROM` a
  verified identity). No code change to the seam.
- **SMS:** new **`platform/sms.ts`** copying the ADR-0021 seam verbatim: `interface SmsSender {
  sendOtp(phone, code): Promise<boolean> }`, factory returns the Fast2SMS sender only when
  `FAST2SMS_API_KEY` + `FAST2SMS_OTP_TEMPLATE_ID` are set, else a disabled sender that
  logs-and-skips; injectable for tests (`setSmsSender`). Implementation = native `fetch` to
  `/dev/otp/send` with our code — **zero new dependencies**. Send is best-effort per channel; the
  challenge stands if at least one channel delivered.
- **Deferred activation:** if neither channel can deliver for a user (no configured provider
  reaches any contact the user has), the gate **logs a warning and lets the login through** —
  the ADR-0021 "inert until provisioned" philosophy; a hard gate that bricks every login on a
  missing env var or an un-provisioned staging box is worse than a temporarily-open one. Once
  providers are live, a user with neither email nor phone is the same case (admin must fill a
  contact field; login meanwhile works and warns).

### 4. Data (migration 0113)

- **`auth_otp_challenges`** — `id uuid`, `user_id` FK, `purpose` (`'LOGIN'`; text for future
  flows), `device_id`, `code_encrypted` (AES-256-GCM via the existing `platform/encryption.ts` +
  `MFA_ENC_KEY` — the same at-rest scheme as TOTP secrets; verify = decrypt + `timingSafeEqual`.
  **Not a one-way hash on purpose:** the resend rule re-delivers the *same* still-valid code, which
  a hash cannot do; a KDF also buys nothing for a 6-digit/5-attempt/5-minute code),
  `expires_at` (now+5 min), `attempts int`, `send_count int`, `last_sent_at`, `sent_email bool`,
  `sent_sms bool`, `consumed_at`, `created_ip`, `created_at`. One active challenge per
  (user, device); expired/consumed rows pruned opportunistically.
- **`auth_trusted_devices`** — `user_id` FK, `device_id`, `trusted_at`, `last_seen_at`,
  `UNIQUE(user_id, device_id)`. Trust = row exists **and** `trusted_at > now() − role.otp_trust_hours`
  — a **fixed** window from the last OTP; logins never extend it (`last_seen_at` is audit-only), and
  a successful re-verify resets `trusted_at` (owner decision 5; mig 0114 adds
  `roles.otp_trust_hours`, default 24, FIELD_AGENT 720). Revocation = delete the row (admin UI
  deferred).
- **`roles.otp_login_required boolean NOT NULL DEFAULT false`** — seeded `true` for SUPER_ADMIN,
  MANAGER, TEAM_LEADER, BACKEND_USER, KYC_VERIFIER; `false` for FIELD_AGENT (see §2). Surfaced via
  `getRoleAttributes` + the existing OCC role-admin editor, like `idle_logout_minutes`.

### 5. Limits & cost visibility (no daily caps — owner)

Constants (not env — they never vary per box): 6-digit code, 5-min TTL, 60 s resend cooldown,
≤ 3 sends per challenge, ≤ 5 verify attempts per code. The per-IP login limiter (ADR-0076) already
caps request floods, and challenge-reuse means an attacker hammering login cannot make the system
send more than 3 SMS per victim per 5 minutes. Every SMS send emits a structured
`logger.info('otp sms sent', { userId, requestId })`; `auth_otp_challenges.sent_sms` makes daily
counts a one-line query. Caps can be added later without schema change.

### 6. Security notes

- Codes are stored **encrypted at rest only** (never plaintext); never in a response or log.
  `@crm2/logger`'s `SENSITIVE_KEY` regex gains `otp` so any `otp`/`otpCode` field redacts.
- The challenge is bound to `(user, device, purpose)`; verifying it on a different device fails.
- `OTP_REQUIRED` is only reachable **after** a correct password → it leaks no more account
  existence than login already does; the masked `sentTo` reveals only what the authenticated-
  password holder could learn anyway.
- Wrong OTP codes feed the account lockout — no unbounded grinding (mirrors MFA).

## Consequences

### Positive
- Daily logins on known devices are friction-free and cost ₹0; SMS spend ≈ new devices only.
- Zero new endpoints, zero new dependencies, one new platform seam, one migration — the whole
  feature is the existing MFA/gate/seam patterns applied once more.
- Mobile fleet cannot break: nothing existing changes shape; enforcement per role is a DB flag.

### Negative
- Login without a configured provider (or a contact-less user) is warn-and-allow until
  provisioning completes — a deliberate deferred-activation window, visible in logs.
- Password re-submitted on resend (it's the same login endpoint) — same TLS surface as login
  itself; accepted to avoid a challenge-token endpoint trio.
- `auth_otp_challenges` accrues rows; pruned opportunistically on challenge creation (delete
  expired > 24 h old), same lightweight approach as `auth_refresh_tokens`.

## Alternatives considered
- **Dedicated `/auth/otp/{request,verify,resend}` endpoints** — rejected: three routes + a
  challenge-id round-trip to model what the proven `mfaCode` login shape already models; more
  mobile-contract surface for the same behaviour.
- **Fast2SMS-managed OTP (their generate + verify APIs)** — rejected: the SMS code would diverge
  from the email code (owner wants one code on both channels) and moves auth state outside our DB.
- **OTP on every login / passwordless** — rejected by owner (cost; UX/contract blast radius).
- **scrypt-hashing the OTP** — rejected: 6-digit codes with a 5-attempt cap don't need a KDF;
  scrypt on the login path was the ADR-0076 threadpool-DoS vector.
- **Per-user/global daily SMS caps** — deferred by owner ("no caps for now"); the schema already
  records enough to add them without migration.

## Deploy steps (owner)
1. **SES:** verify `allcheckservices.com` (3 DKIM CNAMEs in Hostinger DNS) in SES `ap-south-1`,
   request production access, create SMTP credentials; set `SMTP_HOST/PORT/USER/PASSWORD` +
   `MAIL_FROM` in each box's `.env` (staging + prod separately — secrets are per-box).
2. **Fast2SMS:** create an OTP template in the panel (DLT there), supply `FAST2SMS_API_KEY` +
   `FAST2SMS_OTP_TEMPLATE_ID` for prod `.env` (staging may stay disabled or use a test key).
3. Flip `FIELD_AGENT.otp_login_required` ON only when the OTP-capable mobile build is released.
