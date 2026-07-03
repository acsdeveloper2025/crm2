# Kickoff prompt — OTP-based authentication (SMS via Fast2SMS + Email), web + mobile

> Paste this into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`.

---

We are adding **OTP-based authentication** to CRM2 for **both web (frontend) users and mobile (field-agent) users**, with **two delivery channels: SMS OTP via Fast2SMS and email OTP**. Owner will supply the Fast2SMS API key (and DLT template details) when asked.

## Read first (standard session start + auth-specific)

1. `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` §8 (live status) → `SESSION_KICKOFF.md`.
2. **Auth-related ADRs — read all before designing** (in `docs/adr/`):
   - **ADR-0014** authentication & session management (the base: scrypt passwords, JWT access + refresh rotation)
   - **ADR-0043** login policy acceptance gate · **ADR-0045** idle logout + 12h session cap (FIELD_AGENT exempt)
   - **ADR-0076** security hardening — rate limiting, token kill-switch (`users.tokens_valid_after`), refresh family-revoke, httpOnly refresh cookie, logger redaction (OTPs must be redacted too)
   - **ADR-0054** v2-native mobile contract (additive-only; NEVER break the installed mobile fleet)
   - **ADR-0021** storage seam — the *pattern to copy* for the SMS provider seam (interface + deferred-activation: unset env → disabled provider, clean 503, never a crash)
3. Existing auth code: `apps/api/src/modules/auth/` (service/controller/repository — login lockout after N failed attempts, MFA TOTP already exists via `user_mfa_secrets` + `platform/totp.ts`), `platform/password.ts`, `packages/config/src/index.ts` (env schema; `MAIL_FROM` exists — find/verify the mailer), web `apps/web` login flow, mobile repo `crm-mobile-native` login + `src/config`.
4. Memory files: `project_dev_workflow_2026_07_04` (edit→staging→prod flow — **test on staging first, promote only after owner OK**), `project_security_hardening_2026_06_27`, `project_aws_migration_2026_07_04` (infra; staging and prod have SEPARATE secrets).

## What to build (design first, then ADR, then code)

- **Decide with the owner** (AskUserQuestion, one at a time — owner prefers that): OTP as (a) second factor after password, (b) passwordless login option, or (c) only for specific flows (first login on a new device / password reset / sensitive actions)? Which flows get SMS vs email vs user's choice?
- New **ADR-0088** (next free number; next migration = **0113**) covering: OTP model, channels, provider seam, cost controls. Frozen architecture — no new packages/patterns without the ADR.
- **Fast2SMS integration** as a platform seam (`platform/sms.ts` mirroring the ADR-0021 storage seam): interface `sendOtp(phone, code)`, provider selected by env (`FAST2SMS_API_KEY` etc. in `/opt/crm2/secrets/.env.prod` on each box — NEVER in git; staging can run with the provider disabled or a test key). Fast2SMS specifics to verify against their current docs: DLT-approved template + sender ID for transactional OTP route, template variables, error handling, delivery reports.
- **Email OTP** through the existing mail path (verify what `MAIL_FROM` is wired to; if there is no real SMTP sender yet, that becomes part of the ADR).
- **DB (mig 0113)**: hashed OTP codes (never plaintext — treat like passwords), purpose, channel, expiry, attempt counter, per-user/per-day counters. Raw SQL in repositories only.
- **API**: additive `/api/v2` endpoints only (request-otp, verify-otp, resend). Mobile fleet must keep working un-updated (ADR-0054); mobile app changes ship release-gated in `crm-mobile-native`.
- **Web**: via `@crm2/sdk` only; keyboard-accessible OTP input (repo a11y standards); uppercase rules don't apply to OTP fields but check ADR-0058 predicate doesn't uppercase them accidentally.

## OTP economy — minimize messages/day (owner explicitly wants low SMS cost)

Design these in from the start:
1. **Trusted-device memory**: OTP only on NEW device/browser (long-lived device token after first success) — not on every login; refresh-token rotation already keeps sessions alive (ADR-0014/0076).
2. **Email first, SMS on request** (email is free; SMS costs per message) — or role-based: office users email, field users SMS.
3. **Resend cooldown** (45–60s) + **max resends** per request (2–3) + same code stays valid across resends within its TTL (5 min) — a resend must NOT generate a new SMS if the old one is still valid.
4. **Per-user daily cap** + per-IP rate limit (extend the ADR-0076 limiter; align 429 semantics).
5. **Existing TOTP-MFA users skip SMS entirely** — authenticator app satisfies the OTP step at zero cost.
6. Attempt limit per code (3–5) then invalidate — prevents brute force AND resend-storms.
7. Log + expose a daily-SMS-count metric so cost creep is visible (logger, no console.*).

## Process rules (unchanged)

Test-first; `pnpm verify` green + integration tests (`DATABASE_URL` on `:5433`, `LC_ALL=C`); e2e for the new login flow (`apps/web/e2e/` — `auth.setup.ts` must keep passing, it gates ALL e2e); browser-verify on **staging** (`https://staging.crm.allcheckservices.com`, deploys automatically on push to `main`); owner approves before `git push origin main:prod`. Commits: Mayur, conventional, no AI trailer, never `--no-verify`. Update `CRM2_MASTER_MEMORY.md` §8 + memory files + `COMPLIANCE_GAPS_REGISTRY` at ship.

## Owner inputs the session must ask for (one question at a time)

1. Fast2SMS API key + DLT sender ID/template ID (store on the boxes' `.env.prod` only).
2. Which flows require OTP (see decision above) and for which roles.
3. Whether SMTP/email sending exists (provider creds) or email OTP should wait.
4. Daily SMS budget target (to size the caps).
