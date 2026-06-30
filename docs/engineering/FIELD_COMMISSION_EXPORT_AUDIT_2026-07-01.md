# Field-User Commission — Calculation, Export & Period Coverage Audit (2026-07-01)

**Type:** AUDIT-ONLY (read-only findings; no code changed, no migrations). Verified against code at
`main` HEAD `77c7f33`.
**Scope:** how a FIELD user's commission is computed in CRM2 v2, where it is surfaced/exported, which
export periods + aggregation dimensions exist, and a v1 + Zion parity cross-check.
**Governing decisions:** ADR-0036 (billing/commission read-model) · ADR-0046 (location + TAT dims) ·
ADR-0050 (exact-match `field_rate_type` key) · ADR-0056 (`field_rate_type` derived from assignee) ·
ADR-0068 (rate-type FK conversion: the string cols became `rate_type_id`) · ADR-0047 (commission frozen
at SUBMIT) · billing scope = **EXPORT-ONLY** (owner 2026-06-25, `project_billing_scope_export_only`).

Dispositions use the COMPLIANCE_GAPS_REGISTRY vocabulary: **FIXED-needed / DEFERRED / RATCHET / WONTFIX**.

---

## TL;DR

- **Calculation is sound and read-derived.** Per-task commission resolves from `commission_rates` via the
  shared `COMMISSION_LATERAL`, frozen onto `case_tasks.commission_amount` at SUBMIT (first-stamp-wins).
  No persisted payout state machine — by design.
- **The core question — periodic commission export (weekly / 15-day / monthly / quarterly) — is MISSING.**
  Both billing and MIS accept only a **freeform `completedFrom`/`completedTo` date range** on
  `ct.completed_at`. There is **no period preset and no period bucketing/grouping anywhere** (API, SDK, web).
- **Per-field-user aggregation is MISSING.** Billing is per-CASE; the assignee appears only inside the
  per-case accordion lines and is **not even a column in the billing export**. There is no GROUP BY user.
- **v1 had more than v2 here:** v1's commission **pivot export** supported week/month/quarter/year presets
  (+ custom range) keyed on `case_completed_at`, pivotable user × client × product × rate_type. v1 also
  lacked 15-day/fortnightly.
- **Zion is not a commission parity model** — Zion field execs are salaried (no commission engine at all);
  its MIS export is manual-date-range only (no presets), with a per-executive *visit-count* report.

---

## A. Calculation (v2) — end-to-end trace

### A.1 — How `field_rate_type` is chosen for a FIELD user (ADR-0056 → ADR-0068)

The task's rate-type now lives in `case_tasks.rate_type_id` (FK → `rate_types`, post ADR-0068; the old
free-text `field_rate_type` column was dropped). The CODE (`LOCAL`/`OGL`/`OFFICE`) is read back via a join.

At **assignment** the value is **derived, never client-supplied** (the web never sends it):

- `apps/api/src/modules/cases/repository.ts:924-928` — `assignTask`: `if (visitType === 'FIELD' && !fieldRateType)`
  call `deriveFieldRateTypeForTask(...)`; **null ⇒ `AppError.badRequest('NO_FIELD_COMMISSION')` blocks the
  assignment.**
- `deriveFieldRateTypeForTask` ([repository.ts:186-220](../../apps/api/src/modules/cases/repository.ts)) and
  `deriveFieldRateTypeForNewTask` (assign-at-create, [:224-254](../../apps/api/src/modules/cases/repository.ts))
  resolve the executive's OWN active `commission_rates` rows at the task location — most-specific-wins
  (client > product > unit, then location granularity), **`OFFICE` rows excluded**, returning the band CODE.
  This guarantees a downstream commission amount will resolve (same predicate as the resolver minus the
  `rate_type`/`tat_band` legs).
- **OFFICE/desk tasks auto-stamp `OFFICE`** in SQL: `rate_type_id = (SELECT id FROM rate_types WHERE code =
  CASE WHEN $4::varchar = 'OFFICE' THEN 'OFFICE' ELSE $5 END)` ([repository.ts:937](../../apps/api/src/modules/cases/repository.ts)).
