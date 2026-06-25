# Rate-Type Management — design spec (ADR-0063)

- **Date:** 2026-06-25
- **Status:** Design — owner-approved shape (2026-06-25); spec under review; not yet planned/built.
- **Owner decisions (2026-06-25):** (1) **Unified catalog, FK'd everywhere** (full v1 parity); (2) **per-combination assignment** layer (v1-style); (3) **preserve current resolution** (FK the rate-type *value*; keep ADR-0050 location-based billing + key+location+dims commission; **no** geo/service-zone rules); (4) **phased ship** (A → B → C, each gated + deployed).
- **New ADR:** **ADR-0063** — supersedes **ADR-0050 §"client_rate_type is a free-text label"**; relates to **ADR-0056** (field rate-type auto-derived at assignment) and **ADR-0051** (inline-grid admin pattern). Frozen-area change (billing/commission data model) → ADR + owner sign-off per `docs/governance/LONG_TERM_PROTECTION.md`.
- **Migrations:** Phase A = `0091`, Phase B = `0092`, Phase C = `0093+` (final numbers confirmed at build; next-free today is 0091).

---

## 1. Problem & background

The owner wants what v1 had: an **administration page to create rate types** (each becomes a row with a real id), the ability to **assign** which rate types apply where, and to **reference those ids** consistently across Rate Management, case/task creation, commission, and billing.

**How v1 did it.** ONE `rate_types` table (`id`, `name`, `description`, `is_active`) with a CRUD admin page (RateTypesPage + create/edit dialogs) and a **`rate_type_id` FK everywhere** (`rates`, `cases`, `verification_tasks`, `commission_rate_types`, `field_user_commission_assignments`, `invoice_items`) plus a **RateTypeAssignment** page declaring which rate types are available per (client × product × verification type). One catalog, FK'd across billing + commission.

**Current v2 state (the gap).**
- A `rate_types` catalog table **already exists** but is effectively **orphaned**: `db/v2/migrations/0014_rate_types_lookup.sql` (`id`, `code` varchar(40) unique, `sort_order`, `is_active`, `effective_from`, audit cols; 18 seeded codes — LOCAL/OGL/OUTSTATION families ×1–5). **No `name`/`description`/`version`.**
- The API module `apps/api/src/modules/rateTypes/` is **read-only** — a single `GET /api/v2/rate-types` gated by `MASTERDATA_VIEW` (`routes.ts:8`). No admin UI exists.
- Nothing FK's to it. Three independent, non-FK'd columns carry rate-type values today:
  - `rates.client_rate_type` — free-text `varchar(60)` **display label**; billing resolves **by location only** (`platform/billing/laterals.ts:24-38`, mirrored in `cases/repository.ts` TASK_VIEW). Defined `0013_rate_management_flatten.sql:26`, renamed by `0083`.
  - `commission_rates.field_rate_type` — `varchar`, validated by `z.enum(COMMISSION_RATE_TYPES)` = `LOCAL|OGL|OFFICE`. Defined `0058_commission_rates.sql:21`, renamed by `0083`; CHECK widened for OFFICE in `0084`.
  - `case_tasks.field_rate_type` — `varchar(10)`, CHECK `IN ('LOCAL','OGL'[,'OFFICE'])`; set at assignment, **auto-derived from the assignee's commission** per **ADR-0056**. Defined `0011_task_assignment.sql:22`, widened `0084`.
- SDK: `RateType` (`packages/sdk/src/rateTypes.ts:6-13`); `FIELD_RATE_TYPES`/`FieldRateType` = `['LOCAL','OGL']` (`cases.ts:82-83`); `COMMISSION_RATE_TYPES`/`CommissionRateType` = `['LOCAL','OGL','OFFICE']` (`cases.ts:87-88`); `Rate.clientRateType: string|null` (`rates.ts:16`); `CaseTaskView.fieldRateType` + `.clientRateType` (`cases.ts:231,240`). The enums are **hardcoded**, not derived from the catalog.
- v2 **deliberately dropped** v1's `service_zone_rules` (geo→rate-type) in `0013_rate_management_flatten.sql:47`.

**Conclusion:** the catalog exists but is unmanaged and unreferenced. This spec makes it the managed FK source of truth and wires it through, **without** reversing how amounts resolve.

---

## 2. Locked decisions

