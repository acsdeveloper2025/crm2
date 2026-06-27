# ADR-0077: Case-creation lookups decoupled from `page.masterdata`

- **Status:** Accepted
- **Date:** 2026-06-27
- **Relates to:** ADR-0022 (RBAC permissions), ADR-0065 (case-creation portfolio-scope gates), ADR-0044 (TAT bands), ADR-0024 (assignee eligibility). No migration.

## Context

A user could not complete the new-case / add-tasks workflow unless granted `page.masterdata`
(Master Data — View). The reason: the workflow's lookup dropdowns were gated on that permission —
`GET /clients/options`, `GET /products/options`, `GET /tat-policies/options`, and the FIELD
pincode→area picker `GET /locations`. But `page.masterdata` also unlocks the entire Master Data
admin section (clients/products/rates/locations management pages). So a "case creator only" role
was impossible: granting the dropdowns also granted the admin surface.

The rest of the flow was already correctly decoupled — `GET /cases/available-units` (the CPV
verification-unit picker) and `GET /cases/rate-preview` gate `case.create`; the field/KYC assignee
picker `GET /cases/:id/eligible-assignees` gates `case.assign`. Only the four lookups above were
coupled to masterdata.

## Decision

Add **dedicated, `case.create`-gated** lookup endpoints under the cases module, and repoint the
web case-creation forms to them. The Master Data endpoints are left untouched (admin pages keep
`page.masterdata`).

- `GET /api/v2/cases/lookups/clients` — `case.create`
- `GET /api/v2/cases/lookups/products` — `case.create`
- `GET /api/v2/cases/lookups/tat-policies` — `case.create`
- `GET /api/v2/cases/lookups/locations` — `authorizeAny(case.create, case.assign)` (the picker it
  feeds is itself `case.assign`-gated)

The handlers are thin delegations to the existing services (`clientService.options`,
`productService.options`, `tatPolicyService.options`, `locationService.list`) — **no duplicated SQL**.
`clients`/`products` stay **portfolio-scoped via the actor** (`scopedEntityIds`), so a case creator
sees only their assigned clients/products — exactly what `POST /cases` already enforces
(ADR-0065 SR-1). This mirrors the existing precedent `GET /rate-types/available`, which already
uses `authorizeAny(MASTERDATA_VIEW, CASE_CREATE)` for the same reason.

A role with `case.create` + `case.view` (+ `case.assign`) and **no `page.masterdata`** can now drive
the whole workflow: pick client/product → see CPV verification units for that client+product → pick
TAT → (FIELD) search pincode/area and see eligible field agents, or (OFFICE) see eligible KYC users.

**Client-first product loading.** The product picker is **client-dependent**: `/cases/lookups/products`
requires `?clientId=` and returns only products **enabled for that client** (`client_products`)
**∩ the actor's PRODUCT scope** (`scopedEntityIds(actor,'PRODUCT')`). The web form disables the product
select until a client is chosen and clears the prior product when the client changes. This enforces the
owner's rule that a product appears only if (a) the chosen client actually has it and (b) the user is
scoped to it — so a backend user, after client+product scope is assigned, sees and can pick only what
their scope allows. An out-of-scope client returns `[]` (the actor could not have picked that client).
The client picker stays scoped via the existing CLIENT-scope path.

## Consequences

- **Not a widening of existing endpoints** — net-new routes; the Master Data admin surface is
  unchanged and still requires `page.masterdata`. No data leak: lookups are either portfolio-scoped
  (clients/products) or non-sensitive master (TAT bands, pincode catalog).
- **Regression-proofed** — `cases.api.test.ts` seeds a bespoke `case.create`-only role and asserts
  the four lookups return 200 while `/clients/options` returns 403 for that same role. Reverting any
  guard back to `MASTERDATA_VIEW` flips a 200 → 403 and fails the test.
- The web forms call the new paths via the SDK's `api()` helper (no SDK resource-object change).
- `openapi.json` regenerated (auto-derived from routes).
