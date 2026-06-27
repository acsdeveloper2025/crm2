# ADR-0076: Security hardening — rate limiting, resource-exhaustion guards, secret fail-fast, and access-token revocation

- **Status:** Accepted (Phase 1 + Phase 2 built & verified — see Decision)
- **Date:** 2026-06-27
- **Amends:** ADR-0014 (Authentication & session management) · ADR-0022 (Access Control 2.0).
- **Relates:** ADR-0027 (Realtime & push) · ADR-0030 (Background jobs).

## Context

A six-point production-readiness security review (2026-06-27) of the live CRM2 API
(`apps/api`) asked the standard backend questions: *can data leak across tenants? can the
APIs be abused/spammed? are secrets exposed? can access be escalated? what happens if a token
is stolen? can one request take the system down?* Four read-only audit passes + an adversarial
design review produced the findings below. Two halves emerged:

**The authorization core is sound and needs no change.** The scope predicate
(`platform/scope`) fails closed (`FALSE` on a missing dimension) and is applied on list,
detail-by-`:id`, sub-resources, exports, and aggregates — no IDOR found. Writes use Zod
allowlists (no mass-assignment); role/permission/scope writes are SUPER_ADMIN-only; assignment
is re-validated server-side; the KYC-unit grant is fail-closed (ADR-0073). Secrets hygiene is
strong: no committed secrets, gitleaks in CI, GitHub-Secrets-only deploy, an error handler that
returns a bare `{error:'INTERNAL'}`, and a web bundle with zero embedded secrets.

**The edges are unguarded.** Concretely, against the current single-instance prod topology
(`infra/prod/docker-compose.yml` — Valkey/Redis is commented out, `REDIS_*` unset, jobs run
in-process):

1. **No rate limiting anywhere** (verified: zero `express-rate-limit`/`limit_req`/`helmet`
   across `apps/`, `infra/`, `packages/`). A per-*account* DB lockout exists
   (`modules/auth/service.ts:42` — 5 fails → 15-min lock), so single-account brute-force is
   already defended, but per-IP password-spray, scraping, and a scrypt **timing oracle** for
   username enumeration (unknown user fails *before* the ~2s hash) are open.
2. **Login can stall the whole API at trivial volume.** scrypt (`N=16384`, ~2s) runs on the
   libuv threadpool; `UV_THREADPOOL_SIZE` is unset (default **4**). With no login throttle, ~4
   concurrent logins occupy the pool and stall all fs/dns/crypto process-wide.
3. **`req.ip` is wrong** — Express has no `trust proxy`, so behind the nginx edge every request
   reports the edge container's IP (also corrupts the IP stored on `auth_refresh_tokens` /
   `consents`). Per-IP limiting is impossible until this is fixed.
4. **Prod can boot on a public secret.** `JWT_SECRET`/`MFA_ENC_KEY`
   (`packages/config/src/index.ts:14,16`) are `.min(16).default('dev-only-insecure-…')` with no
   production fail-fast — an unset var silently boots on the repo-published default (forgeable
   JWTs; decryptable TOTP secrets).
5. **No DB/HTTP timeouts.** `new Pool({connectionString})` has no `statement_timeout`,
   `connectionTimeoutMillis`, or `idle_in_transaction_session_timeout` and `max:10` default — a
   handful of slow/locking queries exhaust the pool and block everything with no acquire
   timeout. The HTTP server sets no `requestTimeout`/`headersTimeout` (slowloris).
6. **A stolen access token cannot be revoked.** Access JWTs are stateless (no `jti`, not
   stored); `authenticate.ts` checks only signature + `exp`. Every revoke primitive (idle
   logout, "log out now", admin revoke, password change, **account deactivation**) touches only
   the refresh table — none kills a live access token, which stays valid for its full TTL (15
   min), and the realtime socket is verified only at handshake so a revoked user keeps a live
   channel. Refresh rotation is single-use but a replayed rotated token is not treated as a
   breach (no family revocation).

`dev`/`test`/CI legitimately run without Redis and with the default secrets; any fix must not
break them. The frozen stack (ADR-0042) and single-instance prod topology constrain the design.

## Decision

