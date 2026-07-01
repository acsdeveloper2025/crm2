# AUDIT 04: Input Validation

## Scope

Read-only static inspection of `/Users/mayurkulkarni/Downloads/crm2`, focused on the request-validation
pipeline across the Express API (`apps/api/src`) and the shared Zod schema layer (`packages/sdk/src`).

Files/modules inspected directly:
- `docs/architecture-inventory.md` (baseline, read first)
- `apps/api/src/http/app.ts`, `apps/api/src/http/params.ts`, `apps/api/src/http/authenticate.ts`,
  `apps/api/src/http/refreshCookie.ts`, `apps/api/src/http/rateLimit.ts`
- `apps/api/src/platform/file.ts`, `apps/api/src/platform/image.ts`, `apps/api/src/platform/pagination.ts`,
  `apps/api/src/platform/bulk.ts`, `apps/api/src/platform/jwt.ts`
- `apps/api/src/platform/import/{index,format,parsers}.ts`, `apps/api/src/platform/export/{index,format}.ts`
- `apps/api/src/modules/cases/{routes,controller,service}.ts`
- `apps/api/src/modules/verification-tasks/{routes,controller,service}.ts`
- `apps/api/src/modules/users/{routes,controller}.ts`
- `apps/api/src/modules/auth/{controller,service}.ts`
- `apps/api/src/modules/tasks/{controller,service}.ts`
- `apps/api/src/modules/geocode/{controller,service}.ts`
- `apps/api/src/modules/saved-views/controller.ts`, `apps/api/src/modules/field-monitoring/controller.ts`
- `apps/api/src/modules/caseReports/render.ts`, `apps/api/src/modules/fieldReports/render.ts`
- `apps/api/src/modules/reportLayouts/service.ts`
- `apps/api/src/modules/caseDataEntries/{service,repository}.ts`
- `packages/sdk/src/{cases,users,auth,telemetry,userKycUnits,caseDataEntries,reportLayouts,policies}.ts`
- 38 `routes.ts` files (enumerated, all checked for `req.body`/parse-call coverage)
- 74 `packages/sdk/src/*.ts` schema files (enumerated)
- `node_modules/.pnpm/body-parser@2.3.0/.../lib/utils.js` (verified the default JSON body-size limit)

