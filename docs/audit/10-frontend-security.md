# AUDIT 10: Frontend Security

## Scope

Inspected `apps/web` (the React 19 / Vite 8 SPA), its build config, the `apps/web/src` tree (all
`features/`, `components/`, `lib/`), `apps/web/index.html`, `infra/Dockerfile.web`,
`infra/prod/nginx.conf`, the root `eslint.config.js`, `apps/api/src/http/app.ts`,
`apps/api/src/http/refreshCookie.ts`, and `docs/adr/ADR-0009-feature-flags.md`. Cross-referenced
`docs/architecture-inventory.md` (§1 Frontend, §6 Infrastructure, §8 Security).

Commands actually run (read-only):
- `grep -rn "sourcemap" apps/web ...` (no matches — no sourcemap override anywhere)
- `grep -rn "import\.meta\.env" apps/web/src` (no matches)
- `grep -rn "console\." apps/web/src --include="*.ts" --include="*.tsx"` (only doc-comment text matches, no real calls)
- `grep -rn "dangerouslySetInnerHTML\|\.innerHTML\|eval(\|new Function(" apps/web/src` (no matches)
- `cat apps/web/vite.config.ts`, `cat apps/web/package.json`, `cat apps/web/index.html`
- `cat infra/prod/nginx.conf`, `cat infra/Dockerfile.web`
- `cat apps/web/src/App.tsx`, `cat apps/web/src/components/Layout.tsx`, `cat apps/web/src/lib/sdk.ts`,
  `cat apps/web/src/lib/auth.ts`, `cat apps/web/src/lib/AuthContext.tsx` (partial), `cat apps/api/src/http/refreshCookie.ts`
