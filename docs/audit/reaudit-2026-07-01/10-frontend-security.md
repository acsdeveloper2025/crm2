# RE-AUDIT 10: Frontend Security

Re-audited fresh against HEAD (`8ded432`); baseline `b19039e`. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| FRONTEND_SECURITY-02 (SPA edge security headers) | CONFIRMED_FIXED | `infra/prod/nginx.conf:76-81` (server-level), repeated at `:138-143` (`/assets/`) and `:150-155` (`/index.html`). Full set: X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS, CSP. Diff `git diff b19039e..8ded432 -- infra/prod/nginx.conf` = +34 lines, all additive. CSP is strict — no `unsafe-inline`/`unsafe-eval`/wildcard (grep clean). nginx add_header non-inheritance gotcha handled correctly (headers re-declared in each location that sets its own add_header). |
| FRONTEND_SECURITY-04 (ADR-0009 status corrected) | CONFIRMED_FIXED | `docs/adr/ADR-0009-feature-flags.md:3-9` now reads "Accepted (design) · NOT IMPLEMENTED — verified 2026-07-01". Independently confirmed: `grep -rniE "feature.?flag" apps/api/src apps/web/src packages` → zero hits. Registry §FRONTEND_SECURITY-04 (`docs/COMPLIANCE_GAPS_REGISTRY.md:1677`). |
| FRONTEND_SECURITY-01 (admin route client-guard, SR-11) | ACCEPTED_AS_DOCUMENTED | `docs/COMPLIANCE_GAPS_REGISTRY.md:1219` (SR-11, DEFERRED at LOW) and `:1661` (ACCEPTED_RISK). Documented rationale: all write controls are backend-gated by `authorize()`, so a missing client-side route guard is cosmetic/info-leak, not privilege escalation. No code change expected; none made. |
| FRONTEND_SECURITY-03 (access token in localStorage, ADR-0076 SEC-10) | ACCEPTED_AS_DOCUMENTED | `apps/web/src/lib/auth.ts:1-23`: only the short-lived access token + non-secret `jti` live in localStorage; the refresh token is httpOnly-cookie-only (comment + `tokenStore` contract). Registry `docs/COMPLIANCE_GAPS_REGISTRY.md:1660` (MERGED-ACCESS-TOKEN-LOCALSTORAGE, ACCEPTED_RISK, ADR-0076 SEC-10's deliberate scoping). Matches documented acceptance exactly. |

## New Findings

None.

Independent hunt performed (all clean):
- `grep -rn "console\." apps/web/src` → only prose in doc comments ("field-operations console"), zero real `console.*` calls.
- `grep -rn "import\.meta\.env" apps/web/src` → zero hits; no leaked build-time env secret.
- `sourcemap` not set in `apps/web/vite.config.ts` (Vite prod default = false) → no source maps shipped to prod.
- `dangerouslySetInnerHTML` in `apps/web/src` → zero hits (no DOM-injection sink).
- CSP contains no `unsafe-inline`, `unsafe-eval`, `*`, or `http:` (grep clean); `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` all present.
- `apps/web/vite.config.ts` unchanged across the remediation range — no regression there.
- nginx diff is +34 additive lines only; header re-declaration in each `location` correctly compensates for nginx's non-inheriting `add_header`, so `/assets/` and `/index.html` responses carry the full header set (not just the server-level defaults).

## Verdict

**PASS.** Both claimed fixes are real and complete against the live files (edge security headers present with a genuinely strict CSP and no inheritance gap; ADR-0009 status corrected and independently confirmed as zero-code). Both ACCEPTED items match their documented acceptance (access token scoping per ADR-0076 SEC-10; SR-11 client-route guard deferred as backend-gated cosmetic). Independent sweeps for console leaks, env-secret leaks, prod source maps, and HTML-injection sinks all came back clean, and the remediation introduced no regression — the diff is additive nginx headers plus a documentation correction. Zero new findings.