We will harden the API in **two phases**. Phase 1 (this ADR's immediate build) ships every
fix that is low-risk, needs no Redis, and needs no migration. Phase 2 specifies access-token
revocation done correctly (durable, with reuse-detection grace) and is built and reviewed
separately because it carries migration + false-positive risk.

### Phase 1 — ship now (no Redis, no migration)

1. **Trust the edge proxy.** `app.set('trust proxy', 1)` in `http/app.ts` — one hop (the nginx
   edge). Not `true` (that would let a client spoof `X-Forwarded-For` to evade per-IP limits).
   Fixes `req.ip` for limiting *and* the pre-existing wrong-IP audit data.

2. **Rate limit auth-sensitive routes** with `express-rate-limit` (one new dependency) using
   its **in-memory store** — correct for single-instance prod; the nginx floor (#4) covers the
   blue-green deploy overlap and process restarts. `POST /auth/login` and `POST /auth/refresh`
   get a per-IP limiter; thresholds are config-driven (`RATE_LIMIT_*`) and sized for shared-NAT
   offices (login default 30 / 15 min, refresh 60 / 15 min) so the limiter is a flood cap while
   the **existing DB per-account lockout remains the credential-stuffing control**. A 429 returns
   the canonical `{error:'TOO_MANY_REQUESTS'}` shape (new `HTTP_STATUS.TOO_MANY_REQUESTS` + error
   code). We do **not** add a per-username limiter (the DB lockout already throttles per account;
   a second one only amplifies victim-DoS) and we do **not** add `rate-limit-redis` (no Redis to
   back it — that is the documented Phase-3 upgrade when multi-instance + Valkey land).

3. **Close the login timing oracle.** When the username is unknown/unusable, run scrypt against
   a fixed dummy hash before returning `INVALID_CREDENTIALS`, so response latency no longer
   reveals whether a username exists (`modules/auth/service.ts`).

4. **nginx `limit_req` floor.** A per-IP `limit_req_zone` (`10r/s`, `burst=20 nodelay`,
   `limit_req_status 429`) on `location /api/` — a cross-process baseline independent of the app
   limiter, scoped off `/socket.io` and static assets.

5. **Raise `UV_THREADPOOL_SIZE` to 16** for the api container (`docker-compose.yml` env) so
   concurrent scrypt logins + sharp/PDF work don't serialize on a 4-thread pool. Bounded
   (≤16) against the 2 GB container `mem_limit` given scrypt's ~16 MB/hash.

6. **pg pool guards** (`platform/db.ts`, config-driven): `statement_timeout` (default **60 s** —
   a backstop that bounds pathological/locking queries with comfortable margin for the largest
   legit detached export ~200k rows; raise the env var or move exports out-of-process if it ever
   trips), `connectionTimeoutMillis` (5 s acquire), `idle_in_transaction_session_timeout` (30 s),
   explicit `max`. Migrations are unaffected (separate `psql` process via `migrate.sh`).

7. **HTTP server timeouts** (`main.ts`): `requestTimeout = 120000`, `headersTimeout = 125000`
   (must exceed `requestTimeout`), `keepAliveTimeout` tuned above nginx's to avoid the keep-alive
   race. **120 s, not 60 s** — it must match nginx's deliberate `proxy_read_timeout 120s` so the
   origin doesn't cut off legitimate slow PDF/DOCX/large-upload requests below the proxy budget.

8. **Secret fail-fast** (`packages/config`): a `.superRefine` that throws when
   `NODE_ENV==='production'` and `JWT_SECRET`/`MFA_ENC_KEY` equal the known dev default. Surfaces
   via `loadEnv()`'s existing boot-time throw, for every ROLE. `dev`/`test`/CI keep the default.

9. **test-auth double-guard** (`http/testAuth.ts`): the middleware itself no-ops when
   `NODE_ENV==='production'`, so even a misconfigured mount can't honor `x-test-auth` in prod.
   The mount guard stays as the first line.

### Phase 2 — access-token revocation (BUILT, migration 0101)

Because prod has no Redis, the access-token kill switch needs **durable** state, and reuse
detection needs a grace window to avoid mass-logout false positives. Built as:

- **Per-user `tokens_valid_after timestamptz` on `users`** (new migration). `signAccessToken`
  already stamps `iat`; `verifyAccessToken` returns it; `authenticate.ts` rejects a token whose
  `iat < tokens_valid_after` (strict `<`, never `<=` — `<=` would kill a token minted in the
  same second as a re-login). Read it via the **already-cached** `enrichAuth` per-request lookup
  (no new per-request DB hit). Fail-open on read error is **not** acceptable here (durable DB,
  not a cache) — the lookup is on the existing role-resolution path which already fails 500 on
  error, so a revoked token cannot slip through.
- **Set `tokens_valid_after = now()`** on logout-all, password change, and **admin
  deactivation** (single + bulk — `setActive(false)` does not revoke today; this is net-new) and
  also **force-disconnect the user's live sockets** (`io.in('user:<id>').disconnectSockets(true)`
  in `platform/realtime`) so the revoked user loses the realtime channel too. Single-session
  revoke stays device-scoped (access dies at TTL).
- **Refresh-reuse → family revoke with a grace window.** A replayed already-rotated refresh
  token triggers `revokeAllForUser` **only if** the rotation happened more than a grace window
  (≈60 s) ago; a replay within grace is treated as a benign client retry (mobile retries lost
  responses; multi-tab web races) and reissued, not nuked. This prevents ordinary network jitter
  from logging users out everywhere.

Until Phase 2 ships, access-token exposure remains bounded by the 15-min TTL and refresh-side
revocation (deactivation/password change block the next refresh) — unchanged from today.

## Consequences

### Positive
- Closes both criticals: API-wide login DoS (#2/#3/#5) and the total absence of rate limiting
  (#1), plus the secret-default footgun (#4) and unbounded queries/requests (#5).
- Per-IP limiting + correct `req.ip` also fixes a latent audit-data bug (wrong stored IPs).
- Phase 1 is Redis-free and migration-free → low blast radius, ships behind the existing gate.
- Phase 2's durable epoch makes revocation near-instant (≤ enrichAuth cache TTL) without Redis.

### Negative
- In-memory rate-limit counters reset on deploy/restart and aren't shared across the blue-green
  overlap; the nginx floor mitigates this. True distributed limiting waits on Valkey (Phase 3).
- `statement_timeout` is a single global; a future export larger than the 60 s backstop would
  fail (detached job, not a user-facing 500) until exports move out-of-process or the env var is
  raised — documented, accepted.
- One new runtime dependency (`express-rate-limit`). Justified: it is the de-facto standard;
  hand-rolling a correct sliding-window limiter is more code and more risk (reuse > reinvent).
- Phase 2 adds a `users` column + per-request epoch on the cached path; acceptable.

## Alternatives Considered
- **Stand up Valkey now and use `rate-limit-redis` + a Redis revocation set** — rejected for
  Phase 1: prod deliberately runs single-instance with no Redis (compose comment); adding a
  container + secret + eviction policy is a separate infra decision and unneeded while
  single-instance. Kept as the Phase-3 upgrade path.
- **Per-username login limiter (5/15 min)** — rejected: duplicates the existing DB per-account
  lockout and amplifies the victim-DoS vector for no added protection.
- **`requestTimeout = 60 s`** — rejected: below nginx's intentional 120 s budget, would cut off
  legitimate PDF/DOCX/large-upload requests.
- **Redis-only (ephemeral) access-token revocation** — rejected for Phase 2: no Redis in prod,
  and an ephemeral marker silently re-enables revoked tokens on flush. A durable `users` column
  is the robust choice for a single-instance box.
- **Family-revoke on any rotated-token replay (no grace)** — rejected: ordinary mobile retries
  of lost responses and multi-tab web refresh races would trigger mass logout.

## Related ADRs
- ADR-0014 (auth/session — token model amended by Phase 2) · ADR-0022 (access control — guard
  layer verified, unchanged) · ADR-0027 (realtime — Phase 2 socket force-disconnect) · ADR-0030
  (jobs — in-process today, informs the export `statement_timeout` decision).
- COMPLIANCE_GAPS_REGISTRY §SEC-AUDIT-2026-06-27 tracks each finding to FIXED/DEFERRED.
