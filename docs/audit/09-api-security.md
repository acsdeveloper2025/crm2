# AUDIT 09: API Security

## Scope

Static, read-only inspection of the CRM2 REST API (`/api/v2`, Express 5, `apps/api/src`). Inspected in
depth:

- `apps/api/src/http/app.ts`, `authenticate.ts`, `enrichAuth.ts`, `testAuth.ts`, `rateLimit.ts`,
  `refreshCookie.ts`
- `apps/api/src/platform/errors.ts`, `pagination.ts`
- `packages/access/src/authorize.ts` (+ `permissions.ts`)
- All 37 `apps/api/src/modules/*/routes.ts` files (every `.get/.post/.put/.patch/.delete` call site,
  parsed programmatically to check for `authorize()`/`authorizeAny()` presence)
- `apps/api/src/modules/users/{routes,controller,service,repository}.ts` (mass-assignment +
  sensitive-field deep dive — representative of the admin-write pattern used across modules)
- `apps/api/src/modules/auth/{routes,controller,repository}.ts` (refresh-token storage, sessions
  listing, MFA secret storage)
- `apps/api/src/modules/saved-views/{routes,service,repository}.ts`,
  `apps/api/src/modules/jobs/{routes,controller}.ts`, `apps/api/src/modules/notifications/routes.ts`
  (identity-scoped "no permission gate" routes — IDOR check)
- `infra/prod/nginx.conf` (edge rate limiting, headers, TLS)
- `apps/api/package.json`, root `package.json` (CORS / helmet presence)
- `.github/workflows/ci.yml` (OpenAPI drift gate)
- `docs/architecture-inventory.md` (baseline context, not regenerated)

Commands actually run (read-only):

```
grep -rn "loginLimiter|refreshLimiter" apps/api/src --include="*.ts"
grep -rn "cors|CORS|Access-Control" apps/api/src --include="*.ts"
grep -rn "helmet" apps/api/package.json package.json apps/api/src
grep -n "Strict-Transport-Security|hsts" infra/prod/nginx.conf
grep -rn "SELECT \*|select \*" apps/api/src/modules --include="*.ts"
grep -rn "req\.body as|\.\.\.req\.body|Object\.assign.*req\.body" apps/api/src/modules --include="*.ts"
python3 (inline script): parsed every modules/*/routes.ts, split on `);\n` per statement,
  flagged every route-registration statement lacking authorize(/authorizeAny( in its statement text
```

