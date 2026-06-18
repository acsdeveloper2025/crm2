# Idle / inactivity auto-logout (web) — design

- **Date:** 2026-06-18
- **Status:** Approved (brainstorm) → ready for plan
- **Branch:** `worktree-feat+idle-logout`
- **ADR:** ADR-0045 (new) — "Web session lifecycle: idle auto-logout + absolute cap + FIELD_AGENT carve-out"
- **Supersedes/relates:** ADR-0014 (auth & session mgmt), ADR-0019 (OCC), ADR-0027 (realtime + FCM push-revoke), ADR-0043 (login policy acceptance — the server-driven-gate precedent)

## 1. Problem

The v2 web app (`apps/web`) has **no idle/inactivity timeout**. A DESK/office user who walks away leaves an authenticated session open indefinitely. The v1 web app had a warn-then-logout idle manager (`CRM-FRONTEND/src/services/sessionManager.ts`); v2 must replicate that behavior the v2 way — **server-driven where it matters**, role-aware, standards-compliant — and add industry-grade hardening (absolute session cap, server-side enforcement, realtime revoke).

## 2. Scope

**Applies to (web, DESK roles):** `SUPER_ADMIN`, `MANAGER`, `TEAM_LEADER`, `BACKEND_USER`, `KYC_VERIFIER`.

**Exempt:** `FIELD_AGENT` — field-execution users live on the mobile app (`crm-mobile-native`); their session is governed by the mobile lifecycle (long-lived refresh tokens, FCM push-revoke per ADR-0027, device-locked sessions). Even when a FIELD_AGENT logs into the **web**, idle-logout MUST NOT engage (they may legitimately step away during long verifications). Enforced **server-side** by emitting `idleLogoutMinutes = null` for the role, so the FE never starts a timer, and by leaving their refresh token's absolute cap NULL.

There is **no pre-existing field-session policy ADR** in the repo; this carve-out is formalized in ADR-0045.

**Out of scope:** mobile app changes; server-side per-request idle tracking (model B below); a new admin UI screen if none exists to extend (backend/API config support is in scope regardless).

## 3. Locked decisions (owner, 2026-06-18)

| Decision | Choice |
| --- | --- |
| DESK idle thresholds | **warn 9 min → hard logout 10 min** (v1 parity); `idle_logout_minutes = 10` |
| Warn cushion | **60 s** (FE constant, derived as `logout − 60s`) |
| SUPER_ADMIN | **subject to idle-logout** (most-privileged = highest risk); `idle_logout_minutes = 10` |
| KYC_VERIFIER | **same as DESK** (9→10); no special activity signal |
| Absolute session cap | **12 h** (`max_session_minutes = 720`), per NIST 800-63B; truly server-enforced |
| FIELD_AGENT | **exempt** (`idle_logout_minutes = NULL`, `max_session_minutes = NULL`) |

**Role → policy matrix**

| Role | `idle_logout_minutes` | `max_session_minutes` |
| --- | --- | --- |
| SUPER_ADMIN, MANAGER, TEAM_LEADER, BACKEND_USER, KYC_VERIFIER | 10 | 720 |
| FIELD_AGENT | NULL | NULL |

## 4. Architecture — model C (hybrid)

Two enforcement layers:

- **Idle logout = FE-driven** (v1 pattern), with the **policy server-decided**. The FE timer thresholds come from `idleLogoutMinutes`; `null` ⇒ the manager never initializes (the role carve-out). On timeout the FE calls `POST /auth/logout`, which revokes the refresh token and emits realtime `auth:session_revoked` — that is the server-side teeth.
- **Absolute 12 h cap = truly server-enforced** via `auth_refresh_tokens.absolute_expires_at`: set at login, **never extended by rotation**. Refresh sets the new token's `expires_at = least(now()+refreshTTL, absolute_expires_at)`, so the **existing** validity check (`revoked_at IS NULL AND expires_at > now()`) rejects refresh once the cap passes — no new query path. FIELD_AGENT's `absolute_expires_at` stays NULL ⇒ never capped.

Rejected alternatives: **A** (FE-only, no real server enforcement of the cap the owner asked for); **B** (server-tracked per-request idle — heavy, needs activity pings, access token still valid until `exp`, and diverges from the proven v1 pattern).

## 5. Backend changes (`apps/api`, `db/v2`, `packages/sdk`)

