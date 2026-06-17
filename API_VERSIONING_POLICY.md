# API Versioning Policy (Part 4) — FROZEN

Cross-ref: `docs/CI_CD_STANDARDS.md`, `DOCUMENTATION_AS_CODE.md` (Part 14).

## Base path & versioning format
- Versioning format: **`/api/v1`, `/api/v2`, `/api/v3`…**. Frozen current version: **`/api/v2`**. Every public route lives under it. **No unversioned endpoints** (`/api/cases`, `/api/users` are forbidden → use `/api/v2/cases`, `/api/v2/users`).
- All route segments are **kebab-case** (e.g. `/api/v2/verification-units`).

## Consumers & surfaces (FROZEN, decided 2026-06-04)
- **ONE internal contract serves BOTH the web app and the existing mobile app: `/api/v2/*`.** The mobile app is a first-class consumer of the same versioned contract — there is **NO separate `/api/mobile`** surface.
- **`/api/external/v1` is deliberately NOT created now** (premature complexity). A dedicated external surface is introduced **only** when a real third party lands (bank portal / client portal) — at that point external integrations get `/api/external/v1/*` so they never couple to internal APIs. Until then: internal `/api/v2/*` only.
- **The existing mobile application is a first-class API consumer. All API changes must maintain compatibility with (1) CRM2 Web and (2) the existing Mobile app. No API change may be merged unless contract tests pass for BOTH consumers. OpenAPI remains the source of truth. The SDK remains the only supported integration layer.** (Connection plan: `MOBILE_API_COMPATIBILITY_MATRIX.md`; ADR-0011, ADR-0012.)

## Core rules
1. **No breaking change without a version review.** A maintainer must sign off
   before any change classified "breaking" below.
2. **No silent contract changes.** Every request/response shape is defined in
   zod; the wire contract is whatever zod emits — nothing implicit.
3. **Every contract change is documented + propagated:** changelog entry →
   reflected in OpenAPI (emitted from zod) → SDK regenerated (`@crm2/sdk`).
4. **Additive changes are allowed within v2** (new endpoint, new *optional*
   request field, new response field). No version bump needed.
5. **Breaking changes require a new version** (`/api/v3`) plus a
   migration/deprecation window. They are never shipped in-place under `/api/v2`.

## Breaking vs non-breaking

| Change | Class |
|---|---|
| Add new endpoint | Non-breaking (additive) |
| Add new **optional** request field | Non-breaking |
| Add new response field | Non-breaking |
| Loosen validation (accept more) | Non-breaking |
| Remove or rename a field | **Breaking** |
| Change a field's type | **Breaking** |
| Change a field's semantics/meaning | **Breaking** |
| Add a **required** request field | **Breaking** |
| Tighten validation (reject previously-valid input) | **Breaking** |
| Change HTTP status code for an outcome | **Breaking** |
| Change an `ErrorCode` value | **Breaking** |
| Remove an endpoint | **Breaking** |

## Deprecation policy
1. **Mark** — annotate the endpoint/field as deprecated in zod/OpenAPI and the
   changelog; the SDK surfaces it as `@deprecated`.
2. **Announce** — record removal target in the changelog at deprecation time.
3. **Sunset window** — keep the deprecated surface working for the announced
   window before removing it (removal = new version).

## SDK policy
- The SDK is **generated from OpenAPI** and is the **single** integration layer for web + mobile (`@crm2/sdk`). Frontends never call HTTP directly.
- **SDK major version matches the API version** (the v2 contract = `@crm2/sdk` v2 line, i.e. `@crm2/sdk-v2`). A new API version ships a new SDK major; consumers pin to a major.

## Database independence
- **Database/schema version ≠ API version.** API versioning MUST NEVER depend on schema version. Migrations evolve the DB freely behind the stable `/api/v2/*` contract; only a *wire-contract* change (per the breaking table) can bump the API version.

## Mobile protection
- The mobile app MUST keep working across API upgrades. Never break an older supported client without a deprecation period. Field removals/renames/response-shape/enum changes that mobile reads are **breaking** (table below) and require the full review + deprecation + a coordinated mobile release.

## Contract tests (both consumers) — CI gate
- Every API change runs **web contract tests AND mobile contract tests**; a change cannot merge unless both prove the current Web and current Mobile still work. Wired in CI alongside the OpenAPI/SDK drift gate (activates with the SDK phase).

## URL stability
- Once released, **`/api/v2/*` is stable** — no silent contract changes; the only way to change the contract incompatibly is a new version.

## Contract drift is machine-checked (Part 21)
CI regenerates OpenAPI from zod and the SDK from OpenAPI, then `git diff
--exit-code`. If the API changed but the SDK was not regenerated, the build
fails. The CI step exists in `.github/workflows/ci.yml` (job `build`,
"7+8. OpenAPI + SDK drift"); it **activates in the SDK phase** once the
zod-to-openapi emit is wired.

## Error contract (stable)
Every error response is:

```json
{ "error": "<CODE>", "details?": ..., "issues?": [...] }
```

- `error` is a standard `ErrorCode` from `apps/api/src/platform/errors.ts`
  (`ERROR_CODES` + `AppError`). HTTP status + code are mapped at the HTTP layer.
- `details` carries optional context; `issues` carries zod validation issues.
- The error shape and code set are part of the contract — changes follow the
  breaking/non-breaking rules above.
