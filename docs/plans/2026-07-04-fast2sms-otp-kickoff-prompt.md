# Kickoff prompt — Fast2SMS OTP leg (activate SMS delivery for ADR-0088 login OTP)

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. The email leg is DONE and
> LIVE — this session activates the SMS leg only.

---

## What is already SHIPPED (do not rebuild)

- **ADR-0088 OTP login is LIVE on staging AND prod** (`0472015`): new-device gate for
  role-flagged accounts, trusted-device windows (mig 0114), challenge table, cooldown +
  send-cap (max 3 deliveries/challenge, same code re-delivered — never a fresh SMS while
  one is live), 5-attempt limit feeding the account lockout, Unlock UI in User Management.
- **ADR-0089 email leg is LIVE on staging AND prod**: SES API transport over HTTPS
  (`MAIL_TRANSPORT=ses` — built because the staging DC blocks ALL outbound SMTP ports),
  domain DKIM verified, **SES production access GRANTED** (50k/day), real sends verified
  from both boxes, `MAIL_FROM=ACS CRM <no-reply@allcheckservices.com>`.
- `deliverOtp` in `apps/api/src/modules/auth/service.ts` already fires BOTH legs in
  parallel; the SMS leg is inert because `FAST2SMS_API_KEY`/`FAST2SMS_OTP_TEMPLATE_ID`
  are unset (deferred-activation, ADR-0021 pattern).
- **The Fast2SMS sender code EXISTS but has NEVER run against the real API**:
  `apps/api/src/platform/sms.ts` — header-auth POST to
  `https://www.fast2sms.com/dev/otp/send` with `{mobile, otp_id, otp}`,
  `normalizeIndianMobile()` (bare 10-digit), `smsConfigured()` needs BOTH env vars.

## This session's job

1. **Ask the owner, one question at a time** (his strong preference): Fast2SMS API key ·
   the DLT-approved OTP template/message id (from the Fast2SMS panel) · sender ID ·
   whether his phone number should be wired to `admin` for testing (mirror of what we did
   with email) · daily SMS budget.
2. **Verify `sms.ts` against the CURRENT Fast2SMS docs before trusting it** — it was
   written from docs, never live-tested. Check endpoint, auth header, payload field names
   (`otp_id` vs template variants), response JSON (`return: true`?), error shape. Also
   check whether the Fast2SMS account restricts calls by IP allowlist — if yes, the
   staging box (49.50.119.155) and prod EIP (43.204.64.111) both need allowlisting.
3. **Egress sanity** from both boxes: `timeout 6 bash -c 'echo > /dev/tcp/www.fast2sms.com/443'`
   (HTTPS — expected open everywhere; the SMTP-block saga does not apply here).
4. **STAGING FIRST** (owner's hard rule): add `FAST2SMS_API_KEY` + `FAST2SMS_OTP_TEMPLATE_ID`
   to `/opt/crm2/secrets/.env.prod` on the staging box, recreate ONLY the api container
   (`docker compose -f infra/prod/docker-compose.yml --env-file /opt/crm2/secrets/.env.prod up -d --no-deps --force-recreate api`
   — export `IMAGE_TAG` from the running container first; if you ever recreate `edge`
   manually, export `NGINX_CONF=./nginx.staging.conf` or it crash-loops on a missing cert).
   Then a REAL end-to-end: set a phone on a staging user, log in from a fresh browser
   profile → OTP SMS must arrive on the owner's phone. Direct seam test also works:
   `docker exec crm2_api node --input-type=module -e "const m = await import('/app/apps/api/src/platform/sms.ts'); console.log(await m.getSmsSender().sendOtp('<10digits>','123456'))"`.
5. **Cost economy checks with real SMS**: resend inside TTL must NOT send a new SMS
   (same code, capped at 3); wrong-code attempts must not trigger sends; confirm with the
   owner which roles are OTP-flagged and that office users lean on the (free) email leg.
6. **Prod flip only after staging verified + explicit owner OK**: same two env vars on the
   prod EC2 box, recreate api with `docker-compose.aws.yml` (see the SES flip in
   `project_aws_migration_2026_07_04` memory as the exact template). No code change = no
   deploy needed; if `sms.ts` needs fixes, that's a normal main→staging→promote cycle.
7. **Record**: creds → `crm2/secrets/CREDENTIALS.md` + the boxes' `.env.prod` ONLY (never
   git); update `CRM2_MASTER_MEMORY.md` §8, memory files, registry if any finding.

## Operational facts you'll need

- Staging: `ssh -p 2232 -i ~/.ssh/github_actions_key root@49.50.119.155` · env at
  `/opt/crm2/secrets/.env.prod` · DB `docker exec crm2_db psql -U crm2_staging -d crm2_staging`.
- Prod: `ssh -i ~/.ssh/crm2-aws.pem ubuntu@43.204.64.111` · same env path · DB via
  `DATABASE_URL` in that env (RDS, CA at `/run/secrets/rds-ca.pem` mounts).
- Deploys: push `main` → staging auto; promote `git push origin main:prod` → AWS prod.
  Full workflow + credentials map: memory `project_dev_workflow_2026_07_04` +
  `crm2/secrets/CREDENTIALS.md`.
- All rules unchanged: `pnpm verify` green, conventional commits (Mayur, no AI trailer),
  ask before push/deploy/live-DB writes, never break mobile (`/api/v2` additive-only).