- `grep -rln "usePermission\|hasPermission\|can(\|permissions.includes" apps/web/src/features` (no list-page guards found, only `has()` used for in-page action gating)
- `grep -rn "helmet\|X-Frame-Options\|Content-Security-Policy\|Strict-Transport-Security\|X-Content-Type-Options\|Referrer-Policy\|Permissions-Policy" apps/api/src apps/web` and `grep -n "helmet\|setHeader|app.use|cors" apps/api/src/http/app.ts`
- `ls apps/web/dist/assets`, `find apps/web/dist -iname "*.map"` (pre-existing local build artifact, gitignored — `git check-ignore -v apps/web/dist` confirmed) — used only as supporting evidence that a real Vite production build emits no `.map` files
- `grep -oE "(sk_live|AKIA|AIza...|-----BEGIN ... PRIVATE KEY-----)" apps/web/dist/assets/*.js` and a targeted grep for server-only env var names (`JWT_SECRET`, `DATABASE_URL`, `MFA_ENC_KEY`, `S3_SECRET_ACCESS_KEY`, `SMTP_PASSWORD`, `POSTGRES_PASSWORD`) inside the built bundle — no matches
- `grep -rniE "featureflag|feature_flag|feature flag" apps/web/src packages/config/src apps/api/src` and `grep -rliE "feature_flag|flags" db/v2/migrations` (no matches — ADR-0009 has no implementation anywhere in code)
- `grep -rn 'target="_blank"' apps/web/src` cross-checked against `rel=` attribute on each hit
- `grep -rn "postMessage\|window.open(" apps/web/src`
- `diff` of nav-link paths (`Layout.tsx`) vs all declared `<Route path>` values (`App.tsx`) to check for orphaned/hidden routes

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| React/Vite version & config sanity | PASS | `apps/web/package.json:1-34` (React `^19.2.7`, Vite `^8.0.16`); `apps/web/vite.config.ts:1-19` | Standard `@vitejs/plugin-react`, dev proxy only for `/api` and `/socket.io`, nothing unusual. |
| Environment variables — no server secret reaches the client | PASS | `grep -rn "import\.meta\.env" apps/web/src` → 0 matches; `apps/web/vite.config.ts` has no `define`/`envPrefix` override; `infra/Dockerfile.web:8-9` comment: "the web build pulls the whole workspace... takes NO build args and bakes NO secrets" | The web app uses **zero** `import.meta.env.VITE_*` values — no client env surface exists at all, so there is nothing to leak via `define`/env inlining. |
| Secrets/API keys in client bundle | PASS | `grep -oE "(sk_live|AKIA|AIza...|-----BEGIN...PRIVATE KEY-----)" apps/web/dist/assets/*.js` → no matches; targeted grep for `JWT_SECRET\|DATABASE_URL\|MFA_ENC_KEY\|S3_SECRET_ACCESS_KEY\|SMTP_PASSWORD\|POSTGRES_PASSWORD` in `apps/web/dist/assets/index-*.js` → no matches | Checked against a real local production build output (`apps/web/dist`, gitignored per `.gitignore:7`). The web `package.json` (above) has no AWS/Google/Firebase SDK as a dependency, so there is no code path that could embed those keys. |
| console.log / debug code in production | PASS | `grep -rn "console\." apps/web/src --include="*.ts" --include="*.tsx"` → only 2 hits, both inside doc comments (`fieldMonitoring/FieldMonitoringPage.tsx:34`, `dashboard/components/RosterSummary.tsx:9`), neither is a real `console.*` call; `eslint.config.js:41` sets `'no-console': 'error'` globally for `**/*.{ts,tsx}`; `eslint.config.js:33` sets `linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' }` so an inline `// eslint-disable-next-line no-console` would itself fail lint | Machine-enforced, not just convention — verified the rule's actual scope and that disable-comments are inert. |
| Unused routes | PASS (informational) | `diff` of `Layout.tsx` nav-link paths vs `App.tsx` `<Route path>` values — every route not in the nav is either a `:id`/`new` sub-route reached via in-page navigation, or `/profile`/`/security` (reached via the header `UserMenu`, not the sidebar) | No orphaned/dead routes found; the apparent "diff" entries are all intentionally nav-link-free routes. |
| Admin pages exposure (route-level authorization) | **FAIL** | `apps/web/src/App.tsx:69-121` — every `<Route>` (including all 16 `/admin/*` routes) renders unconditionally once `user` is truthy (`App.tsx:63`); `apps/web/src/components/Layout.tsx:84-89` only filters the **nav links** by `has(a.perm)`; `grep -rln "usePermission\|hasPermission\|can(\|permissions.includes" apps/web/src/features` → 0 matches in any feature/page component; sampled `UsersPage.tsx`, `SystemPage.tsx` → no `useAuth`/permission import at all; `RolesPage.tsx:39` imports `has` from `useAuth()` but only uses it to disable an in-page **Edit** button (`RolesPage.tsx:169`), not to gate the page render | See FRONTEND_SECURITY-01. |
| Feature flags | NOT VERIFIED (resolved: not implemented) | `docs/adr/ADR-0009-feature-flags.md` (Status: Accepted) names Verification Workspace/billing/reporting/assignment-engine as flag-gated; `grep -rniE "featureflag|feature_flag|feature flag" apps/web/src packages/config/src apps/api/src` → 0 matches; `grep -rliE "feature_flag|flags" db/v2/migrations` → 0 matches | ADR-0009 is accepted on paper but has **no implementation** anywhere in this repo (web, api, or DB). Confirms project memory ("feature flags may be unbuilt/YAGNI"). No client-facing flag risk exists today because there is no flag mechanism to leak/bypass — see FRONTEND_SECURITY-04 for the doc/code drift. |
| Source maps in production build | PASS | `grep -rn "sourcemap" apps/web/vite.config.ts apps/web/package.json` → no matches (Vite's documented default is `build.sourcemap: false`); `find apps/web/dist -iname "*.map"` against a real local production build (`pnpm --filter @crm2/web build` output already on disk, dated Jul 1 02:24) → 0 files; `.github/workflows/*.yml`/`turbo.json` have no sourcemap override | No sourcemap config exists to flip this on, and the actual build artifact confirms no `.map` files are emitted. |
| Build output / bundle inspection | PASS | `ls apps/web/dist/assets` → one JS bundle (`index-DAphEa2Z.js`, 966KB), one CSS bundle, self-hosted woff2 fonts only; no `.env`, no `.map`, no stray source files in `dist/` | Clean static SPA output; nothing unexpected shipped. |
| XSS (cross-ref Audit 5) | PASS | `grep -rn "dangerouslySetInnerHTML" apps/web/src` → 0 matches; `grep -rn "\.innerHTML\|eval(\|new Function(" apps/web/src` → 0 matches; `grep -rln "ReactMarkdown\|marked(\|DOMPurify\|sanitize-html" apps/web/src` → 0 matches (no raw-HTML rendering library is even used, consistent with React's default JSX escaping) | All 4 `target="_blank"` hits (`FieldMonitoringPage.tsx:111`, `CaseDetailPage.tsx:2006`) carry `rel="noreferrer"` (`FieldMonitoringPage.tsx:112`, `CaseDetailPage.tsx:2007`); all 4 `window.open(...)` calls pass `'noopener'` explicitly (`CaseDetailPage.tsx:1287,2257`, `JobsTray.tsx:69`, `NotificationBell.tsx:28`) — reverse-tabnabbing is closed. React's default JSX text-node escaping is the only HTML-rendering path in the app, so stored-XSS via case/client/KYC text fields is not reachable through the frontend rendering layer itself (full payload-injection testing is Audit 5/API scope, not re-verified here). |
| CSP (Content-Security-Policy) | **FAIL** | `cat apps/web/index.html` — no `<meta http-equiv="Content-Security-Policy">` tag; `cat infra/prod/nginx.conf` — no `add_header Content-Security-Policy ...` anywhere in either the `:80` or `:443` server block; `grep -rn "helmet" apps/api/package.json package.json` → 0 matches; `apps/api/src/http/app.ts` has no `app.use(helmet())` or manual CSP header | No CSP at any layer (HTML meta, nginx edge, or API). See FRONTEND_SECURITY-02 (folded into the broader missing-headers finding). |
| Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS) | **FAIL** | `cat infra/prod/nginx.conf` (full file read) — zero `add_header` directives for any of these in the `server { listen 443 ssl ... }` block (only `Cache-Control`/`Content-Type` on `/assets/`, `/index.html`, `/_edge_health`); `apps/api/src/http/app.ts:60` sets only `x-request-id`; per-route `X-Content-Type-Options: nosniff` exists **only** on 3 file-download endpoints in `apps/api/src/modules/cases/controller.ts:370,386,401`, not globally | See FRONTEND_SECURITY-02. The SPA HTML/JS/CSS response (the page nginx serves directly at `/`) carries no `X-Frame-Options`/`Content-Security-Policy`/`Referrer-Policy`/`Permissions-Policy`/`Strict-Transport-Security` at all. |

## Findings

### FRONTEND_SECURITY-01
- **Category:** Broken Access Control (client-side route authorization)
- **Severity:** Medium
- **CVSS:** 5.3 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N) — low-privilege authenticated user gains UI-level disclosure of admin page structure/labels for screens their role's API calls will reject
- **OWASP Mapping:** OWASP Top 10:2021 — A01:2021 Broken Access Control
- **CWE Mapping:** CWE-862 (Missing Authorization)
- **Location**
  - **File:** `apps/web/src/App.tsx`
  - **Line Number:** 69-121 (all `<Route>` declarations); guard gap originates at line 63 (`if (!user) return <LoginPage />;` is the only gate)
