# RE-AUDIT 06: CSRF

Re-audit of the CSRF area against current HEAD (`8ded432`), baseline `b19039e`. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| CSRF-01 (verifySameOrigin on POST /auth/refresh) | CONFIRMED_FIXED | `apps/api/src/http/sameOrigin.ts:14-27` implements the Origin/Referer cross-host check (fail-closed 403 `CROSS_ORIGIN_REQUEST` on mismatch; pass-through when header absent/unparseable). Wired at `apps/api/src/modules/auth/routes.ts:18` (`post('/refresh', refreshLimiter(), verifySameOrigin(), c.refresh)`). It is the ONLY cookie-authenticated endpoint: `readRefreshCookie` is used solely in `controller.ts:36` (grep confirmed); `logout/me/changePassword/mfa*` all auth via bearer `requireUserId(req)` (`controller.ts:47-105`), so they are not cookie-CSRF-exploitable and correctly left unguarded. |
| CSRF-01 — mobile (no Origin/Referer) not broken | CONFIRMED_FIXED | `sameOrigin.ts:16-17`: `if (!declared) return next()` lets header-less clients through. Mobile also sends the refresh token in the body, not the cookie (`controller.ts:35-38`). Test coverage: `auth.api.test.ts:163-170` asserts a no-Origin refresh returns 200. |
| CSRF-02 (socket.io CORS allowlist, merged) | CONFIRMED_FIXED | `apps/api/src/platform/realtime/index.ts:140-145`: `origin: true` replaced with `env.NODE_ENV === 'production' ? PROD_ORIGIN : DEV_ORIGINS`. `PROD_ORIGIN='https://crm.allcheckservices.com'`; `DEV_ORIGINS=['http://localhost:5273','http://127.0.0.1:5273']` — dev port 5273 matches `apps/web/vite.config.ts:7` / `package.json:7`. Handshake still requires a valid bearer JWT, so the allowlist is a genuine second factor. |

Test suite for CSRF-01 (`auth.api.test.ts:151-182`) covers all three branches: cross-host 403, no-Origin 200, same-host 200.

## New Findings

None.

Notes from independent hunt (no finding warranted):
- `verifySameOrigin` compares `declaredHost === req.headers.host`. A malformed request lacking a Host header fails the compare and is rejected (fail-closed) — correct, not a bypass. A legitimate browser sends `Origin: https://crm.allcheckservices.com` + `Host: crm.allcheckservices.com`, which matches behind nginx. No proxy/port-normalization edge was found that would false-reject a legit web refresh (browsers include the port in Origin only for non-default ports; web serves on 443, Host has no port).
- The HTTP API mounts no `cors()` middleware (grep for `cors(` returned nothing), so there is no HTTP-layer CORS reflection to worry about; the socket.io change is the only CORS surface.
- Both attacker-controlled headers (Origin and Host) would have to agree for a match; a cross-site browser request cannot set Origin, so the guard holds. Non-browser attackers can forge both, but they don't have the victim's httpOnly cookie — CSRF is not their threat model. Consistent with the documented design in `sameOrigin.ts:4-13`.

## Verdict

PASS. Both claimed fixes (CSRF-01 same-origin guard on the sole cookie-authenticated endpoint, CSRF-02 socket.io CORS allowlist) are real, complete, correctly wired, and test-covered; the mobile/header-less path is explicitly preserved and verified. The remediation is a minimal, defense-in-depth layer on top of the already-present `SameSite=Lax` cookie and bearer-JWT socket handshake, and introduced no regressions. Zero new findings.
