# AUDIT 07: SSRF

## Scope

Read-only inspection of `/Users/mayurkulkarni/Downloads/crm2` for server-side request forgery (SSRF) risk: every outbound HTTP/network call made by the API/worker tiers, whether the destination host/path can be influenced by request-scoped user input, cloud-metadata-endpoint exposure, and outbound-destination whitelisting.

Files/modules inspected:
- `apps/api/src/platform/geocode/index.ts` — Google Geocoding reverse-lookup
- `apps/api/src/platform/staticmap/index.ts` — Google Static Maps thumbnail
- `apps/api/src/modules/geocode/{controller,service,routes,repository}.ts` — the `/api/v2/geocode/reverse` HTTP surface and its DLQ/replay
- `apps/api/src/platform/geocode/queue.ts` — async reverse-geocode job queue (BullMQ/in-process)
- `apps/api/src/modules/verification-tasks/service.ts` — field-photo upload → reverse-geocode enqueue producer (lines ~270-296)
- `apps/api/src/modules/caseReports/{service,render,docx}.ts` — CASE_REPORT assembly (photo presign + static-map inset), HTML render (Handlebars), `.docx` photo embedding (`fetchImage`)
- `apps/api/src/platform/pdf/index.ts` — Puppeteer HTML→PDF (`page.setContent`, no `page.goto`)
- `apps/api/src/platform/storage/index.ts` — S3/MinIO storage seam (`signedUrl`, `put`, `get`)
- `apps/api/src/platform/mail/index.ts` — nodemailer SMTP seam
- `apps/api/src/platform/photo.ts` — field-photo image processing (sharp only, no network)
- `apps/api/src/modules/reportLayouts/service.ts` + `packages/sdk/src/reportLayouts.ts` — admin-authored CASE_REPORT/FIELD_REPORT Handlebars template bodies + the raw-output ban (`RAW_OUTPUT_RE`)
- `apps/api/src/modules/commissionRates/import.ts`, `apps/api/src/modules/rates/import.ts`, `apps/api/src/modules/rateTypeAssignments/import.ts`, `apps/api/src/modules/cpv/import.ts`, `apps/api/src/modules/shared/masterDataImport.ts` — import surfaces (checked for URL-based import vectors)
- `infra/prod/nginx.conf` — edge proxy_pass targets
- `packages/config/src/index.ts` — env schema (`GOOGLE_GEOCODING_API_KEY`, `S3_*`, `SMTP_*`)
- `docs/architecture-inventory.md` — baseline context (read first, per instructions)

Commands actually run (all read-only):
```
find apps/api/src -iname "*geocode*" -not -path "*/node_modules/*"
grep -rn "fetch(\|axios\|http.request\|https.request\|got(\|node-fetch" apps/api/src --include="*.ts" -l
grep -rln "puppeteer" apps/api/src --include="*.ts"
grep -rn "page.goto\|setContent\|\.goto(" apps/api/src --include="*.ts"
grep -rn "signedUrl" apps/api/src/platform/storage/*.ts
grep -rn "169.254\|instance-metadata\|metadata.google\|metadata.azure\|EC2MetadataCredentials\|fromInstanceMetadata\|ECS_CONTAINER" apps/api/src infra/ -i
grep -rln "fromInstanceMetadata\|@aws-sdk/credential-provider" apps/api/src package.json apps/api/package.json
cat infra/prod/nginx.conf | grep -n "proxy_pass\|location"
grep -rln "webhook|callback_url|callbackUrl|webhookUrl|webhook_url" apps/api/src -i
grep -rln "axios|node-fetch|got\b|request-promise|superagent" apps/api/src apps/worker apps/report-worker package.json apps/api/package.json
grep -rn "createTransport|nodemailer" apps/api/src --include="*.ts"
grep -n "photo.url|{{.*url" packages/sdk/src/caseReports.ts
grep -rln "net.connect|net.Socket|dns.lookup|child_process|exec(" apps/api/src --include="*.ts"
```

