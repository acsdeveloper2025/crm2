# RE-AUDIT 09: API Security

Re-audit against current HEAD (8ded432); baseline b19039e. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| API_SECURITY-01 (security headers) | CONFIRMED_FIXED | `apps/api/src/http/app.ts:57-65` defines `securityHeaders()` setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; wired as the FIRST middleware at `app.ts:99` (before `express.json()`), so it applies to every response including error/429/404. `git diff b19039e..8ded432 -- app.ts` shows this block added, not pre-existing. |
| API_SECURITY-02 (sensitiveActionLimiter on change-password + MFA enroll/verify/disable) | CONFIRMED_FIXED | `apps/api/src/http/rateLimit.ts:73-78` adds `sensitiveActionLimiter()` (lazy, per-IP, login window/threshold). Wired at `apps/api/src/modules/auth/routes.ts:25` (change-password), `:34` (mfa/enroll/start), `:35` (mfa/enroll/verify), `:36` (mfa/disable). `mfa/status` (`:33`, read-only) and `mfa/admin/:userId/disable` (`:37`, perm-gated) intentionally not limited. Diff confirms all four were unlimited at baseline. |
| API_SECURITY-04 (ADR documents same-origin/no-CORS) | CONFIRMED_FIXED | `docs/adr/ADR-0082-same-origin-no-cors-layer.md` (Accepted, 2026-07-01) documents the decision. Verified against code: `grep` for `cors`/`Access-Control-Allow-Origin` across `apps/api/src` + `packages` returns nothing; no `cors` dep in `apps/api/package.json`. The one browser-CORS surface (Socket.IO handshake allowlist) is correctly called out. Decision matches reality. |
| API_SECURITY-03 (100kb body limit) | ACCEPTED_AS_DOCUMENTED (retracted) | `apps/api/src/http/app.ts:100` `app.use(express.json())` with no `limit` — Express default is 100kb, i.e. already bounded. The retraction ("verified-safe") is accurate; no oversized-body DoS via the JSON parser. |

## New Findings

None.

Independent hunt covered:
- **Error handler / stack-trace leakage** — `app.ts:159-176`: unhandled errors return only `{ error: 'INTERNAL' }` (`:175`); the log line (`:174`) records `err.message`, never `err.stack`, and never puts it in the response. Zod errors return `issues` (validation shape, intended). No leakage.
- **Mass-assignment on update/PATCH** — 30 modules parse `req.body` through explicit zod schemas; no `.passthrough()` and no `...req.body`/`Object.assign(row, req.body)` spread into persistence. The `req.body as unknown` hits are all import-file buffer endpoints (`const file = req.body as unknown`), not attribute assignment. Pre-existing, sound, unchanged by remediation.
- **verifySameOrigin (CSRF, added in remediation)** — `apps/api/src/http/sameOrigin.ts`: correctly fail-open on missing header (mobile body-token path unaffected) and fail-closed only on a contradicting host. Wired on `/refresh` (`routes.ts:18`), the only cookie-auth endpoint. No regression to the mobile contract.
- **Rate-limiter lazy build** — `rateLimit.ts:42-48` memoizes per-limiter; `validate: { creationStack: false }` disables only the false-positive guard. Correct for single-instance prod; keying via `trust proxy: 1` (`app.ts:98`) is unspoofable.

## Verdict

**PASS.** All three claimed FIXED items (API_SECURITY-01/-02/-04) are real and complete at the cited file:line, and the RETRACTED item (API_SECURITY-03) matches the documented 100kb-default acceptance. The independent re-scan of the error handler, update/PATCH mass-assignment surface, and the newly-added same-origin/rate-limit middleware found zero new issues and no remediation-introduced regression. Security headers apply globally (including error responses) because they are the first middleware, and no stack traces reach clients. This area is clean for Go/No-Go.