- **Evidence:**
  ```tsx
  // apps/web/src/App.tsx:63-121
  if (!user) return <LoginPage />;
  ...
  return (
    <Layout>
      <Toaster richColors position="top-right" />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/admin/verification-units" element={<VerificationUnitsPage />} />
        ...
        <Route path="/admin/users" element={<UserRecordPage />} />
        ...
        <Route path="/admin/rbac" element={<RolesPage />} />
        ...
        <Route path="/admin/system" element={<SystemPage />} />
        ...
      </Routes>
    </Layout>
  );
  ```
  Compare with `apps/web/src/components/Layout.tsx:47-66`, where the comment explicitly states the
  intended invariant: *"Each item carries the SAME permission its page's read endpoint enforces (so
  the nav mirrors the API: a route the user would be 403'd from is not shown)"* — but that mirroring
  is implemented **only** in the nav link list (`Layout.tsx:89,93`), never in `App.tsx`'s router. The
  `AuthContext.has()` helper that exists for exactly this purpose (`AuthContext.tsx:28-29`: *"UX
  gating must mirror the server perm"*) is used inside `RolesPage.tsx:39,169` only to disable a
  button, not to block the page.
- **Why it is a problem:** Any authenticated user (e.g. a `FIELD_AGENT` or `KYC_VERIFIER`) who
  navigates directly to a URL like `/admin/users`, `/admin/rbac`, or `/admin/system` — by typing it,
  via a stored/shared link, browser autocomplete, or a forward/back-button replay — gets the full
  React page component mounted and rendered. The backend RBAC (per `docs/architecture-inventory.md`
  §8 and `@crm2/access`) will reject the underlying data-fetch calls, so no protected *data* is
  returned, but the page shell, all column headers/labels, button layout, and any client-side-only
  derived UI state still render and execute before/around the failed API calls. This is a defense-in-
  depth gap, not a fail-open data leak — the real risk is mid-tier severity.
- **Real world attack scenario:** A `FIELD_AGENT` (role with no `page.users`/`page.access`/`page.system`
  permission) who is curious or has the URL bookmarked from a screen-share visits
  `https://crm.allcheckservices.com/admin/rbac` directly. The `RolesPage` component mounts, renders
  its table/column scaffolding, and only then issues the data-fetch which the API 403s — exposing
  that an Access-Control/RBAC admin surface with a specific permission-code taxonomy exists, its
  exact route structure, and its UI affordances (e.g. "Locked"/"Edit" controls in
  `RolesPage.tsx:169-172`), all useful reconnaissance for a follow-on privilege-escalation or social-
  engineering attempt, and a confusing/unprofessional UX (flash of admin chrome before an error toast).
- **Business impact:** Low direct data risk (server RBAC is the real backstop and was not found to be
  bypassable from here), but it weakens defense-in-depth on a CRM that handles KYC/PII and commission
  data, and it contradicts the codebase's own documented invariant ("UX gating must mirror the server
  perm"), which is itself a maintainability/consistency risk — a future regression in nav-link gating
  (e.g. a new admin route added without updating `Layout.tsx`) would have **no second line of defense**.
- **Recommended fix:** Add a small `RequirePermission`/route-guard wrapper (using the existing
  `useAuth().has()`) around each `/admin/*` `<Route element>` in `App.tsx`, redirecting to
  `/dashboard` (or a 403 page) when the permission is missing — mirroring the same `perm` values
  already declared per-route in `Layout.tsx`'s `ADMINISTRATION`/`OPERATIONS` arrays (those arrays could
  be the single source of truth for both the nav filter and the route guard).