- Same derivation on the **reassign-after-revoke** path (`reassignRevokedTask`, [:1275](../../apps/api/src/modules/cases/repository.ts)).

### A.2 — How the commission amount is resolved

The single resolver is `COMMISSION_LATERAL`
([apps/api/src/platform/billing/laterals.ts:61-93](../../apps/api/src/platform/billing/laterals.ts)) —
shared by the billing read-model, the pipeline/tasks read-model, the MIS engine, and the snapshot writer
(do **not** fork it). Resolution:

| Leg | Behaviour |
|---|---|
| **REQUIRED-specific** | `cmr.user_id = ct.assigned_to`, `cmr.rate_type_id = ct.rate_type_id` (exact), and `cmr.location_id IN (ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)` — **no location-less default** for FIELD. |
| **OFFICE flat path** | `OR (ct.rate_type_id = (SELECT id FROM rate_types WHERE code='OFFICE') AND cmr.location_id IS NULL)` — desk commission is location-less. |
| **Universal-able (NULL = any)** | `client_id`, `product_id`, `verification_unit_id`, `tat_band` — each `(col IS NULL OR col = task.col)`. |
| **Most-specific-wins** | `ORDER BY client_id, product_id, verification_unit_id, tat_band DESC NULLS LAST`, then a location-granularity CASE rank (task.area > task.pincode > case.area > case.pincode), then `cmr.id DESC`. `LIMIT 1`. A specific value always outranks Universal at each level. |
| **`billCount` multiplier** | Applied at the **rollup**, not in the lateral: `SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count)` ([billing/repository.ts:122](../../apps/api/src/modules/billing/repository.ts)). **Note:** since SHIP-2 (2026-06-23) the operator input was removed — every task ships `billCount: 1`, so the multiplier is effectively vestigial today. |
| **REVISIT vs ORIGINAL** | `task_origin` is a **label only** (`billingClass` in the SDK); both bill/earn full-rate (v1 rule R2 carried). |

### A.3 — Where the math runs; derived vs persisted

- **Derived at read time**, but **frozen onto a per-task snapshot column** — there is no payout state machine.
  `stampCommissionSnapshot` ([repository.ts:65-78](../../apps/api/src/modules/cases/repository.ts)) writes
  `case_tasks.commission_amount` (`numeric(12,2)`, mig 0080) **first-stamp-wins** (guarded
  `WHERE … commission_amount IS NULL`), reusing `COMMISSION_LATERAL` so the stored value == the resolver.
  - Called at **SUBMIT** ([:1428](../../apps/api/src/modules/cases/repository.ts), ADR-0047 freeze) and at a
    direct ASSIGNED→COMPLETED desk completion ([:1033](../../apps/api/src/modules/cases/repository.ts)).
- Every read prefers the snapshot: `COALESCE(ct.commission_amount, com.commission_amount)`
  (billing list/lines/breakdown + MIS `COMMISSION_AMOUNT`). So editing a rate later never rewrites a frozen
  commission.
- **Rounding:** no app-level `Math.round`/`toFixed`. The lateral casts `amount::float8`; the snapshot column
  is `numeric(12,2)` so the persisted value rounds to 2 dp at store time. Rollups `SUM(... * bill_count)::float8`.
- **NULL-rate behaviour:** an unmatched line yields `NULL`; the rollup's outer
  `COALESCE(SUM(...), 0)` makes it contribute **₹0 silently**. FIELD assignment is blocked when the executive
  has no matching row (A.1); OFFICE/desk tasks have **no such block** → silently earn ₹0 if no OFFICE rate is
  configured (known CEO launch-checklist item: pre-seed OFFICE rates).
- **OFFICE flat path:** resolves the location-less OFFICE branch above; otherwise identical.

### A.4 — Edge cases

