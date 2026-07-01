# RE-AUDIT 08: File Upload

Re-audit of area 08 against post-remediation HEAD (`8ded432`), baseline `b19039e`. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| FILE_UPLOAD-01 | CONFIRMED_FIXED | New `apps/api/src/platform/av.ts:39-71` — `scanBuffer()` speaks clamd INSTREAM over `node:net`, inert (`{clean:true}`, no network call) when `AV_SCAN_HOST` unset (`av.ts:41`). Wired at all 3 documented upload call sites, scan BEFORE `getStorage().put()` in every case: **users** scan `users/service.ts:437` → put `:441`; **field photos** scan `verification-tasks/service.ts:236` → put `:245`; **case attachments** scan `cases/service.ts:755` → put `:763`. `MALWARE_DETECTED` on positive match → `AppError.badRequest` (400) at each site; error code registered `platform/errors.ts:21`. Config `packages/config/src/index.ts:63-64` (`AV_SCAN_HOST` optional, `AV_SCAN_PORT` default 3310). Tests `platform/__tests__/av.test.ts` cover inert no-op, OK, FOUND, unreachable-host reject, framing. `git diff b19039e..8ded432` confirms all wiring is new. |

Notes on scope and fail-mode (all consistent with the documented fix):
- Import files (XLSX/CSV via `platform/import/index.ts`) are **not** scanned — this matches the documented FILE_UPLOAD-01 scope (fix targets the 3 binary attachment/photo/avatar sites only; import bytes are parsed as tabular data, never served back as a downloadable binary). Not a gap in this fix.
- Fail-mode when AV is configured but unreachable/times out: `scanBuffer` **rejects** (`av.ts:56-57`) → uploads **fail-closed** (rejected, unscanned content never stored). In the field-photo path the per-file catch (`verification-tasks/service.ts:272-288`) buckets a scanner error into `failed[]` with the file NOT stored — still fail-closed. Correct.

## New Findings

### FIN-1 — clamd `ERROR` / empty replies are treated as clean (fail-open in the new AV code)
- **Severity:** Low
- **Classification:** NEW (defect inside newly-added `av.ts`; the AV feature did not exist pre-remediation, so no prior behavior regressed — but it is a gap in the remediation's own code)
- **file:line:** `apps/api/src/platform/av.ts:31-36` (`parseClamdReply`), reached from `av.ts:61`
- **Evidence:** `parseClamdReply` returns `{clean:true}` for **any** reply that does not match `/stream:\s*(.+?)\s+FOUND/`. Verified by direct execution: `parseClamdReply('')` → `{clean:true}`; `parseClamdReply('INSTREAM size limit exceeded. ERROR')` → `{clean:true}`. clamd returns an `ERROR` (not a clean scan) when a stream exceeds its `StreamMaxLength` (default 25 MiB = 26,214,400 bytes). Case attachments are capped at exactly `MAX_ATTACHMENT_BYTES = 26_214_400` (`platform/file.ts:10`), so a max-size PDF can hit clamd's stream limit → `ERROR` reply → treated as clean → stored **unscanned**. A truncated/empty reply on a socket close (`av.ts:61` resolves `parseClamdReply(reply)` on `close`) also yields clean.
- **Why it matters:** Once a clamd sidecar is stood up (the whole point of this fix), the largest attachments — the ones most likely to be a bomb/exploit — are exactly the class that can silently skip scanning. Defeats the fix for its highest-risk inputs.
- **Recommended action:** Treat any non-`OK`, non-`FOUND` reply (and an empty reply on close) as a scan failure — throw so the upload fails-closed, same as a timeout — rather than defaulting to clean. Also raise clamd `StreamMaxLength` above `MAX_ATTACHMENT_BYTES` (or reject at the app before scanning). Dormant until `AV_SCAN_HOST` is set, hence Low.

### FIN-2 — NUL bytes (0x00) embedded in `cases/service.ts` source (assignee-pool cache key)
- **Severity:** Low
- **Classification:** REGRESSION_FROM_REMEDIATION (added by Wave 2/3 `poolCache` block; baseline `b19039e` version of the file has zero NUL bytes)
- **file:line:** `apps/api/src/modules/cases/service.ts:349`
- **Evidence:** `git diff b19039e..8ded432` added `const key = \`${t.visitType}<NUL>${t.pincodeId ?? ''}<NUL>${t.areaId ?? ''}<NUL>${t.verificationUnitId ?? ''}\``. The separators between interpolations are raw `0x00` bytes, not spaces — hex dump of line 349: `...7d 00 24 7b...` (`}` `NUL` `${`). `file cases/service.ts` reports `data`, `iconv` confirms valid UTF-8 but with NUL control chars; default `grep`/`file`/many formatters treat the file as binary as a result (this is why a first-pass grep for `scanBuffer` in this file returned nothing).
- **Why it matters:** Functionally the cache key is still correct (NUL is a unique, collision-safe separator), so **no runtime bug** — but a NUL byte in a source file is almost certainly an accidental paste artifact, breaks text tooling (grep/diff/some editors), and is a code-hygiene defect that slipped through the gate in unrelated remediation. Not a file-upload issue; surfaced here because it lives in a file this area touches.
- **Recommended action:** Replace the three `0x00` separators with a normal delimiter (e.g. a space or `|`). One-line fix; verify `file` reports the source as text afterward.

## Verdict

**PARTIAL.** FILE_UPLOAD-01 is genuinely and completely fixed: `scanBuffer` runs before `getStorage().put()` at all three documented call sites, the default path is inert and safe, detections fail-closed with a 400 `MALWARE_DETECTED`, and it's test-covered — this is a real, well-built fix, not a stub. Two Low findings keep it from a clean PASS: a fail-open in the new `parseClamdReply` on clamd `ERROR`/empty replies (max-size attachments can skip scanning once a sidecar is live), and NUL bytes accidentally embedded in `cases/service.ts` by an unrelated remediation wave (functionally harmless but breaks text tooling). Both are Low and dormant/cosmetic; neither blocks Go, but FIN-1 should be fixed before any clamd sidecar is actually enabled in prod.