1. **Unified catalog = single source of truth.** Promote `rate_types` to a managed, FK-referenced catalog used for both client billing and field/commission rate types.
2. **FK the value everywhere** (`rate_type_id`): `rates`, `commission_rates`, `case_tasks`. Backfill from existing strings/enums (auto-promoting any orphan free-text `client_rate_type` into the catalog first), then **drop the old columns in the same migration** (no transition / no dual-write — owner 2026-06-25); idempotent + re-run-safe.
3. **Per-combination assignment** (`rate_type_assignments`): which rate types are available per (client × product × verification_unit). Rate Management + case-creation availability are assignment-gated; the **Commission picker offers ALL active rate types** (commission dims are Universal-able — owner 2026-06-25, matches v1).
4. **Resolution preserved (ADR-0050 unchanged):** client bill still resolves **by location** (rate-type is the FK'd label); commission still resolves by **rate-type key + location + Universal dims** (now matching `rate_type_id`). **No `service_zone_rules` / geo→rate-type mapping is reintroduced.**
5. **OFFICE** becomes a catalog row tagged `category='OFFICE'` (desk; location-less commission branch keys on its id). All other rows are `category='FIELD'`.
6. **Mobile unaffected** — the sync contract never exposes `field_rate_type` (`sync/service.ts:14-55`, `sdk/sync.ts`); FK-converting `case_tasks.field_rate_type` does not change any mobile-facing field. Verified.
7. **Phased delivery** — A → B → C, each its own `pnpm verify` gate + browser-verify + deploy.

---

## 3. Data model

### 3.1 Catalog — extend `rate_types` (Phase A, mig 0091)
Add (idempotent `ADD COLUMN IF NOT EXISTS`):
- `name` varchar(100) — human label (backfill = title-cased `code` for the 18 seeds).
- `description` text null.
- `category` varchar(10) NOT NULL DEFAULT `'FIELD'` CHECK `IN ('FIELD','OFFICE')`.
- `version` integer NOT NULL DEFAULT 1 — OCC token (matches `designations`/`rates` convention).
- Insert one `OFFICE` row (`code='OFFICE'`, `category='OFFICE'`, `sort_order` low/0) `ON CONFLICT (code) DO NOTHING`.
- Keep `uq_rate_types_code`. Keep `effective_from`.
- **The seeded rows (18 + OFFICE) are ordinary editable catalog rows** shown in the admin page — NOT system-locked (unlike the 9 `is_system` verification units). `code` is immutable on edit (it is the FK key); `name`/`description`/`category`/`sort_order`/`is_active` are editable + updatable (owner 2026-06-25).

### 3.2 Assignment — new `rate_type_assignments` (Phase B, mig 0092)
```
id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY
client_id       integer NOT NULL REFERENCES clients(id)
product_id      integer NOT NULL REFERENCES products(id)
verification_unit_id integer NOT NULL REFERENCES verification_units(id)
rate_type_id    integer NOT NULL REFERENCES rate_types(id)
is_active       boolean NOT NULL DEFAULT true
created_by/updated_by uuid · created_at/updated_at timestamptz
UNIQUE (client_id, product_id, verification_unit_id, rate_type_id)
```
Index `(client_id, product_id, verification_unit_id) WHERE is_active` for the availability lookup.

### 3.3 FK conversion (Phase C, mig 0093+)
Add `rate_type_id integer REFERENCES rate_types(id)` to `rates`, `commission_rates`, `case_tasks`, backfill, swap the constraints, and **drop the old string/enum columns in the SAME migration** (no transition / no dual-write — owner 2026-06-25). Strict order within the one migration:
1. **Lossless catalog reconciliation first** (so the in-place drop can't lose data). `commission_rates.field_rate_type` / `case_tasks.field_rate_type` are already canonical codes (`LOCAL|OGL|OFFICE`) → total match. `rates.client_rate_type` is free-text → **auto-promote**: `INSERT INTO rate_types(code, name, is_active)` every DISTINCT non-null `UPPER(client_rate_type)` not already present, so every existing label becomes a real catalog row with an id (nothing lost), then match.
2. Add `rate_type_id`; backfill by `UPPER(old_value) = rate_types.code` (null `client_rate_type` → null id; KYC units legitimately null).
3. Swap the rates `rates_no_overlap` EXCLUDE term `COALESCE(client_rate_type,'')` → `COALESCE(rate_type_id,-1)`; drop the `case_tasks`/`commission_rates` string CHECK (the FK supersedes the enum CHECK).
4. `DROP COLUMN IF EXISTS` the three old columns.

Because the drop is in-place, the re-run-safety guarding (§3.4) is the load-bearing risk: the earlier migrations that (re)create/rename these columns on every deploy (0011/0013/0058/0079/0083/0084) must be guarded to no-op once `rate_type_id` exists, or a re-run resurrects the dropped column. `migrations.rerun.test.ts` must prove this.

### 3.4 ⚠️ Migration re-run safety (HARD invariant)
Every migration re-runs verbatim on every deploy (the 0037/0083 trap). The FK conversion + the in-place column drops MUST:
- Be idempotent (`ADD COLUMN IF NOT EXISTS`, guarded constraint add/drop, `DROP COLUMN IF EXISTS`).
- Guard any earlier-migration reference to a to-be-dropped column on the **new** column's presence (the exact pattern used in 0011/0013/0058/0079 for the 0083 rename).
- Keep `apps/api/src/platform/__tests__/migrations.rerun.test.ts` green (applies the full set 3× and asserts no resurrected columns / surviving constraints). Add catalog/assignment assertions there.

---

## 4. API / SDK (additive `/api/v2`)

- **`rateTypes` → full CRUD** (was read-only): `GET /` (list, existing), `GET /:id`, `POST /`, `PUT /:id` (OCC `version`), `POST /:id/activate`, `POST /:id/deactivate`. View = `MASTERDATA_VIEW`; mutations = `MASTERDATA_MANAGE`. SDK: extend `RateType`, add `CreateRateTypeSchema`/`UpdateRateTypeSchema`.
- **`rateTypeAssignments` module (new):** `GET /` (by combo filter), `POST /bulk` (set the assigned set for a combo), and **`GET /api/v2/rate-types/available?clientId&productId&verificationUnitId`** → active rate types assigned to that combo. View `MASTERDATA_VIEW` / `case.create`; manage `MASTERDATA_MANAGE`.
- **Contracts expose code+id:** `Rate`/`CommissionRate`/`CaseTaskView` carry `rateTypeId` + a derived `rateTypeCode`/`rateTypeName` (JOIN to `rate_types`). The existing `clientRateType`/`fieldRateType` string fields **keep being emitted, now sourced from the JOINed catalog code** (not the dropped column) — so SDK/web/mobile consumers are unaffected by the in-place column drop.
- **OpenAPI regen** (`pnpm --filter @crm2/api openapi`) + contract test after each module change.

---

## 5. Web (`apps/web`)

- **Rate Types admin page** — inline-grid (the `DesignationsPage`/ADR-0051 pattern): columns `code`, `name`, `description`, `category`, `sort order`, `active`; per-cell edit + add-row; OCC `version`. Route `/admin/rate-types` (+ guard `MASTERDATA_VIEW`); nav entry in `Layout.tsx` ADMINISTRATION; routes in `App.tsx`. (Code stays immutable on edit, like other code-keyed entities.)
- **Rate Type Assignment page** — bespoke matrix: pick client → product → verification unit → checkbox list of active rate types → save (POST bulk). Route `/admin/rate-type-assignments`.
- **Wire the 3 pickers to catalog ids** (Phase C):
  - Rate Management `RateRecordPage` — replace the free-text client-rate-type input with a select of the **assigned** rate types for the chosen client×product×unit (id-valued, assignment-gated; this is the surface the assignment layer governs).
  - Commission `CommissionRateRecordPage:313-317` — replace the hardcoded `COMMISSION_RATE_TYPES` `<option>` map with **all active catalog rows** (id-valued). **Not** combo-gated: commission dims (client/product/unit) are Universal-able (NULL = any), so a specific assignment can't bound them — this matches v1, which keyed commission on rate-type alone, not per combo.
  - Case creation: `AddTasksForm` does **not** collect the field rate-type (ADR-0056 derives it server-side) — unchanged; the rate-preview surfaces the catalog code(s); the assignment layer bounds which rate types a combo can resolve to.

---

## 6. Resolution semantics (PRESERVED — explicit)

- **Client bill** — `platform/billing/laterals.ts` RATE_LATERAL keeps the location ladder (task.area > task.pincode > case.area > case.pincode > location-less) + `id DESC` tie-break; it now SELECTs `rate_type_id`→code for display instead of the string. `rate_type_id` is **not** added to WHERE/ORDER. Billing total stays live `SUM(rt.bill_amount * ct.bill_count)` for COMPLETED tasks.
- **Commission** — COMMISSION_LATERAL keeps `user` + `rate_type` exact + location + Universal (client/product/unit/tat) most-specific-wins, OFFICE location-less branch — but matches `case_tasks.rate_type_id = commission_rates.rate_type_id` (and the OFFICE branch keys on the OFFICE catalog id). Still stamped at SUBMIT.
- **Task rate-type** — still set at assignment via ADR-0056 derivation; stores `rate_type_id`.

---

## 7. Phasing (each = own branch off latest origin/main, gate, browser-verify, deploy on owner OK)

- **Phase A — Catalog + admin CRUD.** mig 0091 (extend `rate_types` + OFFICE row + backfill name/description); `rateTypes` CRUD API + SDK schemas + RBAC; Rate Types inline-grid admin page + nav + routes; e2e spec + seed row; `migrations.rerun.test.ts` extended. **No FK/resolution change yet** — fully shippable on its own.
- **Phase B — Assignment.** mig 0092 (`rate_type_assignments`); assignments API + `available` endpoint + SDK; Assignment matrix page + route; e2e. Pickers can start consuming `available` (still string-valued until C).
- **Phase C — FK conversion + wiring.** mig 0093 (auto-promote orphan `client_rate_type` labels → catalog; add `rate_type_id` to rates/commission_rates/case_tasks; backfill; swap the rates EXCLUDE term + drop the case_tasks/commission string CHECK; **DROP the three old columns in the SAME migration**; guard the earlier old-name migrations [0011/0013/0058/0079/0083/0084] so a re-run can't resurrect them; extend `migrations.rerun.test.ts`); resolution matches by id (display-only for billing); pickers wired (Rate Mgmt = assignment-gated select · Commission = all active · case-creation rate-preview); contracts keep emitting the string fields from the catalog JOIN; full `pnpm verify` (Postgres :5433) + mobile-safety re-confirm + browser-verify the bill/commission round-trip.

ADR-0063 authored as the first task of Phase A.

---

## 8. Out of scope (explicit)

- v1's `service_zone_rules` / any pincode→rate-type geo auto-selection (owner chose "preserve resolution"). Task rate-type stays ADR-0056-derived.
- Changing how the bill **amount** is computed (stays location-resolved, live).
- Mobile changes (contract unaffected).
- v1's `cases.rate_type_id` header field, `invoice_items`, `commission_rate_types`/`field_user_commission_assignments` table shapes — v2's equivalents are `commission_rates` + the stamped `case_tasks.commission_amount`; we FK those, not re-model them. (Billing is export-only in v2 per the 2026-06-25 descope — no invoicing tables to wire.)

---

## 9. Invariants / DON'T-REGRESS

- Migrations idempotent + **re-run-safe** (§3.4); `migrations.rerun.test.ts` stays green.
- `/api/v2` additive-only; OpenAPI regenerated; mobile contract byte-unchanged (re-verify in C).
- ADR-0050's resolution model (location billing, key+location+dims commission) is **preserved**, not reversed — only the value source becomes a FK.
- OCC `version` on catalog updates; code immutable on edit; export never wider than the list read perm.
- No `any`/ts-suppress/`console.*`; FE talks to API via `@crm2/sdk` (generic `api()` for new reads is fine, per existing pattern); raw SQL only in repositories + migrations.
- Commit author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, NO AI trailer; commit at green gates; **never push/deploy without explicit owner OK**.

---

## 10. Verification

Per phase: `pnpm verify` (typecheck→lint→format→no-suppressions→boundaries→test→build; api integration on Postgres `:5433`, `LC_ALL=C`) + full Playwright e2e (`pnpm exec playwright test`, with the new seed rows in `db/v2/seed/e2e.seed.sql`) + browser-verify the real admin action and confirm persistence in `crm2_dev`. Disposition any audit follow-ups in `docs/COMPLIANCE_GAPS_REGISTRY.md`.
