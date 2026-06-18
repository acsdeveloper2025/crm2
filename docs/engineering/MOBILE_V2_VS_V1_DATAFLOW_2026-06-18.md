# Mobile ↔ backend data-flow: v2 vs v1 field-level diff (2026-06-18)

Field-level audit of **every** mobile↔backend endpoint the field app uses: what data flows (request + response) and how the **live v2** backend differs from **v1** (the contract the app was built against). 6 endpoint groups, **322 fields catalogued, 305 with some v1↔v2 difference**.

**Headline:** the vast majority of the 305 differences are **envelope-shape drift that the app's `apiClient` adapter already bridges** (`normalizeV2Envelope` for 2xx, `normalizeV2Error` for 4xx/5xx) — no app impact. The **real, app-affecting gaps are concentrated in `GET /sync/download`**: v2's `toMobileTask` mapper omits several task fields that v1 sent and the app's local SQLite upsert still stores, so they silently become **null on the device**.

## A. Real gaps worth deciding on

### A1. `GET /sync/download` — fields v2 no longer sends (app stores them → now null on device)
Source: `apps/api/src/modules/sync/{service.ts (toMobileTask),repository.ts}`. The app already has the columns + upsert mappings — **fixing these is v2-side only (additive to `toMobileTask`), no app change.**

| Field | v1 source | v2 today | Impact |
|-------|-----------|----------|--------|
| `verificationOutcome` | `cases.verification_outcome` | **absent** | moderate — completed-task outcome not visible on device |
| `latitude` / `longitude` | `cases.latitude/longitude` | **absent** | moderate — case geo pin/distance lost (if any map UI) |
| `addressPincode` | `cases.pincode` | **`''` hardcoded** | low-moderate — address pincode blank on device |
| `formData` | `cases.verification_data` (jsonb) | **absent** | moderate — server-side/pre-filled form data not hydrated |
| `revokeReason` | revocation reason | **absent** | moderate — agent loses *why* a task was revoked |
| `revokedAt` / `revokedByName` | revoke audit | **absent** | low-moderate — revoke timestamp/actor blank |
| `customerEmail` | `cases` | **absent** | low — rarely shown to field agent |
| `savedAt` | draft-save time | **absent** | low — device-local concept anyway |
| `companyName` | — (NEW in v2, from `case_applicants.company_name`) | **sent**, app didn't store/show | **being fixed** (mobile wire-up in progress) |

> Note: some of these need a source decision on the v2 side (e.g. v2 has no `cases.latitude/longitude`; pincode must be derived from the area/pincode FK; revoke detail is partly in `case_tasks.remark`). `verificationOutcome` and `formData` map cleanly to existing `case_tasks` columns.

### A2. `POST /auth/login` — user-profile fields v2 drops (app shows blank, no crash)
`authUserById` selects fewer columns than v1: **`employeeId`, `designation`, `department`, `profilePhotoUrl`, `assignedPincodes`, `assignedAreas`** are gone (app schema marks them optional → `undefined`). v2 adds `phone/grantsAll/permissions/mustChangePassword/...`. `profilePhotoUrl` is now set via the photo-upload endpoint instead of login.

## B. By-design v2 differences (intended, app-supported — not bugs)
- **Form-submit == complete** (no `SUBMITTED_FOR_REVIEW` fork): v2 device form POST always lands `COMPLETED` (ADR-0032). App only reads `success`.
- **Device priority is a no-op server-side**: numeric drag-reorder is acked but never overwrites office priority (owner decision).
- **`verificationOutcome` on form-submit is evidence only**, not the official result (single-layer, ADR-0032).
- **`GET /forms/:formType/template` → `data:null`**: no server template engine; device uses its bundled template.
- **version-check** drops `features/bugFixes/currentVersion/checkTimestamp/buildNumber`; adds `minSupportedVersion`.

## C. Bridged / inert (no action — adapter or app fallback absorbs it)
- **Envelope drift on every endpoint**: v1 `{success,message,data}` vs v2 bare/paginated/`{error:CODE}` bodies → `normalizeV2Envelope`/`normalizeV2Error` rewrite to the v1 shape. The app reads post-adapter, so all parsers/Zod keep working.
- **`GET /attachments`**: `url` now a presigned absolute URL, `thumbnailUrl`/`geoLocation` dropped — app passes http(s) through unchanged, schema `.passthrough()`.
- **`POST /location/capture`**: `activityType` stripped by v2 Zod (v1 never persisted it); `source` widened to accept GPS/NETWORK/PASSIVE.
- **notifications**: list paginates by `page/limit` not the app's `limit/offset` (pages 2+ re-return page 1 — harmless <100 notifs); `updatedAt` dropped (falls back to `createdAt`); no `priority` field (badge → NORMAL); `actionUrl` null when producer omits it (in-app tap uses `taskId`).
- **telemetry ingest / mark-read / mark-all / delete / restore**: response bodies reshaped; app ignores them (treats 2xx/404 as success).

## D. Not called by the app (no contract risk)
`GET /auth/me` (doc-comment only), `GET /verification-tasks/:id` (detail read from local SQLite projection), `GET /notifications/unread-count` (computed locally).

---
*Generated from a 6-agent field-level fan-out (mobile src ↔ CRM-BACKEND v1 ↔ crm2 v2). Companion to [`MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md`](./MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md) and the frozen [`MOBILE_API_COMPATIBILITY_MATRIX.md`](./MOBILE_API_COMPATIBILITY_MATRIX.md).*