Out of scope per audit instructions: mobile app source (separate repo, inaccessible), any live network call to crm.allcheckservices.com or production infra.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Internal network access (can a request reach internal-only hosts/ports via a server-initiated fetch?) | PASS | `apps/api/src/platform/geocode/index.ts:45` (`GEOCODE_ENDPOINT = 'https://maps.googleapis.com/...'`, hard-coded host); `apps/api/src/platform/staticmap/index.ts:52` (`STATIC_MAP_ENDPOINT` hard-coded); `apps/api/src/platform/storage/index.ts:83` (`S3_ENDPOINT` is an env var, not request-derived); `apps/api/src/platform/mail/index.ts:53` (`SMTP_HOST` is env-only) | Every outbound-fetch call site in `apps/api/src` was enumerated (`grep -rln "fetch("` → 3 files, all reviewed). None build a URL host from request body/query/path. No `axios`/`node-fetch`/`got`/`http.request`/`https.request` usage in non-test app code (`grep -rln "axios\|node-fetch\|got\b\|..."` → only test files and `bulk.ts` false-positive line-match with no actual hit). |
| Metadata endpoints (cloud instance metadata, e.g. 169.254.169.254) | PASS | `grep -rn "169.254\|instance-metadata\|metadata.google\|metadata.azure\|EC2MetadataCredentials\|fromInstanceMetadata\|ECS_CONTAINER" apps/api/src infra/` → no matches; `grep -rln "fromInstanceMetadata\|@aws-sdk/credential-provider"` → no matches; `apps/api/src/platform/storage/index.ts:77-84` constructs the S3 client with explicit static `credentials: { accessKeyId, secretAccessKey }` from env, never an instance-metadata credential provider | `docs/architecture-inventory.md` §6 states this is a single unbranded VPS (not a managed cloud compute platform) — confirmed independently: no cloud-provider SDK/tooling, no IMDS credential chain anywhere in `apps/api`, `infra/`. The architecture-inventory's "likely N/A" framing is correct; this audit additionally verified no AWS SDK default credential-provider chain (which would silently try IMDS) is in use — credentials are always explicit env values. |
| URL validation (is user input that reaches a fetch validated/sanitized before forming the request URL?) | PASS | `apps/api/src/modules/geocode/service.ts:24-27` (`Number(rawLat)`, `Number(rawLng)`, `Number.isFinite` + `Math.abs(lat) > LAT_MAX(90)` / `LNG_MAX(180)` bound check, throws `INVALID_COORDINATES` 400 otherwise) before the validated numbers are interpolated into `GEOCODE_ENDPOINT` at `platform/geocode/index.ts:63`; same numeric values flow to the static-map thumbnail call (`platform/staticmap/index.ts:67-70`) | The only two places request-influenced data reaches an outbound `fetch()` URL are `lat`/`lng`, and both are coerced through `Number()` + range-checked first. A JS number's string form (`Infinity`, `NaN`, `1e+21`, etc. — verified via `node -e`) can only ever contain `[0-9eE+\-.Inafity]`, never `&`, `/`, `:`, `?`, or `#`, so even an out-of-range or non-finite value cannot redirect the request to a different host/path — it can only produce a malformed query parameter the upstream API rejects. One secondary path (`apps/api/src/modules/verification-tasks/service.ts:289-292`, the field-photo-upload reverse-geocode producer) checks `typeof lat === 'number'` but does **not** re-apply the ±90/±180 bound check before enqueueing — see SSRF-01 (informational, not an SSRF vector for the reason above, but a latent validation gap). |
| Whitelisting of outbound destinations | PASS | `apps/api/src/platform/geocode/index.ts:45`, `apps/api/src/platform/staticmap/index.ts:52` — both endpoints are `const` string literals (`https://maps.googleapis.com/...`); no env var or request value can change the host. `apps/api/src/platform/storage/index.ts` — `S3_ENDPOINT` is a deploy-time env value (`packages/config/src/index.ts`), never derived from a request. `apps/api/src/platform/mail/index.ts:53` — `SMTP_HOST` likewise deploy-time only | There is no generic "fetch this URL" capability anywhere in the API surface (no webhook config, no URL-based import, no proxy/redirect endpoint) — confirmed by `grep -rln "webhook\|callback_url\|callbackUrl\|webhookUrl\|webhook_url" apps/api/src -i` returning zero hits, and a review of all 5 import modules (`commissionRates`, `rates`, `rateTypeAssignments`, `cpv`, `shared/masterDataImport`) showing they are `multer` file-upload + in-process XLSX/CSV parsers, not URL-fetch importers. The only "destinations" the app ever calls are: Google Maps Platform (2 fixed endpoints), the configured S3/MinIO bucket, the configured SMTP relay, and Firebase Admin SDK's own fixed FCM endpoints (not independently re-verified here — no raw `fetch`/`axios` call site found for it, it goes through the `firebase-admin` SDK). |

## Findings

