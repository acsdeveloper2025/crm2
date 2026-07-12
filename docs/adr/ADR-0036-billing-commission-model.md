# ADR-0036: Billing & Commission model (per-case, unified)

> **Later extension:** [ADR-0093](./ADR-0093-multi-location-bulk-and-one-slot-one-type.md) adds multi-location **bulk** entry + the **one-slot-one-type** rule — additive, **no change to this decision** (same schema, same resolution; guard is app-layer on new saves).

> **⚠️ SUPERSEDED (commission model) → [ADR-0046](./ADR-0046-commission-location-and-tat-dimensions.md)
> (2026-06-18).** §1–§3 (commission resolution: per-user `(user, rate_type, client)`, no location)
> are **replaced** by ADR-0046: field-executive commission gains **location + client + product/VU +
> completed-in-TAT-band** dimensions, **decoupled from the client's `rate_type`**. The *billing* side
> (client bill from `rates`, eligibility = any COMPLETED task, derived-amounts, outcome-independence —
> §4/§5) **still stands**, plus the `bill_count` multiplier fix (ADR-0046 §5). Read ADR-0046 for the
> current commission model.

- **Status:** **Superseded (commission §1–§3) → ADR-0046** · billing §4–§5 still Accepted
- **Date:** 2026-06-16
- **Slice:** Billing 5 (this ADR lands with 5a — the `commission_rates` config foundation)

## Context

The lifecycle (ADR-0032) establishes "the task is the unit of billing." v2 had no money layer:
no commission table, no per-user commission rates, no billing view. v1 runs two separate flows —
agent **commission** (per-task, from a per-user `field_user_commission_assignments` (FUCA) table,
**field-only**, PENDING→APPROVED→PAID) and client **invoicing** (per-case rollup of completed
unbilled tasks, GST). Zion has no commission screen at all (field execs salaried; billing is
per-case/per-document `BILL=YES/NO` set inline, export-only MIS).

The owner chose (2026-06-16) a **unified per-case Billing & Commission** surface that diverges from
both references on eligibility: **ANY completed task** is eligible (not field-only).

## Decision

**1. Unified surface, two amount sources, per case.** For every COMPLETED task in a case:
   - **Client bill amount** ← the EXISTING `rates` engine (client+product+unit, resolved
     area > pincode > case > default, temporal). No new billing-rate table.
   - **Agent commission amount** ← a NEW `commission_rates` config table (this ADR): per-user
     `(user, rate_type, client[nullable=universal]) → amount`, v1-FUCA parity, most-specific-
     client-wins + temporal + active. Resolved against the task's assignee + resolved rate_type +
     the case client; null when the assignee has no matching rate ("unset", not an error).

**2. Eligibility = ANY COMPLETED task** (field / office / KYC alike). The client bill always
   resolves from `rates`; commission resolves only if the assignee holds a matching
   `commission_rates` row — so an office/KYC assignee with no rate simply shows commission "—".
   A task is never both billable and revoked: revoke is blocked on COMPLETED (→ revisit), so a
   revoked task is never COMPLETED and never bills. A revisit bills as its own COMPLETED task; a
   reassign-after-revoke replacement bills once when it completes (the revoked original never did).

**3. `commission_rates` is CONFIG master-data, not billed-state.** Modelled exactly like `rates`:
   effective-dated (a revision end-dates the old row and inserts a new one — self-historizing, no
   separate history table), OCC `version` (ADR-0019), GiST no-overlap EXCLUDE on
   `(user, rate_type, COALESCE(client_id,-1))` over the active period, a `(user, rate_type,
   client_id) WHERE is_active` resolve index. Gated `masterdata.manage` (SUPER_ADMIN) for **both
   read and write** — commission AMOUNTS are compensation data, more sensitive than rate cards, so
   the list is deliberately NOT exposed to the broader `page.masterdata` viewers (MANAGER/TL/
   BACKEND_USER) that `rates` reads allow (Security panel 2026-06-16). A billing-operator VIEW perm
   is introduced with the billing page (slice 5c) when that surface needs a non-admin reader. No new
   permission added in 5a. Migration **0058**.

**4. Derived amounts now; engine later.** Amounts are COMPUTED at read time (the billing view,
   slice 5b/5c). The only new persistence is this CONFIG table.
   **OUT OF SCOPE — owner decision 2026-06-25: CRM2 does NOT generate invoices or GST, and does NOT
   run a commission payout.** Billing & commission are delivered as a **read-model + Excel/CSV export
   only** — the shipped `/billing` page (`/cases` · `/cases/:id/tasks` · `/breakdown` · `/export`)
   plus the MIS export. Client invoicing + GST live **externally** (Tally, per the v1 decision) and
   commission is **exported and paid outside the CRM**. So `invoice generation + GST + PDF` and the
   `commission payout run (PENDING→APPROVED→PAID)` are **removed from the backlog (WONTFIX), not
   deferred.** A persisted billed-marker (`case_tasks.billed/billed_at`) + double-bill guard + a
   case-detail financial-summary card remain OPTIONAL niceties, not committed deliverables.

**5. Outcome-independent** (v1 parity) — neither bill nor commission depends on
   `verification_outcome`.

## Consequences

- 5a (this slice) ships the `commission_rates` backend module (mig 0058 + repo/service/controller/
  routes + SDK + tests). The management UI is bundled into the Billing page (5c), not a throwaway
  standalone page — so 5a is backend-only (live HTTP E2E is the proof; no browser surface yet).
- The resolver uses the DB `now()` for the temporal predicate (skew-proof; consistent with the
  rates list view). A point-in-time/snapshot variant, if ever needed, is the engine slice's concern.
- **DON'T-REGRESS:** `commission_rates` is config (masterdata gate), effective-dated + OCC +
  no-overlap like `rates`; the resolver is most-specific-client-wins + active + `now()`-temporal;
  commission null when unconfigured is correct (not a failure); eligibility is ANY completed task;
  amounts stay derived (no billed-state persistence in slice 5).
- **CARRY:** the agent-commission resolution currently uses current rates (`now()`); the engine
  slice that PERSISTS commission must snapshot the amount at the billing moment.
