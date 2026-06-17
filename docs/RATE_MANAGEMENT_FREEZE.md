# Rate Management — Design Freeze (2026-06-05)

> ⚠️ **SUPERSEDED — describes the abandoned 4-table model.** The owner reshaped Rate Management
> to a FLAT one-table model mid-build; `rate_type_eligibility` + `service_zone_rules` + the
> eligibility trigger described below were **dropped** (migration 0013). The shipped design is
> [ADR-0018](adr/ADR-0018-rate-management-flat-one-table-model.md). This freeze is retained for
> history only — do not implement against the DDL/resolution/workspace sections below.

**Status:** SUPERSEDED → ADR-0018 (was: FROZEN design binding ADR-0016). Derived from the
V1 forensic audit (`RATE_MANAGEMENT_V1_FORENSIC_AUDIT_2026-06-05.md`, v1 repo) + owner decisions.

> **Adopt V1's engine semantics unchanged; fix only its surface and its unfinished stubs.** The
> high-risk core (strict resolution, eligibility gating, freeze-by-copy preservation, immutable
> issued invoices, per-task immutable commission) stays identical to V1.

---

## 1. The resolution chain (load-bearing invariant)

```
field VU:  (client, product, VU, pincode, area) ──SZR──▶ rate_type ──rates──▶ amount
KYC VU:    (client, product, VU)                 ─────────────────────rates──▶ amount   (rate_type NULL)
```

- **Strict, no fallback.** Exact SZR match (geography → rate_type), then exact `rates` match
  (→ amount) for the pricing instant; else **hard error** (no silent default — V1 proved silent
  fallback was the single most dangerous path).
- **Eligibility gates pricing.** A `rates` row's `rate_type` must be eligible for its
  `(client, product, VU)` — enforced in the service **and** by a DB `BEFORE INSERT/UPDATE` trigger
  (V1's `trg_rates_check_rta_allowed`, ported).
- **Point-in-time.** Resolution picks the row whose `[effective_from, effective_to)` window
  contains the pricing instant and `is_active`.
- A caller may pass a **preferred rate_type** (override) but it must still be eligible.

---

## 2. Data model (DDL the build implements — new migration, extends `0003_rates`)

### 2.1 `rate_types` (NEW — global tier catalog, no money)
```sql
CREATE TABLE rate_types (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        varchar(40)  NOT NULL,           -- LOCAL, OGL, OUTSTATION…  (UPPER_SNAKE, immutable)
  name        varchar(100) NOT NULL,
  description text,
  is_active   boolean      NOT NULL DEFAULT true,
  sort_order  integer      NOT NULL DEFAULT 0,
  created_by uuid, updated_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rate_types_code UNIQUE (code)
);
```

### 2.2 `rate_type_eligibility` (NEW — V1 RTA, VU-keyed, WITH the uniqueness V1 lacked)
```sql
CREATE TABLE rate_type_eligibility (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id            integer NOT NULL REFERENCES clients(id),
  product_id           integer NOT NULL REFERENCES products(id),
  verification_unit_id integer NOT NULL REFERENCES verification_units(id),
  rate_type_id         integer NOT NULL REFERENCES rate_types(id),
  is_active            boolean NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- the integrity fix V1 never had:
CREATE UNIQUE INDEX uq_rte_active
  ON rate_type_eligibility (client_id, product_id, verification_unit_id, rate_type_id) WHERE is_active;
```

### 2.3 `service_zone_rules` (NEW — geography → rate_type, VU-keyed)
> v2 collapsed v1's `pincodes` + `areas` into **one `locations` row** (id PK, `(pincode, area)`
> unique — `0004_locations`). So geography in v2 = a single **`location_id`** (a pincode+area pair),
> not two FKs.
```sql
CREATE TABLE service_zone_rules (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id            integer NOT NULL REFERENCES clients(id),
  product_id           integer NOT NULL REFERENCES products(id),
  verification_unit_id integer NOT NULL REFERENCES verification_units(id),
  location_id          integer NOT NULL REFERENCES locations(id),   -- = a pincode+area
  rate_type_id         integer NOT NULL REFERENCES rate_types(id),
  is_active            boolean NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_szr_active
  ON service_zone_rules (client_id, product_id, verification_unit_id, location_id) WHERE is_active;
```

### 2.4 `rates` (EXTEND `0003_rates`)
```sql
ALTER TABLE rates
  ADD COLUMN rate_type_id  integer REFERENCES rate_types(id),   -- NULL only for KYC VUs
  ADD COLUMN effective_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN effective_to   timestamptz;                        -- NULL = open-ended (current)
-- replace the flat UNIQUE(client,product,VU) with a time-aware exclusion:
ALTER TABLE rates DROP CONSTRAINT uq_rates;
ALTER TABLE rates ADD CONSTRAINT rates_no_overlap EXCLUDE USING gist (
  client_id WITH =, product_id WITH =, verification_unit_id WITH =,
  COALESCE(rate_type_id,-1) WITH =,
  tstzrange(effective_from, COALESCE(effective_to,'infinity'),'[)') WITH &&
) WHERE (is_active);
```
Backfill: existing `0003` rows get `effective_from = created_at`, `effective_to = NULL`,
`rate_type_id = NULL` (treated as KYC-style flat until a rate_type is assigned).

### 2.5 `rate_history` (NEW — audit, written on EVERY change, not just amount-edit)
```sql
CREATE TABLE rate_history (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_id     integer REFERENCES rates(id),
  action      varchar(20) NOT NULL,            -- CREATE | REVISE | DEACTIVATE
  old_amount  numeric(10,2), new_amount numeric(10,2),
  old_effective_to timestamptz, new_effective_from timestamptz,
  changed_by  uuid, changed_at timestamptz NOT NULL DEFAULT now()
);
```

