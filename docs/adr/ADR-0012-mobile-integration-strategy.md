# ADR-0012: Mobile Integration Strategy

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

A production React Native mobile app (`crm-mobile-native`, RN 0.84, axios) already
exists and is developed and released **separately**. It is the field agents' daily
tool: offline-first (SQLCipher op-sqlite), idempotent sync queue, photo/evidence
capture. CRM2 is a new backend/web platform — it is **not** rebuilding the
mobile app. The mobile app must keep working.

## Decision

**Mobile is a first-class consumer of the single internal contract `/api/v2/*` —
the same contract the web app uses.**

- **No separate `/api/mobile` (or `/api/external/v1`) surface** — that would be
  premature complexity. Both web and the existing mobile app consume `/api/v2/*`
  via the OpenAPI-generated SDK (ADR-0011). External portals get `/api/external/v1`
  only if/when they actually exist.
- The existing mobile app currently calls a `/api/mobile/*` shape (axios, JWT-pair
  + idempotent refresh, `GET /sync/download` watermark+delta, type-specific
  `POST /verification-tasks/{id}/verification/{formType}`, multipart
  `POST /verification-tasks/{id}/attachments`, idempotent `start`/`complete`/
  `revoke`/`priority`, `UserProfile` with territory). **`MOBILE_API_COMPATIBILITY_MATRIX.md`
  is the controlled CONNECTION PLAN** that maps each current mobile call →
  its `/api/v2/*` target — produced BEFORE building Cases/Tasks/Workspace so
  compatibility is designed in, not discovered late.
- **No API change may break the existing mobile app or the v2 web app.** Changes
  are additive-only within `/api/v2`; anything breaking requires ADR + migration +
  deprecation window + a coordinated mobile release (ADR-0011).
- **`Idempotency-Key` dedupe is mandatory** on all mobile writes (method+body+key);
  `409` on already-applied `start`/`complete`/`revoke` is treated as success.
- Evidence uploads go to the object store (immutable, versioned, sha256,
  signed-URL — never a local volume); standalone uploads link by `taskId`.
- **CI gate:** every API change runs **web contract tests AND mobile contract
  tests** + synthetic mobile flows; nothing merges unless both consumers still pass.

## Consequences

### Positive

- Field operations continue uninterrupted; mobile and web evolve independently.
- The integration contract is explicit, tested, and drift-detected.

### Negative

- The mobile client must be connected/adapted to `/api/v2/*` (a connection effort
  in the mobile repo, mapped by the compatibility matrix), and `/api/v2` must be
  designed to satisfy the mobile flows from day one.

## Alternatives Considered

- **A separate `/api/mobile` (or `/api/external/v1`) surface now** — rejected:
  premature complexity; two contracts to keep in sync; external coupling we don't
  yet need. Add `/api/external/v1` only when a real external party exists.
- **Rebuild mobile on v2** — rejected: out of scope; the app already exists and
  only needs connecting.
- **Big-bang mobile cutover** — rejected: connect incrementally via the matrix +
  generated SDK with no breaking changes; both consumers gated by contract tests.

## Related ADRs

- ADR-0011 — API versioning that governs mobile contract changes.
- ADR-0002 — the Case→Task→Verification-Unit model mapped into the mobile shape.
- ADR-0006 — shared generated SDK (web + mobile).
