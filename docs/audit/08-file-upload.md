# AUDIT 08: File Upload

## Scope

Inspected every upload-bearing route and the platform code it calls through to object storage:

- `apps/api/src/modules/users/routes.ts`, `apps/api/src/modules/users/controller.ts`, `apps/api/src/modules/users/service.ts` (profile photo, `POST /users/:id/photo`, `POST /users/me/photo`)
- `apps/api/src/modules/verification-tasks/routes.ts`, `apps/api/src/modules/verification-tasks/controller.ts`, `apps/api/src/modules/verification-tasks/service.ts` (device field-photo attachments, `POST /verification-tasks/:id/attachments`)
- `apps/api/src/modules/cases/routes.ts`, `apps/api/src/modules/cases/controller.ts`, `apps/api/src/modules/cases/service.ts` (office reference-document attachments, `POST /cases/:id/attachments`; field-photo single/zip download)
- `apps/api/src/platform/image.ts` (profile-photo magic-byte allowlist)
- `apps/api/src/platform/file.ts` (case-attachment magic-byte allowlist — PDF + 3 image types)
- `apps/api/src/platform/photo.ts` (sharp processing: EXIF strip, thumbnail, decompression-bomb pixel cap, GPS overlay compositing)
- `apps/api/src/platform/storage/index.ts` (the S3/MinIO storage seam — `put`/`get`/`signedUrl`/`remove`)
- `apps/api/src/platform/import/index.ts`, `apps/api/src/platform/import/format.ts` (spreadsheet import engine — XLSX/CSV parsing via `exceljs`)
- All 12 `*/routes.ts` files using `raw({ type: () => true, limit: ... })` for octet-stream/import bodies (commissionRates, clients, rates, products, rateTypeAssignments, designations, cases, departments, locations, users, verificationUnits, cpv)
- `apps/api/src/modules/cases/controller.ts` `archiver` usage (zip *building*, not extraction)
- `infra/prod/docker-compose.yml`, `infra/prod/nginx.conf`, `docker-compose.yml` (MinIO bucket provisioning/policy, nginx `/crm2-prod/` proxy)
- Test files: `apps/api/src/platform/__tests__/storage-mail.test.ts`, `apps/api/src/platform/__tests__/photo.test.ts`, `apps/api/src/modules/users/__tests__/users.api.test.ts`, `apps/api/src/modules/cases/__tests__/cases.api.test.ts`, `apps/api/src/modules/verification-tasks/__tests__/verification-tasks.api.test.ts`
- `apps/api/package.json` (dependency list for AV/file-type libs)

