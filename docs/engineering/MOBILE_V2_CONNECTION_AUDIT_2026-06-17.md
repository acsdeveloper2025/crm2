# Mobile → CRM2 `/api/v2` Connection Audit (2026-06-17)

**Status:** AUDIT + BUILD PLAN (active). Companion to [`MOBILE_API_COMPATIBILITY_MATRIX.md`](./MOBILE_API_COMPATIBILITY_MATRIX.md) (frozen governance). Drives the parity build that connects the existing field app to v2.
**Scope decision (owner, 2026-06-17):** **full v1 contract parity first**, then repoint+rebuild. Keep the v2 **submit == complete** model (ADR-0032) — no `SUBMITTED_FOR_REVIEW` reintroduction.
**App:** `CRM-APP-MONOREPO-PROD/crm-mobile-native` v1.0.56 (RN 0.84, axios, op-sqlite/SQLCipher, socket.io, FCM) — **separate repo**.

## Live-verified state (probed 2026-06-17)
- v2 is live and serving `/api/v2/*` (`/api/v2/health`→200, `/api/v2/time` OK). **`/api/mobile/*`→404.** v1 backend wiped from the box.
- **The app is 100% disconnected from prod**, for two independent reasons:
  1. **TLS cert-pin mismatch (HARD).** App pins leaf SPKI `+D94EBRU5pr3Lcn2SvqWT8E+MSR6oDpQx952sp+iH2M=` + LE-**R13** intermediate `AlSQhgtJirc8ahLyekmtX+Iw+v46yPYRLJt9Cq1GlB0=`. The **live leaf SPKI is `V329rvVf6FFkAnHhuxgqMXVCR9puyLSJbeXYMGVllIc=`**, issuer Let's Encrypt **YR2**. Both pins stale → no TLS handshake.
  2. **Base URL path.** App targets `…/api/mobile`; v2 serves `/api/v2`.
- **Down-sync (ADR-0035 delta arrays + execution fields — the "FE→BE→DB→mobile" redesign) is already built and v1-shape-compatible.** `GET /api/v2/sync/download` + `SyncDownloadService` — **GREEN, no work.**
- **DB: no blockers.** `case_tasks` (=v1 `verification_tasks`), `case_attachments`, `notification_tokens` present; device-relevant statuses preserved; no new NOT-NULL on the device write path. Renames are backend-internal (sync DTO re-labels to v1 wire names).

## Parity gap — definitive (read against the live v2 router)
`GET /api/v2/sync/download`, `auth/{login,refresh,logout,me}`, `verification-tasks/{start,verification/:formType,attachments,complete,revoke,priority}`, `location/capture`, `time`, `auth/notifications/register`, `users/me/photo`, `notifications` (list/unread-count) **all EXIST and match**. The gaps the app actively uses:

### (A) ABSENT endpoints the app actively calls — the build list
| # | Mobile method+path | v2 build target | Phase |
|---|---|---|---|
| 1 | POST /auth/version-check | min-version gate, v1 `{forceUpdate,updateRequired,downloadUrl,…}` shape | 1D |
| 2 | GET /verification-tasks/:id | scope-guarded read-one | 1C |
| 3 | GET /forms/:formType/template | 9 FIELD_VISIT form templates | 1C |
| 4 | POST /verification-tasks/:id/auto-save | draft store | 1C |
| 5 | GET /verification-tasks/:id/auto-save/:formType | draft fetch | 1C |
| 6 | GET /verification-tasks/:id/attachments | list device photos | 1C |
| 7 | GET /reference/verification-type-outcomes | project `verification_units.result_set` → v1 shape | 1B |
| 8 | GET /reference/revoke-reasons | new `revoke_reasons` table | 1B |
| 9 | POST /consents/accept | DPDP record | 1E |
| 10–19 | DELETE /notifications, DELETE /:id, GET /trash, POST /:id/restore, POST /restore, GET/PUT /preferences, POST /mute, GET /mutes, DELETE /mute/task/:id | notifications CRUD | 1A |
| 20 | POST /telemetry/mobile/ingest | store-or-drop | 1E |

