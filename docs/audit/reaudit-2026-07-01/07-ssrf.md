# RE-AUDIT 07: SSRF

Re-audited fresh against current HEAD (`8ded432`). Baseline `b19039e`. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| SSRF-01 (retracted false-positive: geocode coords validated downstream) | ACCEPTED_AS_DOCUMENTED | `apps/api/src/modules/geocode/service.ts:26-27` — `reverse()` rejects with `INVALID_COORDINATES` unless `Number.isFinite(lat/lng)` **and** `Math.abs(lat) <= 90` / `Math.abs(lng) <= 180`, *before* line 34 calls `getGeocoder().reverse()`. The outbound URL (`platform/geocode/index.ts:63`) is a fixed Google endpoint with numeric coords interpolated + `encodeURIComponent(apiKey)` — no user-controlled host/path/scheme. Controller (`controller.ts:7`) passes raw query straight into this guarded service. Retraction still valid. |
| No new user-input→outbound path from remediation | CONFIRMED_FIXED | `git diff --stat b19039e..8ded432` for the geocode area = **0 changes**; only new file in scope is `platform/av.ts` (Wave 2, commit `987f01f`). All three `fetch()` sites in `apps/api/src` reach fixed endpoints or server-signed URLs (see New Findings — none). `av.ts` `connect({host,port})` uses **config-only** `AV_SCAN_HOST`/`AV_SCAN_PORT` (`platform/av.ts:42-46`; `packages/config/src/index.ts:63-64`), never request input; the user controls only the bytes scanned, never the destination. |

## New Findings

**None.**

Full outbound-request inventory in `apps/api/src` (grep for `fetch(`/`.request`/`.connect(`, excluding tests):
- `platform/geocode/index.ts:64` — fixed Google Geocoding endpoint, numeric coords (guarded upstream, see SSRF-01).
- `platform/staticmap/index.ts:71` — fixed Google Static-Maps endpoint (`STATIC_MAP_ENDPOINT`, index.ts:52), numeric `${lat},${lng}` centre + `encodeURIComponent` marker + `encodeURIComponent(apiKey)`. No user-controlled destination.
- `modules/caseReports/docx.ts:87` (`fetchImage`) — fetches `photo.url` from `task.photos`, which is server-built report data holding presigned object-store URLs, not request input (docstring docx.ts:78-79; call site docx.ts:134). Server-side, bounded by `IMG_FETCH_TIMEOUT_MS`.
- `platform/av.ts:46` — `node:net` connect to config `AV_SCAN_HOST:AV_SCAN_PORT`; inert when host unset (av.ts:41). Not an HTTP SSRF surface and host/port are operator-set env, not user input.
- `platform/jobs/index.ts:131` & `platform/geocode/queue.ts:54` — `new URL(REDIS_QUEUE_URL)` parse config only, not user input.

All outbound destinations are compile-time-fixed hosts or server-signed URLs. No path lets request input choose the target host/scheme/port.

## Verdict

**PASS.** SSRF-01's retraction holds — the geocode coordinate bound-check is genuinely enforced in `geocodeService.reverse()` before any outbound call, and the Google endpoint is a fixed host with numeric-only interpolation. The one new file the remediation added in this area (`platform/av.ts`) connects to operator-configured `AV_SCAN_HOST`/`AV_SCAN_PORT`, not user input, so it introduces no new SSRF surface. Every outbound `fetch`/socket in the API targets a compile-time-fixed host or a server-signed object-store URL; none lets request data select the destination. Zero new findings, all fixes confirmed.
