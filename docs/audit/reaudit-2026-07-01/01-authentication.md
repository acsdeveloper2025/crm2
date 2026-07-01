# RE-AUDIT 01: Authentication

Re-audit of area 01 against post-remediation HEAD (`8ded432`); baseline `b19039e`.
Scope: `apps/api/src/modules/auth/{service,repository,routes}.ts`, `packages/config/src/index.ts`, auth tests.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| AUTHENTICATION-01 (wrong MFA/TOTP increments lockout; missing code does not) | CONFIRMED_FIXED | `apps/api/src/modules/auth/service.ts:200-206` — enrolled user: missing `mfaCode` → `throw mfaRequired()` with no counter touch (line 201); wrong code → `repo.recordFailedLogin(creds.id, MAX_FAILED_LOGINS, LOCKOUT_COOLDOWN_S)` then `accountLocked()`/`mfaRequired()` (lines 202-204), mirroring the password branch (lines 190-193). `resetLoginState` runs only on full success (line 207). Locked-before-password gate at `service.ts:189` stops a locked account grinding. Integration test asserts it: `auth.api.test.ts:582-596` (5 missing-code legs stay unlocked + counter reset by success; 5 wrong `000000` codes trip the 423 lock). |
| AUTHENTICATION-03 (JWT_SECRET/MFA_ENC_KEY prod entropy floor: len>=32 + >=10 distinct) | CONFIRMED_FIXED | `packages/config/src/index.ts:107-133` — `checkSecretStrength`: `MIN_SECRET_LENGTH=32` (line 107), `MIN_DISTINCT_CHARS=10` (line 108), length issue at 118-124, `new Set(value).size` distinct-char floor at 125-132; still rejects the exact dev-default first (110-117). Wired for prod only via `superRefine` at `index.ts:95-97`. Tests: `packages/config/src/index.test.ts:39-47` (short secret rejected; `'abab…'` 33-char low-entropy rejected) and `:55-56` (real high-entropy base64 passes). |
| AUTHENTICATION-02 (web access token in localStorage — accepted, ADR-0076 SEC-10) | ACCEPTED_AS_DOCUMENTED | No change in range: `git diff b19039e..8ded432 -- apps/web/src/lib/auth.ts` is empty. Access token still `localStorage` (`apps/web/src/lib/auth.ts:14,18,22`, key `acs.accessToken`). Refresh token remains the httpOnly cookie per SEC-10 (in-body jti only). Matches the documented acceptance. |

## New Findings

None.

Independent hunt notes (all clear):
- The MFA-failure path now runs `recordFailedLogin` *after* a correct password. A legitimate user who mistypes TOTP 5x gets locked 15 min even with the right password — this is the intended, symmetric tradeoff with the password branch, not a defect.
- `recordFailedLogin` (`repository.ts:122-135`) is a single atomic `UPDATE … RETURNING`; the `>= $2` lock trip and cooldown interval are correct; no TOCTOU between check and increment.
- DATABASE-02 hitchhiker fix (revoke-old + insert-new now one `withTransaction`, `repository.ts:201-220`, wired via the `persist` param `service.ts:127,321-328`) is correct and repository-scoped; login still uses the plain-insert default (`service.ts:213-219`). No regression: rotation still carries `absoluteExpiresAt` forward unchanged and remains single-use.
- Routes gained `verifySameOrigin()` on `/refresh` and `sensitiveActionLimiter()` on change-password + MFA enroll/verify/disable (`routes.ts:18,25,33-35`) — additive hardening from areas 06/API_SECURITY, no auth-flow regression (mobile no-Origin still allowed, tested `auth.api.test.ts` refresh-CSRF block).
- `verifyMfaCode` (`service.ts:87-102`) unchanged: TOTP vs recovery split by regex, recovery codes hash-matched against UNUSED slots then burned; no timing/enumeration change.

## Verdict

PASS. Both claimed fixes are real, complete, and backed by passing integration/unit tests read at file:line; the accepted localStorage item is genuinely untouched in the remediation range and matches its documented ADR-0076 SEC-10 rationale. The remediation also pulled in adjacent hardening (atomic refresh rotation, same-origin refresh check, per-IP caps on account-security endpoints) without introducing any regression in the authentication flow. Zero new findings.
