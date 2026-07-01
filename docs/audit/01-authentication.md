# AUDIT 01: Authentication

## Scope

Static, read-only inspection of the authentication subsystem in `/Users/mayurkulkarni/Downloads/crm2`. Files read in full:

- `apps/api/src/modules/auth/service.ts`, `controller.ts`, `routes.ts`, `repository.ts`, `version.controller.ts` (referenced, not modified)
- `apps/api/src/platform/jwt.ts`, `password.ts`, `totp.ts`, `encryption.ts`, `tokenRevocation/index.ts`
- `apps/api/src/http/authenticate.ts`, `enrichAuth.ts`, `testAuth.ts`, `rateLimit.ts`, `refreshCookie.ts`, `app.ts`
- `packages/config/src/index.ts` (env schema + fail-fast `superRefine`), `packages/config/src/index.test.ts`
- `packages/sdk/src/auth.ts`, `packages/sdk/src/users.ts` (`StrongPasswordSchema`)
- `apps/web/src/lib/auth.ts` (token store), `apps/web/src/lib/sdk.ts` (fetch wrapper, refresh-and-retry), `apps/web/src/lib/sessionManager.ts` (idle/absolute timers)
- `db/v2/migrations/0009_auth.sql`, `0028_session_tracking.sql`, `0075_idle_logout_and_session_cap.sql`, `0102_user_tokens_valid_after.sql`
- `apps/api/src/modules/auth/__tests__/auth.api.test.ts` (828 lines, full test list enumerated), `policyGate.api.test.ts`
- `apps/api/src/platform/__tests__/password.test.ts`
- `infra/prod/nginx.conf`, `infra/prod/.env.prod.example`
- `apps/api/src/modules/users/service.ts` (unlock/deactivate wiring to the access-token kill switch)

