# ADR-0027 — Real-time transport, in-app notifications & FCM push

- **Status**: ACCEPTED (2026-06-12)
- **Context**: OPERATIONS build. v2 has **zero** real-time infra today — no websocket
  server, no FCM, no `notifications` table (confirmed in the Field Monitoring baseline
  audit, `ADR-0026`). The Field Monitoring console live-updates via a 30s poll, and the
  device location-capture contract (`POST /api/v2/location/capture`) is built but has no
  admin "request-location" trigger because there is no push channel. `ADR-0026` explicitly
  deferred the request-location ping, live updates and websockets to "the FCM/WS layer" —
  this is that layer. `MOBILE_API_COMPATIBILITY_MATRIX.md` already reserves
  `GET /api/v2/notifications` (+ read/mark-all) and `POST /api/v2/auth/notifications/register`.
  **This is net-new additive infra — it does NOT reopen any frozen decision** (Case→Task→VU,
  stack, repo pattern, `/api/v2`, mobile-compat, Valkey-as-Redis all hold; real-time + Valkey
  were always in the stack freeze, see MASTER_MEMORY §3).

## Decision

### 1. Transport = socket.io + Valkey adapter (config-gated seam)

The unchanged mobile app is a **first-class consumer** (`ADR-0012`) and its real-time
contract is **LOCKED**: it connects with a **socket.io client**, joins the `user:<id>` room,
and listens for `location:request`. Reproducing that byte-compatibly forces **socket.io** on
the server — native `ws` and SSE are **rejected** because they are not socket.io-protocol
compatible (they would break the device) and SSE cannot carry the bidirectional device
delivery the contract needs.

- The socket.io server attaches to the same Node `http.Server` as Express (`main.ts`
  refactored to create the server explicitly and `listen` on it).
- **Multi-instance pub/sub** uses `@socket.io/redis-adapter` over **Valkey** (Redis-compatible,
  the frozen choice). It is wired through a **config-gated seam** (`platform/realtime/`,
  mirroring `platform/storage` and `platform/geocode`): when `REDIS_CACHE_URL` is set the
  Valkey adapter engages (prod / multi-instance); when it is absent socket.io uses its
  in-memory adapter (dev / browser-verify / tests work with no Valkey running). Adding the
  adapter is **never** a hard dependency on Valkey being up.
- **Handshake auth** reuses the HTTP seam: the access token arrives in
  `socket.handshake.auth.token`, is verified with `verifyAccessToken` (`platform/jwt`), and
  the role is resolved to `grantsAll`/`permissions` via the same `getRoleAttributes` used by
  `enrichAuth`. An invalid/expired/missing token rejects the connection (no anonymous sockets).
- **Scope-correct rooms** (no event reaches a user who could not read it over HTTP):
  - `user:<id>` — every authenticated socket auto-joins its own user room. Per-user delivery
    (notifications, the device `location:request`).
  - `perm:field_monitoring` — a socket joins **only** if its role grants `page.field_monitoring`
    (`grantsAll` or the permission code). Carries `field-monitoring:location-updated` so the
    supervisor console repaints live. This mirrors the existing server-side scope seam — the
    room membership IS the authorization, decided at join time, never trusted from the client.

### 2. In-app notification model = one append-only table + the `/api/v2/notifications` contract