| Case | Behaviour |
|---|---|
| No matching `commission_rate` (FIELD) | **Blocked at assign** — `NO_FIELD_COMMISSION` 400 (A.1). |
| No matching `commission_rate` (OFFICE/desk) | Not blocked → **silent ₹0** snapshot. |
| Revoked / reassigned | Only `SUBMITTED`/`COMPLETED` rows surface in billing/MIS. A revisit is a **new task** (own snapshot); reassign-after-revoke re-derives + re-stamps. |
| Submit-vs-complete timing | Commission freezes at **`submitted_at`** (`COALESCE(ct.submitted_at, ct.completed_at, now())`); client bill resolves at **COMPLETE**. **But the period/date filter keys on `ct.completed_at`** (A.4 caveat → GAP-5). |
| Universal fallbacks | `client`/`product`/`unit`/`tat_band` NULL ⇒ matches any; specific always wins. |

---

## B. Where field-user commission is surfaced

| Layer | Surface | Grain / notes |
|---|---|---|
| **API** | `GET /billing/cases` · `/billing/cases/:id/tasks` · `/billing/breakdown` · `/billing/cases/export` ([billing/routes.ts](../../apps/api/src/modules/billing/routes.ts)) | per-CASE aggregate + per-task accordion lines + by-location/by-band breakdown. Gated `billing.view`. |
| **API** | `GET /mis/rows` · `/mis/export` ([mis/routes.ts](../../apps/api/src/modules/mis/routes.ts)) | per-COMPLETED-TASK, layout-driven; `COMMISSION_AMOUNT`/`RATE_AMOUNT` columns silently stripped without `billing.view`. Requires **one** client + **one** product. |
| **API** | `GET /commission-rates` (+ `/export`, `/import`) ([commissionRates/routes.ts](../../apps/api/src/modules/commissionRates/routes.ts)) | **CONFIG, not earnings** — the tariff table. SA-only (`masterdata.manage`). |
| **SDK** | `sdk.billing.cases / caseTasks / breakdown / export`; `sdk.mis.rows / export`; `sdk.commissionRates.list/create/revise/...` ([client.ts:390-431](../../packages/sdk/src/client.ts)) | mirror the API exactly. |
| **Web** | `BillingPage.tsx` | per-case grid (`commissionTotal`) + accordion task lines (assigneeName + per-line commission) + by-location/by-band panels. Filters: client picker + `completedFrom`/`completedTo`. |
| **Web** | `MisPage.tsx` | per-task grid; commission only if the layout defines the column. Filters: client + product (required) + `completedFrom`/`completedTo` + search. |
| **Web** | `CommissionRatesPage.tsx` | tariff config (per-user × rate-type × client/product/unit/tat-band/location × amount). |
| **Web** | `PipelinePage.tsx` | **money columns REMOVED** (ADR-0046 §6); only `billCount`. |

**Notable:** the **billing export columns** are `caseNumber, client, product, status, completedTaskCount,
billTotal, commissionTotal, lastCompletedAt` ([billing/service.ts:41-50](../../apps/api/src/modules/billing/service.ts))
— **no assignee/field-user column at all**.

---

## C. Export & period options — the core question

**Every commission surface filters on a single freeform date range over `ct.completed_at`. There is no
period preset and no period bucketing/grouping anywhere.**

- Billing: `completedFrom`/`completedTo` → `ct.completed_at >= / <= $?`
  ([billing/repository.ts:88-89](../../apps/api/src/modules/billing/repository.ts)).
- MIS: `completedFrom`/`completedTo` → same column ([mis/repository.ts:69-70](../../apps/api/src/modules/mis/repository.ts)).
- SDK query types expose only `clientId? / completedFrom? / completedTo? / search`
  ([billing.ts:85-90](../../packages/sdk/src/billing.ts), [mis.ts:26-37](../../packages/sdk/src/mis.ts)) —
  no `period`/`week`/`month`/`quarter`.
- Web: only `<input type="date">` From/To; a repo-wide search found **no** `weekly`/`monthly`/`quarterly`/
  `fortnight`/`15`/period-picker primitive.
- `breakdown` groups by **location** and **TAT band** only — never by period.

