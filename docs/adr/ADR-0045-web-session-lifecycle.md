# ADR-0045: Web session lifecycle — idle auto-logout + 12h absolute cap + FIELD_AGENT carve-out

- **Status:** Accepted
- **Date:** 2026-06-18
- **Reference spec:** [docs/specs/2026-06-18-idle-logout-design.md](../specs/2026-06-18-idle-logout-design.md) (design) · [docs/plans/2026-06-18-idle-logout-plan.md](../plans/2026-06-18-idle-logout-plan.md) (implementation plan).
- **Replicates (v1):** the web `sessionManager` + `SessionTimeoutModal` warn-then-logout, rebuilt the v2 way.
- **Relates:** ADR-0014 (auth & session management), ADR-0019 (OCC), ADR-0022 (role attributes), ADR-0027 (realtime + FCM push-revoke), ADR-0042 (dependency stack freeze), ADR-0043 (server-driven login gate — the pattern this follows).

## Context

The v2 web app (`apps/web`) had **no idle/inactivity timeout**. A DESK/office user who walks away leaves an authenticated session open indefinitely — unacceptable for a verification CRM handling PII. The v1 web app had a warn-then-logout idle manager (warn at 9 min, logout at 10); v2 must replicate that, plus add industry-grade hardening, while honouring the standing constraints: **server-driven where it matters** (mirror `mustChangePassword`/`mustAcceptPolicies`), per-role config (precedent: `roles.password_expiry_days`), **no new tracked dependencies** (ADR-0042 freeze), and **never auto-log-out field agents** — they live on the mobile app and may legitimately step away during long verifications.

## Decision

**Model C (hybrid):** FE-driven idle with a server-decided policy, plus a *truly* server-enforced absolute cap.

1. **Per-role policy columns** (`roles.idle_logout_minutes`, `roles.max_session_minutes`, both `NULL`-able), surfaced on `AuthUser` (so both `/auth/login` and `/auth/me` carry them) and editable through the existing OCC role-config admin path. Seeded:

   | Role | `idle_logout_minutes` | `max_session_minutes` |
   | --- | --- | --- |
   | SUPER_ADMIN, MANAGER, TEAM_LEADER, BACKEND_USER, KYC_VERIFIER | 10 (warn at 9) | 720 (12h) |
   | FIELD_AGENT | NULL (exempt) | NULL (no cap) |

2. **Idle logout is FE-driven** (a native `sessionManager` port — no new deps): the timer thresholds come from `idleLogoutMinutes`; a `null` window means the manager never starts (**the role carve-out is server-decided**, not a client `if`). Cross-tab via `localStorage`; the timer pauses while a user mutation/upload is in flight; adaptive 1s/30s polling; resume-from-suspend re-evaluation. A `role="alertdialog"` modal warns 60s before logout.

3. **The 12h absolute cap is server-enforced** via `auth_refresh_tokens.absolute_expires_at`: stamped at login from `max_session_minutes`, **never extended by rotation**. `issueTokens` caps `expires_at = least(refreshTTL, absolute_expires_at)`, so the *existing* refresh check (`revoked_at IS NULL AND expires_at > now()`) rejects refresh once the cap passes. FIELD_AGENT's `absolute_expires_at` stays `NULL` ⇒ uncapped.

4. **Idle/absolute timeout revokes only THIS browser session** (`POST /auth/sessions/:jti/revoke`), not logout-everywhere — a web tab idling out must not kill the user's mobile or other-device sessions. Manual logout and change-password keep their existing logout-everywhere semantics.

5. **Web sessions get a synthesized stable per-browser `deviceId`** (`acs.deviceId`, sent at login). Web refresh tokens previously had `device_id = NULL`, so the existing device-targeted `auth:session_revoked` realtime emit (ADR-0027) skipped them; with a deviceId, an admin force-logout (or change-password) drops the user's web tabs live, and the web listener filters on its own deviceId.

## Alternatives considered

- **A — FE-only (v1 parity):** no real server enforcement of the cap the business asked for. Rejected.
- **B — server-tracked idle** (reject refresh when idle beyond a threshold): needs activity pings, the access token stays valid until `exp` regardless, and it diverges from the proven v1 pattern for no idle-security gain over A+revoke. Rejected.

## Consequences

- A FIELD_AGENT logging into the web is never idle-logged-out (server emits `null`) — the carve-out is enforced server-side, not just in the client. This **is** the field-session policy for the web; the mobile lifecycle (long-lived refresh, FCM push-revoke, device-locked) is unchanged.
- No client-side telemetry logger was added: `@crm2/logger` is a server (stdout) logger and `apps/web` has no client logging mechanism (console is banned). Idle timeouts are observable server-side via the `revokeSession` request log. Revisit if a browser-safe logger lands.
- No new dependencies: the manager and modal are native (the frozen stack and `react-idle-timer`-style deps were avoided).
- Adding `idle_logout_minutes` / `max_session_minutes` follows the established per-role-config precedent (`password_expiry_days`); it is not a new pattern.