Commands actually run (read-only):
```
grep -rn "multer(" apps/api/src --include="*.ts"
grep -rn "detectImage\|detectAttachment" apps/api/src --include="*.ts"
grep -rn "fileFilter" apps/api/src -r --include="*.ts"
grep -rn "archiver|extract|unzip|AdmZip|yauzl|tar\." apps/api/src --include="*.ts"
grep -i "clamav|clamscan|virus|malware-scan|file-type" apps/api/package.json package.json apps/*/package.json packages/*/package.json
grep -rn "content-disposition" apps/api/src --include="*.ts" -i
grep -n "minio" -A 20 infra/prod/docker-compose.yml
grep -n "crm2-prod|minio|location /" infra/prod/nginx.conf
```

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Extension validation | PASS | `apps/api/src/platform/file.ts:34-39` (`detectAttachment`), `apps/api/src/platform/image.ts:32-37` (`detectImage`) — storage key extension is taken from the **detected** type, not the client-supplied filename/extension: `apps/api/src/modules/cases/service.ts:740` `const key = \`attachments/${caseId}/${randomUUID()}.${kind.ext}\`` and `apps/api/src/modules/verification-tasks/service.ts:241` `const storageKey = \`${baseKey}.${detected.ext}\`` | Original filename is stored only as DB metadata (truncated to 255 chars), never used to derive the stored extension or storage path |
| MIME validation | PASS (not solely trusted) | Same magic-byte functions above set `mimeType`/`Content-Type` from the **detected** type, e.g. `apps/api/src/modules/cases/service.ts:753` `mimeType: kind.type` and `:741 await getStorage().put(key, bytes, kind.type)` | Client `Content-Type`/declared MIME is never trusted as the sole gate; multer has no `fileFilter` (relies on the post-buffer magic-byte check instead, which is the actual security boundary) |
| Magic-byte validation | PASS | `apps/api/src/platform/file.ts:19-31` allowlist: PDF (`%PDF`), PNG, JPEG, WebP (RIFF+"WEBP" double-check); `apps/api/src/platform/image.ts:17-29` same 3 image types for profile photos. Enforced at: `apps/api/src/modules/cases/service.ts:741` (`detectAttachment`), `apps/api/src/modules/verification-tasks/service.ts:232-234` (`detectAttachment`, rejects non-`image/*`), `apps/api/src/modules/users/service.ts:414-415` (`detectImage`) | Contradicts the audit brief's assumption that no `file-type`-style check exists — this repo hand-rolled its own magic-byte sniffer instead of the npm `file-type` package, and it is wired into every upload path found |
| Virus scanning | FAIL | `grep -i "clamav\|clamscan\|virus\|malware-scan" apps/api/package.json package.json` → no output (no match in any `package.json`) | No AV/malware-scanning dependency or call-site anywhere in the repo. See FILE_UPLOAD-01 |
| Storage location | PASS | `apps/api/src/platform/storage/index.ts:90-97` (`put` → S3 `PutObjectCommand`); all 3 upload services call `getStorage().put(...)`, never `fs.writeFile`/disk; `infra/prod/nginx.conf:103-111` proxies `/crm2-prod/` to `minio:9000` only for presigned reads (no public listing); `docker-compose.yml`/`infra/prod/docker-compose.yml` `mc mb` creates the bucket with no `--with-policy public` flag (default private) | Multer uses `multer.memoryStorage()` in both route files (`apps/api/src/modules/users/routes.ts:26`, `apps/api/src/modules/verification-tasks/routes.ts:18`) — bytes never touch local disk, buffered in memory then shipped to S3/MinIO |
| Filename sanitization | PASS | Storage keys are 100% server-minted: `randomUUID()` + detected extension (`cases/service.ts:740`, `verification-tasks/service.ts:240-241`, `users/service.ts:417`). Original filename only stored as a DB column (`originalName: fileName.slice(0, MAX_ATTACHMENT_NAME_LEN)`, `cases/service.ts:754`; `MAX_ATTACHMENT_NAME_LEN = 255` at `cases/service.ts:95`) | No path-traversal vector — the user-controlled filename never participates in path/key construction. Download `Content-Disposition` filenames are also server-canonicalized (`fieldPhotoFilename()`, never the raw upload name) — `apps/api/src/modules/cases/controller.ts:385,400` |
| Image validation | PASS | `apps/api/src/platform/photo.ts:27-46` `processFieldPhoto()` runs every field photo through `sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()` (decode-or-throw) AFTER the magic-byte check, strips all EXIF/GPS metadata on re-encode, and a `MAX_INPUT_PIXELS = 50_000_000` decode bound (`photo.ts:25`) is a decompression-bomb defense | Sharp's decode is not the *sole* validation — the magic-byte allowlist runs first (`verification-tasks/service.ts:232-234`), then sharp decode acts as a second structural check (a magic-byte-valid-but-corrupt/oversized image throws → caught → bucketed into `failed[]`, never silently stored) |
| PDF validation | PASS | `apps/api/src/platform/file.ts:20` — `%PDF` (`0x25,0x50,0x44,0x46`) magic-byte check for case attachments; no PDF-specific structural/JS-stripping validation beyond the byte-signature check and the fact that PDFs are never executed/rendered server-side from upload (only Puppeteer-generated PDFs are server-rendered, a separate code path, not from uploads) | A magic-byte-valid PDF carrying an embedded exploit (e.g. malicious JS, a font-parser CVE) would still pass — see FILE_UPLOAD-01 (no AV/content scanning at all, covers this case too) |
| Executable upload prevention | PASS | The case-attachment allowlist (`apps/api/src/platform/file.ts:19-31`) accepts only 4 signatures: PDF/PNG/JPEG/WebP; the profile-photo allowlist (`apps/api/src/platform/image.ts:17-29`) accepts only 3 image types; the field-photo path additionally requires `detected.type.startsWith('image/')` (`apps/api/src/modules/verification-tasks/service.ts:233`). Anything else (e.g. `.exe`, `.sh`, `.php`, `.html`, `.svg` with embedded script) → `UNSUPPORTED_FILE_TYPE`/`INVALID_IMAGE` 400, never stored | Tested: `apps/api/src/modules/users/__tests__/users.api.test.ts:834-840` ("rejects a non-image (400 INVALID_IMAGE) and never stores it"), `apps/api/src/modules/cases/__tests__/cases.api.test.ts:1806` (`UNSUPPORTED_FILE_TYPE`), `apps/api/src/modules/verification-tasks/__tests__/verification-tasks.api.test.ts:581` ("a non-image → success=false with a failed[] entry"). Served downloads also set `X-Content-Type-Options: nosniff` (`apps/api/src/modules/cases/controller.ts:369,387,398`) — defends the browser against MIME-sniff-driven execution even for an allowed type |
| Archive extraction safety | PASS | `grep -rn "archiver\|extract\|unzip\|AdmZip\|yauzl\|tar\." apps/api/src --include="*.ts"` → only hit is `apps/api/src/modules/cases/controller.ts:2,402` building a **download** zip via `archiver('zip', ...)` + `archive.append(f.bytes, { name: f.filename })` (`f.filename` is the server-canonicalized `fieldPhotoFilename()`, not user input). No `unzip`/`extract`/`AdmZip`/`yauzl`/`tar` call anywhere in `apps/api/src` | No code path anywhere in the repo unzips/extracts an uploaded archive — zip-slip is not a reachable risk because there is no extraction code at all, confirming the audit brief's hypothesis |