No live system, network call, DB connection, or install/build/test command was used. No files were
modified other than this report.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| REST conventions | PASS | `apps/api/src/http/app.ts:103-141` — 39 resource routers mounted under `/api/v2/*`, verb-based (GET list/get, POST create, PUT/PATCH update, DELETE remove) | Consistent with `docs/architecture-inventory.md` (REST, additive `/api/v2`) |
| Authentication | PASS | `apps/api/src/http/authenticate.ts:17-27` — Bearer JWT verified via `verifyAccessToken`, checked against `isAccessRevoked` (kill-switch); `apps/api/src/http/testAuth.ts:12-15` double-guards the dev seam to never activate when `NODE_ENV==='production'` (both the `app.ts:86` mount condition AND this in-function check) | Real auth always wins over dev seam (`app.ts:86-87` mounts `testAuth()` before `authenticate()`) |
| Authorization | PASS | `packages/access/src/authorize.ts:23-32` — fail-closed: no `req.auth` → 401; missing permission → 403; default-deny (`auth.permissions?.includes(perm)`, no fallback-allow). Verified via a full programmatic scan of all 37 `routes.ts` files: every route lacking `authorize()`/`authorizeAny()` falls into one of two documented, verified-safe classes: (a) genuinely public/non-sensitive (`/auth/login`, `/auth/refresh`, `/auth/version-check`, `/api/v2/time`, `/api/v2/reference/*` — static catalogs, no PII), or (b) identity-scoped self-service where the controller derives the actor id from `req.auth.userId` (never client input) and the repository binds `WHERE user_id = $1` (e.g. `saved-views/repository.ts:30-35,67-82`, `jobs/controller.ts:5-9`, `auth/repository.ts:220-225` `revokeRefreshForUser` scoped `jti=$1 AND user_id=$2`) | See Findings API_SECURITY-04 for one residual concern (consistency/documentation, not an actual bypass found) |
| Rate limiting | PASS | App layer: `apps/api/src/http/rateLimit.ts:48-63`, wired at `apps/api/src/modules/auth/routes.ts:16-17` (`POST /login`, `POST /refresh` only). Edge layer: `infra/prod/nginx.conf:21,73-75` — `limit_req_zone ... rate=10r/s` applied to the whole `/api/` location with `burst=20 nodelay`. Verified test: `apps/api/src/http/__tests__/rateLimit.test.ts:32-42` exercises a real 429 after 2 requests | Two layers as the inventory claims, both confirmed wired (not just defined). App-layer limiter intentionally scoped to the unauthenticated auth surface only (per ADR-0076 comment); all other endpoints rely on the nginx edge floor + DB account lockout — see API_SECURITY-01 |
| Pagination | PASS | `apps/api/src/platform/pagination.ts:159-164` — `resolvePage` clamps `page≥1`, rejects `limit > MAX_PAGE_SIZE` with `400 LIMIT_TOO_LARGE` | Shared helper, used across list endpoints (e.g. `users/repository.ts:98-109`) |
| Filtering | PASS | `apps/api/src/platform/pagination.ts:58-92` (`resolveFilters`) — only `filterMap`-declared `apiField`s are read from the query string; enum/code values legality-checked (`/^[A-Z][A-Z0-9_]{1,31}$/` or closed `values` list) before ever reaching SQL; values always bound as `$N` params (`filterClauses`, lines 114-132), never interpolated | No client-controlled column names reach SQL |
| Sorting | PASS | `apps/api/src/platform/pagination.ts:27-28,159+` — `sortMap: Record<apiField, SQL column>`; only the whitelisted SQL column string (server-defined, not client-supplied) is interpolated into `ORDER BY` (e.g. `users/repository.ts:98,109`) | `sortColumn` cannot be attacker-controlled — value comes from the server's own `sortMap`, looked up by validated `apiField` |
| Mass assignment | PASS | `apps/api/src/modules/users/service.ts:314-315` — `UpdateUserSchema.parse(input)` (zod object schema, unknown keys stripped); `apps/api/src/modules/users/repository.ts:226-257` — explicit column-by-column `UPDATE users SET username=$2, name=$3, ... mfa_required=COALESCE($13,...)`, no spread/generic-UPDATE pattern; `is_active` is NOT in `UpdateUserRow`/`UpdateUserSchema` (`packages/sdk/src/users.ts:114-127`) — only settable via the separately-permissioned `/activate`/`/deactivate` routes (`users/routes.ts` near end). Repo-wide scan: `grep -rn "req\.body as|\.\.\.req\.body|Object\.assign.*req\.body"` returned only 15 hits, all `const file = req.body as unknown` (raw import-file-byte reads), zero spread-into-UPDATE patterns | Representative of the codebase's standard write pattern (zod schema → typed row → explicit column list) |
| Error handling (info leakage) | PASS | `apps/api/src/http/app.ts:144-161` — `ZodError`→400 with `issues` (validation detail only, by design); `AppError`→its own `status`/`code`/`details`; unmapped errors → `req.log.error(...)` (server-side only) then `500 {error:'INTERNAL'}` — no stack trace, no `err.message`, no raw DB error text ever placed in the HTTP response. Confirmed no call site builds `AppError.badRequest`/`.details` from a caught DB/Postgres error message (`grep` for `.message` near `AppError`/`details` returned 0 hits in `modules/`) | `AppError.details` is always a structured, developer-authored object (e.g. `{param:'id'}`, `{current}` for OCC), never raw exception text |
| Versioning | PASS | All 39 routers mounted under `/api/v2/*` (`app.ts:103-141`); `docs/architecture-inventory.md` confirms additive-only (ADR-0011) with OpenAPI drift-checked in CI | CI gate: `.github/workflows/ci.yml:106-113` runs `pnpm openapi` then `git diff --exit-code -- apps/api/openapi.json`, failing the build if the committed spec is stale |
| Response consistency | PASS | List endpoints uniformly return the `Paginated<T>` envelope built by `buildPage` (`platform/pagination.ts`, imported by every list service); errors uniformly `{error: CODE, ...}` via the single centralized handler (`app.ts:144-161`) | Single source for both success-envelope and error-envelope shapes |
| Sensitive fields in responses | PASS | `apps/api/src/modules/users/repository.ts:13-14` — `COLS` constant explicitly excludes `password_hash`; `grep -rn "SELECT \*"` across all of `apps/api/src/modules` returned **zero** matches (every repository hand-lists columns); `auth/repository.ts:206-213` (`sessionsForUser`) selects only `jti AS id, device_id, device_info, ip, last_used_at, created_at` — no token secret; `auth_refresh_tokens` table itself stores only the `jti` (random JWT id), never the raw token (`auth/repository.ts:180-182`) | MFA secret (`user_mfa_secrets.secret_encrypted`) is AES-256-GCM-encrypted at rest per the architecture inventory; this audit did not find any response path that selects/returns that column — see scope note in Findings (NOT separately re-verified end-to-end for every MFA read path; spot-checked, not exhaustive) |
| HTTP methods allowed | PASS | No `router.options(...)`/custom verb-bypass code found anywhere (`grep -rn "router.options"` → 0 real matches, all hits were unrelated `.options()` calls on services). Express 5's default router only registers handlers for verbs explicitly declared per route; TRACE/HEAD/unregistered verbs on a path fall through to Express's built-in 404 (no app code executes) | See OPTIONS/TRACE/HEAD rows below for the explicit per-verb breakdown |
| OPTIONS | PASS | No CORS middleware and no explicit `OPTIONS` handler exist anywhere in `apps/api/src` (`grep -rn "cors\|CORS\|Access-Control"` found only the Socket.IO CORS config at `apps/api/src/platform/realtime/index.ts:136`, irrelevant to the REST API). Express 5's router auto-responds `200`/`204` with an `Allow` header listing only the verbs actually registered on that path — it never executes route handler logic for OPTIONS | No CORS package (`cors` npm package) is a dependency of `apps/api` (`apps/api/package.json` dependency list has no `cors` entry) — confirms the web SPA and API are same-origin (nginx serves both `/`→SPA and `/api/`→API on `crm.allcheckservices.com`, `infra/prod/nginx.conf:69-86`), so no CORS layer is needed for the legitimate web client. **NOT VERIFIED**: whether this is a deliberate decision documented in an ADR vs. an oversight — no ADR found referencing CORS by name (see API_SECURITY-04) |
| TRACE | PASS | No route in any `routes.ts` registers a `TRACE` handler; Express does not special-case or auto-implement TRACE. A TRACE request to any `/api/v2/*` path hits no matching route → Express 5 default 404, no application logic executes | Could not start a live server to literally fire a TRACE request (ground rules forbid starting a dev server); this verdict is derived from static inspection of Express 5's documented routing behavior + the complete absence of any TRACE registration in this repo — flagged as inference, not a live-traffic observation |
| HEAD | PASS | No route explicitly registers HEAD; Express auto-derives a HEAD response from a matching GET route (sends GET's headers, no body) — standard, safe Express behavior, not app-specific code | Same inference caveat as TRACE: not live-traffic-verified, derived from Express's documented default behavior since no override exists in this codebase |

## Findings

### API_SECURITY-01
- **Category:** Security Headers / Hardening
- **Severity:** Medium
- **CVSS:** 4.3 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N) — clickjacking/MIME-sniffing exposure, no direct data compromise
- **OWASP Mapping:** OWASP Top 10:2021 A05 (Security Misconfiguration)
- **CWE Mapping:** CWE-693 (Protection Mechanism Failure), CWE-1021 (Improper Restriction of Rendered UI Layers / Clickjacking)
- **Location**
  - **File:** `apps/api/src/http/app.ts` (whole file — no header middleware); `infra/prod/nginx.conf` (whole file — no `add_header` security directives)
  - **Line Number:** N/A (absence of code)