- Migration **0045** adds `notifications` (append-only): `id`, `user_id`, `type`, `title`,
  `body`, `payload` (jsonb), `action_type`, `read_at`, `created_at`. No update except setting
  `read_at` (mark-read); rows are never edited or hard-deleted by the app (retention is a later
  job, mirroring v1's purge function).
- Endpoints (own-user scoped — a user only ever sees their own feed; enforced by
  `WHERE user_id = actor.userId`, no cross-user read path exists):
  - `GET /api/v2/notifications` — paginated envelope (the pagination freeze), newest first,
    optional `unreadOnly`.
  - `GET /api/v2/notifications/unread-count` — `{ count }` for the bell badge.
  - `POST /api/v2/notifications/:id/read` — idempotent mark-read (own row only → 404 otherwise).
  - `POST /api/v2/notifications/mark-all-read`.
  - These match the shapes the mobile matrix reserved, so the eventual mobile rebase consumes
    the same contract (web now, mobile later — one `/api/v2` surface).
- A new `notification.view` permission is **not** required — every authenticated user reads
  their own feed (like profile); no permission gate, scope is identity.

### 3. Notification producers (in-app row + live socket, one path)

A single `notify(userId, payload)` service: INSERT the row, then `emit` to `user:<id>`. The
socket leg is best-effort (a disconnected user still has the durable row + badge on next load).
Phase-1 producers wired end-to-end:
- **Case-task assigned → notify the assignee** (`type: CASE_TASK_ASSIGNED`, `action_type:
  OPEN_TASK`).
- **Task completed / submitted-for-review → notify** the relevant supervisor (`type:
  TASK_COMPLETED` / `TASK_SUBMITTED_FOR_REVIEW`).
- More producers are additive later; the engine is built once.

### 4. FCM push to the unchanged device = `firebase-admin`, byte-compatible, forward-prep (Phase 2)

- `firebase-admin` initialized through a config-gated seam (`platform/push/`, same pattern):
  active only when a **`caseflow-mobile` service-account** is provisioned (gitignored
  `.env`/secret, never committed — handled like `GOOGLE_GEOCODING_API_KEY`); unconfigured = a
  disabled pusher that no-ops (silent, the correct failure mode per the v1 outage post-mortems).
  The service account **MUST** be from the same Firebase project as the device's bundled
  `google-services.json` (`caseflow-mobile`, project_number `965937232232`) or every send
  returns `INVALID_ARGUMENT` (proven 3× in v1).
- `POST /api/v2/auth/notifications/register` — token registration (`{ pushToken, platform,
  deviceId }`; platform UPPERCASE-only per the v1 CHECK).
- The silent location ping reproduces the **LOCKED** data-message **byte-for-byte**: data
  `{ type:'LOCATION_REQUEST', requestId, requestedBy, requestedAt }`, `android.priority:'high'`,
  **no** `notification` block. Delivered over **both** FCM and the `user:<id>` socket
  (`location:request`), idempotent via `requestId` (= the device's `Idempotency-Key`/`operation_id`).
- First consumer (closes the `ADR-0026` deferred loop): Field Monitoring **"Request location"**
  → FCM + socket → device → `/location/capture` → `field-monitoring:location-updated` socket →
  console roster repaints → the 30s poll is retired.
- An FCM health probe (`fcm_initialized`, `active_push_tokens`, recent failures) surfaces the
  silent-failure class the v1 outages hid.

## New dependencies (registered in `ALLOWED_DEPENDENCIES.md`)

| Package | Phase | Purpose |
|---|---|---|
| `socket.io` | 1 | the LOCKED real-time transport (mobile is a socket.io consumer) |
| `@socket.io/redis-adapter` | 1 | multi-instance pub/sub over Valkey (config-gated) |
| `ioredis` | 1 | Valkey/Redis client for the adapter (also the future BullMQ client) |
| `firebase-admin` | 2 | FCM push to the unchanged device |

## Slicing

- **Phase 1** (no external creds, fully browser-verifiable): deps + migration 0045 + socket.io
  server/seam + notifications module/SDK + producers + FE bell/badge/toast/live + FM live roster.
- **Phase 2** (needs the `caseflow-mobile` service-account JSON + a device): `firebase-admin`
  seam + token register + byte-compatible silent ping + "Request location" button + health probe.

## Consequences

- Web gets a live notification bell + live Field Monitoring immediately, browser-verifiable
  with no external creds.
- The device's real-time + push contract is honored byte-for-byte, so the eventual
  `crm-mobile-native` rebase is a client base-URL change, not a backend rebuild.
- Single-instance dev needs no Valkey; prod HA gets multi-instance fan-out for free via the
  adapter seam.
- **DON'T-REGRESS**:
  - Socket rooms ARE the authorization — `perm:field_monitoring` membership is decided at
    handshake from resolved role attributes, never from a client-supplied flag.
  - The `LOCATION_REQUEST` data-message shape + `location:request` event name + `user:<id>`
    room are a **device contract** — changing them breaks the unchanged app.
  - The FCM service account must be from `caseflow-mobile`; never commit it.
  - Notifications are own-user scoped (identity, not a permission) and append-only (only
    `read_at` mutates).
  - The realtime/push seams are config-gated: missing `REDIS_CACHE_URL` → in-memory adapter;
    missing service-account → disabled pusher. Neither is a hard runtime dependency.
