# ADR-0046: Field-executive commission gains location, client/product/VU, and TAT-band dimensions (decoupled from the client rate)

- **Status:** **Accepted** — domain-owner sign-off 2026-06-18 (CTO + domain-owner). Build spec + plan
  to follow; **build order: TAT (ADR-0044) → commission (this ADR).** **Supersedes ADR-0036 §1–§3**
  (the commission resolution model) and partially restates ADR-0036 §4–§5. Supersedes a FROZEN
  decision — see [docs/governance/LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md).
- **Date:** 2026-06-18
- **Depends on:** ADR-0044 concept **B** (the completed-in TAT band) and `tat_policies`.
- **Companion audit:** [docs/engineering/COMMISSION_RATE_CROSS_AUDIT_2026-06-18.md](../engineering/COMMISSION_RATE_CROSS_AUDIT_2026-06-18.md)
  (findings COMPLIANCE_GAPS §G).

## Context

ADR-0036 set commission as per-user config resolved per completed task against `(user, rate_type,
client)` with **no location dimension**, where `rate_type` is the **client-side** type resolved by the
location-aware rate cascade (`COMMISSION_LATERAL` joins `cmr.rate_type = rt.rate_type`,
`apps/api/src/platform/billing/laterals.ts:35-42`). The 2026-06-18 cross-audit confirmed:

- Commission varies by location only **transitively** through the client's `rate_type`; two completed
  tasks with the **same** `rate_type` in **different** pincodes/areas earn the **same** commission —
  unrepresentable today.
- The owner requires commission keyed to the **field executive's own (pincode, area) classification**,
  which is **independent of the client's**: a location that is **OGL for the client can be LOCAL for
  the executive** — "don't mix" them. An executive covers only **5–20 pincodes**.
- Commission must also vary by **client**, **product / verification-unit**, and the **TAT band the
  executive actually completed the task in** (ADR-0044 concept B).
- The billing rollup **ignores `case_tasks.bill_count`** (a per-task billable-units multiplier) — a
  correctness bug (§G-2).
- The pipeline "Commissionable" surface shows ₹ in an operational view (server already null-guards;
  FE-surface only, §G-3).

## Decision (locked 2026-06-18)

**1. Commission resolves from the field executive's OWN location mapping — decoupled from the client
rate.** The `cmr.rate_type = rt.rate_type` coupling is **removed**. Commission no longer inherits the
client's rate type; the executive's LOCAL/OGL/OUTSTATION classification is the executive's own and is
set on the executive's commission config (a descriptive label + the location it applies to), never
derived from the client side.

**2. `commission_rates` gains dimensions, mirroring the `rates` resolution discipline.** The resolution
key becomes:

> **executive (`user_id`) + `location_id` + `client_id` + `product_id` + `verification_unit_id` +
> `tat_band`** → `amount`

All dimensions except `user_id` are **nullable = "applies generally"** (the rate model's
location-less-default pattern, generalized). An executive sets a base amount and adds specific
overrides only where needed — so the 5–20 covered pincodes stay a small number of rows.

**3. Resolution = most-specific-match cascade, decoupled from the client rate.** Location follows the
**same precedence as `RATE_LATERAL`** — `task.area > task.pincode > case.area > case.pincode >
location-less default`. The other dimensions resolve **exact-match-wins over the NULL ("any")
default**. A single deterministic `ORDER BY` (exact column SQL in the build spec) picks one row;
`LIMIT 1` keeps the billing join 1:1. Null commission (executive has no matching row) remains
"unset / —", not an error (ADR-0036 §2 retained).

**4. Commission consumes the completed-in TAT band (ADR-0044 B).** The band is computed from
elapsed `completed_at − assigned_at` (server-receipt clock, wall-clock) against `tat_policies`, and is
a resolution dimension (`tat_band` nullable = "any band"). The resolved band **and** the resolved
amount are **snapshotted at finalize** (ADR-0036 §"CARRY") so editing `tat_policies` or rates later
never rewrites historical commission.

**5. `bill_count` is a billable-units multiplier — fix the rollup (§G-2).** `bill_total` becomes
`SUM(rt.bill_amount * ct.bill_count)`; commission and the completed-task count are weighted by
`bill_count` consistently (exact semantics — does a 0 count zero the line? — pinned in the spec).

**6. Commission/bill amounts live only on the Billing & Commission page (§G-3).** The pipeline
"Commissionable" bucket + the bill/commission columns are **removed** (FE-only change; the server
null-guard stays). The Billing & Commission page is (re)designed to show counts + amounts, including a
**by pincode/area** breakdown and the completed-in-band view.

