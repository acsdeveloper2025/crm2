# CRM2 — Mobile API Compatibility Matrix & Connection Plan (FROZEN)
**Status:** PERMANENT governance + the controlled connection plan. Produce/consult this **before building Cases, Tasks, Workspace** so compatibility is designed in, not discovered late. ADRs: `docs/adr/ADR-0011` (versioning), `docs/adr/ADR-0012` (mobile). Policy: `API_VERSIONING_POLICY.md`.

## Governing rule (frozen)
> The existing mobile application is a **first-class API consumer**.
> All API changes must maintain compatibility with: **(1) CRM2 Web** and **(2) the existing Mobile application**.
> **No API change may be merged unless contract tests pass for BOTH consumers.**
> **OpenAPI remains the source of truth. The SDK remains the only supported integration layer.**

## Contract model (decided 2026-06-04)
- **Web and Mobile both consume the single internal contract `/api/v2/*`** via the OpenAPI-generated SDK (`@crm2/sdk`, major matches API version).
- **No separate `/api/mobile` or `/api/external/v1` surface** (premature complexity). External (bank/client) portals get `/api/external/v1` only when a real external party exists.
- The mobile app is **already built**; we **connect** it: re-base its client from `/api/mobile/*` to `/api/v2/*` (same shapes) and adopt the generated SDK incrementally. v2 must implement these endpoints with compatible request/response shapes.
- **Database version ≠ API version** — `/api/v2/*` stays stable while the schema evolves behind it.

## Current mobile contract (verified against `crm-mobile-native`, RN 0.84, axios)
Base today: `https://crm.allcheckservices.com/api/mobile`. Headers: `Authorization: Bearer`, `X-Platform`, `X-App-Version`, `traceparent` (W3C), `Idempotency-Key` (UUID, every write). Centralized client `src/api/apiClient.ts` + `src/api/endpoints.ts`. Offline: SQLCipher op-sqlite + `sync_queue` (10-retry→DLQ), conflict resolver.

## Connection plan — current mobile call → CRM2 `/api/v2` target
| Capability | Current mobile (`/api/mobile/…`) + shape | Target `/api/v2/…` (connection action) |
|---|---|---|
| **Auth login** | `POST /auth/login {username,password,deviceId,deviceInfo}` → `{user, tokens{accessToken,refreshToken,expiresIn}}`; `Idempotency-Key` | `POST /api/v2/auth/login` — identical JWT-pair shape (stateless JWT + refresh denylist) |
| **Token refresh / logout** | `POST /auth/refresh {refreshToken}` (idempotent), `POST /auth/logout` | `POST /api/v2/auth/refresh`, `/api/v2/auth/logout` — keep idempotent rotation |
| **Version/config gate** | `POST /auth/version-check`, `POST /auth/config` (pinning/limits/flags) | `POST /api/v2/auth/version-check`, `/api/v2/auth/config` |
| **Push register** | `POST /auth/notifications/register` | `POST /api/v2/auth/notifications/register` |
| **Assignment down-sync** | `GET /sync/download?lastSyncTimestamp&limit&offset` → `{cases[], revokedAssignmentIds, deletedTaskIds, deletedCaseIds, conflicts[], syncTimestamp, hasMore}` | `GET /api/v2/sync/download` — v2 maps Case→Task→Verification-Unit into the **same `MobileCaseResponse`** shape; preserve watermark+delta+pagination |
| **Form template** | `GET /forms/{formType}/template` (9 field types) | `GET /api/v2/forms/{formType}/template` — codes map to FIELD_VISIT units; additive only |
| **Verification submit** | `POST /verification-tasks/{id}/verification/{formType}` `{formData,attachmentIds[],geoLocation,photos[],metadata}`; `PUT/GET …/auto-save` | `POST /api/v2/verification-tasks/{id}/verification/{formType}` — superset payload preserved; ≥5-photo+GPS gate (count STORED) |
| **Photo / attachment upload** | `POST /verification-tasks/{id}/attachments` multipart `files,photoType,operationId,clientSha256?,geoLocation(JSON)`; EXIF-stripped; backend watermarks | `POST /api/v2/verification-tasks/{id}/attachments` — object store (immutable/versioned/sha256/signed-URL, never local volume); standalone upload links by `taskId` |
| **Task status** | `POST …/start`,`…/complete`,`…/revoke{reason}`,`PUT …/priority`; idempotent (409=already) | `POST /api/v2/verification-tasks/{id}/{start\|complete\|revoke}`, `PUT …/priority` — status-transition trigger; 409-as-success preserved |
| **Task / attachments fetch** | `GET /verification-tasks/{id}`, `…/attachments`, `…/verification-images` | `GET /api/v2/verification-tasks/{id}` (+ `/attachments`, `/verification-images`) — signed URLs |
| **Profile / identity** | `POST /users/me/photo`; `UserProfile{id,name,username,email,role,employeeId,designation,assignedPincodes[],assignedAreas[]}` | `POST /api/v2/users/me/photo`; same `UserProfile` shape (territory drives scope) |
| **Reference / consents** | `GET /reference/verification-type-outcomes`, `/reference/revoke-reasons`; `POST /consents/accept` (DPDP §5) | `GET /api/v2/reference/*`; `POST /api/v2/consents/accept` (ties to retention) |
| **Policy acceptance gate** (ADR-0042) | v1 had a **FE-only** Field-Exec Acknowledgement guard (no server contract) | `POST /api/v2/auth/accept-policies {policyIds[],source}` (authenticated, no permission, idempotent) **+** `mustAcceptPolicies: boolean` / `pendingPolicies: PendingPolicy[]` on the **login response** — a **locked mobile contract**: the device blocks into its accept screen when `mustAcceptPolicies`, posts `accept-policies` with **`source='MOBILE'`** (the value reserved for the device), and `refresh` is rejected until accepted. Lands when the mobile client rebases `/api/mobile` → `/api/v2`. |
| **Notifications** | `GET /notifications`, `POST /{id}/read`, `/mark-all-read`, `PUT /preferences`, `POST /mute` | `GET /api/v2/notifications` (+ read/mark-all/preferences/mute) |
| **Location capture** | `POST /location/capture {lat,lng,accuracy,timestamp,source,caseId?,taskId?}` (non-fatal) | `POST /api/v2/location/capture` |
| **Telemetry / health** | `POST /telemetry/mobile/ingest`; `GET /health` | `POST /api/v2/telemetry/mobile/ingest`; `GET /api/v2/health` |