## Findings

### FILE_UPLOAD-01
- **Category:** Missing malware/virus scanning on uploaded files
- **Severity:** Medium
- **CVSS:** 5.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N) — CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N
- **OWASP Mapping:** OWASP Top 10:2021 A04 (Insecure Design) / A08 (Software and Data Integrity Failures)
- **CWE Mapping:** CWE-434 (Unrestricted Upload of File with Dangerous Type)
- **Location**
  - **File:** `apps/api/src/platform/file.ts`, `apps/api/src/platform/image.ts`, `apps/api/src/modules/cases/service.ts`, `apps/api/src/modules/verification-tasks/service.ts`, `apps/api/src/modules/users/service.ts`
  - **Line Number:** `file.ts:19-39`, `image.ts:17-37`, `cases/service.ts:728-758`, `verification-tasks/service.ts:228-286`, `users/service.ts:405-425`
- **Evidence:**
  ```
  $ grep -i "clamav\|clamscan\|virus\|malware-scan" apps/api/package.json package.json apps/*/package.json packages/*/package.json
  (no output — no match in any package.json)
  ```
  Every upload path (case office-reference PDFs/images, field-agent device photos, admin/user profile photos) validates files **only** by a 1–8-byte magic-number signature match (`apps/api/src/platform/file.ts:34-39`, `apps/api/src/platform/image.ts:32-37`). There is no content-level scan for embedded exploits, malicious macros, polyglot payloads, or known malware signatures anywhere in the codebase.
- **Why it is a problem:** A magic-byte check only confirms the first few bytes match a known container format; it does not inspect the rest of the file. A well-formed PDF or JPEG can still carry a malicious payload (e.g. an exploit targeting a PDF reader's JS engine, a crafted image targeting a downstream image-library CVE, or content designed to be misinterpreted by whatever application eventually opens the downloaded file on an admin's or field-agent's desktop). Sharp's own decode (for images) provides some structural validation but is not a malware scanner and does not run for PDFs at all.
- **Real world attack scenario:** A KYC-document upload (a PAN/Aadhaar "scan") on a case attachment, or a field agent's device photo, is crafted as a valid PDF/JPEG by byte signature but carries an embedded exploit targeting whichever PDF/image viewer a back-office "Compliance" or "Verifier" user opens it with when reviewing the case. Because attachments are downloaded and opened by staff (not just rendered in a sandboxed `<img>` tag) — e.g. via `GET /cases/:id/attachments/:attachmentId/url` → a signed S3 URL the browser/OS hands to a native PDF viewer — a malicious PDF could compromise the reviewing user's machine, which in a CRM holding KYC PII (PAN, Aadhaar scans, signatures) is a high-value pivot point.
- **Business impact:** Potential malware foothold inside the back-office network via a routine KYC document upload; reputational and compliance exposure (PII-handling CRM) if an uploaded file is later found to have delivered malware to an employee.
- **Recommended fix:** Integrate a scanning step (e.g. ClamAV via a sidecar/daemon, or a managed scanning API) in the upload pipeline, called after the magic-byte check and before `getStorage().put(...)` in `cases/service.ts:741`, `verification-tasks/service.ts:239-242`, and `users/service.ts:414-418`; quarantine/reject on a positive match. If self-hosting ClamAV is out of scope for the current infra footprint (single VPS, no extra service budget), at minimum document this as an accepted residual risk in `docs/COMPLIANCE_GAPS_REGISTRY.md` per the repo's own "every finding ends FIXED / DEFERRED / RATCHET / WONTFIX" rule.
- **Estimated effort:** M (clamd sidecar + a thin scan call in 3 call sites; more if a managed API is preferred)
- **Priority:** P2
- **Status:** OPEN

## Summary

**Counts by severity:** Critical: 0, High: 0, Medium: 1, Low: 0, Informational: 0.

**Overall verdict: PARTIAL.**

The file-upload implementation in this repo is materially better than the audit brief assumed: every upload path (profile photos, field-agent device photos, case office-reference documents) is sniffed by a hand-rolled magic-byte allowlist (`apps/api/src/platform/file.ts`, `apps/api/src/platform/image.ts`) — not the npm `file-type` package, but functionally equivalent and actually wired into every call site, with tests proving non-matching files are rejected and never stored. Storage keys are 100% server-minted (`randomUUID()` + detected extension), eliminating path-traversal/filename-injection risk; uploads go straight to S3/MinIO via `multer.memoryStorage()` (never local disk); the MinIO bucket is private with all reads gated through short-TTL presigned URLs; `archiver` is confirmed zip-build-only with zero extraction code anywhere in the repo, so zip-slip is not a reachable risk. The one real gap is the complete absence of virus/malware scanning (no ClamAV or equivalent dependency anywhere in `package.json`), which is a genuine Medium-severity finding (FILE_UPLOAD-01) given this CRM accepts KYC document scans that back-office staff later open. All ten checklist items are evidenced PASS except virus scanning (FAIL), which is why the overall verdict is PARTIAL rather than PASS.
