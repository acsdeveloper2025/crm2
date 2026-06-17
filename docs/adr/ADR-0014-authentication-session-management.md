# ADR-0014: Authentication & Session Management

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

User Management (migration `0007`) ships identity-only — users have a role and a
hierarchy but no credential. The system still authenticates via the dev `x-test-auth`
header seam. Real authentication is required before GA and must serve **both** the web
app and the existing `crm-mobile-native` app (a first-class `/api/v2` consumer, ADR-0012).

`MOBILE_API_COMPATIBILITY_MATRIX.md` already pins the contract the mobile app expects and
must not break:

- `POST /api/v2/auth/login {username,password,deviceId,deviceInfo}` → `{user, tokens:{accessToken,refreshToken,expiresIn}}`
- `POST /api/v2/auth/refresh {refreshToken}` (idempotent rotation), `POST /api/v2/auth/logout`
- `Authorization: Bearer <accessToken>` on every authenticated request
- Model: **stateless JWT access token + refresh-token denylist/rotation**

## Decision

We will implement JWT-pair authentication with rotating refresh tokens:

1. **Password hashing — Node built-in `crypto.scrypt`** (no new dependency). Stored as a
   self-describing string `scrypt$N$r$p$<saltB64>$<hashB64>`; verified with
   `crypto.timingSafeEqual`. Hashing/verification live in `platform/password.ts`.
2. **Tokens — `jose` (HS256)** signed with `JWT_SECRET` (already in `@crm2/config`).
   - **Access token: stateless JWT**, short TTL (`AUTH_ACCESS_TTL_S`, default 900s = 15 min),
     claims `{ sub: userId, role }`. Verified by signature + expiry only — no DB hit.
   - **Refresh token: opaque-by-use JWT**, long TTL (`AUTH_REFRESH_TTL_S`, default 30 days),
     claim `{ sub, jti }`. The `jti` is tracked in `auth_refresh_tokens` (hashed) so the
     server can **rotate** (issue new, revoke old) and **deny-list** (revoke on logout /
     password change). A refresh token is valid only if its row exists, is unexpired, and
     is not revoked.
3. **Endpoints** (`/api/v2/auth/*`, unversioned-path-free per ADR-0011): `POST /login`,
   `POST /refresh`, `POST /logout`, `GET /me`. Login/refresh are unauthenticated; logout/me
   require a valid access token.
4. **Middleware** — a real `authenticate` middleware verifies `Authorization: Bearer` into
   `req.auth = { userId, role }`. It runs **before** the dev `x-test-auth` seam, which stays
   only in non-production as a fallback for tests/local until the web login UI lands.
5. **Initial credentials** — admins set a user's password via `POST /api/v2/users/:id/password`
   (`user.manage`). Self-service reset flows are a later enhancement.
6. **Refresh rotation is idempotent-safe**: presenting a refresh token revokes its `jti` and
   issues a fresh pair; a revoked/rotated token is rejected (401 `INVALID_REFRESH`).

## Consequences

### Positive

- Mobile contract honored exactly (login/refresh/logout shapes, Bearer, JWT-pair + denylist).
- Access-token verification is stateless (no DB hit on the hot path); only refresh touches the DB.
- Zero new password dependency (scrypt is built in); `jose` is audited and native-dep-free.
- Rotation + denylist gives revocation (logout, password change, lost device) without sessions.

### Negative

- A revoked access token remains valid until it expires (≤15 min) — accepted trade-off of
  stateless access tokens; mitigated by the short TTL.
- `auth_refresh_tokens` grows; needs periodic pruning of expired rows (ops task, later).

## Alternatives Considered

- **Server-side sessions (cookie + session store)** — rejected: mobile expects a JWT-pair;
  a session store adds infra (Valkey) on the auth hot path. Stateless JWT matches the contract.
- **`argon2`/`bcrypt`** — stronger KDFs but native node-gyp dependencies; `crypto.scrypt`
  (memory-hard, built-in) is sufficient and dependency-free. Revisit via a superseding ADR if
  a threat model demands argon2id.
- **Hand-rolled HS256 sign/verify** — rejected: signing/verifying auth tokens by hand is
  exactly the security-critical reinvention to avoid; reuse `jose`.

## Related ADRs

- ADR-0011 — API versioning (all auth routes under `/api/v2`).
- ADR-0012 — mobile is a first-class `/api/v2` consumer; this ADR satisfies its auth contract.
- ADR-0013 — governance; `jose` added to `ALLOWED_DEPENDENCIES` under CTO approval.