| Period | Status (v2) | Date field | Notes |
|---|---|---|---|
| **Weekly** | **MISSING** | `completedAt` (manual 7-day range) | No auto-bucket, no preset, no per-week grouping. |
| **15-day / fortnightly** | **MISSING** | — | Absent in v2, v1, *and* Zion. |
| **Monthly** | **MISSING** | `completedAt` (manual range) | No preset/grouping. |
| **Quarterly** | **MISSING** | `completedAt` (manual range) | No preset/grouping. |

**What exists today:** a user can manually type a single date range and export the per-case (billing) or
per-task (MIS) grain. They cannot request "give me each agent's weekly commission," cannot get rows bucketed
by period, and cannot select a preset.

**GAP-5 (period anchor mismatch):** commission freezes at `submitted_at` but the filter keys on
`completed_at`. Consequences: (a) a task **submitted but not yet completed** has `completed_at IS NULL` →
**excluded** by any date filter (its frozen commission never appears in a dated export); (b) a task submitted
in period-1 but completed in period-2 lands its commission in **period-2's** range. Low impact while most
tasks complete same-day, but it makes any future "commission by period" report attribute to the wrong period
unless it anchors on `submitted_at`/a `COALESCE`.

---

## D. Aggregation dimensions

| Dimension | Status | Evidence |
|---|---|---|
| **(a) per field-user** | **MISSING** (as an aggregation) | Billing is per-case; assignee appears only in accordion lines + as an MIS column. No GROUP BY user, no per-user total, no assignee in the billing export. |
| **(b) per client + product** | **PARTIAL** | Billing filterable by `clientId` (per-client); rows carry product. MIS is inherently scoped to one client+product. No client+product **rollup**, but filterable. |
| **(c) field-user × client × product** | **MISSING** | No surface produces this matrix. |

The operational purpose of the data is **to pay agents** (export-only, paid outside the CRM). Paying agents
needs per-field-user totals over a pay period — exactly the two things that are missing (D-a + C).

---

## E. v1 cross-check (`/Users/mayurkulkarni/Downloads/CRM-APP-MONOREPO-PROD`)

- **Calculation:** per-task fixed amount from `field_user_commission_assignments` (FUCA), keyed
  `user_id × rate_type_id × client_id?` (client NULL = global), effective-dated, most-specific-wins; written
  to `commission_calculations` on task completion (`autoCalculateCommissionForTask`,
  `commissionManagementController.ts:1100-1251`). No `bill_count` multiplier, no percentage.
- **Pivot export — the key parity item:** `GET /commission-management/pivot/export`
  (`commissionManagementController.ts:1921-2036`) supported **period presets `week / month / quarter / year /
  all` + `custom` (dateFrom/dateTo)**, keyed on **`cc.case_completed_at`**, pivotable **user × client ×
  product × rate_type** (rows/cols/subRows configurable). `commissions/summary` had the same period presets.
- **Aggregation:** per-field-user ✓, per client+product ✓, combined ✓ (4-D pivot rolled to 3-D + 1-D cells).
- **Missing in v1 too:** **fortnightly/15-day** (not in the period enum); period presets on the line-level
  export (custom range only); commission in the MIS dashboard (task metrics only).

**Net:** v2 is **behind v1** on commission reporting — v1 shipped period-pivot + per-user aggregation; v2 has
neither.

---

## F. Zion cross-check (parity yardstick)

Reference material: `docs/specs/2026-06-15-lifecycle-audit/05-zion.md`; v1
`docs/acs-simplification-audit-2026-06-04/ZION_CRM_REVERSE_ENGINEERING_AUDIT_2026-06-04.md` §4.

- **Zion has no commission engine** — field executives are **salaried**. Billing is derived **inline at
  assignment** (operator picks Case Area → `LOCAL/OGL1/OGL2` + visit-type + a per-document `BILL Y/N`), fed
  straight into a bank-mandated 95-column MIS Excel.
- **Reporting:** one-click MIS Excel by **manual date range only** — **no weekly/fortnightly/monthly/
  quarterly presets**. A separate `VisitCounts.aspx` gives **per-executive** visit counts
  (LOCAL/OGL1/OGL2/TOTAL) — the closest analog to "per field-user," but counts, not commission.
