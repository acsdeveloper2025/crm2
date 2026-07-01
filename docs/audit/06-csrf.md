# AUDIT 06: CSRF

## Scope

Inspected (all under `/Users/mayurkulkarni/Downloads/crm2`):

- `apps/api/src/modules/auth/controller.ts`, `routes.ts`, `service.ts` — login/refresh/logout handlers
- `apps/api/src/http/refreshCookie.ts` — the httpOnly refresh-cookie helper (set/clear/read)
- `apps/api/src/http/authenticate.ts`, `app.ts` — the real Bearer-auth middleware and Express app wiring (middleware order, route mounting, presence/absence of a `cors` middleware)
- `apps/api/src/http/testAuth.ts` — dev/test auth seam (confirmed prod-disabled, not a CSRF vector)
- `apps/api/src/platform/realtime/index.ts` — socket.io server init (CORS config, auth handshake)
- `apps/web/src/lib/sdk.ts` — frontend fetch wrapper (`credentials: 'include'`, refresh-and-retry flow)
- `apps/api/package.json` — confirmed no `cors` npm package dependency
- `infra/prod/nginx.conf` — edge proxy config (same-origin topology: SPA + `/api/` + `/socket.io/` served from one origin)
- `apps/api/src/modules/auth/__tests__/auth.api.test.ts` — existing cookie/refresh test coverage
- `docs/adr/ADR-0076-security-hardening-rate-limit-token-revocation-resource-guards.md` — the ADR that introduced the httpOnly refresh cookie (SEC-10); checked for any CSRF threat-modeling
- Swept every `routes.ts` under `apps/api/src/modules` for state-changing `GET` routes (none found) and for any `cors(...)`/`Access-Control-*` usage (none found outside socket.io)