- **Estimated effort:** S (a few hours — one wrapper component + applying it to ~16 routes, reusing existing `perm` metadata already in `Layout.tsx`)
- **Priority:** P2
- **Status:** OPEN

### FRONTEND_SECURITY-02
- **Category:** Security Misconfiguration — missing HTTP security headers
- **Severity:** Medium
- **CVSS:** 6.1 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N) — reflects the realistic worst case (clickjacking/MIME-sniffing assisting a future stored-injection or framing attack); no CSP/X-Frame-Options/HSTS today
- **OWASP Mapping:** OWASP Top 10:2021 — A05:2021 Security Misconfiguration
- **CWE Mapping:** CWE-1021 (Improper Restriction of Rendered UI Layers, i.e. clickjacking — missing `X-Frame-Options`/`frame-ancestors`), CWE-693 (Protection Mechanism Failure — missing CSP/HSTS/Referrer-Policy/Permissions-Policy/`X-Content-Type-Options`)
- **Location**
  - **File:** `infra/prod/nginx.conf`
  - **Line Number:** 38-118 (the entire `server { listen 443 ssl ... }` block — no `add_header` for any security header in any `location`)
- **Evidence:**
  ```nginx
  # infra/prod/nginx.conf:38-50 (server block start) — no add_header for CSP/X-Frame-Options/etc.
  server {
      listen 443 ssl;
      listen [::]:443 ssl;
      http2 on;
      server_name crm.allcheckservices.com;

      ssl_certificate     /etc/letsencrypt/live/crm.allcheckservices.com/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/crm.allcheckservices.com/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      ...
  ```
  Full-file grep: `grep -n "add_header" infra/prod/nginx.conf` only returns the 3 `Content-Type`/
  `Cache-Control` headers on `/_edge_health` (x2) and `/assets/`/`/index.html` — **no** security
  header directive exists anywhere in the file. Confirmed no `helmet` dependency
  (`grep -rn "\"helmet\"" apps/api/package.json package.json` → no matches) and no manual equivalent
  in `apps/api/src/http/app.ts` (only `x-request-id` is set globally, line 60).