**7. Effective-dating + OCC + no-overlap preserved.** `commission_rates` stays self-historizing
(revision end-dates + inserts), OCC `version` (ADR-0019). The GiST no-overlap EXCLUDE generalizes to
the coalesced dimension tuple: `EXCLUDE (user_id WITH =, COALESCE(location_id,-1) WITH =,
COALESCE(client_id,-1) WITH =, COALESCE(product_id,-1) WITH =, COALESCE(verification_unit_id,-1) WITH
=, COALESCE(tat_band,'') WITH =, tstzrange(...) WITH &&) WHERE is_active`.

**8. RBAC unchanged.** Commission config stays `masterdata.manage` (SUPER_ADMIN). Amounts stay
`billing.view` (MANAGER + BACKEND_USER + SA). A location dimension needs **no new permission** (the
scope-dimension registry already supports it). No agent-keyed commissionable count is exposed to
non-`billing.view` users (§G-4 / D-audit).

## Impact (surface to change — detailed in the build spec)

| Layer | Change |
|-------|--------|
| **DB** | New migration (next number at build time): add `location_id`, `product_id`, `verification_unit_id`, `tat_band` (+ optional `exec_classification` label) to `commission_rates`; regenerate the no-overlap EXCLUDE + resolve index over the coalesced tuple. Billing rollup applies `* bill_count`. (Additive; existing rows → all-NULL default, see Migration.) |
| **API** | Rewrite `COMMISSION_LATERAL` (`platform/billing/laterals.ts`) to the decoupled location+dims+band cascade (no `rate_type` join). Update `commissionRates/repository.ts resolveAmount` signature + cascade. Billing repository: `* bill_count`; add the pincode/area breakdown + completed-in-band columns. |
| **SDK** | `packages/sdk/src/commissionRates.ts`: add the new fields to `CommissionRate`/`CommissionRateView`/`Create`/`Revise` schemas (additive). Billing types gain the breakdown/band fields. |
| **Web** | Commission-rates admin form gains cascading pincode→area pickers (clone `RateManagementPage`) + client/product/VU/TAT-band selectors. Billing & Commission page (re)design (counts + amounts + by-area breakdown + completed-in-band). Remove the pipeline "Commissionable" surface. |
| **Mobile** (`/api/v2` — never break, ADR-0011) | None required — commission is a web/back-office read-model; mobile does not read commission. Verify no consumer regresses (additive-only). |

## Alternatives considered

1. **Reporting/grouping only** (commission stays as-is, billing view just breaks down by pincode/area)
   — rejected: the owner needs the *amount* to differ for the same location depending on the
   executive's own classification, which the client-rate-coupled model cannot express.
2. **Keep the `rate_type` coupling, add `location_id`** — rejected: it keeps commission tied to the
   client's OGL/LOCAL, contradicting "don't mix" (a client-OGL location must be able to pay the
   executive a LOCAL rate).
3. **A two-level model** (a shared location→executive-classification map + amount-per-class) — viable,
   but unnecessary given only 5–20 pincodes per executive; direct per-(executive, location) rows with a
   classification label are simpler. Revisit only if executive coverage grows.

## Migration

- Forward, additive. Existing `commission_rates` rows become the **all-NULL ("applies generally")
  default** for their `(user, client)` — i.e. no location/product/VU/band specificity — preserving
  current resolution for already-configured executives until location rows are added.
- The `rate_type` column: retained but **no longer a resolution key**; repurposed as / replaced by the
  executive `exec_classification` label (build-spec decision — keep both vs rename). No data loss.
- Backfill of completed-in bands for historical tasks is computable (ADR-0044 Migration) for reporting;
  persisted commission stays snapshot-at-finalize going forward.

## Consequences / risks

- **Resolution complexity:** a 5-nullable-dimension most-specific cascade needs careful, tested SQL
  (the §E worked example is the acceptance test: a multi-pincode case must produce per-location
  amounts). Mitigated by mirroring the proven `RATE_LATERAL` pattern + `LIMIT 1` 1:1 join.
- **`bill_count` fix changes historical totals** for any task with `bill_count ≠ 1` — confirm with the
  billing owner whether to recompute or apply forward-only.
- **Supersession bookkeeping:** on acceptance, stamp ADR-0036 superseded-by-ADR-0046, update
  `docs/adr/README.md` + `PROJECT_INDEX.md` + `FROZEN_DECISIONS_REGISTRY.md`.
- Sequenced **after** the ADR-0044 TAT build (commission's `tat_band` depends on it).

## Sign-off required

Per the freeze, this does **not** proceed to build until **CTO + domain-owner** approve (reconciled
with the data-model + MIS/billing owners). The domain-owner locked the decisions above on 2026-06-18;
on explicit approval this ADR moves to *Accepted*, ADR-0036 is stamped superseded, and a build spec +
plan are written. **Build order: TAT (ADR-0044) → commission (this ADR).**