### SSRF-01
- **Category:** Missing input validation (defense-in-depth gap, not an exploitable SSRF)
- **Severity:** Informational
- **CVSS:** N/A — no host/path injection is possible regardless (see checklist row 3 reasoning: JS `Number` string coercion cannot contain URL-structural characters)
- **OWASP Mapping:** A10:2021 — Server-Side Request Forgery (raised here only for completeness/defense-in-depth; not an actual SSRF given the constraints below)
- **CWE Mapping:** CWE-20 (Improper Input Validation)
- **Location**
  - **File:** `apps/api/src/modules/verification-tasks/service.ts`
  - **Line Number:** 289-292
- **Evidence:**
  ```ts
  const lat = geo?.['latitude'];
  const lng = geo?.['longitude'];
  if (typeof lat === 'number' && typeof lng === 'number') {
    for (const row of stored) void enqueueReverseGeocode({ attachmentId: row.id, lat, lng });
  }
  ```
  Compare to the HTTP-facing `modules/geocode/service.ts:24-27`, which additionally bounds-checks:
  ```ts
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > LAT_MAX || Math.abs(lng) > LNG_MAX)
    throw AppError.badRequest('INVALID_COORDINATES', { lat: rawLat, lng: rawLng });
  ```
- **Why it is a problem:** The field-photo-upload path (device-supplied EXIF/GPS metadata on a mobile field-agent photo upload) only checks `typeof === 'number'`, not finiteness or the ±90/±180 geographic bound, before queuing a reverse-geocode job that eventually calls `getGeocoder().reverse(lat, lng)` (`platform/geocode/index.ts:59-76`), which interpolates the raw values into the Google Geocoding URL (`platform/geocode/index.ts:63`: `` `${GEOCODE_ENDPOINT}?latlng=${lat},${lng}&key=...` ``). `NaN`/`Infinity`/huge-exponent values would produce a malformed `latlng` parameter Google rejects (the call already null-degrades on any non-OK response, per `index.ts:65,67`), so there is no SSRF or availability impact today. It is flagged only because it is the one spot in the codebase where the same kind of value reaches a `fetch()` URL without the same validation rigor as its sibling endpoint, and any future refactor of `createGoogleGeocoder` that built the URL differently (e.g. via `URLSearchParams` misuse or a template change) would inherit this gap.
- **Real world attack scenario:** None practically achievable today — a malicious mobile client could only submit a crafted `geo.latitude`/`geo.longitude` (the value is attacker-controlled if the field-agent device is compromised, since it's device-reported GPS metadata, not GPS-verified server-side), but the resulting string can never contain `&`, `/`, `:`, or `#`, so it cannot retarget the request's host or path — it can at most cause a wasted/failed Google API call.
- **Business impact:** None currently. Purely a robustness/consistency gap that should be closed to keep the two reverse-geocode entry points (sync HTTP route vs. async upload-triggered queue) aligned, and to avoid relying on "the string representation of a JS number happens to be URL-safe" as the only safety net.
- **Recommended fix:** Apply the same `Number.isFinite` + `Math.abs(lat) <= 90 && Math.abs(lng) <= 180` guard (already implemented in `modules/geocode/service.ts:26`) at `verification-tasks/service.ts:291` before enqueueing, e.g. extract the bound check into a small shared helper both call sites import.
- **Estimated effort:** S (under 1 hour — add one shared guard function + 2 call-site updates)
- **Priority:** P3
- **Status:** OPEN

## Summary

Counts by severity: Critical 0, High 0, Medium 0, Low 0, Informational 1.

Overall verdict: **PASS**. All four checklist items are real, evidenced PASSes: every outbound server-side HTTP call in `apps/api/src` was enumerated and traced to its URL-construction site — Google Geocoding/Static-Maps use fixed-host endpoints with only numeric, range-validated `lat`/`lng` query parameters (incapable of host/path injection regardless of value, per JS number string-coercion semantics, independently verified with `node -e`); object storage (`signedUrl`) and SMTP (`createTransport`) hosts are deploy-time environment values, never request-derived; Puppeteer renders only server-composed HTML via `page.setContent` (no `page.goto` to an external/user URL anywhere in the codebase) and embeds only the app's own presigned storage URLs as `<img src>`; there is no webhook/callback-URL feature and no URL-based import (all 5 import modules are file-upload parsers); and the self-hosted-VPS architecture has zero cloud-metadata-endpoint exposure (no IMDS credential provider, no `169.254.169.254`/metadata-host string anywhere in the tree — confirmed, not just assumed). One informational gap (SSRF-01) was raised for defense-in-depth consistency between the sync and async reverse-geocode entry points, but it carries no actual SSRF risk because JS-number string coercion cannot produce URL-structural characters.