### 2.6 Commission (FUCA) — unchanged from V1, its own phase
`field_user_commission_assignments (user_id, rate_type_id, client_id?, commission_amount,
effective_from/to, is_active)` + `commission_calculations` (one immutable row per task, frozen
at completion). Ported as-is; not part of the rate-workspace build.

---

## 3. Versioning rules (effective-dated)

- **Create** a rate → `effective_from = now()` (or a chosen date), `effective_to = NULL`.
- **Revise** → in one transaction: set the current row's `effective_to = <new effective_from>`,
  INSERT a new row with the new amount and `effective_from = <new effective_from>`,
  `effective_to = NULL`; write a `rate_history` REVISE row. **Never overwrite an amount.**
- **Schedule** a future rate → INSERT with `effective_from` in the future; the exclusion prevents
  overlap; the resolver only picks it once the instant arrives.
- **Deactivate** → `is_active=false` + history DEACTIVATE.
- **Resolution** = `WHERE … AND is_active AND effective_from <= $ts AND (effective_to IS NULL OR effective_to > $ts)`.
- The `rates_no_overlap` exclusion guarantees at most one active row per `(client,product,VU,rate_type)` at any instant.

---

## 4. Preservation rules (UNCHANGED — frozen invariant)

The resolved amount is **copied by value** onto the task at pricing time (`case_tasks` snapshot),
then copied to the invoice line and the commission row. Issued invoices are immutable. **Editing a
rate never alters a past task, invoice, or payout.** This is identical to V1 and must not change.

---

## 5. Single-page Rate Management Workspace (the v2 standard design — one line per rate)

One page, one Client+Product context chosen once, built on the frozen **DataGrid** +
**MANAGEMENT_LIST_STANDARD** (server-paginated, global+column search, Created/Updated columns,
skeleton/Hexagon loaders, export via DataGrid). **Each rate is one row.**

```
RATE MANAGEMENT                                   [Client ▾ HDFC] [Product ▾ HOME LOAN]
──────────────────────────────────────────────────────────────────────────────────────
 Verification Unit │ Rate Type │ Geography (pincode/area) │ Amount │ Effective │ Status │ ⋯
 RESIDENCE         │ LOCAL     │ 400001 · Andheri          │ ₹350   │ 01 Jun→   │ ACTIVE │ ▸
 RESIDENCE         │ OGL       │ 400050 · Bandra           │ ₹600   │ 01 Jun→   │ ACTIVE │ ▸
 OFFICE            │ LOCAL     │ —                         │ ₹400   │ 01 Jun→   │ ACTIVE │ ▸
 PAN (KYC)         │ —         │ —                         │ ₹150   │ 01 Jun→   │ ACTIVE │ ▸
──────────────────────────────────────────────────────────────────────────────────────
 [+ Add rate]   row ▸ expands: Eligibility (allowed rate types) · Zone rules · Revision history
```

- **One row = one priced `(VU, rate_type, geography)` line.** All V1 dimensions are columns:
  Verification Unit · Rate Type · Pincode/Area · Amount · Currency · Effective window · Status +
  Created/Updated.
- **Row expand (inline accordion, the standard — no empty side pane):** eligibility toggles for
  that VU (which rate types are allowed), the SZR zone-rule sub-grid (geography → rate_type), and
  the effective-dated **revision history** for that rate.
- **Add / Revise** open an inline editor on the same page (VU → rate_type → geography → amount →
  effective_from). Revise creates a new dated version; the old row stays in history.
- **Rate Types** master catalog = a small admin drawer (global), not a separate page.
- Collapses V1's 6 screens → 1; the Client→Product→VU context is picked once, never re-entered.
  No dimension lost, auditability increased (history is visible + point-in-time).

---

## 6. V1 hardening (owner-approved, applies to the LIVE v1 system — separate, gated step)

Per the V1 audit, two safe fixes to land on the live v1 system (DB triple-write: live → dump →
migration; **ask before applying to remote**):
1. **Add the missing uniqueness** to `rate_type_assignments` (active scope) — closes the
   duplicate-active-eligibility gap.
2. **Write a `rate_history` row on every change** (CREATE/REVISE/DEACTIVATE), not only on
   amount-edit — closes the audit gap (DELETE/INSERT currently unlogged).
These do **not** change V1 pricing behaviour; they only add integrity + audit.

---

## 7. Build sequence (owner: ADR+spec → harden V1 → build v2)

1. **ADR + spec** (this doc + ADR-0016) — DONE.
2. **Harden V1** (§6) — live v1 DB + dump + migration; gated on explicit go.
3. **Build v2** (extends the shipped `rates` module): migration (§2) → `rate_types` /
   eligibility / SZR / extended `rates` repos+services+routes → strict point-in-time resolver
   (ported from V1's `validateTaskConfiguration`) + DB eligibility-gate trigger → the case-create
   path writes the frozen snapshot onto `case_tasks` (preservation §4) → the single-page Workspace
   (§5) on the DataGrid → tests + `pnpm verify` + live browser E2E. Commission (FUCA) is a later
   phase. Honor `MOBILE_API_COMPATIBILITY_MATRIX.md`.

Register on build: FROZEN_DECISIONS_REGISTRY (rate model), COMPLIANCE_GAPS (workspace/versioning/
eligibility-uniqueness), MASTER_MEMORY §8, PROJECT_INDEX.