Commands actually run (representative, all read-only):
```
grep -rl "from ['"]zod['"]" apps/api/src packages --include="*.ts" | grep -v -E "node_modules|\.test\.|__tests__" | wc -l   → 43
find apps/api/src/modules -name "routes.ts" | wc -l                                                                          → 38
grep -rn "express.json\|express.raw\|express.urlencoded\|express.text" apps/api/src --include="*.ts"
grep -n "limit" node_modules/.pnpm/body-parser@2.3.0/node_modules/body-parser/lib/utils.js                                   → 102400 (100kb default)
for f in $(find apps/api/src/modules -name "routes.ts"); do <check module has req.body but zero .parse/.safeParse calls>; done → 0 modules flagged
grep -rln "multer(" apps/api/src --include="*.ts" | grep -v __tests__
grep -rn "new RegExp(" apps/api/src packages --include="*.ts" | grep -v __tests__                                            → 0 (no dynamic regex construction)
grep -rn "query(\`" apps/api/src --include="*.ts" | grep -v __tests__   (then manually inspected each for ${} interpolation)  → none found
node -e "<probed toInt() / Number() coercion edge cases for page/limit/lat/lng query params>"
node -e "<probed decodeURIComponent() malformed-percent-encoding throw behavior>"
grep -rn "z\.string()" / "z\.array(" across packages/sdk/src, manually reviewed every hit lacking .max()
```

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Body | PASS | `apps/api/src/http/app.ts:85` `app.use(express.json())` (no `limit` override → body-parser default 100kb, confirmed at `node_modules/.pnpm/body-parser@2.3.0/node_modules/body-parser/lib/utils.js:61-63`). Every route handler that reads `req.body` ultimately runs it through a Zod `.parse()`/`.safeParse()` at the service boundary — verified for cases (`apps/api/src/modules/cases/service.ts:267` `CreateCaseSchema.parse(input)`), auth (`apps/api/src/modules/auth/service.ts:176` `LoginSchema.parse(input)`), consents, location, telemetry, verification-tasks (`apps/api/src/modules/verification-tasks/service.ts:178` `FormSubmissionSchema.parse(input)`). A scripted sweep of all 38 `routes.ts` modules found **zero** modules that read `req.body` without a `.parse(`/`.safeParse(` call somewhere in the module. | Raw-byte upload routes (`raw({ type: () => true })`) are a deliberate, documented exception — validated separately by magic-byte sniffing (see Files). |
| Params | PASS | UUID-shaped path params are validated before reaching SQL. `apps/api/src/modules/cases/controller.ts:12-18` defines `UUID_RE`/`parseUuidParam`, used on every `:id`/`:taskId`/`:attachmentId`. Same pattern repeated independently in `auth/controller.ts:16-20`, `users/controller.ts:14`, `saved-views/controller.ts:15-20`, `notifications/controller.ts`, `jobs/controller.ts`, `billing/controller.ts:15`, `field-monitoring/service.ts:126`, `caseDataEntries/service.ts:20`, `caseReports/service.ts:59`, `policies/service.ts:152`. `apps/api/src/http/params.ts` documents that Express 5 can yield `string[]` for params and `paramStr()` collapses defensively; every numeric-id call site uses `parsePositiveInt`/`Number.isInteger` guards (`apps/api/src/modules/cases/controller.ts:25-29`). | None found unguarded before a SQL-bound use. |
| Headers | PASS (with 1 low finding) | `Authorization: Bearer` parsed and JWT-verified with a pinned algorithm list (`apps/api/src/platform/jwt.ts:46` `jwtVerify(token, secret(), { algorithms: [ALG] })`, `ALG='HS256'` — no `alg:none`/RS256-confusion risk). `trust proxy` set to exactly `1` hop (`apps/api/src/http/app.ts:84`, comment explicitly cites anti-spoofing rationale for rate-limit keying). `x-filename` header is read in 14 modules, always only as upload metadata (truncated to `MAX_ATTACHMENT_NAME_LEN=255` at `apps/api/src/modules/cases/service.ts:754`), never as a filesystem/storage path (storage keys are always `randomUUID()`-derived). See INPUT_VALIDATION-01 for the one related issue (unhandled `decodeURIComponent` throw). | — |
| Cookies | PASS (with 1 low finding, same root cause as Headers) | `apps/api/src/http/refreshCookie.ts` sets the refresh-token cookie `httpOnly`, `sameSite:'lax'`, `secure` in prod, scoped `path:'/api/v2/auth'` (lines 15-23). Cookie is parsed with a small hand-rolled splitter (lines 30-39, linear-time, no regex) rather than a string-injection-prone approach. See INPUT_VALIDATION-01 — the cookie-value `decodeURIComponent` (line 36) can throw on malformed percent-encoding. | — |
| Files | PASS | Case reference-document uploads (`apps/api/src/modules/cases/service.ts:730-762`) and field-photo uploads (`apps/api/src/modules/verification-tasks/service.ts:228-241`) are identified by **magic-byte signature**, not declared `Content-Type` (`apps/api/src/platform/file.ts:34-39`, `apps/api/src/platform/image.ts:31-36` — PDF/PNG/JPEG/WebP signature tables). Size caps enforced server-side: `MAX_ATTACHMENT_BYTES=25MiB` (`platform/file.ts:10`), `MAX_IMAGE_BYTES=5MiB` (`platform/image.ts:9`), `MAX_FIELD_PHOTO_BYTES`+`MAX_FIELD_PHOTOS` (multer `limits`, `apps/api/src/modules/verification-tasks/routes.ts:17-20`, re-checked per-file at `service.ts:231`). Storage keys are always `randomUUID()`-derived (`cases/service.ts:748`, `verification-tasks/service.ts:240`) — the user-supplied filename never reaches a filesystem/object-store path, eliminating path-traversal risk. Multer has no `fileFilter`, but every upload path re-validates bytes by signature after multer parses them, so a spoofed `Content-Type`/extension is still rejected. | — |
| Images | PASS | Same magic-byte mechanism as Files; field-photo path additionally restricts to `image/*` types only (`verification-tasks/service.ts:233` `detected.type.startsWith('image/')`, rejects a PDF disguised as a photo). EXIF-strip + thumbnail + server-side SHA-256 re-hash on every field photo (comment + code at `verification-tasks/service.ts:236-239`). | — |
| CSV | PASS | Import: a hand-rolled RFC-4180 parser (`apps/api/src/platform/import/format.ts:110-142`) handles quoting/escaping/CRLF correctly; every parsed row is then run through the domain's Zod schema (`apps/api/src/platform/import/index.ts:142` `spec.schema.safeParse(row.data)`) before any DB write, with duplicate-key detection (`index.ts:124-140`) and a row-count ceiling (`assertImportable`, `index.ts:80-91`, `IMPORT_JOB_MAX_ROWS`). Export: explicit **CSV formula-injection (CWE-1236) neutralization** — `apps/api/src/platform/export/format.ts:35-58` `FORMULA_LEAD = /^[=+\-@\t\r]/`, applied before RFC-4180 quoting in `escapeCsvCell`. | — |
| Excel | PASS | XLSX import parsed via `exceljs` (`format.ts:85-104`); cell values are read via `.value` (no formula execution — `cellRaw()` at `format.ts:30-42` reads only the cached `result` of a formula cell, never evaluates it). XLSX export applies the same `neutralizeFormula()` guard to string cells (`format.ts:69-93`, calls out CWE-1236 explicitly) before native cell types are written; sheet-name characters are sanitized (`format.ts:78`). File-format auto-detection by the `PK` zip magic header, not file extension (`format.ts:159-162`). | — |
| JSON | PASS | All JSON bodies bound by the global 100kb `express.json()` limit (verified in body-parser source). Per-payload tighter caps layered on top where relevant: form submissions capped at 256 KiB serialized (`apps/api/src/modules/verification-tasks/service.ts:56,180` `MAX_FORM_BYTES`), report-layout template bodies capped at 20,000 chars (`packages/sdk/src/reportLayouts.ts:243`). Free-form `z.record(z.string(), z.unknown())` fields exist (`caseDataEntries.ts:19`, `verification-tasks/service.ts:55` `FormSubmissionSchema`, `verificationUnit.ts:120`, `reportLayouts.ts:204`) but are all (a) authenticated+permission-gated, (b) size-capped at the request or field level, and (c) persisted only via parameterized `::jsonb` columns (`apps/api/src/modules/caseDataEntries/repository.ts:87,115`), never interpolated into SQL or executed. | — |
| XML | NOT VERIFIED — N/A | No XML parsing dependency in any `package.json` (`docs/architecture-inventory.md` dependency inventory lists no XML library), no `xml2js`/`fast-xml-parser`/`libxmljs` import found in `apps/api/src` or `packages`. The repo does not accept or produce XML anywhere I could find — there is no XML attack surface to test. | Confirmed absent, not merely unchecked — grepped all `package.json` deps and found no XML parser. |
| Query strings | PASS | `apps/api/src/platform/pagination.ts` is the shared list-query engine used by essentially every list/export endpoint: sort column is **whitelisted** via `sortMap` (`pagination.ts:171-177`, never built from the raw query string directly), filter columns are whitelisted via `filterMap` (`resolveFilters`, lines 60-98), filter values are always bound as SQL parameters (`filterClauses`, lines 116-139 — only the pre-whitelisted `column` name is interpolated), `ILIKE` wildcard characters in user search input are escaped (`likeContains`, lines 106-109) before binding. `limit` is clamped to `MAX_PAGE_SIZE` and rejected if `<1` (lines 162-164). Ad-hoc query params elsewhere (`clientId`, `lat`/`lng`, `taskIds`, etc.) are uniformly guarded with `typeof === 'string'` + numeric/UUID/regex checks before use (spot-checked `cases/controller.ts`, `tasks/service.ts:223-230`, `geocode/service.ts:23-27`), which also correctly rejects the Express array-param case (`?x=1&x=2` → `typeof` check fails closed). See INPUT_VALIDATION-02 for the one gap found (`page` has no upper bound). | — |
| Numbers | PASS (with 1 low finding) | Numeric coercion is consistently the `Number(v)` + `Number.isInteger`/`Number.isFinite` pattern (`pagination.ts:153-157` `toInt`, `cases/controller.ts:25-29` `parsePositiveInt`, `geocode/service.ts:24-27`). Verified by direct execution (`node -e`) that extreme-overflow strings (`"1e400"`) coerce to `Infinity` and are correctly rejected by `Number.isInteger`, and that `lat`/`lng` arrays (`Number(['1','2'])` → `NaN`) are correctly rejected by `Number.isFinite`. Zod numeric fields (`positiveInt`, `fkId`) are `z.number().int().positive()`. See INPUT_VALIDATION-02 — `page` itself has no `MAX_PAGE` ceiling (only `limit` is capped). | — |
| Enums | PASS | Every enum-shaped input I found is validated against a closed allow-list before use: `visitType` (`cases/controller.ts:179`), export `format`/`mode` (`platform/export/index.ts:24-32`), import `mode` (`platform/import/index.ts:68-73`), CASE_REPORT `format` (`caseReports/controller.ts:15-20`), dedupe decision / role-code / report-layout `kind` (Zod `z.enum(...)` throughout `packages/sdk/src`). Unknown values are uniformly rejected with 400, never silently coerced to a default in a security-relevant path. | — |
| Length limits | PASS (with 2 low/informational findings) | The large majority of string/array fields in `packages/sdk/src` carry explicit `.max()` bounds (e.g. `cases.ts`: name≤200, search≤50, remark≤MAX_REMARK, dedupeRationale≤2000; `users.ts`: username 3-50, name≤150, email≤255, password 8-200). A targeted sweep found 4 `z.string()`/`z.array()` fields with no explicit `.max()` (`auth.ts` `username`/`password`/`refreshToken`; `policies.ts` `content`; `cases.ts` `applicants` array). All are still bounded transitively by the global 100kb JSON body cap, and the genuinely security-relevant ones (login `username`/`password`) are pre-auth but only DoS-relevant in combination, not independently exploitable beyond the body-size ceiling. See INPUT_VALIDATION-03 (low) and INPUT_VALIDATION-04 (informational). | — |
| Regex (incl. ReDoS) | PASS | Manually reviewed every hand-rolled regex literal found via `grep` across `apps/api/src` and `packages/sdk/src` (UUID, PAN, phone/E.164, TOTP, SHA-256, role-code, ISO-date, CSV-formula-lead, raw-Handlebars-output gate, MIS segment, field-report relative-date/status parsers — ~30 patterns total). All are anchored, linear-time patterns (fixed-length character classes, bounded `{m,n}` quantifiers, or single un-nested `*`/`+`) with **no nested quantifiers** (no `(a+)+`, `(a*)*`, or alternation-with-overlap patterns) — no catastrophic-backtracking candidates found. `grep -rn "new RegExp("` across `apps/api/src` and `packages` returned zero hits — no regex is built dynamically from user input anywhere, eliminating regex-injection as an additional ReDoS vector. | — |
| Unicode | PASS | `toUpper` (`packages/sdk/src/text.ts:15`) is native `String.prototype.toUpperCase()`, which is Unicode-correct by spec. Username is deliberately restricted to lowercase ASCII (`users.ts:74` `/^[a-z0-9][a-z0-9._-]*$/`), closing off Unicode-homoglyph confusables in the login identifier. No custom Unicode-normalization logic was found that could introduce a bypass (e.g. no manual NFKC/NFKD handling that runs after a security check). | — |
| Encoding | PASS (with 1 low finding) | Output encoding is explicitly and correctly layered for the two HTML-rendering surfaces: `apps/api/src/modules/caseReports/render.ts` runs Handlebars with auto-escape ON by default (`noEscape:false`, the engine default, confirmed at line 82) and a documented, **server-enforced** gate at the data layer rejecting raw-output template syntax (`packages/sdk/src/reportLayouts.ts:238,244-247` `RAW_OUTPUT_RE = /\{\{~?[{&]/` on every template-body create/update, confirmed exercised by `apps/api/src/modules/reportLayouts/__tests__/reportLayouts.api.test.ts:193-200`, which asserts both `{{{x}}}` and `{{&x}}` are rejected with 400). The companion FIELD_REPORT engine (`apps/api/src/modules/fieldReports/render.ts:84`) deliberately uses `noEscape:true` to match v1's literal plain-text output, but its only consumers are (a) a JSON API response rendered as a React text node (auto-escaped) and (b) the CASE_REPORT engine above, which re-escapes it as plain data through `{{var}}`/`nl2br` (escape-then-`<br>`, `caseReports/render.ts:33-36`) — verified no `{{{narrative}}}`-style raw injection exists in the default or DOCX renderers. CSV/XLSX formula-injection covered under CSV/Excel above. `decodeURIComponent` is used on 2 user-controlled inputs (`x-filename` header, refresh-token cookie) without a dedicated try/catch around just that call — see INPUT_VALIDATION-01. | — |