Commands actually run (read-only):
```
grep -rln "cors" apps/api/src infra
grep -rn "Access-Control\|cors(" apps/api/src infra
grep -n "cors\|origin" apps/api/src/platform/realtime/index.ts
grep -rn "req.headers.origin|req.header('origin')|req.get('origin')|Referer|referer" apps/api/src --include="*.ts"
grep -rln "csrf|csurf|double-submit|doubleSubmit|x-csrf" apps/api/src apps/web/src --include="*.ts" --include="*.tsx"
grep -rn "router.get(" apps/api/src/modules --include="routes.ts" | grep -i "delete|revoke|approve|assign|complete|cancel"
grep -n "\"cors\"" apps/api/package.json
```
No live system, network call, or DB connection was made. No file outside this report and `docs/audit/` was modified.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Cookie-authenticated endpoints identified | PASS | `apps/api/src/http/authenticate.ts:17-27` populates `req.auth` **only** from `Authorization: Bearer <token>`; `apps/api/src/modules/auth/controller.ts:34-44` (`refresh`) is the only handler that reads `readRefreshCookie(req)` (`apps/api/src/http/refreshCookie.ts:27-34`). Every other route/controller in `apps/api/src/modules/**` is gated by `req.auth` (Bearer) via `authorize()`/`requireUserId()`, never the cookie. | Cookie auth surface = exactly one endpoint: `POST /api/v2/auth/refresh`. |
| Refresh-cookie `SameSite` attribute | PASS | `apps/api/src/http/refreshCookie.ts:18-23`: `res.cookie(NAME, token, { httpOnly: true, sameSite: 'lax', secure: loadEnv().NODE_ENV === 'production', path: COOKIE_PATH, maxAge: ... })` | `SameSite=Lax` blocks the cookie on cross-site sub-requests (fetch/XHR/JS `<form>`-via-JS POST) and on cross-site `<form method=POST>` top-level navigations (blocked by Lax since Chrome 80/Firefox 96/Safari 13.1+) — only cross-site **top-level GET navigations** still attach a Lax cookie. No cross-site state-changing GET route exists (see next row), so the Lax setting is doing real work here, not just nominal. `Secure` is correctly prod-only (dev is HTTP). |
| `httpOnly` flag on the refresh cookie | PASS | Same line: `httpOnly: true` | Confirmed by test `apps/api/src/modules/auth/__tests__/auth.api.test.ts:286-294` (`expect(c?.toLowerCase()).toContain('httponly')`). Prevents JS/XSS exfiltration but is orthogonal to CSRF. |
| `Path` scoping on the refresh cookie | PASS | `COOKIE_PATH = '/api/v2/auth'` (`refreshCookie.ts:14`), confirmed by `auth.api.test.ts:288` (`expect(c).toContain('Path=/api/v2/auth')`) | Cookie is not sent on unrelated API routes even same-site, shrinking blast radius. |
| State-changing endpoints using only the cookie for auth (no Bearer requirement) | FAIL (narrow) | `apps/api/src/modules/auth/controller.ts:32-41`: `refresh` builds `{ refreshToken: cookieToken ?? bodyToken }` and calls `svc.refresh(...)` — the cookie alone is sufficient, no CSRF token / double-submit value / Origin check is required in addition to it. | See finding CSRF-01. Severity is reduced by `SameSite=Lax` + `express.json()` only parsing `application/json` bodies (a plain HTML `<form>` cross-site POST cannot reach the JSON body parser, and a JS `fetch` cross-site POST is blocked from sending the Lax cookie) — but there is **no defense-in-depth second factor** (no Origin/Referer check, no CSRF token) if the SameSite assumption is ever weakened (older browser, browser bug, a future code change that flips `sameSite` to `'none'`, or a same-site-but-different-subdomain attacker page if the cookie domain is ever widened). |
| CSRF token / double-submit-cookie pattern present anywhere | FAIL | `grep -rln "csrf|csurf|double-submit|doubleSubmit|x-csrf" apps/api/src apps/web/src` → no output (zero matches) | No CSRF-token middleware (`csurf`, custom double-submit) exists anywhere in the codebase. The sole defense for the one cookie-authenticated endpoint is `SameSite=Lax`. See CSRF-01. |
| Origin/Referer validation as a CSRF mitigation | FAIL | `grep -rn "req.headers.origin|req.header('origin')|...|Referer|referer" apps/api/src --include="*.ts"` → no output (zero matches, excluding tests) | No Origin/Referer allow-listing anywhere in the Express pipeline. Not required given SameSite=Lax + same-origin topology, but it's a defense-in-depth gap (see CSRF-01). |
| CORS (`Access-Control-Allow-Origin`) configuration on the Express API | PASS | `grep -rn "Access-Control\|cors(" apps/api/src infra` → no output; `grep -n "\"cors\"" apps/api/package.json` → no output | No `cors` npm package dependency and no manual `Access-Control-*` headers anywhere in the Express app. Browsers therefore apply the default same-origin policy to all `/api/v2/*` responses — a cross-origin page cannot read API JSON responses even if it could trigger a request. This is the main reason a successful blind-CSRF against `/auth/refresh` has limited value to an attacker (see CSRF-01 for the residual risk that does exist). |
| CORS configuration on the Socket.IO realtime server | FAIL | `apps/api/src/platform/realtime/index.ts:135-137`: `const io: AppServer = new IOServer(httpServer, { cors: { origin: true, credentials: true } });` | `origin: true` (reflects whatever `Origin` header the client sent) combined with `credentials: true` is a permissive CORS combination. See CSRF-02. Exploitability is mitigated because the socket.io handshake authenticates via JWT bearer token in `socket.handshake.auth.token` (`extractToken`, `realtime/index.ts:77-83`), not the cookie — so this is not itself a cookie-based CSRF vector — but it is still a CORS misconfiguration worth flagging under this audit's "CORS config ... overly permissive origin + credentials:true" instruction. |
| Reverse-proxy / deployment topology re: cross-origin exposure | PASS | `infra/prod/nginx.conf:62-87`: SPA static files, `/api/` and `/socket.io/` are all served from the single origin `crm.allcheckservices.com` (no separate API subdomain) | Same-origin web+API topology means the web app itself never needs cross-origin credentialed requests; CORS is irrelevant to the legitimate web client. The `apps/web/src/lib/sdk.ts` fetch calls (`credentials:'include'` at lines 49, 76, 111) hit relative paths (`/api/v2/...`), confirming same-origin usage. |
| State-changing `GET` endpoints that could be triggered by a cross-site top-level navigation (the one case `SameSite=Lax` does not block) | PASS | `grep -rn "router.get(" apps/api/src/modules --include="routes.ts" \| grep -i "delete\|revoke\|approve\|assign\|complete\|cancel"` → no output. Manual check of `apps/api/src/modules/auth/routes.ts:21,30,38,43` shows all `GET` routes (`/me`, `/mfa/status`, `/sessions`, `/my-consents`) are read-only and Bearer-gated (not cookie-gated). | No mutating action is reachable via `GET`, so the one scenario where Lax still attaches the cookie cross-site (top-level GET navigation) has no exploitable target. |
| Logout / change-password / MFA / session-revoke CSRF exposure | PASS | `apps/api/src/modules/auth/controller.ts:48-52` (`logout`), `68-74` (`changePassword`), MFA handlers (78-110), session handlers (113-136) all call `requireUserId(req)` (`controller.ts:7-10`), which reads `req.auth.userId` — populated **only** by `authenticate()` from the `Authorization: Bearer` header (`authenticate.ts:19-23`). The cookie is never consulted by these handlers. | An attacker cannot forge `logout`/`changePassword`/MFA/session-revoke via the cookie alone, because the bearer access token (kept in JS memory, per architecture inventory §1, not in any cookie) is required and is not attacker-readable or auto-attached cross-site. These endpoints are therefore CSRF-safe by construction (no ambient credential). |

