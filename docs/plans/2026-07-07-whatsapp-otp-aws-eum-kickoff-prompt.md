# Kickoff prompt — WhatsApp OTP leg via AWS End User Messaging Social (ADR-0090)

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. You are the session that did
> the AWS migration (ADR-0087) and hold the AWS + Meta credentials. The email OTP leg is DONE + LIVE;
> India DLT blocked the SMS leg — this session **adds WhatsApp as the second delivery channel and
> activates it.** Owner decision (2026-07-07): **email + WhatsApp for ALL ~400 users (office + field),
> both channels on every OTP — NOT field-gated.**

---

## Decision (locked)
- **Provider = AWS End User Messaging Social** (`SendWhatsAppMessage`), chosen over Twilio (2.5× fee),
  AiSensy (cheaper ₹0.145 but new vendor), and SNS (SMS=DLT-dead, push=redundant-via-FCM + weak 2FA).
  Rationale: AWS-native — same ap-south-1 / IAM / bill as the migration, enterprise SLA.
- **Both email AND WhatsApp fire for every OTP, all users.** `deliverOtp` already sends all configured
  legs at once, so this is just a 3rd parallel leg — **NO role gate. Do not re-gate to field-only;
  the owner explicitly wants both channels for everyone.**
- **Accepted cost ≈ ₹1,470/mo** (~4,600 OTP/mo × ~₹0.32 = $0.002 AWS + ~₹0.145 Meta @ ₹85/$). ~96% is
  the 200 backend users' daily 24h re-OTP. Expected and accepted.
- **Meta Business Verification is REQUIRED** (not deferrable): all-users volume (~200–250 business-
  initiated msgs/day + resends) meets/exceeds Meta's 250/24h unverified cap.

## Already SHIPPED — do not rebuild
- ADR-0088 OTP login LIVE staging+prod: new-device gate, trusted-device windows (mig 0114 — office
  24h, FIELD_AGENT 720h), `auth_otp_challenges` table, cooldown + send-cap (max 3 deliveries/challenge,
  same code re-delivered), 5-attempt lockout, Unlock UI.
- ADR-0089 email leg LIVE (SES API transport, `MAIL_TRANSPORT=ses`, SES prod access granted 50k/day).
- `deliverOtp` (`apps/api/src/modules/auth/service.ts:148`) already fires all deliverable legs in
  parallel; email live, Fast2SMS SMS leg inert (DLT-blocked — **leave it, don't delete**; WhatsApp is
  added alongside).
- **AWS-SDK precedent already in the repo:** `apps/api/src/platform/mail/index.ts` dynamic-imports
  `@aws-sdk/client-sesv2` and calls `SendEmailCommand`. Deps `@aws-sdk/client-sesv2` + `@aws-sdk/client-s3`
  at `^3.1070`. **Mirror this pattern for WhatsApp.**

## Job A — AWS + Meta provisioning (you hold the creds; several steps gate everything)
1. AWS console → enable **End User Messaging Social**, region **ap-south-1**.
2. Add a **WhatsApp Business Account (WABA)** via the embedded Meta signup (Facebook Business login).
3. Register a **dedicated phone number NOT already on WhatsApp** → verify via SMS/voice OTP.
4. Meta **display-name review**.
5. **Meta Business Verification** — REQUIRED here (business registration / GST docs). Single open risk;
   a Meta process, distinct from the (blocked) TRAI DLT registration.
6. Create + submit a **Meta AUTHENTICATION template** (category = Authentication; body carries the code,
   with a copy-code button). Approval ~24h. Note the exact template name, language, and variable layout.
7. IAM: grant **`social-messaging:SendWhatsAppMessage`** to the prod EC2 instance role. Create an SNS
   topic + event destination for delivery receipts (recommended — feeds the cost/delivery metric).
8. Capture → env + `crm2/secrets/CREDENTIALS.md` (never git): **WABA ID, origination phone-number ID,
   template name, template language, region.**