### 5.1 Migration `0074_idle_logout_and_session_cap.sql`
- `ALTER TABLE roles ADD COLUMN idle_logout_minutes int NULL` + `CHECK (idle_logout_minutes IS NULL OR (idle_logout_minutes BETWEEN 1 AND 1440))`.
- `ALTER TABLE roles ADD COLUMN max_session_minutes int NULL` + `CHECK (max_session_minutes IS NULL OR (max_session_minutes BETWEEN 5 AND 10080))`.
- `ALTER TABLE auth_refresh_tokens ADD COLUMN absolute_expires_at timestamptz NULL`.
- Seed: `UPDATE roles SET idle_logout_minutes = 10, max_session_minutes = 720 WHERE code IN ('SUPER_ADMIN','MANAGER','TEAM_LEADER','BACKEND_USER','KYC_VERIFIER') AND idle_logout_minutes IS NULL;` — FIELD_AGENT untouched (NULL).
- Mirrors the `0048_role_password_expiry.sql` recipe (idempotent `IF NOT EXISTS`, range CHECK, conditional seed).

### 5.2 Role attribute loader
- `apps/api/src/platform/access/repository.ts` — add `idle_logout_minutes`, `max_session_minutes` to the `loadRoleAttributes()` SELECT and the `RoleAttributes` interface. The 5 s cache in `index.ts` carries them automatically.

### 5.3 Contract (`packages/sdk/src/auth.ts`)
- Extend `AuthUser` with `idleLogoutMinutes: number | null` and `maxSessionMinutes: number | null`. `/auth/me` returns `AuthUser`, and `login` returns `LoginResponse.user: AuthUser` — so **both** login and me carry the fields with one change. Surface them in `withResolvedPermissions()`.

### 5.4 Login
- `apps/api/src/modules/auth/service.ts login()` — when issuing the refresh token, set `absolute_expires_at = now() + (max_session_minutes * interval '1 minute')`, or NULL when the role's `max_session_minutes` is NULL. Thread it into the refresh-token insert in `repository.ts`.

### 5.5 Refresh (rotation)
- On rotation, read the parent token's `absolute_expires_at`, **copy it forward unchanged** to the new token, and set the new token's `expires_at = least(now() + refreshTTL, absolute_expires_at)` (plain `expires_at` when NULL). No change to the validity predicate; expiry naturally enforces the cap.

### 5.6 Logout / revoke — reuse unchanged
- `POST /auth/logout` already calls `revokeAllForUser()` + `emitSessionRevoked()` (→ `auth:session_revoked` to `user:<id>`). The admin `revokeSession` path also emits. No backend change needed for revoke.

### 5.7 Roles admin config
- Thread `idle_logout_minutes` + `max_session_minutes` through the existing OCC `updateConfig()` path (`roles` controller/service/repository), so SUPER_ADMIN can edit them with the standard `version` concurrency check (ADR-0019). FE admin field only if a roles-edit screen already exists to extend (verify in §9); otherwise API-level support is sufficient.

## 6. Frontend changes (`apps/web`) — native port, **no new deps**

### 6.1 `sessionManager` (v2 port)
- **Session sentinel:** access-token presence in `localStorage` (`acs.accessToken`); decode JWT `exp` as a sanity check so a tampered/expired token can't keep the manager alive.
- **Thresholds from server:** `idleLogoutMinutes` from the auth user; **`null` ⇒ never `init()`** (no listeners, no timer) — the role carve-out.
- **Warn cushion:** 60 s constant (`WARN_BEFORE_LOGOUT_SECONDS`); warn fires at `idleMs − 60s`.
- **Activity events** on `window`: `mousemove · mousedown · keydown · scroll · touchstart · click · visibilitychange` (throttled to 1/s).
- **Adaptive polling:** 1 s when visible (smooth countdown), 30 s when hidden; switch on `visibilitychange`.
- **Cross-tab sync** via `localStorage` `storage` events: `acs.lastActivity` (newest wins) and `acs.forceLogout` (broadcast logout to all tabs). Namespaced under `acs.`.
- **Pause on in-flight non-GET requests** (mutations/uploads) only — so TanStack background GET refetches can't defeat the timer. Requires an in-flight counter keyed by HTTP method on the SDK/client seam (verify in §9).
- **Resume-from-suspend:** on each tick compute idle from `Date.now()`; if the wall-clock jumped more than the poll interval since the last tick, re-evaluate immediately rather than waiting for the next tick.
- **Absolute cap (secondary FE timer):** anchor `acs.sessionStartedAt` written at login (preserved across reload, cleared on logout); when `Date.now() ≥ sessionStartedAt + maxSessionMinutes`, run the logout path with reason "session expired (max lifetime)". The authoritative enforcement remains server-side (§5.5); this is the proactive UX.
- **On timeout:** set `acs.forceLogout`; call `sdk.auth.logout()` (server revoke + realtime); clear tokens + `acs.sessionStartedAt` + `sessionStorage acs.activeScope` (the v1 P18.H03 race — wipe scope here, before redirect, not only in the AuthContext handler); redirect `/login?reason=<encoded>`.
- **Telemetry** via `@crm2/logger`: `idle_warning_shown`, `idle_extended`, `idle_timeout_triggered` (+ reason). No `console.*`.