## Findings

### INPUT_VALIDATION-01
- **Category:** Input Validation / Error Handling
- **Severity:** Low
- **CVSS:** 3.1 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N) — informational-DoS-adjacent only; no data exposure or crash
- **OWASP Mapping:** OWASP Top 10:2021 A05:2021 – Security Misconfiguration (improper error handling)
- **CWE Mapping:** CWE-20 (Improper Input Validation), CWE-755 (Improper Handling of Exceptional Conditions)
- **Location**
  - **File:** `apps/api/src/modules/cases/controller.ts` (also `apps/api/src/http/refreshCookie.ts`)
  - **Line Number:** 420 (`apps/api/src/http/refreshCookie.ts:36`)
- **Evidence:**
  ```ts
  // apps/api/src/modules/cases/controller.ts:419-420
  const fn = req.headers['x-filename'];
  const fileName = typeof fn === 'string' ? decodeURIComponent(fn) : 'attachment';

  // apps/api/src/http/refreshCookie.ts:30-38
  export function readRefreshCookie(req: Request): string | null {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === NAME) return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
  }
  ```
  Confirmed by direct execution: `node -e "decodeURIComponent('%E0%A4%A')"` → `URIError: URI malformed`.
- **Why it is a problem:** `decodeURIComponent` throws a `URIError` on malformed percent-encoding (e.g. a lone `%` or an incomplete UTF-8 sequence). Both call sites are reachable pre- or low-trust (the `x-filename` header on an authenticated upload; the refresh-token cookie on the **unauthenticated** `/api/v2/auth/refresh` endpoint). The throw IS caught by the surrounding route `try/catch` → `next(e)` → the global error handler (`apps/api/src/http/app.ts:144-161`), so this is **not** an unhandled crash, but an unrecognized error type falls through to the generic branch and returns `500 INTERNAL` instead of a clean `400`, and logs as an "unhandled error" (`app.ts:159`) even though it is a routine malformed-input case.
- **Real world attack scenario:** An attacker (or a buggy proxy/client) sends `POST /api/v2/auth/refresh` with `Cookie: crm2_rt=%E0%A4%A` (malformed percent-encoding, no valid session needed). The request 500s and is logged as an unhandled internal error, polluting error-rate alerting/observability for the live CRM with noise that looks like a real backend fault, and returns a less specific status code than the input actually warrants.
- **Business impact:** Low — no data exposure, no crash, no auth bypass. Mild operational noise (false-positive 500-rate alerts) and a slightly worse error-response contract for malformed `x-filename` on case-attachment uploads.
- **Recommended fix:** Wrap each `decodeURIComponent` call in its own try/catch (or a tiny `safeDecodeURIComponent` helper) and treat a decode failure as the same "fall back to default" / "no cookie" path already used for the missing-header case, rather than letting the exception propagate to the global handler.
- **Estimated effort:** S (a few lines, 2 call sites)
- **Priority:** P3
- **Status:** OPEN