**Staging auth note:** the staging box (49.50.119.155) is the OLD DC box, not AWS — no instance role.
It already authenticates to SES with static AWS keys in its `.env.prod`; add
`social-messaging:SendWhatsAppMessage` to that same IAM identity (or a sibling) so staging can send
WhatsApp for the staging-first test. Prod uses the instance role (no static keys).

## Job B — build the code seam (backend). Mirror `platform/sms.ts` (contract) + `platform/mail/index.ts` (AWS call)
1. **NEW `apps/api/src/platform/whatsapp.ts`** — `interface WhatsappSender { sendOtp(phone, code): Promise<boolean> }`;
   `whatsappConfigured(env)`, `getWhatsappSender()`, `setWhatsappSender()` (test inject), `disabledSender`
   (logs-and-skips when unset). Real sender: dynamic `await import('@aws-sdk/client-socialmessaging')` →
   `new SocialMessagingClient({ region })` → `SendWhatsAppMessageCommand`. Format phone to E.164
   (`+91` + `normalizeIndianMobile()` 10 digits — reuse from sms.ts). Best-effort: **never throw into the
   caller**; log one count-able `otp whatsapp sent` INFO per accepted message.
2. **`packages/config/src/index.ts`** — add env: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`,
   `WHATSAPP_TEMPLATE_LANG` (default `en_US`), `WHATSAPP_META_API_VERSION` (default `v20.0`). **Reuse the
   existing AWS region var** that SES/S3 already use (check the config schema — don't add a new one).
   `whatsappConfigured()` = phone-number-id + template-name both set.
3. **`modules/auth/service.ts`**:
   - `deliverOtp` (148–171): add `waLeg = whatsappConfigured() && phone10 !== null`; add a 3rd
     `Promise.all` leg; return `sentWhatsapp` in the result.
   - `OtpSentTo` (124–127): add `whatsapp: string | null`.
   - `sentToView` (129–137): add a `sentWhatsapp` param → `whatsapp: sentWhatsapp && creds.phone ? maskPhone(creds.phone) : null`.
   - Thread `sentWhatsapp` through EVERY `sentToView(...)` call + `recordOtpResend(...)` +
     `insertOtpChallenge(...)` in the resend/challenge block (~200–225).
4. **`modules/auth/repository.ts`**: OtpChallenge row type (~50) add `sentWhatsapp`; `activeOtpChallenge`
   SELECT (304) add `sent_whatsapp`; `insertOtpChallenge` (316–336) add input field + column;
   `recordOtpResend` (343) add param + widen the flag.
5. **`apps/api/package.json`**: add `@aws-sdk/client-socialmessaging` at `^3.1070` (match sibling AWS deps).
6. **Tests** — `modules/auth/__tests__/otp.api.test.ts`: inject a fake sender via `setWhatsappSender`,
   assert the WhatsApp leg fires alongside email, `sent_whatsapp` persists, resend re-delivers the same
   code without a fresh send inside cooldown.

## Job C — migration 0116 (NOT 0115 — that's `users_email_unique`)
`db/v2/migrations/0116_otp_whatsapp.sql`:
```sql
ALTER TABLE auth_otp_challenges ADD COLUMN sent_whatsapp boolean NOT NULL DEFAULT false;
```
Register via the tracked runner (`migrate.sh` + `schema_migrations`) — see `project_migration_runner_tracked_2026_06_26`.

## Job D — ADR-0090 (NOT 0089 — that's the SES transport)
`docs/adr/ADR-0090-whatsapp-otp-aws-eum.md` (use `_template.md`): new WhatsApp OTP channel via AWS EUM
Social; Impact / Alternatives (Twilio, AiSensy, SNS, ILDO) / Migration / cost. Additive to ADR-0088;
frozen-auth contract unchanged — **no new endpoint, `/api/v2` additive-only.**

## Job E — mobile display (follow-up release, NON-blocking)
Backend WhatsApp can activate WITHOUT this — the app just won't *label* the WhatsApp channel until
updated. In `crm-mobile-native` (latest tag v1.0.79 → v1.0.80):
- `src/screens/auth/LoginScreen.tsx`: `sentTo` type (204) + extraction (212–213) + `otpSentToLabel()`
  join (244–246) — add `whatsapp`.
- `src/api/schemas/auth.schema.ts`: add `whatsapp` to the sentTo shape (already `.passthrough()` →
  non-breaking).
- Normal mobile release rules (pin-check CI, pre-push review). Ship AFTER the backend leg is verified.

## Job F — activate STAGING first (owner hard rule), then PROD
1. Add the WhatsApp env vars to staging `/opt/crm2/secrets/.env.prod`, recreate ONLY the api container
   (see the SES/Fast2SMS flip template in `project_aws_migration_2026_07_04`). Seam test:
   `docker exec crm2_api node --input-type=module -e "const m=await import('/app/apps/api/src/platform/whatsapp.ts'); console.log(await m.getWhatsappSender().sendOtp('<10digits>','123456'))"`
2. Real end-to-end: set a phone on a staging user → log in from a fresh browser profile → WhatsApp code
   arrives on the owner's phone (email arrives too — both legs).
3. Cost-economy checks with real WhatsApp: resend inside TTL sends NO new message (same code, cap 3);
   wrong-code attempts trigger no send.
4. Prod flip only after staging verified + explicit owner OK: same env vars on prod EC2 `.env` (uses
   instance role — no static keys), recreate api. No code change to flip; code fixes go main→staging→promote.

## The `SendWhatsAppMessage` envelope — STARTING POINT, verify vs the live AWS API ref (versions move)
`message` is a Uint8Array blob of the WhatsApp Cloud API payload:
```js
new SendWhatsAppMessageCommand({
  originationPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  metaApiVersion: env.WHATSAPP_META_API_VERSION,           // "v20.0"
  message: new TextEncoder().encode(JSON.stringify({
    messaging_product: "whatsapp",
    to: e164,                                              // "+91XXXXXXXXXX"
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME,
      language: { code: env.WHATSAPP_TEMPLATE_LANG },      // "en_US"
      components: [
        { type: "body",   parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  })),
})
```
Confirm the body/button variable layout against YOUR approved template.
API ref: docs.aws.amazon.com/social-messaging/latest/APIReference/API_SendWhatsAppMessage.html ·
getting-started: docs.aws.amazon.com/social-messaging/latest/userguide/getting-started-whatsapp.html

## Operational facts (same boxes/deploy as the SES/Fast2SMS flips)
- Staging: `ssh -p 2232 -i ~/.ssh/github_actions_key root@49.50.119.155` · env `/opt/crm2/secrets/.env.prod`.
- Prod: `ssh -i ~/.ssh/crm2-aws.pem ubuntu@43.204.64.111` · same env path · RDS via `DATABASE_URL`.
- Deploys: push `main`→staging auto; promote `git push origin main:prod`→AWS prod. Full map:
  `project_dev_workflow_2026_07_04` + `crm2/secrets/CREDENTIALS.md`.
- Rules unchanged: `pnpm verify` green (integration tests need `DATABASE_URL` on :5433, `LC_ALL=C`),
  conventional commits (author Mayur, **NO AI/Co-Authored-By trailer**), never `--no-verify`, **ask before
  push/deploy/tag/live-DB writes**, never break mobile (`/api/v2` additive-only), no `any` /
  ts-suppressions / `eslint-disable` / `console.*` (use `@crm2/logger`), raw SQL only in repos+migrations.
- On completion: creds → `CREDENTIALS.md` + boxes' `.env` only (never git); update `CRM2_MASTER_MEMORY.md`
  §8 + memory files + `project_mobile_otp_delivery_decision_2026_07_06`.
