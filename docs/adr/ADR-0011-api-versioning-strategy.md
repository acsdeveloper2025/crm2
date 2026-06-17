# ADR-0011: API Versioning Strategy

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

CRM2 serves multiple long-lived consumers (the web SPA and an existing,
separately-released mobile app). Consumers cannot be force-upgraded in lockstep,
and a silent contract change has already caused production incidents in v1.
We need an explicit, enforceable versioning contract.

## Decision

**All HTTP APIs are versioned and the contract is OpenAPI-first.**

- Versioning format `/api/v1`, `/api/v2`, `/api/v3`. Current: **`/api/v2`** (e.g.
  `/api/v2/cases`, `/api/v2/tasks`, `/api/v2/verification-units`). **Unversioned
  paths (`/api/cases`, `/api/users`) are forbidden.**
- **ONE internal contract `/api/v2/*` serves BOTH the web app and the existing
  mobile app.** Mobile is a first-class consumer of the same versioned contract —
  there is **no separate `/api/mobile` surface** (see ADR-0012; the connection
  plan is `MOBILE_API_COMPATIBILITY_MATRIX.md`).
- **`/api/external/v1` is intentionally deferred** — not created until a real
  external party (bank/client portal) exists, so future integrations never couple
  to internal APIs. Creating it now would be premature complexity.
- **OpenAPI (emitted from zod) is the single source of truth** for every contract;
  the SDK is generated from it and is the **only** integration layer for web +
  mobile (ADR-0006 / `DOCUMENTATION_AS_CODE.md`). **SDK major matches API version**
  (`@crm2/sdk` v2 line). **Database/schema version ≠ API version** — versioning
  never depends on schema.
- **Compatibility is gated for both consumers:** every change runs **web contract
  tests AND mobile contract tests**; nothing merges unless both still pass.
- **Within a version, changes are additive-only** (new optional fields / new
  endpoints). **Breaking changes** — removing/renaming a field, changing a type
  or response structure, changing a status code, tightening validation — require
  a **new version + ADR + migration plan + deprecation plan** (announce → window →
  sunset). No silent breaking changes; no field removal without review.
- The error contract is stable: `{ error: <CODE>, details?, issues? }` with the
  standard `ErrorCode` set.

Machine enforcement: CI regenerates OpenAPI + SDK and **fails on drift**
(`API_VERSIONING_POLICY.md`, CI gate 7+8; activates with the SDK phase).

## Consequences

### Positive

- Consumers (web + mobile) get a stable, discoverable contract.
- Breaking changes become deliberate, reviewed, and migration-planned.

### Negative

- Maintaining additive-compatibility and (eventually) parallel versions costs
  discipline and some surface duplication during deprecation windows.

## Alternatives Considered

- **Unversioned / latest-only API** — rejected: breaks independently-released
  consumers and reintroduces the v1 silent-drift incident class.
- **Header/content-negotiation versioning** — rejected: path versioning is
  simpler to route, cache, observe, and reason about for this team.

## Related ADRs

- ADR-0006 — Verification Workspace / SDK consumption.
- ADR-0012 — Mobile integration uses the versioned `/api/mobile` surface.
- ADR-0013 — governance that enforces the review gates.