- **Why it is a problem:** The SPA HTML document and all static JS/CSS served at `https://crm.allcheckservices.com/`
  carry none of: `Content-Security-Policy` (no defense-in-depth against any future XSS sink),
  `X-Frame-Options`/`frame-ancestors` (the app can be iframed by any origin — clickjacking), `X-Content-Type-Options: nosniff`
  (browsers may MIME-sniff responses), `Referrer-Policy` (full URLs, potentially including query-string
  case/client IDs, leak to any cross-origin link target via the `Referer` header), `Permissions-Policy`
  (no restriction on camera/geolocation/microphone access if a malicious script ever ran in-page — notably
  relevant since this CRM's field-photo features make camera/geolocation plausible browser permission prompts),
  or `Strict-Transport-Security` (no HSTS — a user typing `crm.allcheckservices.com` without `https://` is not
  forced onto TLS by the app layer, though the `:80` block does perform a same-request 301 redirect).
- **Real world attack scenario:** An attacker embeds `https://crm.allcheckservices.com` in a hidden/transparent
  `<iframe>` on an attacker-controlled page (no `X-Frame-Options`/`frame-ancestors` stops this) and overlays
  decoy UI to trick a logged-in CRM operator (whose session cookie/localStorage token rides along automatically
  in the iframe) into clicking through a case-assignment, status-change, or commission-rate action —
  classic clickjacking against a session that already holds a valid access token. Separately, the absence
  of CSP removes a meaningful second layer of protection if any future code change introduces an XSS sink
  (e.g. a careless `dangerouslySetInnerHTML` in a later PR) — today's PASS on XSS (no current sink) is only
  as durable as code review, with no browser-enforced backstop.
  pip
- **Business impact:** Clickjacking against an operator session could be used to trigger unintended case/KYC
  actions or commission-rate edits. Missing CSP removes the standard last line of defense for a CRM holding
  client PII, KYC documents, and commission/billing data — auditors and customers (this is a B2B verification
  CRM serving banks/NBFCs per the KYC domain) will commonly flag absent security headers in any external
  pen-test or vendor security questionnaire.
- **Recommended fix:** Add `add_header` directives in the `:443` server block of `infra/prod/nginx.conf`
  (declarative, matches the file's own stated design: "NEVER mutated at deploy"): `X-Frame-Options: DENY`
  (or `Content-Security-Policy: frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), camera=(), microphone=()`
  (tightened/loosened per actual field-photo-capture browser usage, if any web camera capture exists — verify
  before locking down), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, and a baseline
  `Content-Security-Policy` (e.g. `default-src 'self'; connect-src 'self' wss://crm.allcheckservices.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`), tuned against the app's actual asset/connect origins (same-origin API + same-origin socket.io per this audit's findings, so a tight policy should be achievable without `unsafe-eval`/broad allowlists).
- **Estimated effort:** S (1-2 hours to draft + test the header set against the live app's actual resource origins, since nginx.conf is declarative and not deploy-mutated)
- **Priority:** P2
- **Status:** OPEN

### FRONTEND_SECURITY-03
- **Category:** Sensitive Data Exposure (token storage) — informational, accepted-risk by design
- **Severity:** Low
- **CVSS:** N/A — this is a documented, deliberate trade-off (ADR-0076 SEC-10), not an oversight; rated informational/low because it is only exploitable in combination with another XSS vulnerability, none of which were found in this audit
- **OWASP Mapping:** OWASP Top 10:2021 — A02:2021 Cryptographic Failures (storage of session-bearing tokens in JS-readable storage)
- **CWE Mapping:** CWE-922 (Insecure Storage of Sensitive Information)
- **Location**
  - **File:** `apps/web/src/lib/auth.ts`
  - **Line Number:** 14-15 (`access: (): string | null => localStorage.getItem(ACCESS_KEY)`)
- **Evidence:**
  ```ts
  // apps/web/src/lib/auth.ts:8-15
  const ACCESS_KEY = 'acs.accessToken';
  const JTI_KEY = 'acs.jti';
  ...
  export const tokenStore = {
    access: (): string | null => localStorage.getItem(ACCESS_KEY),
    jti: (): string | null => localStorage.getItem(JTI_KEY),
  ```
- **Why it is a problem:** The short-lived (15-minute default, `AUTH_ACCESS_TTL_S`) JWT access token is
  stored in `localStorage`, which is readable by any JavaScript executing on the page — including an
  injected XSS payload. This audit found **no** XSS sink in the current codebase (no
  `dangerouslySetInnerHTML`, no `.innerHTML`, no `eval`, no unsanitized-markdown rendering — see the XSS
  checklist row above), so this is not exploitable today, but it means any *future* XSS bug becomes a full
  session-takeover bug rather than a contained one.
- **Real world attack scenario:** If a future change introduces any HTML-injection sink (e.g. a markdown/HTML
  renderer for a case note or report field), a stored-XSS payload in a CRM case/client field could read
  `localStorage['acs.accessToken']` and exfiltrate it to an attacker-controlled endpoint, granting up to
  15 minutes of full API access as the victim (a verifier/admin who opened the case). The httpOnly refresh
  cookie is correctly out of JS reach (`apps/api/src/http/refreshCookie.ts:16-22`), capping the blast radius
  to the access-token TTL, which is the mitigation already in place.
- **Business impact:** Low today given no current XSS sink and the already-implemented httpOnly-cookie
  mitigation for the longer-lived refresh token; would become Medium/High if a future PR adds any raw-HTML
  rendering without review.
- **Recommended fix:** No action required given the existing mitigation (refresh token already moved to an
  httpOnly cookie per ADR-0076 SEC-10) and the short access-token TTL. If/when the team adds CSP
  (FRONTEND_SECURITY-02), that further reduces this risk. Optionally revisit moving the access token to an
  in-memory-only store (no persistence) at the cost of losing it on hard page refresh — a product trade-off,
  not a clear-cut fix, hence Low/informational rather than a hard FAIL.
- **Estimated effort:** N/A (no fix required; informational)
- **Priority:** P3
- **Status:** OPEN (tracked for awareness, not a blocking gap)

### FRONTEND_SECURITY-04
- **Category:** Documentation/code drift — ADR vs. implementation
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `docs/adr/ADR-0009-feature-flags.md`
  - **Line Number:** 1-5 (Status: Accepted)
- **Evidence:** `grep -rniE "featureflag|feature_flag|feature flag" apps/web/src packages/config/src apps/api/src` and `grep -rliE "feature_flag|flags" db/v2/migrations` both return zero matches, yet the ADR is marked "Status: Accepted" and names the Verification Workspace, billing, reporting, and assignment engine as flag-gated.
- **Why it is a problem:** Not a security vulnerability by itself (there is no flag mechanism to attack), but an "Accepted" ADR with zero implementation is misleading for future audits/engineers who might assume flag-gated kill-switches exist for these high-risk surfaces (billing/reporting) when they do not — consistent with this repo's own memory noting this is likely YAGNI/unbuilt.
- **Real world attack scenario:** N/A (no attack surface — this is a process/documentation hygiene item).
- **Business impact:** None directly; risk is purely to engineering decision-making (someone assuming a kill-switch exists for billing/reporting when redeploy is the only rollback path).
- **Recommended fix:** Either implement the flags ADR-0009 describes, or update its Status to reflect reality (e.g. "Superseded" / "Not implemented — deploy-based rollback used instead"), per this repo's own `docs/COMPLIANCE_GAPS_REGISTRY.md` discipline of never leaving a finding silently unresolved.
- **Estimated effort:** S (doc update only) or L (if actually implementing flags — out of scope for this audit to recommend without a product decision)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 1 |
| Informational | 1 |

**Overall verdict: PARTIAL.**

Frontend security fundamentals are solid: no client-side env-var/secret leakage (the app uses zero
`import.meta.env` values), no sourcemaps in production builds, `console.*` is genuinely and
machine-enforced (not just documented) banned via ESLint with inert disable-comments, no XSS sinks
(`dangerouslySetInnerHTML`/`innerHTML`/`eval`) exist anywhere in `apps/web/src`, all external-link/
window.open patterns correctly prevent reverse-tabnabbing, and the auth-token design (httpOnly
SameSite=Lax cookie for the long-lived refresh token, short-TTL access token) reflects a deliberate,
documented hardening pass (ADR-0076 SEC-10). The two Medium findings are real, evidenced gaps: admin
routes have no client-side authorization guard despite the codebase's own stated intent that "UX
gating must mirror the server perm" (FRONTEND_SECURITY-01), and the nginx edge — which serves the SPA
directly and is explicitly designed to be the single declarative point of control — emits zero
security response headers (no CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy,
X-Content-Type-Options) anywhere (FRONTEND_SECURITY-02). Neither is currently exploitable into direct
data exposure (server-side RBAC is the real backstop and was not found bypassable from the frontend
alone), which is why this is PARTIAL rather than FAIL, but both should be fixed before considering the
frontend security posture complete for a CRM handling KYC/PII and commission data.
