# ADR-0064: Rate-type management — catalog as the managed FK source of truth

- **Status:** Accepted · owner-directed 2026-06-25
- **Date:** 2026-06-25

## Context

The owner wants v1 parity for rate types: an administration page that
**creates rate types** (each a row with a real id), the ability to **assign**
which rate types apply where, and a consistent **`rate_type_id` FK** referenced
across Rate Management, case/task creation, commission, and billing.

v1 had one `rate_types` table (`id`, `name`, `description`, `is_active`) with a
CRUD admin page and a `rate_type_id` FK everywhere (`rates`, `cases`,
`verification_tasks`, `commission_rate_types`, `field_user_commission_assignments`,
`invoice_items`), plus a per-(client × product × verification type) assignment
page.

v2 today has the gap: a `rate_types` catalog **already exists** (mig 0014 —
`id`, `code` varchar(40) unique, `sort_order`, `is_active`, `effective_from`,
audit cols; 18 seeded codes — LOCAL/OGL/OUTSTATION families ×1–5) but it is
**orphaned** — read-only API (`GET /api/v2/rate-types`, `MASTERDATA_VIEW`), no
`name`/`description`/`version`, no admin UI, and nothing FK's to it. Three
independent, non-FK'd columns carry rate-type values instead:
`rates.client_rate_type` (free-text display label, billing resolves by location),
`commission_rates.field_rate_type` (`LOCAL|OGL|OFFICE` enum), and
`case_tasks.field_rate_type` (auto-derived at assignment per ADR-0056). v2 also
deliberately dropped v1's `service_zone_rules` (geo→rate-type) in mig 0013.

This is a frozen-area change (billing/commission data model) and therefore
requires an ADR plus owner sign-off per
`docs/governance/LONG_TERM_PROTECTION.md`.

## Decision

We will promote the existing `rate_types` catalog (mig 0014) to the **managed
source of truth** for rate types, FK-referenced by `rates`,
`commission_rates`, and `case_tasks` (Phase C), with a per-(client × product ×
verification unit) **assignment** layer (Phase B).

- **Resolution is preserved** (ADR-0050 unchanged): the client bill still
  resolves **by location** (the rate type is the FK'd display label); commission
  still resolves by **rate-type key + location + Universal dims** (now matching
  `rate_type_id`, with the OFFICE branch keyed on the OFFICE catalog id). **No**
  `service_zone_rules` / geo→rate-type mapping is reintroduced.
- **OFFICE** becomes a catalog row tagged `category='OFFICE'` (the desk band —
  the location-less commission branch keys on its id). All other rows are
  `category='FIELD'`.
- The seeded rows (18 + OFFICE) are ordinary **editable** catalog rows, not
  system-locked. `code` is **immutable** on edit (it becomes the FK key in
  Phase C); `name`/`description`/`category`/`sort_order`/`is_active` are
  editable with an OCC `version` token (ADR-0019).
- **Phased delivery A → B → C**, each its own gate + browser-verify + deploy:
  Phase A = mig 0092 (extend the catalog: `name`/`description`/`category`/`version`
  + the OFFICE row + backfill `name`), CRUD API + SDK schemas + inline-grid admin
  page; Phase B = mig 0093 (`rate_type_assignments`); Phase C = mig 0094 (FK
  conversion + drop the old string/enum columns in the same migration, guarding
  the earlier old-name migrations against re-run resurrection).

## Consequences

### Positive

- Admins can create and curate rate types; the OUTSTATION family becomes
  selectable; one catalog is FK'd across both billing and commission.
- The value source becomes a real id while the amount-resolution model is left
  exactly as ADR-0050 specified — no behavioural regression to bill or
  commission totals.
- Mobile is unaffected: the sync contract never exposes `field_rate_type`, so
  FK-converting `case_tasks.field_rate_type` changes no mobile-facing field.

### Negative

- The Phase C FK conversion drops three string/enum columns **in place**, so the
  migration **re-run safety** (the 0083 / 0037 trap — every migration replays on
  every deploy) is the load-bearing risk: the earlier migrations that re-create
  or rename those columns (0011/0013/0058/0079/0083/0084) must be guarded to
  no-op once `rate_type_id` exists, proven by `migrations.rerun.test.ts`.
- Three surfaces gain a managed dependency (Rate Management, commission picker,
  case-creation availability) that must stay aligned with the catalog.

## Alternatives Considered

- **Keep the catalog orphaned + free-text labels** — rejected: the owner wants
  v1 parity and proper ids, not unmanaged strings.
- **Full v1 resolution (bill keyed by rate-type + reintroduce
  `service_zone_rules`)** — rejected by the owner: preserve the current
  location-based billing / key+location+dims commission resolution; only the
  value source becomes a FK.
- **FK only the client (billing) side** — rejected: the owner wants commission
  and billing unified on one catalog.

## Related ADRs

- ADR-0050 — **supersedes** its §"`client_rate_type` is a free-text display
  label" (the value source becomes a managed FK catalog); its resolution model
  is otherwise preserved.
- ADR-0056 — relationship: the task field rate-type stays **auto-derived** at
  assignment from the executive's commission; this ADR only changes the value
  source to a FK.
- ADR-0051 — relationship: the Rate Types admin page reuses the inline-grid
  admin pattern.
- ADR-0017 — `effective_from` temporal usability gating (the catalog keeps it).
- ADR-0019 — OCC `version` token on catalog updates.
