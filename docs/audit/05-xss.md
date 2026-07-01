# AUDIT 05: XSS

## Scope

Inspected:
- `apps/web/src` — full-tree grep for `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `srcDoc`, `outerHTML`, `createContextualFragment`, markdown/sanitizer libs, toast call sites, `window.open`/`document.createElement` usage.
- `apps/api/src/modules/reportLayouts/` — the admin-authored Handlebars template store + its Zod-level "raw output" gate (`packages/sdk/src/reportLayouts.ts`).
- `apps/api/src/modules/caseReports/` — CASE_REPORT engine: `render.ts` (Handlebars→HTML), `xlsx.ts`, `docx.ts`, `service.ts` (context assembly), `controller.ts` (HTTP routes incl. `GET /cases/:id/report.html`), `job.ts` (PDF job).
- `apps/api/src/modules/fieldReports/` — FIELD_REPORT engine: `render.ts` (Handlebars, `noEscape:true`), `helpers.ts` (the ~30 grammar helpers), `service.ts`, `controller.ts`.
- `apps/api/src/platform/pdf/index.ts` — Puppeteer `htmlToPdf` wrapper (`page.setContent`).
- `apps/api/src/platform/export/format.ts` — the generic CSV/XLSX export engine (`toCsv`, `toXlsx`, `escapeCsvCell`, `neutralizeFormula`) used by every DataGrid export across the app.
- `apps/api/src/http/app.ts` — Express app wiring (looked for helmet / manual security-header middleware).
- `infra/prod/nginx.conf` — full file read for `add_header`/CSP/X-Frame-Options/HSTS.
- `apps/web/index.html` — checked for a meta-tag CSP / inline scripts.
- `apps/web/src/features/cases/CaseDetailPage.tsx` — `FieldReportBody` (narrative + raw-field rendering), `CaseReportSection.preview()` (opens server-rendered HTML in a new tab via blob URL), field-photo download/zip flow.
- `apps/web/src/features/reportLayouts/ReportLayoutRecordPage.tsx` — admin template editor (confirmed plain `<textarea>`, FE mirror of the server raw-output regex, no live HTML preview).
- `apps/api/src/modules/cases/controller.ts` + `service.ts` — static-map PNG / field-photo download routes (`Content-Disposition`, `nosniff` headers, filename provenance).
- `package.json` / `apps/api/package.json` / `packages/*/package.json` — confirmed no `helmet`, no `dompurify`/`sanitize-html`/`marked`/`react-markdown` dependency anywhere in the workspace.

Commands actually run (paraphrased, full output captured during the session):
- `grep -rn "dangerouslySetInnerHTML" apps/web --include="*.tsx" --include="*.ts"` → **no matches** (exit code 1).
- `grep -rn "innerHTML|document.write|insertAdjacentHTML|[^.]eval(" apps/web/src apps/api/src` → no matches.
- `grep -rn '{{{' apps/api/src` → only in test files (`reportLayouts.api.test.ts`) and explanatory comments (`render.ts`), confirming triple-stash is rejected, not used.
- `grep -n "{{{" packages/sdk/src/reportLayouts.ts` → 0 (the actual gate uses a broader regex, see XSS-finding-free section below).
- `grep -n "add_header" infra/prod/nginx.conf` → only `Content-Type`/`Cache-Control`, no security headers.
- `grep -rln "helmet" apps/api package.json` → no matches.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Stored XSS (web app, general) | PASS | `grep -rn "dangerouslySetInnerHTML\|innerHTML" apps/web/src` → 0 matches. All free-text fields (case remarks, applicant names, field-report narrative) render as JSX text children, e.g. `apps/web/src/features/cases/CaseDetailPage.tsx:1858` `<p ...>{report.narrative}</p>`, `:1845-1846` `<Meta ... value={f.value} />` | React escapes all text-node interpolation by default; no raw-HTML sink found anywhere in the SPA. |
| Reflected XSS | PASS | No server-rendered HTML templating reflects request params; all API responses are JSON (`res.json`) except 5 binary/typed routes (`apps/api/src/platform/export/index.ts:100`, `platform/import/index.ts:104`, `modules/cases/controller.ts:372,387`, `modules/caseReports/controller.ts:43`) — none echo a request parameter into HTML/script context. | The one HTML-emitting route (`/cases/:id/report.html`) is server-rendered from DB-sourced + Handlebars-escaped data, not a reflected request param. |
| DOM XSS | PASS | `grep -rn "innerHTML\|insertAdjacentHTML\|document.write\|outerHTML\|createContextualFragment\|srcDoc" apps/web/src` → 0 matches. `document.createElement('a')` calls (`CaseDetailPage.tsx:1874`, `UsersPage.tsx:199`, `CommissionSummaryPage.tsx:96`, `MisPage.tsx:87`, `ImportModal.tsx:30`, `DataGrid.tsx:436`) are all anchor-download triggers (`a.href = blobUrl; a.click()`), not DOM-HTML sinks. | No client-side template engine, no manual DOM string injection anywhere in `apps/web`. |
| Template injection (Handlebars — report/document generation) | PASS | (1) FIELD_REPORT (`apps/api/src/modules/fieldReports/render.ts:84`) compiles with `noEscape: true` but documents at `:81-83` that this is intentional plain-text output, consumed only as a React text node or `docx.Paragraph` (verified — see below); (2) CASE_REPORT (`apps/api/src/modules/caseReports/render.ts:23,82-86`) compiles with Handlebars default auto-escape (`noEscape` NOT set ⇒ `false`) and `allowProtoPropertiesByDefault:false`/`allowProtoMethodsByDefault:false`; (3) the only admin-authored template surface (`report_layouts.template_body`) is gated server-side at the Zod schema layer: `packages/sdk/src/reportLayouts.ts:238` `const RAW_OUTPUT_RE = /\{\{~?[{&]/;` applied via `.refine()` at line 244 on both `CreateReportLayoutSchema` (line 305) and `UpdateReportLayoutSchema` (line 321) — blocks `{{{`, `{{&`, and the whitespace-control variants `{{~{`/`{{~&`. Confirmed by test: `apps/api/src/modules/reportLayouts/__tests__/reportLayouts.api.test.ts:194` `expect((await mk('<p>{{{case.customerName}}}</p>', 'Evil1')).status).toBe(400);` | Defense is layered: (a) escape-on by default at the render engine for the HTML/PDF sink, (b) a save-time Zod gate that is broader than a naive `{{{` grep (also catches `{{&` and the `~` whitespace-control bypass), (c) the FE mirrors the same regex (`ReportLayoutRecordPage.tsx:196` `const hasRawOutput = /\{\{~?[{&]/.test(templateBody);`) as a UX nicety, not the authoritative gate. |
| HTML rendering (server → browser) | PASS | `GET /api/v2/cases/:id/report.html` (`apps/api/src/modules/caseReports/controller.ts:37-47`) is the only API route that returns `text/html` to a browser tab. It sets `res.setHeader('X-Content-Type-Options', 'nosniff')` (line 42) and serves output of `renderCaseReportHtml` (auto-escaped, verified above). Web opens it via `URL.createObjectURL(blob)` + `window.open(url, '_blank', 'noopener')` (`CaseDetailPage.tsx:2255-2257`), not a direct navigation to the API origin — further isolating it (blob URL inherits an opaque/null-ish origin context per spec, separate from the API host). | Sound design; the one place HTML reaches a real browser-rendering context is escaped at the source and additionally carries `nosniff`. |
| Markdown | PASS | `grep -rn "react-markdown\|marked\|markdown-it" package.json apps/web/package.json apps/api/package.json` → no matches in any workspace `package.json`. No markdown rendering exists anywhere in the app. | N/A — feature not present, so no markdown-to-HTML XSS surface exists. |
| Rich text | PASS | No rich-text editor dependency found (no Slate/Quill/TipTap/Draft.js in any `package.json`); the only multi-line text inputs are plain `<textarea>` (e.g. `ReportLayoutRecordPage.tsx:438,512`) bound to React state, rendered back only as escaped JSX text. | N/A — feature not present. |
| innerHTML | PASS | `grep -rn "innerHTML" apps/web/src apps/api/src` → 0 matches anywhere in first-party code. | |
| dangerouslySetInnerHTML | PASS | `grep -rn "dangerouslySetInnerHTML" apps/web/src` → 0 matches. | The single strongest piece of evidence for the whole audit — React's escape-by-default behavior is never opted out of. |
| Output escaping | PASS | React (web, default behavior, see above) + Handlebars auto-escape (CASE_REPORT, `render.ts:82`, default `noEscape:false`) + `docx.Paragraph` plain-text runs (`apps/api/src/modules/caseReports/docx.ts:107-108`, comment at line 20: "writes a plain-text run (no markup parsing)") + `csvSafe`/`neutralizeFormula`/`escapeCsvCell` formula-injection guards in both export pipelines (`apps/api/src/modules/caseReports/xlsx.ts:29-32`, `apps/api/src/platform/export/format.ts:36-59`) applied at every free-text cell write site (`xlsx.ts:67,87-92,116-117,121,125`). One narrow exception: FIELD_REPORT narrative is intentionally un-escaped plain text (`fieldReports/render.ts:84`, `noEscape:true`) — verified every consumer (web React text node, `docx.Paragraph`, and the CASE_REPORT HTML engine which re-escapes it via `{{narrative}}` interpolation, `caseReports/service.ts:144` → `render.ts` template) treats it as plain text, never as raw markup. | This is the one place a "PASS" required deeper tracing rather than a single grep — documented thoroughly inline in the source (`render.ts:13-20,80-83`) and confirmed correct by following every call site. |
| CSP | **FAIL** | `infra/prod/nginx.conf` (full file read) contains zero `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, or `Referrer-Policy` headers — only `Content-Type`/`Cache-Control` (lines 30, 65, 116, 121). `apps/api/src/http/app.ts` (full file read) has no `helmet` import and no manual `res.setHeader` for any of these headers at the app level (only two individual routes set `X-Content-Type-Options: nosniff` ad hoc: `caseReports/controller.ts:42`, `cases/controller.ts:370,381`). `grep -rln "helmet" apps/api package.json packages/*/package.json` → 0 matches; no `helmet` dependency in the workspace at all. `apps/web/index.html` (full file read) has no `<meta http-equiv="Content-Security-Policy">`. | See finding **XSS-01**. |

## Findings

### XSS-01
- **Category:** Missing security headers (CSP / clickjacking / MIME-sniffing / HSTS / referrer leakage)
- **Severity:** Medium
- **CVSS:** 5.4 (AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N) — CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N
- **OWASP Mapping:** OWASP Top 10:2021 A05 — Security Misconfiguration
- **CWE Mapping:** CWE-1021 (Improper Restriction of Rendered UI Layers — clickjacking, via missing X-Frame-Options/frame-ancestors), CWE-693 (Protection Mechanism Failure — missing CSP as defense-in-depth)
- **Location**
  - **File:** `infra/prod/nginx.conf` (no `add_header` for any security header in either `server{}` block, lines 21-126); `apps/api/src/http/app.ts` (no helmet/manual header middleware, full file, esp. lines 80-89)
  - **Line Number:** nginx.conf 21-126; app.ts 80-89
- **Evidence:**
  ```
  $ grep -n "add_header" infra/prod/nginx.conf
  30:        add_header Content-Type text/plain;
  65:        add_header Content-Type text/plain;
  116:        add_header Cache-Control "public, immutable";
  121:        add_header Cache-Control "no-cache, no-store, must-revalidate";

  $ grep -rln "helmet" apps/api package.json packages/*/package.json
  (no output)
  ```
- **Why it is a problem:** The app currently has no stored/DOM XSS sinks (verified above — React + Handlebars auto-escape hold the line), so a CSP would mostly be defense-in-depth today. But it is the standard last line of defense against XSS that does eventually creep in via a future dependency, a future feature (e.g., a rich-text/markdown field, a new admin HTML-import), or a bug in the Handlebars escaping path. Without `X-Frame-Options`/`frame-ancestors`, the app is also clickjackable — an attacker can iframe `crm.allcheckservices.com` (which serves real KYC/PII/case data and an authenticated session) on an attacker page and trick a logged-in user into clicking through privileged actions. Without `Strict-Transport-Security`, a user who once visits the bare-HTTP form of the URL is vulnerable to SSL-stripping on the first request. Without `Referrer-Policy`, full case/client URLs (which may include identifiers) could leak to third-party resources via the `Referer` header.
- **Real world attack scenario:** A SUPER_ADMIN or BACKEND_USER is socially-engineered into visiting an attacker-controlled page that iframes `https://crm.allcheckservices.com` and overlays invisible buttons over the iframe (classic clickjacking) to trick them into approving a case, assigning a task, or changing a role/permission while believing they're interacting with the attacker's page. Separately, if any future code path (a new "case remarks rich-text" feature, a new bulk-import preview, a regression in the Handlebars layer) ever introduces a single unescaped sink, there is currently no CSP to contain the blast radius — the injected script would have unrestricted ability to call `/api/v2/*` with the victim's session (e.g., exfiltrate KYC/PAN/applicant PII, or call the commission/billing export endpoints).
- **Business impact:** Increases the severity ceiling of any future XSS or clickjacking bug from "contained" to "full account compromise" for whoever views the malicious content — for an admin/backend role this means exposure of customer PAN numbers, phone numbers, addresses, and commission/billing data (regulated PII in a KYC verification context). Reputational and potential regulatory (DPDP) exposure if PII is exfiltrated this way.
- **Recommended fix:** Add `helmet` (already zero-dependency-cost to add — small, no DB/infra impact) to `apps/api/src/http/app.ts` with at minimum: `contentSecurityPolicy` (start with a conservative `default-src 'self'`, tune for the SPA's actual asset/XHR/websocket origins — note CRM2 self-hosts fonts and has no third-party script/analytics per the architecture inventory, so a strict policy should be achievable), `frameguard`/`frame-ancestors 'none'`, `hsts` (the edge already terminates TLS only), `noSniff`, `referrerPolicy`. Alternatively/additionally set the same headers at the nginx edge via `add_header` in both `server{}` blocks of `infra/prod/nginx.conf` (covers the SPA's static/index.html responses, which `helmet` on the API process cannot reach). Given the architecture (`nginx` fronts both the SPA and proxies `/api/`), the nginx-level fix is the more complete single change.
- **Estimated effort:** S (a few hours — add headers, test the CSP doesn't break the Vite-built SPA's asset loading, socket.io websocket connect-src, and MinIO presigned-URL image loads)
- **Priority:** P2
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |
| Informational | 0 |

**Overall verdict: PARTIAL.**

Every classic XSS sink checked (stored, reflected, DOM, `innerHTML`, `dangerouslySetInnerHTML`, markdown, rich text) came back a clean, evidenced PASS — this is a well-defended app at the rendering layer: React's default escaping is never bypassed anywhere in `apps/web`, and the one HTML-template-generation surface (Handlebars, used for FIELD_REPORT narratives and CASE_REPORT PDF/HTML/Word/Excel exports) has a deliberately layered defense — auto-escape on by default, an explicit and unusually thorough save-time Zod gate against triple-stash/`{{&`/whitespace-control raw-output bypasses (with a passing negative test), formula-injection guards on every spreadsheet export cell, and a documented, verified-correct exception (the plain-text FIELD_REPORT narrative) whose every consumer was traced and confirmed safe. The one gap is infrastructural rather than a code-level vulnerability: there is no Content-Security-Policy, X-Frame-Options, HSTS, or Referrer-Policy anywhere in the stack (neither `helmet` in Express nor `add_header` in nginx) — this doesn't expose an active XSS today, but it removes the standard defense-in-depth layer and leaves the app clickjackable, which downgrades the verdict from PASS to PARTIAL pending that fix.