**Net connection step:** rebase the mobile client base URL `/api/mobile` → `/api/v2`, keep shapes/headers/idempotency identical, then migrate endpoint definitions onto the generated `@crm2/sdk`. v2 implements each endpoint above with a compatible contract.

## Compatibility testing (CI — both consumers)
- **Web contract tests** + **Mobile contract tests** run on every API change; merge blocked unless both pass (current Web still works AND current Mobile still works). Runs with the OpenAPI/SDK drift gate + synthetic mobile flows (`MONITORING_STRATEGY.md`). Wired in `.github/workflows/ci.yml` (activates with the SDK phase).

## Don't-regress (mobile)
Never remove/rename a field mobile reads · never change a status code it branches on · keep `Idempotency-Key` dedupe (method+body+key) · keep multipart attachment fields · keep the JWT-pair shape · keep `/sync/download` watermark+delta semantics · standalone photo upload links by `taskId` · keep `409`-as-success on start/complete/revoke · keep `mustAcceptPolicies`/`pendingPolicies` on the login response and the `POST /auth/accept-policies` contract (ADR-0042) — both are a **locked mobile contract**; `source='MOBILE'` is reserved for the device.

Cross-ref: `API_VERSIONING_POLICY.md`, `DOCUMENTATION_AS_CODE.md`, `BUSINESS_RULES.md`, `SECURITY_STANDARDS.md`, `docs/adr/ADR-0011`, `docs/adr/ADR-0012`, `PROJECT_INDEX.md`.

## Data scope on the shared /api/v2 contract (ADR-0022, 2026-06-11)
Every operational read the device will consume (`/api/v2/cases` list/detail; `assignable-users`;
future task/sync reads) is **centrally scoped server-side** through the ONE seam
(`apps/api/src/platform/scope` → `resolveScope` + `composeScopePredicate`): hierarchy mode +
role-wired dimensions (territory/portfolio/state/city/verification-type), fail-closed, out-of-scope
detail = 404. Because web and mobile consume the SAME `/api/v2` endpoints (no `/api/mobile`
surface), a device can never fetch out-of-scope cases — `UserProfile.assignedPincodes/Areas`
becomes display data backed by `GET /users/:id/scope-assignments`; enforcement never depends on the
client. Any NEW `/api/v2` list/read added for mobile (e.g. `/sync/download`) MUST compose the scope
seam before shipping — that is the mobile-scope contract test to add when the sync endpoint lands.