- **Verdict:** Zion is **not a commission parity model**. For the period yardstick it also has no presets; its
  one relevant idea is the **per-executive report** + inline-at-assignment billing coherence (MIS and finance
  can't diverge). v1's pivot is the better yardstick for "periodic per-agent commission."

---

## Gap dispositions

| ID | Gap | Disposition | Rationale |
|---|---|---|---|
| **FC-1** | No periodic commission export — weekly / monthly / quarterly presets or bucketing | **FIXED-needed** | This is the literal ask; v1 shipped it; it is pure read-model/export → **inside** the export-only scope (not the WONTFIX'd invoice/GST/payout). Recommend period presets + a period-bucketed export on billing (and/or MIS). |
| **FC-2** | No per-field-user aggregation/export (assignee absent from billing export) | **FIXED-needed** | The operational purpose is paying agents per period; without a per-agent total the export can't drive payout. v1 had it via pivot. |
| **FC-3** | 15-day / fortnightly period | **DEFERRED** | No precedent (absent in v1 and Zion); a net-new ask. Build with FC-1 only if the actual pay cycle is fortnightly — confirm with owner. |
| **FC-4** | field-user × client × product pivot | **DEFERRED** | Composes FC-1 + FC-2; build after the per-agent view lands. |
| **FC-5** | Period filter anchors on `completed_at`; commission freezes at `submitted_at` (SUBMITTED rows dropped; cross-period attribution) | **DEFERRED** | Low impact today (same-day completions). Any FC-1 build should anchor the commission period on `submitted_at`/`COALESCE` and decide SUBMITTED inclusion. |
| **FC-6** | OFFICE/desk task earns silent ₹0 when no OFFICE rate configured (no assign-time block, unlike FIELD) | **WONTFIX (known)** | By-design fail-soft for desk; already tracked as the CEO launch-checklist "pre-seed OFFICE rates / ₹0 indicator." |
| **FC-7** | Invoice generation + GST + commission **payout** engine | **WONTFIX** | Owner 2026-06-25: billing/commission = export-only; invoicing/GST in Tally, agents paid externally. |
| **FC-8** | `bill_count` multiplier vestigial (every task ×1 since SHIP-2) | **WONTFIX (note)** | Harmless; full column/multiplier retirement is a later cleanup already logged at SHIP-2. |

---

## Coverage matrix — v2 vs v1 vs Zion

`{weekly, 15-day, monthly, quarterly} × {per-field-user, per-client-product}` for **commission** export/report.

| Period | Aggregation | **v2 (CRM2)** | **v1** | **Zion** |
|---|---|---|---|---|
| Weekly | per-field-user | ✗ | ✓ pivot (rows=user, period=week) | n/a — salaried¹ |
| Weekly | per-client-product | ✗² | ✓ pivot (rows/cols=client/product) | manual date-range MIS only³ |
| 15-day | per-field-user | ✗ | ✗ | n/a¹ |
| 15-day | per-client-product | ✗ | ✗ | ✗ |
| Monthly | per-field-user | ✗ | ✓ pivot | n/a¹ |
| Monthly | per-client-product | ✗² | ✓ pivot | manual date-range MIS only³ |
| Quarterly | per-field-user | ✗ | ✓ pivot | n/a¹ |
| Quarterly | per-client-product | ✗² | ✓ pivot | manual date-range MIS only³ |

✓ = supported · ✗ = missing · n/a = not applicable.
¹ Zion field execs are salaried — no commission; the nearest analog is the per-executive *visit-count* report.
² v2 can filter by `clientId` over a **single manual date range** (not period-bucketed, not aggregated per
client+product) — so "partial filter, no period rollup."
³ Zion exports billing MIS per portfolio (≈client×product) over a manual date range — **no period presets**.

---

*Read-only audit. Findings dispositioned per `docs/COMPLIANCE_GAPS_REGISTRY.md` conventions; no code,
schema, or frozen decision changed. Recommend FC-1 + FC-2 (with FC-5 baked in) as the one shippable unit if
the owner wants periodic per-agent commission export — it restores v1 parity within the export-only scope.*
