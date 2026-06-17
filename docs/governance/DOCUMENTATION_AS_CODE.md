# Documentation as Code (Part 14) — FROZEN

Cross-ref: `docs/CI_CD_STANDARDS.md`, `API_VERSIONING_POLICY.md` (Part 4).

## Single sources of truth (frozen)
| Contract | Source of truth | Lives in |
|---|---|---|
| **API contract** | **OpenAPI**, emitted from zod | generated from `apps/api` zod schemas |
| **Database schema** | **migrations** (raw SQL, no Prisma) | `db/v2/migrations/*.sql` |
| **Frontend contract** | **`@crm2/sdk`**, generated/typed from the same zod | `packages/sdk` |

zod is the one contract layer. OpenAPI and the SDK are both **derived from zod**,
so the API definition, its docs, and the typed client never diverge.

## The rule
- **Docs that can be generated MUST be generated.** No hand-maintained
  duplicate of the API contract, the DB schema, or the SDK types.
- **Hand-written docs are limited to rationale/governance:** ADRs, guides,
  policies (e.g. this file, `API_VERSIONING_POLICY.md`, `docs/*`).
- **Generated artifacts are drift-checked in CI** — regenerate, then
  `git diff --exit-code`. A stale generated file fails the build (Part 21,
  `.github/workflows/ci.yml` job `build`).

## Generated vs hand-written
| Artifact | Mode | Where |
|---|---|---|
| OpenAPI spec | **Generated** (from zod) | emitted in build/CI |
| `@crm2/sdk` client + types | **Generated** (from OpenAPI) | `packages/sdk` |
| DB schema reference | **Authoritative source = migrations** | `db/v2/migrations` |
| ADRs / guides / policies | Hand-written | repo root + `docs/` |
| Changelog | Hand-written (per contract change) | per Part 4 |

## Tooling (PENDING — activates in the SDK phase)
- **Emit:** `@asteasolutions/zod-to-openapi` — zod → OpenAPI.
- **Consume:** `openapi-typescript` — OpenAPI → SDK types.
- Both are **not yet wired**; they **activate in the SDK phase**. The CI drift
  step already exists in `.github/workflows/ci.yml` ("7+8. OpenAPI + SDK drift")
  and is a no-op until the generation scripts (`openapi`, `sdk:gen`) are present.

Until then, `packages/sdk` is hand-typed against the same zod schemas as an
interim measure; once generation is wired it becomes fully generated and the CI
drift gate enforces it.

> **SDK consumers (frozen):** the OpenAPI-generated SDK is the *only* supported integration layer for **both** the web app and the existing mobile app (`crm-mobile-native`). Frontends never call HTTP directly. See `MOBILE_API_COMPATIBILITY_MATRIX.md` + ADR-0012.
