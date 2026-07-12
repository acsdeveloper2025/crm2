# ADR-0016: Rate Management — unified VU resolution chain, effective-dated versioning, single-page workspace

> **Later extension:** [ADR-0093](./ADR-0093-multi-location-bulk-and-one-slot-one-type.md) adds multi-location **bulk** entry + the **one-slot-one-type** rule — additive, **no change to this decision** (same schema, same resolution; guard is app-layer on new saves).

> ⚠️ **SUPERSEDED by [ADR-0018](./ADR-0018-rate-management-flat-one-table-model.md) (2026-06-05).**
> The owner reversed this 4-table design mid-build to a FLAT one-table model. The
> `rate_type_eligibility` / `service_zone_rules` tables and the eligibility trigger described
> below were **dropped** (migration 0013). This document is retained for history only — the
> shipped design is in ADR-0018. Do not implement against this ADR.

- **Status:** Superseded → ADR-0018
- **Date:** 2026-06-05
- **Extends:** migration `0003_rates` (the shipped flat `(client,product,verification_unit)→amount` rate). Adopts the proven V1 rate engine semantics (see `RATE_MANAGEMENT_V1_FORENSIC_AUDIT_2026-06-05.md` in the v1 repo). Relates to ADR-0002 (Case→Task→VU), ADR-0010 (reporting), ADR-0015 (case workspace), ADR-0009 (feature flags).

## Context

Rate Management is a backbone, highest-risk module. A full forensic audit of the **V1** system (5 agents, `file:line` evidence) established exactly how it works and is the basis of this decision. Key V1 facts:

- V1 prices field work through a **4-layer chain**: `rate_types` (tier catalog, no money) → `rate_type_assignments` (eligibility, no money) → `service_zone_rules` (geography→rate_type, no money) → `rates` (the amount). KYC is a **separate** axis (`kyc_rates`, by document_type). Resolution is **strict, no-fallback**. The rate is **frozen by value-copy** onto the task at the moment of work, then copied to the invoice line and the commission row; issued invoices are DB-immutable. Historical preservation is by copy, not by date-lookup.
- V1 weaknesses: two parallel rate axes (`rates` + `kyc_rates`); `rate_type_assignments` has **no uniqueness**; `effective_from`/`effective_to` columns exist but are **never written** (revisions overwrite in place); 6 disconnected UI screens (Client→Product→VT re-picked 3×, ≈25-30 clicks).
- v2 today has only the flat `0003_rates` table — it lacks rate_types, eligibility, geography, and versioning.

Owner decisions (2026-06-05) that drive this ADR:
- **Q2 — one unified Verification-Unit rate axis** (no separate KYC rate table).
- **Resolution chain (owner, verbatim):** `(client, product, Verification Unit, pincode, area) → rate_type → rate amount` — the full V1 chain is preserved, keyed on the VU.
- **Q3 — real effective-dated versioning** (revise → new dated row; old end-dated; scheduled future rates + point-in-time history).
- **Q4 — one page, the v2 standard design, one line per rate** (DataGrid / management-list standard).

## Decision

**1. One unified rate axis keyed on Verification Unit.** There is no separate KYC rate table. The catalog is the existing VU set (field ∪ KYC). KYC VUs are priced too — they simply carry no rate_type and no geography.

**2. The resolution chain is preserved exactly (the load-bearing invariant):**

```
field VU:  (client, product, VU, pincode, area) ──SZR──▶ rate_type ──rates──▶ amount
KYC VU:    (client, product, VU)                 ─────────────────────rates──▶ amount   (rate_type = NULL, no geography)
```