### INPUT_VALIDATION-02
- **Category:** Input Validation
- **Severity:** Low
- **CVSS:** 3.1 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L) — minor resource-consumption only
- **OWASP Mapping:** OWASP Top 10:2021 A04:2021 – Insecure Design (missing resource-consumption limits)
- **CWE Mapping:** CWE-1284 (Improper Validation of Specified Quantity in Input)
- **Location**
  - **File:** `apps/api/src/platform/pagination.ts`
  - **Line Number:** 160
- **Evidence:**
  ```ts
  // apps/api/src/platform/pagination.ts:159-167
  export function resolvePage(query: Record<string, unknown>, spec: PageSpec): ResolvedPage {
    const page = Math.max(1, toInt(query['page'], 1));

    const limit = toInt(query['limit'], DEFAULT_PAGE_SIZE);
    if (limit < 1) throw AppError.badRequest('INVALID_LIMIT', { limit });
    if (limit > MAX_PAGE_SIZE) throw AppError.badRequest('LIMIT_TOO_LARGE', { limit, max: MAX_PAGE_SIZE });

    const offset = (page - 1) * limit;
    ...
  ```
  `limit` is bounded (`MAX_PAGE_SIZE`), but `page` has no equivalent upper-bound check, so `offset` is unbounded.
- **Why it is a problem:** Every list endpoint built on this shared helper (cases, tasks, users, billing, MIS, etc. — the dominant pagination pattern across the API) computes `OFFSET = (page-1) * limit` with no ceiling on `page`. A large `page` value produces a large `OFFSET` passed to Postgres.
- **Real world attack scenario:** An authenticated low-privilege user (e.g. FIELD_AGENT with `case.view`) requests `GET /api/v2/cases?page=999999999&limit=500` repeatedly. Postgres must still walk/skip rows up to the offset on a non-trivially-indexed sort, consuming CPU/IO disproportionate to the (empty) result returned, across many concurrent requests this could measurably load the single-instance prod Postgres. Bounded in practice by `DB_STATEMENT_TIMEOUT_MS=60000` (60s) per `docs/architecture-inventory.md`, so an individual request cannot hang forever, but it is still wasted work.
- **Business impact:** Low — single-VPS, single-Postgres-instance prod topology (per architecture inventory) makes this a soft, query-timeout-bounded degradation rather than an outage vector; no data exposure.
- **Recommended fix:** Add a `MAX_PAGE` (or derive a ceiling from `totalCount`/a fixed cap like 100,000) and reject (or clamp) `page` beyond it, mirroring the existing `limit` bound.
- **Estimated effort:** S (a few lines)
- **Priority:** P3
- **Status:** OPEN

