# Security Guide (Part 1 — Practitioner Guide)

How an engineer builds securely in CRM2 (banking RCU/KYC). Architecture
is FROZEN. Governance/cadence lives in `SECURITY_STANDARDS.md`.

## The non-negotiables

1. **`authorize(perm)` on every route.** No route ships without a permission
   code from `@crm2/access`. Never gate on a role literal — gate on the
   capability. To add behaviour, add a permission code (see below).
2. **Declare scope or don't ship.** Every list/read route declares how results
   are scoped to the caller's hierarchy. The app **refuses to boot** if a route
   lacks a scope declaration — fail-closed by design. If scope can't be
   determined at request time, **deny**.
3. **Record-level access on detail routes.** `GET /thing/:id` must verify the
   caller can see *that* record (IDOR guard), not just hold the permission.
   Returning a 404 (not 403) on out-of-scope IDs avoids leaking existence.
4. **Parameterized SQL only.** Raw SQL lives in repositories and migrations;
   always use bind params (`$1, $2`). Never interpolate user input into a query
   string. No exceptions.
5. **Never log secrets or PII.** Use the centralized `@crm2/logger`, which masks
   PII. Don't `console.log` request bodies, tokens, or `pii_sensitive` fields.
6. **Structured errors only.** Throw `AppError` with a code + safe message.
   Clients never see stack traces, SQL, or internal identifiers — the error
   handler strips them.
7. **Validate input with zod at the service boundary.** Every external input is
   parsed/validated before it reaches business logic or SQL.
8. **Evidence via signed URLs.** Never expose raw object-store paths. Issue a
   short-lived signed URL through the serve layer.

## Adding a permission code

1. Define the code in `@crm2/access` (e.g. `kyc.recheck`).
2. Map it to the roles that should hold it — keep it least-privilege; do not add
   it to a role "just in case" (privilege creep is audited quarterly).
3. Assert it on the route: `authorize('kyc.recheck')`.
4. Add the scope declaration for the route. No scope = no boot.

## Handling PII fields

- Mark the column `pii_sensitive` in the migration so masking applies.
- On read, PII is masked unless the caller is authorized to see the cleartext.
- Respect DPDP: never bypass consent/retention/legal-hold flags. Don't copy PII
  into logs, error messages, audit free-text, or external API payloads.
- When serving documents containing PII, use signed URLs — no direct links.

## CSRF & token handling

- Access via stateless **JWT**; keep it short-lived. Refresh tokens rotate and
  are subject to the **denylist** — on logout/rotation the old refresh token is
  denylisted server-side.
- For cookie-based flows, enforce CSRF protection on state-changing requests.
  Bearer-token API calls are not cookie-ambient and rely on the token itself.
- Never store tokens in logs or URLs.

## Quick checklist before opening a PR

- [ ] `authorize(perm)` present on every new/changed route
- [ ] Scope declared (list) / record-level check present (detail)
- [ ] All SQL parameterized; no string interpolation
- [ ] All input zod-validated at the boundary
- [ ] No secrets/PII in logs or error bodies; `AppError` used
- [ ] PII columns flagged `pii_sensitive`; evidence served via signed URL
- [ ] `gitleaks` clean; any new dep in `ALLOWED_DEPENDENCIES.md`

See also: `SECURITY_STANDARDS.md`, `docs/CI_CD_STANDARDS.md`, `BUSINESS_RULES.md`.
