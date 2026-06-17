# ADR-0028 — Server-authoritative time & client clock offset

- **Status**: ACCEPTED (2026-06-12)
- **Context**: Several server decisions and cross-surface orderings trust a **client-supplied
  timestamp**, yet the device/browser clock is user-settable and drifts. The worst case is the
  device fix `timestamp` on `POST /api/v2/location/capture`: the IST 8–22 **shift-gate**
  (`OUTSIDE_SHIFT_WINDOW`, the consent promise from `ADR-0026`) is evaluated against it, and it also
  feeds sync watermarks (`lastSyncTimestamp`) and `Idempotency-Key` correlation. A wrong device clock
  can bypass/trip the shift-gate and make locations/notifications appear out of order versus the
  server's `now()` / `created_at`. Server-stamped values are already authoritative
  (notification `createdAt`, request-location `requestedAt`, all `created_at`/`updated_at` defaults =
  Postgres `now()`); the gap is **client-originated timestamps + client-side time display/ordering**.
  **This is net-new additive infra — it does NOT reopen any frozen decision.** The LOCKED mobile
  capture envelope and the `403 OUTSIDE_SHIFT_WINDOW` code are unchanged.

## Decision

### 1. The backend is the single time authority
The API host is NTP-synced (chrony/ntpd) and Postgres `now()` is the matching reference. No client
clock is trusted for a gated or ordered decision. **Prod check:** `timedatectl` / `chronyc tracking`
must show the host clock synchronized (document in the deploy runbook alongside the geocode/FCM keys).

### 2. `GET /api/v2/time` — the clock reference
New unauthenticated, side-effect-free route (`apps/api/src/modules/time/routes.ts`, mounted
beside `/api/v2/health`). Response (`@crm2/sdk` `ServerTime`):
```json
{ "serverTime": "2026-06-12T07:49:16.482Z", "epochMs": 1781248156482 }
```
Express also stamps an accurate `Date` response header — a header-only fallback for the same offset.
Unauthenticated so a client too early to hold a token (app boot) can still sync; it leaks nothing
but the wall clock.

### 3. Client clock offset (½-RTT, NTP-style)
`@crm2/sdk` `time.ts` ships the pure contract + math (so web and mobile compute it identically):
- `computeClockOffsetMs(t0, serverEpochMs, t1)` — `t0`/`t1` = local clock at send/receive around the
  server reading; assumes symmetric latency, so `offset = serverEpoch + RTT/2 − t1`.
- `serverNowMs(offsetMs, nowMs?)` — server-corrected epoch ms.
Clients persist the offset and stamp outgoing time and time-sensitive display with the corrected time,
never the raw device clock.

### 4. Skew-defense on the LOCKED capture endpoint (backstop)
`location/service.ts` rejects a **future-skewed** fix only: `timestamp − serverReceipt >
MAX_CLIENT_CLOCK_AHEAD_MS` (120 s) → `400 CLOCK_SKEW_AHEAD`. A fix is **never** captured ahead of the
server's own clock, so a future timestamp means a fast/wrong device clock that could fool the
shift-gate. **PAST timestamps are never rejected** — the offline queue legitimately replays fixes
hours/days later; that contract (and `OUTSIDE_SHIFT_WINDOW`) is untouched. A device that stamps with
`serverNow()` (below) never trips this.

### 5. Web (`apps/web`)
`lib/serverClock.ts` syncs the offset once at boot (`App.tsx` effect, `GET /api/v2/time`) and exposes
`serverNow(): Date`. Time-sensitive **client-originated** decisions use it — e.g. `effectiveStatus`
(ACTIVE vs SCHEDULED) now compares against `serverNow()` so a row's SCHEDULED→ACTIVE flip agrees with
the backend. Server-stamped display values (created_at, etc.) are already authoritative and unchanged.
(Optional later: resync on `window` focus / a slow interval — boot-only is sufficient for typical
NTP-ok browsers.)

### 6. Mobile (`crm-mobile-native`, separate repo) — implementation spec
Additive only; does **not** change the LOCKED queue/watermark semantics.
1. **Offset client** mirroring `@crm2/sdk` `time.ts`: on app start and before each sync/capture batch,
   `t0 = Date.now()`; call `GET /api/v2/time` (or read the `Date` response header of any v2 call);
   `t1 = Date.now()`; `offset = computeClockOffsetMs(t0, epochMs, t1)`. Persist `offset` (the last
   good value survives offline). Re-sync opportunistically whenever a v2 response is seen.
2. **`serverNow()`** = `new Date(Date.now() + offset)`. Use it for: the capture `timestamp` (so the
   shift-gate reads server-corrected time and `CLOCK_SKEW_AHEAD` never fires), `lastSyncTimestamp`
   watermarks, and any displayed/ordered time. Keep stamping at capture time (offline correctness):
   a fix queued at server-09:00 keeps 09:00 even if uploaded at 11:00 — only the *clock source* is
   corrected, not the moment.
3. **Envelope unchanged**: same fields, same `Idempotency-Key`, same `OUTSIDE_SHIFT_WINDOW` handling.
   Newly-possible response `400 CLOCK_SKEW_AHEAD` (only if a device clock is >120 s fast *and* the
   offset wasn't applied) → treat as non-retryable, re-sync the offset, re-stamp, resend.
4. **Rebase coupling**: lands with the deferred `/api/mobile → /api/v2` rebase (DEFERRED_ITEMS §22);
   the offset client is designed to drop in independently of that rebase.

## Consequences
- Web + backend agree on "now"; the shift-gate and ordering become clock-tamper-resistant once mobile
  stamps with `serverNow()`. No frozen contract changed; one additive endpoint, one additive 4xx code
  (future-skew only), one additive SDK module. No new dependency (pure `Date` + Express + zod).
- Until the mobile rebase, `/api/v2/location/capture` still has no live producer — the skew-defense is
  forward-prep covered by tests.