### INPUT_VALIDATION-03
- **Category:** Input Validation
- **Severity:** Low
- **CVSS:** N/A (defense-in-depth gap, not independently exploitable)
- **OWASP Mapping:** OWASP Top 10:2021 A04:2021 – Insecure Design
- **CWE Mapping:** CWE-1284 (Improper Validation of Specified Quantity in Input)
- **Location**
  - **File:** `packages/sdk/src/auth.ts`
  - **Line Number:** 10-25
- **Evidence:**
  ```ts
  export const LoginSchema = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
    ...
  });
  export const RefreshSchema = z.object({ refreshToken: z.string().min(1) });
  ```
- **Why it is a problem:** `username`, `password`, and `refreshToken` have a `.min(1)` floor but no `.max()` ceiling, unlike almost every other string field in the SDK (which consistently bounds length, e.g. `users.ts` `StrongPasswordSchema.max(200)` for the password-**change** path). The login/refresh endpoints are pre-authentication, so this is the lowest-trust input surface in the whole API.
- **Real world attack scenario:** A request to the unauthenticated `POST /api/v2/auth/login` with a ~100KB `password` string (near the global JSON body cap) reaches `scrypt` hashing (`PASSWORD_SCRYPT_N` default 16384) on every login attempt regardless of validity — scrypt's CPU cost scales with `N`/memory parameters, not input length, so this is not a meaningful amplification, but it is inconsistent with the rest of the schema layer's defensive posture and offers no benefit to allow.
- **Business impact:** Low — already mitigated by the global 100kb body cap and the existing per-IP login rate limiter (`RATE_LIMIT_LOGIN_MAX`/`RATE_LIMIT_LOGIN_WINDOW_MS`, `apps/api/src/http/rateLimit.ts`); flagged for consistency/defense-in-depth, not as an active exploit path.
- **Recommended fix:** Add reasonable `.max()` bounds matching the DB column widths (e.g. `username.max(50)` to match `users.ts`'s create-side bound, `password.max(200)`, `refreshToken.max(512)` or whatever the issued-token length actually is).
- **Estimated effort:** S
- **Priority:** P3
- **Status:** OPEN

### INPUT_VALIDATION-04
- **Category:** Input Validation
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1284
- **Location**
  - **File:** `packages/sdk/src/cases.ts`
  - **Line Number:** 370
- **Evidence:**
  ```ts
  export const CreateCaseSchema = z
    .object({
      ...
      applicants: z.array(applicantInput).min(1),
      ...
    })
  ```
- **Why it is a problem:** No `.max()` on the applicants array for case creation (contrast with the `dedupeMatches` array two lines below, which is capped `.max(200)`). Each `applicantInput` element is itself bounded (name≤200, regex-validated mobile/PAN), and the whole request is capped by the global 100kb JSON body limit, so in practice only on the order of a few hundred applicant objects could fit in one request.
- **Real world attack scenario:** An authenticated, `case.create`-permitted office user submits a case with an unrealistic number of applicants (e.g. 300+) in one request, causing an oversized DB insert/transaction for what should always be a 1-3 applicant case in this domain. Not exploitable by an unauthenticated party; effectively a data-quality/abuse-by-an-authorized-user concern rather than a security vulnerability.
- **Business impact:** Informational — no security impact; a sanity-cap would improve data-quality/defense-in-depth only.
- **Recommended fix:** Add `.max(10)` (or whatever the real-world ceiling is — co-applicants are rare beyond a handful) to match the bounding discipline used everywhere else in this file.
- **Estimated effort:** S
- **Priority:** P3
- **Status:** OPEN

## Summary

**Counts by severity:** Critical: 0 · High: 0 · Medium: 0 · Low: 3 · Informational: 1

**Overall verdict: PASS** (with minor low/informational findings — none reach the FAIL threshold of any Critical/High, or even Medium, issue).

This codebase's input-validation posture is genuinely strong and consistently applied, not just superficially present. Every checklist item resolved to a real, evidenced PASS: a shared Zod-schema boundary is enforced on every route that reads `req.body` (verified by a scripted sweep of all 38 route modules, zero gaps found); file/image uploads are validated by magic-byte signature rather than trusted `Content-Type`, with size caps and randomized storage keys eliminating path-traversal risk; CSV/XLSX import and export both carry explicit, tested, CWE-1236 formula-injection neutralization; the pagination/filter/sort engine whitelists every SQL-bound column and parameterizes every value, closing off SQL injection on the dominant list-query pattern; the two Handlebars rendering engines correctly separate "plain-text producer" from "HTML sink with auto-escape + a server-enforced raw-output ban," with the ban verified by an actual passing test; and every hand-rolled regex in the codebase is linear-time with no ReDoS-prone nested quantifiers. The four findings recorded here are all Low/Informational defense-in-depth gaps (a couple of unhandled `decodeURIComponent` throws that degrade gracefully to a 500 rather than crashing, two unbounded-but-practically-capped fields, and one missing page-number ceiling) — worth fixing for polish and consistency, but none constitute an exploitable vulnerability in the live CRM as deployed.