### (B) Method drift (path exists, method differs)
- `PUT /notifications/:id/read` → v2 is **POST**. Fix: **add PUT alias** server-side (zero mobile change).
- `PUT /notifications/mark-all-read` → v2 is **POST**. Fix: **add PUT alias**.

### (C) Body-shape incompatibility
- `POST /auth/notifications/register`: v2 `RegisterPushTokenSchema` requires `platform ∈ {IOS,ANDROID,WEB}` (uppercase). If the app sends lowercase → 400. Fix: case-insensitive normalize (Phase 1F). (`pushToken`/`deviceId` already match; `enabled` is ignored harmlessly.)

### (D) Missing socket event
- `auth:session_revoked` is **never emitted** by v2 (emits `notification`, `location:request`). The app's real-time forced-logout never fires (degrades to next-401). Fix: emit on logout/refresh-revoke (Phase 1G).

> `unused` ABSENT paths (`/auth/config`, `/verification-tasks/:id/forms`, `/verification-images`, `/cases/batch/attachments`, `/sync/upload`, `/sync/status`, `/location/trail`) — nothing to build.

### Build status (2026-06-18) — Phase 1 backend parity COMPLETE
All endpoints with an **active device caller** are built, tested (green), migrated to dev, and in OpenAPI:
- **1A** notifications CRUD (trash/restore/clear/delete + mute/mutes/unmute + preferences + PUT aliases) · **1B** `/reference/{verification-type-outcomes,revoke-reasons}` (v1 data ported, keyed to v2 unit codes) · **1D** `POST /auth/version-check` (`mobile_app_releases` policy) · **1E** `/consents/accept` + `/telemetry/mobile/ingest` · **1F** push-register lowercase-platform · **1G** socket `auth:session_revoked` on logout/revoke · **1C** `GET /verification-tasks/:id/attachments` (office ref docs, ownership-bound) + `GET /forms/:formType/template` (null → device uses bundled template).
- **Migrations added:** 0068 (notif CRUD) · 0069 (reference feeds) · 0070 (consents) · 0071 (app releases).
- **Deferred — no active device caller found** (endpoint constants exist in the app but are unwired; absence can't break the app, so not a parity gap): `GET /verification-tasks/:id` (device works off `/sync/download` + local cache) and `POST/GET /verification-tasks/:id/auto-save` (drafts are local-only in the device's `form_submissions`). Build on request if a caller is confirmed during Phase 2 contract-diff.

## Mobile-side change surface (separate repo — Phase 2)
- **Base URL:** `src/config/index.ts:82,86,90` `/api/mobile`→`/api/v2` (3 constants; `wsUrl` unchanged). All `endpoints.ts` paths are relative → the constant swap repoints all REST traffic.
- **TLS pins (4 values):** Android `network_security_config.xml:80,82` + iOS `Info.plist:69,73` → current leaf `V329…` + current intermediate; **add ISRG Root X1 backup pin** (durable across LE leaf rotation); bump `expiration`. Gate `verify:ssl-pins-live` currently FAILS (good); Android Release CI does **not** run it and **never checks iOS** — wire both.
- **Durable pinning:** pin ISRG Root X1 (`C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=`, valid →2035) and/or server-side `certbot --reuse-key` so ~60–90-day LE renewals don't re-brick the field APK.
- **No change:** deep-link/host allowlist (`fcm.schema.ts`), asset-origin (`resolveAssetUrl.ts`) — same host.
- **Contract-diff** the Zod schemas (`auth`, `sync`, version-check, attachment-upload, notifications, reference) against live v2 before ship.

## Release (Phase 3)
Bump `package.json` version → tag `v1.0.x` → Android Release CI builds universal APK + AAB (`versionCode=epoch`) → GitHub Release. Sideloaded field app → distribute APK to a **pilot agent first**. Requires explicit OK before tag/release/cert change.

## Guardrails
v2 stays submit==complete (no SFR) · all v2 additions additive-only (ADR-0011) · both web + mobile contract tests must stay green · no push/deploy/tag/release/live-cert change without explicit owner OK.