Commands actually run (all read-only):
```
grep -rn "trust proxy" apps/api/src/http/app.ts
grep -n "describe(\|it(\|test(" apps/api/src/modules/auth/__tests__/auth.api.test.ts
grep -n "limit_req|/api/" infra/prod/nginx.conf
grep -rn "remember.me|rememberMe" apps/web/src apps/api/src
grep -rn "forgot|reset.password|emailVerif" apps/api/src apps/web/src packages/sdk/src
```
No `pnpm`/`git mutate`/DB/network commands were run. No files outside `docs/audit/01-authentication.md` were written.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| JWT algorithm | PASS | `apps/api/src/platform/jwt.ts:9` `const ALG = 'HS256';`; `verify()` line 47 passes `{ algorithms: [ALG] }` to `jwtVerify` | Algorithm is pinned server-side (no `alg:none`/confusion risk); symmetric HS256 is consistent with a single-backend, no-federation design |
| JWT secret strength/source | PARTIAL/FAIL (see AUTHENTICATION-03) | `packages/config/src/index.ts:16` `JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me')`; prod fail-fast at lines 88-95; `index.test.ts:9-29` proves the fail-fast throws/passes | Dev-default rejection in prod is real and tested (PASS for that sub-check), but the schema's hard floor accepts any 16-byte secret in prod, weaker than the `.env.prod.example` guidance of 48 random bytes |
| JWT expiry enforced | PASS | `jwt.ts:27-34` `setExpirationTime(\`${ttlSeconds}s\`)`; `AUTH_ACCESS_TTL_S` default 900s (`packages/config/src/index.ts:17`); `verify()` uses `jwtVerify` which rejects expired tokens by default (jose throws `JWTExpired`), caught at `jwt.ts:63-65` → returns `null` | Confirmed by test `auth.api.test.ts:741` "an over-age session cannot be refreshed" (refresh-side; access-token expiry is jose's own default behavior, not independently unit-tested here) |
| Refresh tokens (issuance, storage) | PASS | `service.ts:118-150` `issueTokens()` mints `jti`, signs both tokens, computes `refreshExpiresAt`/`absoluteExpiresAt`, persists via `repo.insertRefresh` (`repository.ts:169-192`) into `auth_refresh_tokens` (`db/v2/migrations/0009_auth.sql:9-19`) | Refresh tokens are tracked server-side (a denylist/allowlist hybrid keyed by `jti`), not purely stateless |
| Token rotation | PASS | `service.ts:301-308` `refresh()`: `await repo.revokeRefresh(claims.jti)` then `issueTokens(...)` mints a new pair; test `auth.api.test.ts:207` "refresh rotates the pair and single-uses the old refresh token" | Single-use rotation confirmed by test |
| Replay protection | PASS | `service.ts:278-287`: a revoked-but-presented `jti` triggers `REFRESH_REUSE_GRACE_MS` (60s) logic — within grace = benign 401, beyond grace = `fullyRevokeUser()` (family revoke); tests at `auth.api.test.ts:221` and `:238` cover both branches | Reuse detection mechanism present and tested for both the grace and theft paths |
| Session expiration | PASS | `refreshExpiresAt` set from `AUTH_REFRESH_TTL_S` (default 30d, `packages/config/src/index.ts:18`); `service.ts:277` `if (!row \|\| new Date(row.expiresAt).getTime() < Date.now()) throw invalidRefresh()`; absolute cap via `absoluteExpiresAt` (ADR-0045, `0075_idle_logout_and_session_cap.sql`), tested at `auth.api.test.ts:92,104,134` | Both rolling (refresh TTL) and absolute (role-based cap, e.g. 12h for desk roles) expirations enforced and tested |
| Password hashing (algorithm + work factor) | PASS | `apps/api/src/platform/password.ts:1-30`: Node built-in `scrypt`, `N` from `PASSWORD_SCRYPT_N` (prod default 16384, `packages/config/src/index.ts:27`), `r=8`, `p=1`, 16-byte salt, stored as `scrypt$N$r$p$salt$hash`; verified with `timingSafeEqual` (line 77) | Modern memory-hard KDF, prod work factor (~2s/hash per code comment) is reasonable; per-hash random salt confirmed by test `password.test.ts:18-20` |
| Password policy (min length/complexity, enforced where) | PASS | `packages/sdk/src/users.ts:88-95` `StrongPasswordSchema`: min 8, max 200, requires lower+upper+digit+special via regex; used by `ChangePasswordSchema` (`packages/sdk/src/auth.ts:102-106`) and `SetPasswordSchema` (admin reset, `auth.ts:90-94`) | Enforced server-side via shared Zod schema (not just client-side); `LoginSchema.password` itself only requires `min(1)` (login doesn't re-validate policy, which is correct — policy applies at set/change time, not at every login) |
| Password reset | PASS (admin-mediated, by design) | `apps/api/src/modules/users/service.ts:377-...` `generateTempPassword`, routed at `apps/api/src/modules/users/routes.ts:72` `POST /:id/generate-temp-password` gated by `authorize(PERMISSIONS.USER_MANAGE)`; `TempPasswordSchema` (`packages/sdk/src/auth.ts:98`) supports `view`/`email` delivery; sets `password_must_change` so next login forces a change (test `auth.api.test.ts:451`) | No self-service "forgot password" flow exists anywhere in the repo (grep across `apps/api/src`, `apps/web/src`, `packages/sdk/src` found zero matches for `forgot`/public reset) — this is an admin-issued reset model, consistent with an internal CRM with no public signup |
| Forgot password | NOT VERIFIED / N/A | `grep -rln "forgot" apps/api/src apps/web/src packages/sdk/src` → no matches | No public self-service forgot-password endpoint exists. Not a gap given the admin-mediated user-provisioning model (no public registration), but flagged as a design fact, not a failure |
| Email verification | NOT VERIFIED / N/A | `grep -rln "emailVerif\|verify.email"` → no matches in `apps/api/src`/`apps/web/src`/`packages/sdk/src` | No email-verification flow exists. Users are provisioned by an admin (`CreateUserSchema`, `packages/sdk/src/users.ts`), not self-registered, so there is no untrusted email to verify at signup time. Not a finding |
| MFA (enrollment, verification, recovery codes, enforceable/bypassable) | PASS, with one gap (AUTHENTICATION-01) | Enrollment: `service.ts:230-236` `mfaEnrollStart`; confirm: `:239-248` `mfaEnrollVerify` mints 10 recovery codes (`mintRecoveryCodes`, lines 105-111), hashed via `hashPassword`; verification at login: `:192`; admin-required flag: `creds.mfaRequired` (`repository.ts:18`), `mustEnrollMfa` surfaced at `service.ts:218`; tests `auth.api.test.ts:509-595` cover enroll/verify/disable/recovery-code-burn/admin-disable | MFA is enrollable, verifiable, has one-time recovery codes, and an admin "required" flag — but `mustEnrollMfa=true` is informational only: nothing server-side blocks a `mfa_required` user's API access until they enroll (see AUTHENTICATION-01) |
| Logout (server-side invalidation) | PASS | `service.ts:325-327` `logout()` calls `fullyRevokeUser()` → `repo.revokeAllForUser` (revokes ALL refresh rows, `repository.ts:237-244`) + `revokeUserAccessTokens` (durable access-token kill switch) + `disconnectUser` (sockets); test `auth.api.test.ts:270` "logout revokes the user's refresh tokens" and `:328` "logout emits auth:session_revoked" | Logout is NOT merely client-side token deletion — it revokes server-side refresh rows AND kills live access tokens via the `tokens_valid_after` cutoff, closing the classic "JWT logout doesn't really log out" gap |
| Session invalidation (force-logout / kill switch) | PASS | `apps/api/src/platform/tokenRevocation/index.ts` (full file read): `isAccessRevoked()` checked in `authenticate.ts:22`; durable column `users.tokens_valid_after` (`db/v2/migrations/0102_user_tokens_valid_after.sql`); wired into logout, password change (`service.ts:269`), admin deactivate (`apps/api/src/modules/users/service.ts:446`), and refresh-reuse-beyond-grace (`service.ts:284`) | 5s in-process cache with bust-on-revoke (`CACHE_TTL_MS = 5_000`, `tokenRevocation/index.ts`) — acceptable window, documented in code comments |
| Device sessions (multi-device tracking, per-device revoke) | PASS | `repository.ts:205-214` `sessionsForUser` (per `device_id`/`device_info`/`ip`/`last_used_at`); `service.ts:319-323` `revokeSession` is owner-scoped (`repo.revokeRefreshForUser(jti, userId)` — 404 if not the caller's own session); admin equivalents at `controller.ts:141-159` gated by `USER_MANAGE`; IDOR test `auth.api.test.ts:653` "a user cannot list-or-revoke another user's session (IDOR-safe)" | Web UI exists: `apps/web/src/components/SessionList.tsx` |
| Remember me | NOT VERIFIED / N/A | `grep -rn "remember.me\|rememberMe" apps/web/src apps/api/src` → no matches | Feature does not exist in this codebase. Not a finding — refresh-token TTL (30d default) already provides persistent login without an explicit "remember me" toggle |
| Token storage (web vs mobile) | PASS, with finding (AUTHENTICATION-02) | Web: `apps/web/src/lib/auth.ts:11-23` access token + `jti` in `localStorage` (`ACCESS_KEY`/`JTI_KEY`); refresh token in httpOnly cookie (`apps/api/src/http/refreshCookie.ts:15-23`). Mobile: `apps/api/src/modules/auth/controller.ts:38` accepts refresh token from body (`bodyToken`) — preserves the existing mobile contract per code comment | Refresh token is correctly kept out of JS-reachable storage on web (cookie, httpOnly). Access token in `localStorage` is readable by any XSS — see AUTHENTICATION-02 |
| Cookie flags (httpOnly/secure/sameSite) | PASS | `apps/api/src/http/refreshCookie.ts:16-22` (the actual `res.cookie()` call): `httpOnly: true`, `sameSite: 'lax'`, `secure: loadEnv().NODE_ENV === 'production'`, `path: '/api/v2/auth'`, `maxAge` from `AUTH_REFRESH_TTL_S` | Verified at the real `res.cookie()` call site, not just by comment/intent. `secure` is correctly conditional (dev is plain HTTP); prod is the only environment with `secure: true`, and prod sets `NODE_ENV=production` per `infra/prod/docker-compose.yml`/deploy pipeline |
| Clock skew handling in token verification | NOT VERIFIED | `apps/api/src/platform/jwt.ts:46-49` `jwtVerify(token, secret(), { algorithms: [ALG] })` — no `clockTolerance` option passed | `jose`'s default `clockTolerance` is 0 seconds. Since both signing and verification happen on the same backend process (no client-clock dependency for access/refresh tokens — TOTP is the only place client/server clock drift matters, and that already has an explicit ±1-step `DRIFT_WINDOW` in `totp.ts:11,83`), this is unlikely to cause real outages, but it was not exercised by any test that simulates clock drift, so marked NOT VERIFIED rather than PASS |
| Timing attacks (login response time for valid vs invalid username) | PASS (mechanism), NOT VERIFIED (measured timing) | `apps/api/src/modules/auth/service.ts:178-183`: an unknown/unusable user still calls `await verifyDummyPassword(v.password)` before throwing, spending the same scrypt cost; `password.ts:54-64` `verifyDummyPassword` lazily mints + caches a dummy hash at the live `PASSWORD_SCRYPT_N` cost factor; test `auth.api.test.ts:170` exercises the unknown-user path (status-only assertion, not a timing assertion) | The anti-enumeration mechanism is real, wired, and covered by a functional test (not a no-op). No test or tool actually measures wall-clock response-time deltas between valid/invalid usernames in this repo, and that can't be reliably measured by static inspection — NOT VERIFIED for the empirical timing characteristic, but the code path is sound |
| Brute force protection | PASS, with gap (AUTHENTICATION-01b/finding below) | Per-account: `service.ts:186-189` `recordFailedLogin` + `accountLocked()`; per-IP: `loginLimiter()` (`apps/api/src/http/rateLimit.ts:51-56`, `RATE_LIMIT_LOGIN_MAX` default 30/15min) mounted at `routes.ts:16`; nginx edge layer `limit_req zone=api_rl burst=20 nodelay` (`infra/prod/nginx.conf:19,72-73`) | Password brute force is well covered (account lockout + 2-layer rate limit). MFA-code brute force after a correct password is NOT covered by the account lockout (see AUTHENTICATION-01) |
| Account lockout (threshold + auto-unlock) | PASS | `service.ts:60-61` `MAX_FAILED_LOGINS = 5`, `LOCKOUT_COOLDOWN_S = 900` (15 min); `repository.ts:112-125` `recordFailedLogin` atomically sets `locked_until` via a single `UPDATE ... CASE WHEN failed_login_count + 1 >= $2`; `isLocked()` (`service.ts:73`) compares against `now()` — auto-unlock is simply the time-based check, no separate cron/job needed; explicit test `auth.api.test.ts:427` "locks the account after 5 failed logins (423 ACCOUNT_LOCKED); admin unlock restores access" and `:440` "a successful login resets the failed-attempt counter" | Threshold and cooldown are both real and tested; admin-unlock endpoint also covered |
| Credential stuffing protection (rate limits on login/refresh) | PASS | `loginLimiter()`/`refreshLimiter()` (`apps/api/src/http/rateLimit.ts:51-64`), mounted on `POST /login` and `POST /refresh` (`routes.ts:16-17`); `RATE_LIMIT_REFRESH_MAX` default 60/15min (`packages/config/src/index.ts:77`); edge-layer `limit_req` in `infra/prod/nginx.conf:19,72-73` as a second, independent layer | In-memory store is correctly scoped to the documented single-instance prod topology (code comment in `rateLimit.ts:9-11,15` explicitly calls out the Valkey-store TODO for multi-instance, consistent with `architecture-inventory.md` confirming Valkey is NOT deployed in prod today) |

## Findings

### AUTHENTICATION-01
- **Category:** Authentication / Brute Force
- **Severity:** Medium
- **CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N) — CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N
- **OWASP Mapping:** OWASP Top 10:2021 A07 — Identification and Authentication Failures
- **CWE Mapping:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- **Location**
  - **File:** `apps/api/src/modules/auth/service.ts`
  - **Line Number:** 186-192
- **Evidence:**
```ts
if (!(await verifyPassword(v.password, creds.passwordHash))) {
  const after = await repo.recordFailedLogin(creds.id, MAX_FAILED_LOGINS, LOCKOUT_COOLDOWN_S);
  throw isLocked(after.lockedUntil) ? accountLocked() : invalidCreds();
}
// MFA challenge: an enrolled user must supply a valid TOTP/recovery code in the same request.
// A missing/invalid code returns 401 MFA_REQUIRED so the client can re-login with `mfaCode`.
if (creds.mfaEnrolled && !(v.mfaCode && (await verifyMfaCode(creds.id, v.mfaCode)))) throw mfaRequired();
await repo.resetLoginState(creds.id); // success clears the failed-attempt counter
```
- **Why it is a problem:** `recordFailedLogin` (the function that increments `failed_login_count` and ultimately triggers `ACCOUNT_LOCKED`) is only called on the wrong-password branch. Once the password check succeeds, a wrong MFA code falls straight to `mfaRequired()` without ever touching the failed-attempt counter — so an attacker who already has a valid password (phished, leaked, reused-credential) faces zero per-account lockout while brute-forcing the 6-digit TOTP code or one of the 10 recovery codes. The only defense left at that point is `loginLimiter()`, a per-IP flood cap of 30 requests/15 minutes (`packages/config/src/index.ts:76`) — which a distributed or low-and-slow attacker can simply wait out or spread across IPs.
- **Real world attack scenario:** A field-agent or backend-user's password is leaked via a phishing campaign or credential-stuffing list (common for CRMs with hundreds of office staff). The attacker has the username/password but not the authenticator app. Because MFA-code failures never lock the account, the attacker can throttle requests to stay just under the per-IP rate limit (e.g. 1 request every 30 seconds from one IP, or distribute across a botnet) and grind through the TOTP keyspace (±1 step window means 3 valid 6-digit codes exist at any instant, i.e. roughly 1-in-333,333 odds per guess) or simply try all 10 recovery-code guesses repeatedly with no cooldown. Given this CRM holds client PII/KYC data and commission/billing data, a successful MFA bypass grants full account takeover of a verified-credential session.
- **Business impact:** Account takeover of an MFA-enrolled user (which, per the admin `mfa_required` flag, includes the most sensitive roles) defeats the entire purpose of having required MFA, exposing client PII, KYC case data, and commission/billing records to an attacker who already cleared the first factor.
- **Recommended fix:** Call `repo.recordFailedLogin` (or a dedicated MFA-attempt counter) on a failed `verifyMfaCode` as well, so repeated wrong MFA codes count toward the same (or a tighter) lockout threshold as password failures. Consider a shorter threshold for MFA-stage failures (e.g. 5-10 attempts) since TOTP brute force is a narrower keyspace than password brute force.
- **Estimated effort:** S (a few lines in `service.ts:192`, mirroring the existing `recordFailedLogin`/`isLocked` pattern; add a corresponding test alongside the existing `describe('lockout', …)` block)
- **Priority:** P1
- **Status:** OPEN

### AUTHENTICATION-02
- **Category:** Authentication / Token Storage
- **Severity:** Low
- **CVSS:** 3.1 (CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N)
- **OWASP Mapping:** OWASP Top 10:2021 A05 — Security Misconfiguration (also relevant: A03 Injection→XSS as the prerequisite vector)
- **CWE Mapping:** CWE-922 (Insecure Storage of Sensitive Information), related CWE-79 (XSS) as the enabling vector
- **Location**
  - **File:** `apps/web/src/lib/auth.ts`
  - **Line Number:** 11-23
- **Evidence:**
```ts
const ACCESS_KEY = 'acs.accessToken';
const JTI_KEY = 'acs.jti';
...
export const tokenStore = {
  access: (): string | null => localStorage.getItem(ACCESS_KEY),
  jti: (): string | null => localStorage.getItem(JTI_KEY),
  set(accessToken: string, jti: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(JTI_KEY, jti);
  },
```
- **Why it is a problem:** The repo's own ADR-0076 SEC-10 hardening (cited in the code comment at the top of `auth.ts` and in `refreshCookie.ts:5-9`) deliberately moved the *refresh* token out of `localStorage` into an httpOnly cookie specifically because `localStorage` is readable by any script running on the page — i.e. it is not XSS-safe. The *access* token, however, is still kept in `localStorage`. Although its blast radius is bounded by the 15-minute TTL (`AUTH_ACCESS_TTL_S` default 900s), any XSS on the web app (a stored-XSS in a case note, client name, or report field rendered without escaping, for example) can read `localStorage.getItem('acs.accessToken')` and replay it as a Bearer token for up to 15 minutes with the victim's full permissions, and can also silently call `/auth/refresh` (the cookie rides automatically with `credentials:'include'`) to mint a fresh access token, indefinitely extending the window without ever touching the httpOnly refresh cookie directly.
- **Real world attack scenario:** A stored-XSS payload is injected into a free-text field that ends up rendered in a case detail view, client field, or report viewed by a SUPER_ADMIN or BACKEND_USER. The script reads `localStorage.acs.accessToken`, exfiltrates it, and also fires `fetch('/api/v2/auth/refresh', {credentials:'include'})` from the victim's browser to keep minting fresh access tokens — turning a 15-minute token leak into a session-length compromise without ever needing the (XSS-immune) refresh cookie. Stolen tokens can read/export client PII, KYC verification data, or commission figures.
- **Business impact:** Reduces (but does not eliminate, since refresh itself stays cookie-protected) the value of the SEC-10 hardening already done; a successful XSS still yields meaningful session compromise, not just a 15-minute nuisance, because the attacker's script can keep calling `/auth/refresh` itself.
- **Recommended fix:** This is a known, accepted trade-off in many SPA architectures (in-memory access token would be the gold standard, but `localStorage` access tokens combined with a short TTL + cookie-only refresh is a common, defensible middle ground) — confirm with the team whether this was a deliberate ADR-0076 scope decision (the access token wasn't mentioned, only the refresh token). If accepted as-is, no action; if not, move the access token to an in-memory variable (module-level JS variable, lost on full page reload, re-acquired via a silent refresh on app boot) to fully close the XSS replay window. Given the 15-minute TTL already limits blast radius and refresh is the operative compromise step, treat this as a hardening backlog item rather than urgent.
- **Estimated effort:** M (move `tokenStore.access` to an in-memory module variable; requires re-deriving the access token on every fresh page load via a silent `/auth/refresh` call, touching `AuthContext.tsx`/`sdk.ts` boot sequence)
- **Priority:** P3
- **Status:** OPEN

### AUTHENTICATION-03
- **Category:** Authentication / Secrets Management
- **Severity:** Low
- **CVSS:** 3.7 (CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N)
- **OWASP Mapping:** OWASP Top 10:2021 A02 — Cryptographic Failures
- **CWE Mapping:** CWE-326 (Inadequate Encryption Strength) / CWE-1391 (Use of Weak Credentials)
- **Location**
  - **File:** `packages/config/src/index.ts`
  - **Line Number:** 16-17
- **Evidence:**
```ts
JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
/** key that encrypts TOTP secrets at rest (AES-256-GCM); set a real value in prod. */
MFA_ENC_KEY: z.string().min(16).default('dev-only-insecure-mfa-key-change-me'),
```
- **Why it is a problem:** The fail-fast `superRefine` (lines 88-103, verified working by `index.test.ts:9-19`) only rejects the *exact* insecure dev-default string in production — it does not enforce any minimum entropy for whatever real value an operator sets. `min(16)` permits a 16-character low-entropy human-chosen secret (e.g. `"CompanyName2026!"`) to pass validation in production, which for an HS256 HMAC secret is far below the recommended ≥256 bits (32+ bytes) of randomness. `infra/prod/.env.prod.example` correctly recommends `openssl rand -base64 48`, but the schema itself doesn't enforce that operational guidance — a future redeploy or manual `.env.prod` edit could regress to a weak-but-passing secret without the test suite or fail-fast catching it.
- **Real world attack scenario:** If a future operator (or an automated secret-rotation script) sets `JWT_SECRET` to a short, guessable value while satisfying only the `min(16)` schema floor, an attacker who obtains any signed JWT (e.g. via a separate log-exposure bug or a misconfigured debug endpoint) could attempt an offline HMAC-secret brute force/dictionary attack against HS256, and on success forge arbitrary access tokens for any user/role — a full authentication bypass for the whole CRM, including SUPER_ADMIN.
- **Business impact:** Low likelihood today (the `.env.prod.example` guidance is good and the current example uses 48 random bytes), but the schema provides no machine-enforced floor proportional to HMAC-256 best practice, so this is a latent gap rather than an active exploit.
- **Recommended fix:** Raise the Zod floor to `min(32)` (32 ASCII chars) or, better, validate effective entropy/byte-length when base64-decoded, to match the `.env.prod.example` recommendation of 48 random bytes. Low cost, no behavioral change for any correctly-provisioned environment.
- **Estimated effort:** S (one-line schema change + an updated `index.test.ts` case)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Informational | 0 |

**Overall verdict: PARTIAL.**

The authentication subsystem is well-engineered: HS256 JWTs with enforced expiry, server-tracked rotating refresh tokens with reuse/family-revoke detection, a durable access-token kill switch independent of TTL, scrypt password hashing at a real work factor with constant-time comparison and a timing-safe dummy-hash anti-enumeration path, a tested account-lockout mechanism, TOTP MFA with hashed one-time recovery codes, an httpOnly/secure/SameSite=Lax refresh cookie verified at its actual `res.cookie()` call site, IDOR-safe per-device session revoke, and a 2-layer (app + nginx) rate-limiting scheme — all backed by an unusually thorough 50+ case test suite (`auth.api.test.ts`) that was read and cross-checked claim-by-claim rather than trusted from comments. The one Medium finding (AUTHENTICATION-01: MFA-code failures don't trigger the account lockout that password failures do) is a genuine gap worth fixing given MFA is meant to gate the highest-trust accounts. The two Low findings (access token in `localStorage`, and a `JWT_SECRET`/`MFA_ENC_KEY` schema floor below recommended HMAC entropy) are real but lower-urgency hardening items, not exploitable today under the documented operational practice. No Critical or High issues were found; verdict is PARTIAL rather than PASS because of the one real Medium FAIL plus two Low findings, and PARTIAL rather than FAIL because nothing Critical/High was identified and every checklist item produced concrete, file-and-line evidence (no unresolved NOT VERIFIED gaps of material concern — the few NOT VERIFIED items are either genuinely unmeasurable from static code, such as live timing deltas and clock-skew behavior under real drift, or features confirmed absent by design, such as forgot-password/email-verification/remember-me in an admin-provisioned internal CRM).