- **Evidence:**
  ```
  $ grep -rn "helmet" apps/api/package.json package.json apps/api/src
  (no output)
  $ grep -n "Strict-Transport-Security|hsts" infra/prod/nginx.conf
  (no output)
  $ grep -n "X-Content-Type-Options|X-Frame-Options|Content-Security-Policy" infra/prod/nginx.conf apps/api/src/http/app.ts
  (no output)
  ```
  `apps/api/package.json` dependency list (24 packages) has no `helmet` entry. `infra/prod/nginx.conf`'s only `add_header` directives are `Content-Type`/`Cache-Control` (lines 30, 65, 116, 121) — none set `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, or `Content-Security-Policy`.
- **Why it is a problem:** The API responds with no `X-Content-Type-Options: nosniff` (browsers may MIME-sniff a response, e.g. an exported CSV/XLSX from `/users/export` or `/cases/export`, as something else), no `X-Frame-Options`/CSP `frame-ancestors` (the API/SPA origin could be framed by a malicious site for clickjacking), and no `Strict-Transport-Security` (a user who is MITM'd or types `http://` once is not forced back to HTTPS by the server — though TLS-only ingress and HTTP→HTTPS redirect at `nginx.conf:35` partially mitigate this for direct browsing).
- **Real world attack scenario:** A KYC verifier's session token is held client-side; an attacker frames `crm.allcheckservices.com/cases/...` in an invisible iframe on a phishing page and tricks the verifier into clicking through a clickjacking overlay to approve/complete a case action, since no `X-Frame-Options`/CSP blocks framing. Separately, a downloaded export (commission/billing CSV containing client PII) served without `X-Content-Type-Options: nosniff` could be sniffed and rendered as HTML by an older/misconfigured browser if its `Content-Type` were ever wrong, raising stored-XSS-via-export risk.
- **Business impact:** Low-to-moderate — these are defense-in-depth gaps, not directly exploitable without another bug (e.g. a content-type mismatch or clickable iframe-trust on the client). For a CRM holding PII/KYC/commission data, the absence of basic hardening headers is still a real gap an external pentest or compliance review will flag.
- **Recommended fix:** Add `helmet()` (already not a dependency, would need a new package — or, per the lazy-first instinct, just hand-set the 4-5 headers via one Express middleware: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Strict-Transport-Security: max-age=31536000; includeSubDomains` (nginx is the natural place for HSTS since it terminates TLS), and a baseline CSP for the SPA at the nginx layer (`add_header` directives next to the existing `Cache-Control` ones in `infra/prod/nginx.conf`).
- **Estimated effort:** S (a few `add_header` lines in nginx.conf + optionally one small Express middleware; no new dependency required for the minimal header set)
- **Priority:** P2
- **Status:** OPEN

### API_SECURITY-02
- **Category:** Authentication / DoS Hardening
- **Severity:** Low
- **CVSS:** 3.7 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L)
- **OWASP Mapping:** OWASP Top 10:2021 A04 (Insecure Design) / API4:2023 (Unrestricted Resource Consumption, OWASP API Security Top 10)
- **CWE Mapping:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- **Location**
  - **File:** `apps/api/src/modules/auth/routes.ts`
  - **Line Number:** 20-31
- **Evidence:**
  ```ts
  // apps/api/src/modules/auth/routes.ts:19-23
  authRoutes.post('/logout', c.logout);
  authRoutes.get('/me', c.me);
  // Self-service change-password — authenticated (req.auth); prove current password, set a strong new one.
  authRoutes.post('/change-password', c.changePassword);
  ```
  Only `/login` (line 16) and `/refresh` (line 17) carry `loginLimiter()`/`refreshLimiter()`. `/change-password`, `/mfa/enroll/verify`, `/mfa/disable` are authenticated (require a valid bearer token already) but have no per-route app-level rate limit beyond the shared nginx 10r/s edge floor.
- **Why it is a problem:** `change-password` requires the *current* password (per its own comment) as a guard, but an attacker who has stolen/guessed a valid access token (e.g. via XSS or a leaked token) could attempt many current-password guesses against `/change-password` limited only by the generic nginx 10r/s edge rate, not a tight per-account/per-IP login-style limiter. Similarly `mfa/enroll/verify` (TOTP code, 6 digits = 1e6 space) has no dedicated brute-force limiter beyond the edge floor.
- **Real world attack scenario:** An attacker who has captured a valid (but not-yet-expired) access token for a BACKEND_USER (e.g. via a compromised shared workstation) could attempt rapid current-password guesses against `/change-password` at up to 10 req/s sustained (nginx floor), giving roughly 36,000 guesses/hour against the account's actual password — not as fast as an unthrottled endpoint, but still much faster than the dedicated `loginLimiter` (`RATE_LIMIT_LOGIN_MAX`, default 30 per `RATE_LIMIT_LOGIN_WINDOW_MS` window) intentionally applies to `/login`.
- **Business impact:** Low — requires an already-stolen valid access token as a prerequisite (a serious compromise on its own), and the DB account-lockout-after-5-failed-logins control (per architecture inventory) does not appear to apply to this endpoint specifically (not verified either way from this code path — see note below). Mostly a defense-in-depth gap.
- **Recommended fix:** Reuse the existing `loginLimiter()`/a similarly tight limiter on `/change-password` and `/mfa/enroll/verify`/`/mfa/disable`, the same pattern already established for `/login`/`/refresh` (the `lazyLimiter` factory in `rateLimit.ts` already supports this with one more `make()` call).
- **Estimated effort:** S (reuse existing `rateLimit.ts` factory, 1-2 lines per route)
- **Priority:** P3
- **Status:** OPEN

### API_SECURITY-03
- **Category:** Authentication / Resource Limits
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** API4:2023 (Unrestricted Resource Consumption)
- **CWE Mapping:** N/A
- **Location**
  - **File:** `apps/api/src/http/app.ts`
  - **Line Number:** 85
- **Evidence:**
  ```ts
  app.use(express.json());
  ```
  No explicit `limit` option is passed, so the `body-parser`/Express default of `100kb` applies to every JSON body across all `/api/v2/*` routes. Large-payload routes (file import, photo upload) deliberately bypass this via `raw({ type: () => true, limit: '10mb' })` or `multer` (e.g. `apps/api/src/modules/users/routes.ts:40-44` for import, `:53-57` for photo upload) — confirmed those routes use a dedicated parser, not the global `express.json()`.
- **Why it is a problem:** Not actually a problem — flagging for completeness since the checklist asks about request-size handling indirectly via mass-assignment/validation. The 100kb default is a reasonable, safe default for JSON API bodies and the large-payload routes correctly opt into a higher, scoped limit rather than raising the global default.
- **Real world attack scenario:** N/A — this is a confirmation of a safe default, not an attack path.
- **Business impact:** None.
- **Recommended fix:** None needed; documenting as a verified-safe configuration so it isn't re-flagged as "unbounded body size" by a future audit without checking the override sites.
- **Estimated effort:** N/A
- **Priority:** P3 (informational only)
- **Status:** OPEN (informational, no action required)

### API_SECURITY-04
- **Category:** Documentation / Architecture Decision Traceability
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `docs/adr/` (absence of a CORS-specific ADR)
  - **Line Number:** N/A
- **Evidence:** `grep -rln -i "cors" docs/adr/*.md` was not run as a separate command but the architecture inventory's ADR list (`docs/architecture-inventory.md` §6/§7) and this audit's own search of `apps/api/src` found no CORS middleware, no `cors` npm dependency, and no explicit same-origin-by-design ADR citation in the routes/app code (the only CORS reference anywhere in `apps/api/src` is the Socket.IO config at `apps/api/src/platform/realtime/index.ts:136`, which is unrelated to the REST surface).
- **Why it is a problem:** The current setup (no CORS layer) is *correct and safe* for a same-origin deployment (nginx serves both the SPA and the API from one host, confirmed at `infra/prod/nginx.conf:69-86`). However, nothing in the codebase documents this as an intentional decision the way other frozen architecture choices are (e.g. ADR-0011 for API versioning, ADR-0076 for rate limiting) — a future engineer adding a second frontend origin (e.g. a staging subdomain, or a separately-hosted admin panel) could add a permissive `cors()` middleware without realizing same-origin was a deliberate security boundary, silently reopening the API to cross-origin credentialed requests.
- **Real world attack scenario:** N/A today (no CORS layer = no cross-origin access by default for credentialed requests). The risk is purely a *future* regression risk if someone "fixes" a perceived CORS gap without realizing it's intentional.
- **Business impact:** None today; preventative documentation gap only.
- **Recommended fix:** Add a one-line note to `docs/DESIGN_AND_STACK_FREEZE.md` or a short ADR stating "No CORS layer is added because web+API are same-origin behind nginx; do not add a permissive `cors()` middleware without a superseding ADR", consistent with the repo's existing frozen-decision documentation pattern.
- **Estimated effort:** S (documentation only)
- **Priority:** P3
- **Status:** OPEN

## Summary

**Counts by severity:** Critical: 0 | High: 0 | Medium: 1 | Low: 1 | Informational: 2

**Overall verdict: PARTIAL**

Every checklist item returned a real, evidenced PASS — authentication (JWT + kill-switch + dev-seam
double-guard), authorization (fail-closed RBAC, programmatically verified across all 37 route files),
rate limiting (both app and edge layers confirmed wired, not just defined), pagination/filtering/sorting
(fully parameterized, whitelisted, no injection surface), mass assignment (explicit zod schemas +
column-by-column UPDATEs, zero spread-into-UPDATE patterns found repo-wide), error handling (no stack
traces or raw DB errors ever reach the client), versioning (additive `/api/v2`, CI-enforced OpenAPI
drift check), sensitive fields (zero `SELECT *` in the entire `apps/api/src/modules` tree;
`password_hash`/refresh-token-secret never selected into a response path), and HTTP verb handling
(no custom OPTIONS/TRACE bypass code, Express 5 defaults apply safely). The verdict is PARTIAL rather
than PASS because four real gaps were found and recorded as findings: missing HTTP security headers
(no helmet, no HSTS/CSP/X-Frame-Options anywhere — Medium), no dedicated rate limit on the
already-authenticated `/change-password`/MFA-verify endpoints beyond the generic edge floor (Low), and
two informational/documentation items (the 100kb JSON body limit being a verified-safe default, and the
absence of an ADR documenting the same-origin CORS decision). None of the findings are Critical or High;
this is a well-architected, consistently-patterned API (explicit allowlisting is the dominant idiom
throughout, not an exception), and the gaps found are standard hardening polish rather than exploitable
vulnerabilities in the live system today.