## Findings

### CSRF-01
- **Category:** Cross-Site Request Forgery — missing secondary defense on a cookie-authenticated endpoint
- **Severity:** Low
- **CVSS:** 3.7 (AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N) — CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N
- **OWASP Mapping:** OWASP Top 10:2021 A01:2021 – Broken Access Control (CSRF is filed under A01 in the 2021 edition)
- **CWE Mapping:** CWE-352 (Cross-Site Request Forgery)
- **Location**
  - **File:** `apps/api/src/modules/auth/controller.ts`
  - **Line Number:** 32-41 (also `apps/api/src/http/refreshCookie.ts:1-34`)
- **Evidence:**
  ```ts
  // apps/api/src/modules/auth/controller.ts:32-41
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      // Accept the refresh token from the httpOnly cookie (web, SEC-10) OR the body (mobile parity).
      const cookieToken = readRefreshCookie(req);
      const bodyToken = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
      const refreshToken = cookieToken ?? (typeof bodyToken === 'string' ? bodyToken : undefined);
      const tokens = await svc.refresh({ refreshToken }, req.ip ?? null);
      setRefreshCookie(res, tokens.refreshToken); // rotate the cookie too
      res.json({ tokens });
    } catch (e) {
  ```
  ```ts
  // apps/api/src/http/refreshCookie.ts:18-23
  export function setRefreshCookie(res: Response, token: string): void {
    res.cookie(NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: loadEnv().NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: loadEnv().AUTH_REFRESH_TTL_S * MS_PER_S,
    });
  }
  ```
  Confirmed: `grep -rln "csrf|csurf|double-submit|doubleSubmit|x-csrf" apps/api/src apps/web/src` → empty (no CSRF token mechanism exists anywhere in the repo).
