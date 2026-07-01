# RE-AUDIT 19: Mobile API Compatibility

Re-audited fresh against HEAD `8ded432` (remediation range `b19039e..8ded432`). Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|---|---|---|
| MOBILE_API_COMPATIBILITY-01 (matrix doc: `/auth/accept-policies` → `/consents/accept`) | CONFIRMED_FIXED | `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md:35` now reads `POST /api/v2/consents/accept` + inline correction comment; `:46` Don't-regress bullet also corrected to `POST /consents/accept`. Real endpoint verified: `apps/api/src/http/app.ts:150` mounts `consentRoutes` at `/api/v2/consents`; `apps/api/src/modules/consents/routes.ts:10` `post('/accept', c.accept)`. `git diff b19039e..8ded432` shows both edits. |
| MOBILE_API_COMPATIBILITY-03 (CI mobile-contract gate now blocking) | CONFIRMED_FIXED | `.github/workflows/ci.yml:124-127`: step now runs `pnpm run contract:mobile` unconditionally (no `\|\| echo` swallow, no `--if-present`). `package.json:28` `contract:mobile` → `test:contract-mobile`; `apps/api/package.json:13` runs `vitest run` over 8 mobile modules (real tests). `contract:web` correctly stays `--if-present` because no such script exists yet (`grep "contract:web" package.json` → only the mobile line). |
| MOBILE_API_COMPATIBILITY-02 (forms/telemetry test coverage) | STILL_DEFERRED_AS_DOCUMENTED | `find apps/api/src/modules/forms apps/api/src/modules/telemetry -type d -name __tests__` → no output (no test dirs). Registry `docs/COMPLIANCE_GAPS_REGISTRY.md:1651-1652` documents it as deferred (trivial non-persisting stubs). Not accidentally "fixed wrong" — untouched. |
| MOBILE_API_COMPATIBILITY-04 (idempotency body-hash) | STILL_DEFERRED_AS_DOCUMENTED | `grep -rn "bodyHash\|body_hash\|hashBody" apps/api/src` → 0 hits (no body-hash mechanism added; `operation_id`-UNIQUE dedupe unchanged). Registry `:1653-1656` documents it deferred (touches a LOCKED mobile contract). |

## Critical contract-lock check (no wave broke a locked mobile contract)

- **SDK `.max()` bounds** — `packages/sdk/src/auth.ts:14-15` login `username .max(50)` / `password .max(200)`; `:30` refresh `.max(2000)`. These exactly match creation-time ceilings (`packages/sdk/src/users.ts:73` username `.max(50)`, `:91` StrongPasswordSchema `.max(200)`), so no legitimately-created account can produce a login payload that exceeds them. A real JWT refresh token is ~150-300 chars, far under 2000. **No mobile payload can exceed these — mobile unaffected.** (Wave-3, INPUT_VALIDATION-03.)
- **`verifySameOrigin` refresh gate** — `apps/api/src/http/sameOrigin.ts:16-17`: when Origin AND Referer are both absent, returns `next()`. Mobile (axios/RN) sends neither header, so it passes. Applied only on `/auth/refresh` (`apps/api/src/modules/auth/routes.ts:18`). Refresh controller reads the token from cookie **OR body** (`apps/api/src/modules/auth/controller.ts:38` `cookieToken ?? bodyToken`) — mobile's body path preserved. **Mobile unaffected.** (Wave-2/3, CSRF-01.)
- **socket.io CORS allowlist** — `apps/api/src/platform/realtime/index.ts:145` changed `origin: true` → prod-origin/dev-origins allowlist. CORS `origin` gates browser cross-origin XHR/WS via the `Origin` header; a non-browser socket.io client (mobile) sends no browser `Origin`, and the handshake auth is a bearer JWT (`extractToken` line 77-83, `resolveSocketIdentity` line 91-105) which is untouched. **Mobile socket client unaffected.** (Wave, MERGED-SOCKETIO-CORS.)
- **security-headers middleware** — `apps/api/src/http/app.ts:57-65` sets response headers only (nosniff/frame-deny/referrer/CSP `default-src 'none'`); it never inspects or rejects a request. A non-browser client ignores these response headers. **Mobile unaffected.**

## New Findings

None. Every claimed fix is real and complete, both deferred items remain in their documented deferred state (verified by absence of the fix code, not by trusting a comment), and no wave altered a locked mobile contract in a way that reaches the mobile client. The pre-existing doc-fidelity gap between the matrix row's `{policyIds[],source}` wording and the actual `{policyVersion}` accept schema (`apps/api/src/modules/consents/service.ts:6-13`) is unrelated to the claimed fix, was flagged in the original audit's finding-01 body, and carries no runtime risk (server enforces the real schema); no new defect introduced.

## Verdict

**PASS.** Both claimed fixes (MOBILE_API_COMPATIBILITY-01 doc correction, -03 CI gate now unconditional/blocking) are confirmed real and complete against file:line; both deferred items (-02, -04) are confirmed untouched and still in their documented deferred state — not accidentally mis-fixed. The four wave-introduced hardening changes on locked mobile surfaces (SDK `.max()` bounds, `verifySameOrigin`, socket.io CORS allowlist, security-headers) were each verified to be inert for the mobile app: bounds sit above any real payload, the same-origin gate passes header-less requests, CORS applies only to browser origins, and the security headers are response-only. Zero new Medium+ findings, zero regressions.