### 6.2 `SessionTimeoutModal` (v2)
- `role="alertdialog"`, `aria-live="polite"` announcing "your session will end in N seconds".
- `useFocusTrap`; default focus and keyboard-dismiss target = **Stay Logged In** (never logout).
- Design-system tokens (DESIGN_AND_STACK_FREEZE / COLOR_SYSTEM_FREEZE); responsive at 320/768/1024/1440.
- **Stay Logged In** → `extendSession()` (pings `/auth/me`, resets timer). **Logout Now** → same logout path as natural timeout.

### 6.3 Wiring
- Mount the manager in `App.tsx`/`AuthContext` **behind the role switch**: `init()` only when `user.idleLogoutMinutes != null`; `destroy()` on logout / role change / unmount.

### 6.4 Realtime listener
- Subscribe to `auth:session_revoked` via the existing `onRealtime()` (`apps/web/src/lib/socket.ts`); on receipt for this session/device, run the logout path. Covers admin force-logout and cross-device/other-tab idle-out. (No listener exists today; the emit + client infra do.)

## 7. Data flows

- **Idle warn → logout:** activity resets `lastActivity` (throttled, mirrored to `localStorage`). Poll computes idle; at `idle ≥ warn` → modal + countdown; at `idle ≥ logout` → timeout path.
- **Cross-tab:** any tab's activity writes `acs.lastActivity`; other tabs adopt the newest. First tab to time out writes `acs.forceLogout`; peers drop immediately.
- **Absolute cap:** server caps the refresh token at login; refresh rejection forces re-auth at/after 12 h. FE proactively logs out at the same deadline.
- **Revoke:** admin/self logout → `auth:session_revoked` → all connected clients drop.

## 8. Testing

- **Unit (vitest, fake timers):** warn fires at cushion; logout fires at threshold; activity resets; cross-tab `storage` adoption + force-logout; pause on in-flight mutation; resume-from-suspend clock-jump; `idleLogoutMinutes = null` ⇒ no-op (no listeners/timer).
- **Integration (api, ephemeral PG :5433, `LC_ALL=C`):** FIELD_AGENT login → `idleLogoutMinutes`/`maxSessionMinutes` null + refresh token `absolute_expires_at` NULL; DESK login → values present + `absolute_expires_at` set ≈ now+720m; refresh carries `absolute_expires_at` forward and caps `expires_at`; refresh **after** the absolute deadline → rejected; logout emits `auth:session_revoked` (via `spyRealtime()`).
- **Playwright e2e @ 320/768/1024/1440:** DESK user sees warn at threshold; Stay Logged In resets; Logout Now logs out; **FIELD_AGENT on web sees no modal** even past the threshold.

## 9. Open items to verify during planning (don't invent)

1. **SDK in-flight seam** — confirm where `@crm2/sdk` `req()` lives and the cleanest place to add a per-method in-flight counter for "pause on non-GET" (so the FE has an `hasActiveMutations()` equivalent).
2. **`acs.activeScope`** — confirm v2 has the `sessionStorage acs.activeScope` scope-lock (it existed in v1); if so, wipe it on timeout (§6.1); if not, drop that step.
3. **Roles admin UI** — confirm whether `apps/web` has a roles-edit screen to extend with the two new fields; if not, ship API/config support only.
4. **ADR number** — confirm ADR-0045 is free at write time (ADR-0044 is the parallel `task-tat-priority`, currently uncommitted on `main`).
5. **`withResolvedPermissions`** — confirm it is the single function feeding both login `.user` and `/auth/me`, so the two new fields are added once.

## 10. Definition of done

- Migration `0074` adds both `roles` columns + `auth_refresh_tokens.absolute_expires_at` and seeds the matrix.
- `AuthUser` carries `idleLogoutMinutes` + `maxSessionMinutes`; login + `/auth/me` both return them; refresh enforces the absolute cap.
- FE `sessionManager` + `SessionTimeoutModal` (no new deps) wired behind the role switch; cross-tab sync, pause-on-mutation, adaptive polling, resume-from-suspend, realtime `auth:session_revoked` listener, telemetry.
- Tests: unit + integration (role exclusion + revocation + cap) + Playwright e2e all green.
- Full `pnpm verify` GREEN; live browser-verify GREEN (DESK warns→stay resets→times out→logs out; FIELD_AGENT no modal).
- ADR-0045 added + linked from `docs/adr/README.md` and `PROJECT_INDEX.md`.
- Memory updated; kickoff prompt removed.
