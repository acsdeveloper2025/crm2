# EFFECTIVE_FROM_STANDARD.md — temporal usability gating for master data

**Status:** FROZEN 2026-06-05 · **ADR:** [ADR-0017](adr/ADR-0017-effective-from-temporal-usability-gating.md)

Master data carries a user-settable **`effective_from`**. A row is **USABLE** only
when it is both active and in effect. This standard is mandatory for every
administration master-data table and every operational read of one.

## The one rule

```
USABLE  ⇔  is_active = true  AND  effective_from <= now()
```

`is_active` is the off-switch (end-of-life). There is **no `effective_to`** on
master data — deactivation ends a row. (`rates` keeps its own effective-dated
revision model per ADR-0016; it is not governed by this doc.)

## Tables in scope (column added by migration 0015)

`verification_units` · `clients` · `products` · `rate_types` · `locations` ·
`users` · `report_templates`

**+ the CPV enablement join tables** (migration `0016`): `client_products` ·
`client_product_verification_units` — these schedule client/product/unit onboarding.

Column: `effective_from timestamptz NOT NULL DEFAULT now()`. Existing rows are
backfilled `effective_from = created_at` (no behaviour change for current data).

## Read semantics

| Read kind | Filter | Returns |
|-----------|--------|---------|
| **Admin list** (no `active` param) | none | ALL rows incl. future-dated; UI shows status |
| **`?active=true`** (operational/dropdown) | `is_active AND effective_from <= now()` | only USABLE |
| **`?active=false`** (admin: show disabled) | `is_active = false` | inactive only (no time gate) |
| **Hard-coded operational read** | adds `AND effective_from <= now()` beside `is_active` | only USABLE |

`?active=true` means **USABLE**, not merely active. Hard-coded operational reads
that must apply the gate: auth login, assignable-user pools, CPV available-units +
`allUnitsEnabled` (gate `vu` + `cp` + `cpvu` effective_from), the rate-management
client/product/unit/rate-type dropdowns, the pincode/area cascade, the rate-type
lookup. The CPV admin list also returns an active `unitCount` per link (so the
verification-unit mapping action is discoverable, not hidden behind an expand).

## Write semantics (user-settable)

- Create and update accept optional `effectiveFrom` (ISO datetime).
- Create: omitted ⇒ `now()`.
- Update: omitted ⇒ leave existing unchanged (`effective_from = COALESCE($n, effective_from)`).

## Admin UI

Every master-data list shows an **Effective From** column (`formatDateTime`) and a
three-state status:

- **ACTIVE** — `is_active && effective_from <= now()`
- **SCHEDULED** — `is_active && effective_from > now()`
- **INACTIVE** — `!is_active`

Create/edit dialogs include an Effective From date input (blank ⇒ now on create).

## Where it lives

- DB: migration `db/v2/migrations/0015_effective_from.sql`.
- Contracts: `effectiveFrom: string` on each entity type; `effectiveFrom` optional
  ISO on Create/Update schemas (`packages/sdk/src/*.ts`).
- Gate: repository SQL only (ADR-0005) — never in services/controllers/UI.
- UI status helper: `apps/web/src/lib/effectiveStatus.ts`.

## Related

- [ADR-0017](adr/ADR-0017-effective-from-temporal-usability-gating.md) ·
  [ADR-0016](adr/ADR-0016-rate-management-resolution-versioning-workspace.md) (rates effective-dating) ·
  `MANAGEMENT_LIST_STANDARD.md` (Created/Updated columns) ·
  `docs/FROZEN_DECISIONS_REGISTRY.md`.
