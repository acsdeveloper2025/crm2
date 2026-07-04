# ADR-0089: SES API (HTTPS) transport for the transactional-mail seam

- **Status:** Accepted
- **Date:** 2026-07-04

## Context

ADR-0088 (OTP login) sends email OTPs through the ADR-0021 mail seam, which had a
single transport: SMTP via nodemailer (`SMTP_*` env). During SES setup we found the
staging box's datacenter **blocks all outbound SMTP ports** (25/465/587/2465/2587
verified filtered upstream — the box firewall is open, the provider edge is not),
so staging can never reach `email-smtp.ap-south-1.amazonaws.com`. Prod EC2 egress is
open, but email delivery should not depend on hosting-provider SMTP policy anywhere.

## Decision

Add a second, env-selected transport to the mail seam: **the SES v2 API over
HTTPS/443** (`@aws-sdk/client-sesv2`, same SDK family the storage seam already uses).

- `MAIL_TRANSPORT=ses` selects it (default stays `smtp`; behavior unchanged for
  existing deployments). Selecting `ses` is the deploy decision — `mailConfigured()`
  is true without `SMTP_HOST`.
- Credentials: `SES_ACCESS_KEY_ID`/`SES_SECRET_ACCESS_KEY` env, or, when absent, the
  SDK default chain (EC2 instance role — prod can eventually drop stored mail creds).
- Same `Mailer` interface, same best-effort semantics (failure logs + returns false,
  never throws), same lazy import (unconfigured/smtp deployments never load the SDK).

Staging runs `ses`; prod may run either (its SMTP egress works) — `ses` recommended
at next prod env touch for symmetry.

## Consequences

### Positive
- Email works from any host with HTTPS egress — immune to SMTP port blocking.
- Structured SES API errors in logs instead of SMTP codes.
- Same cost as SMTP ($0.10/1k mails; the API call is the send).

### Negative
- The `ses` path is AWS-coupled (mitigated: transport is an env flip back to `smtp`,
  which remains fully supported and provider-neutral).
- One more dependency (`@aws-sdk/client-sesv2`) in the api image.

## Alternatives Considered
- **Hosting-provider ticket to unblock 587/2587** — timeline outside our control;
  fixes one box, not the class of problem.
- **SSH tunnel staging→EC2→SES** — fragile ops, hidden dependency between boxes.
- **Move staging to AWS too** — solves it incidentally at ~3× the monthly cost.

## Related ADRs
- ADR-0021 — the seam this extends (deferred-activation, interface-first).
- ADR-0088 — OTP login, the mail consumer driving this.
- ADR-0087 — AWS hosting; SES/DKIM setup lives with it operationally.