- **Why it is a problem:** `POST /api/v2/auth/refresh` is authenticated solely by an ambient credential (the `crm2_rt` cookie) with no CSRF token, no double-submit-cookie value, and no Origin/Referer allow-list as a second factor. Today this is saved by `SameSite=Lax` (blocks the cookie on cross-site `fetch`/XHR POST and on cross-site `<form>` POST navigations) plus `express.json()` only parsing `application/json` bodies (a plain cross-site HTML form can't set that content-type). But the endpoint has **zero defense-in-depth**: it relies on exactly one browser behavior holding forever. A future change that sets `sameSite: 'none'` (e.g. to support an embedded iframe integration, a different subdomain for static assets, or a misguided "fix" for a cross-origin dev/staging setup) would silently turn this into a fully exploitable session-rotation CSRF with no compensating control to catch the regression.
- **Real world attack scenario:** If the SameSite protection were ever weakened (config regression, browser quirk, or a same-site-but-attacker-controlled subdomain such as a future `*.allcheckservices.com` tenant), a logged-in field-ops manager visiting a malicious page would have their session's refresh token silently rotated by a blind cross-site POST. The attacker can't read the new token (no permissive CORS — see the CORS PASS rows above) so this alone doesn't hijack the session, but it can be chained with the 60-second reuse-detection grace window (`apps/api/src/modules/auth/service.ts:282`, `REFRESH_REUSE_GRACE_MS = 60_000`): repeated forced rotations timed against the victim's legitimate refresh calls could trigger `fullyRevokeUser` (treating the legitimate client's now-stale token as "theft replay"), forcibly logging the victim out of an active case-management session — a self-inflicted denial-of-service against a field supervisor mid-shift.
- **Business impact:** Low under current config (SameSite=Lax holds). If regressed, forced session disruption (DoS on legitimate users, e.g. a field agent locked out mid-verification) is the realistic worst case — not data exfiltration, since CORS is locked down separately.
- **Recommended fix:** Add a defense-in-depth Origin check on `/api/v2/auth/refresh` (and any other cookie-reading route added in future): reject the request if `Origin`/`Referer` is present and doesn't match the configured app origin. This costs a few lines, doesn't require a token-issuance round trip, and catches a `SameSite` regression immediately instead of silently reopening CSRF. A classic CSRF token is unnecessary extra surface given the same-origin topology — the Origin check is the proportionate fix here.
- **Estimated effort:** S (a few hours — one shared `requireSameOrigin` check, wired into the `refresh` controller)
- **Priority:** P3
- **Status:** OPEN

### CSRF-02
- **Category:** CORS misconfiguration (permissive origin + credentials) on the realtime transport
- **Severity:** Low
- **CVSS:** 4.3 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N)
- **OWASP Mapping:** OWASP Top 10:2021 A05:2021 – Security Misconfiguration
- **CWE Mapping:** CWE-942 (Permissive Cross-domain Policy with Untrusted Domains)
- **Location**
  - **File:** `apps/api/src/platform/realtime/index.ts`
  - **Line Number:** 135-137
- **Evidence:**
  ```ts
  // apps/api/src/platform/realtime/index.ts:134-137
  export function initRealtime(httpServer: HttpServer, env: Env = loadEnv()): AppServer {
    const io: AppServer = new IOServer(httpServer, {
      cors: { origin: true, credentials: true },
    });
  ```
- **Why it is a problem:** `origin: true` tells socket.io/`engine.io` to reflect whatever `Origin` header the connecting page sends back as `Access-Control-Allow-Origin`, and `credentials: true` adds `Access-Control-Allow-Credentials: true`. This is the textbook overly-permissive combination the audit brief specifically calls out ("any overly permissive origin + credentials:true combination that would make a cookie-based CSRF exploitable cross-origin"). In this codebase the practical impact is narrowed because: (a) the socket.io handshake authenticates via a JWT bearer token passed in `socket.handshake.auth.token` (`extractToken`, lines 77-83), not the `crm2_rt` cookie — an attacker page has no way to read or supply a victim's access token cross-site, so it cannot complete a privileged handshake; (b) `credentials: true` on a `socket.io` `cors` option primarily affects whether browser cookies are attached to the underlying XHR/WebSocket polling fallback requests, but no cookie-based identity is checked on the socket.io side. Still, this is a real CORS misconfiguration that should be tightened to a fixed allow-list (the single production origin `https://crm.allcheckservices.com` (+ the local dev origin)) — "fail open" CORS is fragile if any future code path starts trusting socket.io's `Origin` for something cookie-based.
- **Real world attack scenario:** Today, an attacker page cannot establish an authenticated socket.io connection (it has no valid JWT to put in `auth.token`), so it cannot subscribe to a victim's `user:<id>` room or read live case/notification data over the socket. The realistic risk is forward-looking: if a future change ever adds a cookie-based or session-based identity path to the socket handshake (e.g. "also accept the refresh cookie for socket auth" as a convenience), this CORS config would immediately make it exploitable cross-origin with no additional code change needed on the server side.
- **Business impact:** No current exploitation path found (handshake requires a bearer JWT an attacker page can't obtain). Risk is configuration fragility / latent exposure, not an active vulnerability.
- **Recommended fix:** Replace `origin: true` with an explicit allow-list sourced from the same place the API's trusted origin would be configured (e.g. `https://crm.allcheckservices.com` in prod, `http://localhost:5273` in dev), matching the same-origin topology already documented in `infra/prod/nginx.conf`. Drop `credentials: true` unless a concrete cookie-based socket auth need is added (none exists today).
- **Estimated effort:** S (under an hour — one config object change + an env-driven origin value)
- **Priority:** P3
- **Status:** OPEN

## Summary

Counts by severity: Critical 0, High 0, Medium 0, Low 2, Informational 0.

Overall verdict: **PARTIAL**. The CRM2 API has only one cookie-authenticated endpoint (`POST /api/v2/auth/refresh`); every other state-changing route requires the in-memory-held `Authorization: Bearer` access token, which is not an ambient browser credential and is therefore immune to classic CSRF by construction (verified across every `routes.ts` under `apps/api/src/modules`). The refresh cookie is correctly `httpOnly`, `Path`-scoped to `/api/v2/auth`, `Secure` in production, and `SameSite=Lax`, and there are no state-changing `GET` routes that would let a Lax cookie leak via top-level cross-site navigation. The API itself sets no CORS headers (no `cors` package, no manual `Access-Control-*`), so the same-origin policy blocks any cross-origin JS from reading API responses regardless. However, the refresh endpoint has **no defense-in-depth beyond `SameSite=Lax`** — no CSRF token, no double-submit cookie, no Origin/Referer check — making it a single-point-of-failure if that browser attribute is ever weakened by a future config change (CSRF-01, Low). Separately, the Socket.IO server is configured with `cors: { origin: true, credentials: true }` (CSRF-02, Low), a permissive combination that is currently inert (the handshake requires a bearer JWT an attacker page cannot obtain) but should be tightened to an explicit origin allow-list as routine hygiene. No Critical/High issues were found; both findings are Low severity and P3 priority.