Resolution is **strict and fallback-free** (V1's `validateTaskConfiguration` hardening is adopted): exact SZR match then exact `rates` match, else hard error. Eligibility (the V1 RTA invariant) gates which rate_types a `rates` row may use, enforced in app **and** by DB trigger.

**3. Data model** (detail + DDL in `docs/RATE_MANAGEMENT_FREEZE.md`):
- `rate_types` — global tier catalog (Local/Local1/Local2/OGL/OGL1/OGL2/Outstation… ; no amount). **New.**
- `rate_type_eligibility` — which rate_types are permitted for `(client, product, verification_unit)`. **New, WITH the UNIQUE V1 lacked.** Replaces V1 `rate_type_assignments`, VU-keyed.
- `service_zone_rules` — `(client, product, verification_unit, pincode, area) → rate_type`. **New**, VU-keyed; partial-unique on the active scope. (v2 already holds the all-India pincode/area data.)
- `rates` — **extended** from `0003`: add `rate_type_id` (nullable — NULL only for KYC VUs), add `effective_from`/`effective_to`; the UNIQUE becomes a time-aware exclusion so multiple historical rows coexist with at most one active per `(client, product, VU, rate_type)` at any instant.

**4. Real effective-dated versioning.** A rate revision **inserts a new row** with `effective_from` = the activation date and end-dates the prior row (`effective_to`); it never overwrites an amount in place. Resolution selects the row whose `[effective_from, effective_to)` contains the pricing instant and `is_active`. Future-dated rates are allowed (scheduled). A `rate_history` audit row is written on every change. An exclusion constraint forbids overlapping active windows for the same key.

**5. Freeze-by-copy preservation is UNCHANGED and remains a frozen invariant.** The resolved amount is snapshotted onto the task (`case_tasks` — `estimated_amount`/`actual_amount`), copied to the invoice line and the commission row, and issued invoices are immutable. Changing a rate never alters a past task, invoice, or payout. **This behaviour must remain byte-for-byte identical to V1.**

**6. Commission (FUCA) is preserved** — flat amount per `(field user × rate_type [× client])`, resolved at task completion, frozen one-per-task. (Built as its own phase; unchanged semantics.)

**7. The UI is one single-page Rate Management Workspace** built on the frozen v2 **DataGrid / management-list standard** (`docs/DATAGRID_STANDARD.md`, `docs/MANAGEMENT_LIST_STANDARD.md`): **one row per rate**, server-paginated, with Created/Updated columns, inline edit, an inline-accordion sub-grid for geography (SZR) rules, and an effective-dated revision/history view. It collapses V1's 6 screens to one. No dimension and no auditability is lost.

## Consequences

### Positive
- One resolver, one screen, one rate table — instead of V1's two axes and six screens.
- Versioning becomes real: scheduled rate changes + point-in-time history (V1 never delivered this despite the columns existing).
- Data integrity gaps V1 carried (no RTA uniqueness) are closed.
- The proven, audited high-risk core (strict resolution, RTA gating, freeze-by-copy, immutable invoices/commissions) is kept identical — low regression risk.

### Negative
- `0003_rates` must be migrated (add columns + change the UNIQUE to a time-aware exclusion) — a forward migration with backfill of `effective_from`.
- Strict no-fallback resolution means configuration must be complete before a task can be priced (this is intentional — V1 proved silent fallback was the single most dangerous path).
- Effective-dated logic adds query complexity to the resolver (point-in-time selection) vs a flat lookup.

## Alternatives Considered
- **Keep two rate axes (field + KYC)** — rejected (Q2): v2 already unifies VT + document_type into one VU; two tables/resolvers would re-introduce V1's split.
- **Overwrite-in-place + audit-only history** — rejected (Q3): no scheduled rates, no point-in-time lookup; repeats V1's stub.
- **Flatten away rate_type/geography** `(client,product,VU)→amount` — rejected (owner): loses the geography→rate_type tiering that drives both client price and agent payout.
- **Keep the 6 separate screens with shared context** — rejected (Q4): the owner wants one page on the standard design.

## Related ADRs
- ADR-0002 (Case→Task→VU) — the VU is the rate key.
- ADR-0010 (reporting) / ADR-0015 (case workspace) — billing/MIS read the frozen task snapshot, not live rates.
- ADR-0009 (feature flags) — the new workspace ships behind a flag.
