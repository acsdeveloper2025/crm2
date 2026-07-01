# RE-AUDIT 05: XSS

Re-audited fresh against current HEAD (`8ded432`); remediation range `b19039e..8ded432`.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| XSS-01 (nginx CSP + security headers) | CONFIRMED_FIXED | `infra/prod/nginx.conf:79-84` (server-level CSP + X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, HSTS, all `always`); repeated in `/assets/` block `nginx.conf:143-148` and `= /index.html` block `nginx.conf:156-161`. `git diff b19039e..8ded432 -- infra/prod/nginx.conf` shows all three CSP `add_header` lines are `+` additions — not present pre-remediation. CSP is strict: `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`. |
| XSS-01 (Express API security headers) | CONFIRMED_FIXED | `apps/api/src/http/app.ts:57-65` `securityHeaders()` sets X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, wired at `app.ts:99`. `git show b19039e:apps/api/src/http/app.ts \| grep securityHeaders` returns nothing — the middleware did not exist pre-remediation. Locked-down `'none'` policy is correct for a JSON API (SPA gets its own richer CSP from nginx). |
| XSS-01 (SPA has no HTML-injection sinks) | CONFIRMED_FIXED | `grep -rn "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|document.write\|insertAdjacentHTML" apps/web/src` → zero hits. `grep -rn "srcdoc\|<iframe\|javascript:\|eval(\|new Function\|createContextualFragment" apps/web/src` → zero hits. No raw-HTML rendering path in the SPA. |
| XSS-01 (no handlebars triple-stache sink) | CONFIRMED_FIXED | Report templates are admin-authored Handlebars with auto-escape ON. Raw-output gate `RAW_OUTPUT_RE = /\{\{~?[{&]/` at `packages/sdk/src/reportLayouts.ts:238-247` rejects `{{{`, `{{&`, and the whitespace-control `{{~{` / `{{~&` variants on every create+update. FE mirrors the identical regex at `apps/web/src/features/reportLayouts/ReportLayoutRecordPage.tsx:196`. Only `SafeString` producers are `nl2br`/`badge` in `apps/api/src/modules/caseReports/render.ts:33-35,74`, both of which run `Handlebars.escapeExpression` BEFORE adding markup. Test coverage at `reportLayouts.api.test.ts:161,194,200` asserts `{{{ }}}` bodies are rejected 400. |

## New Findings

None.

Independent hunt covered: SPA HTML sinks (dangerouslySetInnerHTML/innerHTML/document.write/iframe/srcdoc/eval), handlebars raw-output escape opt-outs and their `~` bypass, the two server-side `SafeString` producers (both escape-first), and the FE/BE gate mirror. All escape by default; the only markup-emitting helpers escape user input before wrapping it. CSP `object-src 'none'` + `base-uri 'self'` + `frame-ancestors 'none'` also closes plugin/base-tag/clickjacking vectors. No `'unsafe-inline'` / `'unsafe-eval'` in either CSP.

## Verdict

**PASS.** Every XSS-01 claimed fix is real, present in the current code, and confirmed introduced by the remediation diff (nginx CSP + Express `securityHeaders()` were both absent at `b19039e`). The SPA has no HTML-injection sinks, the Handlebars report engine escapes by default with a robust raw-output reject gate (including the subtle `~` bypass) mirrored on both server and client, and both SafeString helpers escape before emitting markup. No new Medium+ findings and no regressions from the remediation. This area is genuinely clean.
