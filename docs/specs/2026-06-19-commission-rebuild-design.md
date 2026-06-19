# Commission Rebuild — Design Spec (ADR-0046)

- **Date:** 2026-06-19
- **ADR:** [ADR-0046](../adr/ADR-0046-commission-location-and-tat-dimensions.md) (Accepted) — supersedes ADR-0036 §1–3.
- **Depends on:** ADR-0044 TAT (shipped) — `tat_policies`, `case_tasks.completed_elapsed_minutes`, the completed-in band.
- **Companion audit:** [COMMISSION_RATE_CROSS_AUDIT_2026-06-18](../engineering/COMMISSION_RATE_CROSS_AUDIT_2026-06-18.md) (COMPLIANCE_GAPS §G, findings G-1…G-7).
- **Build branch:** `worktree-feat-commission-rebuild` (fresh off `origin/main` `22bfdfc`).
- **Acceptance:** the audit §E multi-pincode worked example yields **per-location** commission amounts.

This spec is the implementation contract. It transcribes ADR-0046's locked decisions and pins every CTO-level decision the ADR delegated to "the build spec." Production code does not start until the bite-sized plan ([docs/plans/2026-06-19-commission-rebuild-plan.md](../plans/2026-06-19-commission-rebuild-plan.md)) exists.

---

## 0. Scope & non-scope

**In scope (ADR-0046 §1–8):**
1. Decouple commission from the client rate (`cmr.rate_type = rt.rate_type` join **removed**).
2. `commission_rates` gains `location_id`, `product_id`, `verification_unit_id`, `tat_band` dimensions (all nullable = "applies generally").
3. Most-specific-match resolution cascade mirroring `RATE_LATERAL` (location) + exact-match-wins (other dims), decoupled from the client rate.
4. Commission consumes the completed-in TAT band; **point-in-time** resolution as-of `completed_at` (see §5 — realizes ADR-0046 §4's stability goal read-derived, no persistence).
5. `bill_count` rollup fix (§G-2): `bill_total`/`commission_total` weighted by `ct.bill_count`.
6. Remove the pipeline "Commissionable" surface **and** the pipeline bill/commission columns (§G-3); money lives only on the `billing.view` Billing & Commission page, redesigned with a per-pincode/area breakdown + completed-in-band view.
7. Effective-dating + OCC + generalized no-overlap EXCLUDE preserved.
8. RBAC unchanged — config = `masterdata.manage`, amounts = `billing.view`. **No new permission.**

**Out of scope / deferred (explicit):**
- **Persisted commission ledger / snapshot columns** — NOT built. ADR-0046 §4's stability goal is met by point-in-time read (§5). Persistence remains the future "engine slice" (ADR-0036 §CARRY). Owner 2026-06-19: "ADR-0047 is other session work" → not constrained by, nor coordinating with, the two-stage lifecycle session.
- **`RATE_LATERAL` (client bill) temporal basis** — stays `now()`. ADR-0046 §4 ("rates later never rewrites historical commission") concerns `commission_rates`, not the client `rates` table. Untouched.
- **ADR-0047 (SUBMITTED gate)** — separate session. This build keeps the commission gate at `status = 'COMPLETED'` (current read-models). The §5 anchor `COALESCE(ct.completed_at, now())` is forward-compatible with a later gate move.
- **Mobile** — commission is a back-office read-model; mobile does not read it. Additive-only, `/api/v2` unbroken.

---

## 1. Decisions delegated by the ADR — locked here (CTO)

| # | Question (ADR-0046 / audit) | Locked decision |
|---|---|---|
| D-a | `tat_band` column type | `integer`, **no FK**. Values = `tat_policies.tat_hours` (4/6/8/12/24/48), or `-1` (completed out-of-band / overflow), or `NULL` (= "any band"). Matches the read-model `completed_tat_band` exactly. No FK because `-1` (overflow) has no `tat_policies` row. |
| D-b | EXCLUDE NULL-sentinel for `tat_band` | `COALESCE(tat_band, 0)` — `0` is never a valid band (bands are positive or `-1`), so it is a safe "any" sentinel that never collides with a real band. |
| D-c | `rate_type` disposition | **Keep the column**, make it **NULLABLE**, relabel as the optional executive **classification** label (LOCAL/OGL/OUTSTATION — descriptive only). **Removed from resolution** (lateral drops the join). **Kept in the EXCLUDE** as `COALESCE(rate_type,'')` so existing rows (which may differ only by `rate_type`) do not collide when the new constraint is created. Going forward new rows set it NULL or a label. |
| D-d | Cascade tie-break order | **Location cascade first** (task.area > task.pincode > case.area > case.pincode > location-less), **then** client, **then** product, **then** verification-unit, **then** tat_band specificity (each non-NULL/exact wins over NULL/any), **then** `cmr.id DESC` for determinism. Rationale: the executive's location is the primary classifier (ADR-0046 §3); the other dims are overrides. |
| D-e | Temporal anchor | `COALESCE(ct.completed_at, now())` for the amount filter **and** the band derivation (§5). |
| D-f | `bill_count` semantics (§G-2, ADR §5) | **Amounts** `× ct.bill_count`: `bill_total = SUM(rt.bill_amount * ct.bill_count)`, `commission_total = SUM(com.commission_amount * ct.bill_count)`. `bill_count = 0` ⇒ that line contributes ₹0 (CHECK allows `>= 0`). **`completed_task_count` stays `count(*)`** (operational task count). Expose **`billable_units = SUM(ct.bill_count)`** as the unit-weighted count alongside. |
| D-f2 | per-task line amounts | `BillingTaskLine` returns raw `billAmount`/`commissionAmount` **and** `billCount`; the page shows `× billCount` line totals. Aggregates use the `× bill_count` SUMs (D-f). |
| D-g | `resolveAmount` (dead code) | **Retire** `commissionRateRepository.resolveAmount` + its unit test (`commissionRates.api.test.ts` "resolveAmount: most-specific-client-wins…"). It is unused in production (grep: only its own def + that test reference it); the live resolver is `COMMISSION_LATERAL`. Resolution is covered by the §E integration test + extended billing/pipeline API tests. Avoids a third resolver sync-point. |
| D-h | Pipeline money | Remove the Commissionable **bucket** AND the **billAmount/commissionAmount columns** entirely (ADR-0046 §6). `canViewBilling` + `money()` usages in `PipelinePage.tsx` removed if unused. Server tasks API unchanged (additive-only; the fields stay, just unused by FE). |

---

## 2. Data model — migration `0079`

File: `db/v2/migrations/0079_commission_rates_dimensions.sql`. Forward-only, additive, idempotent. Mirror the `rates` multi-dimension no-overlap pattern (`0013_rate_management_flatten.sql:26-36`).

```sql
-- 0079_commission_rates_dimensions.sql — commission_rates gains location, product,
-- verification-unit, and TAT-band dimensions, decoupled from the client rate (ADR-0046).
-- rate_type is retained as an OPTIONAL executive classification label (no longer a resolution
-- key) — kept in the no-overlap key as COALESCE(rate_type,'') so existing rows never collide.
-- The GiST no-overlap EXCLUDE + resolve index generalize to the coalesced dimension tuple.
-- Existing rows: all new columns NULL => the "applies generally" default for their (user, client).
-- Additive, forward-only, idempotent. Preserves effective-dating + OCC.
BEGIN;

ALTER TABLE commission_rates
  ADD COLUMN IF NOT EXISTS location_id          integer REFERENCES locations (id),
  ADD COLUMN IF NOT EXISTS product_id           integer REFERENCES products (id),
  ADD COLUMN IF NOT EXISTS verification_unit_id integer REFERENCES verification_units (id),
  ADD COLUMN IF NOT EXISTS tat_band             integer;            -- tat_hours | -1 overflow | NULL=any

-- rate_type is no longer required (it is now an optional classification label).
ALTER TABLE commission_rates ALTER COLUMN rate_type DROP NOT NULL;

-- Regenerate the no-overlap EXCLUDE over the generalized tuple (drop the rate_type/client-only one).
ALTER TABLE commission_rates DROP CONSTRAINT IF EXISTS commission_rates_no_overlap;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rates_no_overlap') THEN
    ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_no_overlap EXCLUDE USING gist (
      user_id WITH =,
      (COALESCE(location_id, -1)) WITH =,
      (COALESCE(client_id, -1)) WITH =,
      (COALESCE(product_id, -1)) WITH =,
      (COALESCE(verification_unit_id, -1)) WITH =,
      (COALESCE(tat_band, 0)) WITH =,
      (COALESCE(rate_type, '')) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;

-- Resolve path: most-specific-wins over (user, location, client, product, VU, tat_band).
DROP INDEX IF EXISTS idx_commission_rates_resolve;
CREATE INDEX IF NOT EXISTS idx_commission_rates_resolve
  ON commission_rates (user_id, location_id, client_id, product_id, verification_unit_id, tat_band)
  WHERE is_active;

COMMIT;
```

**Migration safety note:** keeping `COALESCE(rate_type,'')` in the EXCLUDE means existing rows that previously differed only by `rate_type` remain valid under the new constraint. The constraint creation will not fail on existing data. (If any duplicate-on-the-new-tuple rows exist with `rate_type` NULL/equal, the migration would surface a `23P01` — verified absent for current data; the build task runs the migration on the ephemeral test DB and confirms.)

---

## 3. Resolution — `COMMISSION_LATERAL` rewrite

File: `apps/api/src/platform/billing/laterals.ts`. **`RATE_LATERAL` is unchanged.** Replace `COMMISSION_LATERAL` (lines 35–42) with the decoupled, dimensioned, point-in-time cascade. Update the doc comment (lines 33–34) — it no longer references `rt.rate_type`, so the "must follow RATE_LATERAL" coupling is gone (it may now precede or follow; keep placement to minimize diff).

```ts
/** The assignee's commission, resolved from the executive's OWN location + dims (ADR-0046),
 *  DECOUPLED from the client rate (no rate_type join). Most-specific cascade: location
 *  (task.area > task.pincode > case.area > case.pincode > location-less) then client > product >
 *  unit > tat_band specificity. Point-in-time as-of COALESCE(ct.completed_at, now()) so editing
 *  rates/tat_policies later never rewrites a completed task's commission (ADR-0046 §4). The
 *  completed-in band is derived from completed_elapsed_minutes vs tat_policies as-of the same
 *  anchor. LIMIT 1 → 1:1 (COUNT/SUM stay exact). */
export const COMMISSION_LATERAL = `LEFT JOIN LATERAL (
    SELECT cmr.amount::float8 AS commission_amount
    FROM commission_rates cmr
    WHERE cmr.user_id = ct.assigned_to AND cmr.is_active
      AND (cmr.client_id IS NULL OR cmr.client_id = cs.client_id)
      AND (cmr.product_id IS NULL OR cmr.product_id = cs.product_id)
      AND (cmr.verification_unit_id IS NULL OR cmr.verification_unit_id = ct.verification_unit_id)
      AND (cmr.tat_band IS NULL OR cmr.tat_band = (
            COALESCE(
              (SELECT tp.tat_hours FROM tat_policies tp
                 WHERE tp.is_active
                   AND tp.effective_from <= COALESCE(ct.completed_at, now())
                   AND (tp.effective_to IS NULL OR tp.effective_to > COALESCE(ct.completed_at, now()))
                   AND tp.tat_hours >= CEIL(ct.completed_elapsed_minutes / 60.0)
                 ORDER BY tp.tat_hours ASC LIMIT 1),
              CASE WHEN ct.completed_elapsed_minutes IS NULL THEN NULL ELSE -1 END)))
      AND cmr.effective_from <= COALESCE(ct.completed_at, now())
      AND (cmr.effective_to IS NULL OR cmr.effective_to > COALESCE(ct.completed_at, now()))
    ORDER BY (cmr.location_id = ct.area_id)    DESC NULLS LAST,
             (cmr.location_id = ct.pincode_id) DESC NULLS LAST,
             (cmr.location_id = cs.area_id)    DESC NULLS LAST,
             (cmr.location_id = cs.pincode_id) DESC NULLS LAST,
             (cmr.location_id IS NULL)         DESC,
             cmr.client_id            DESC NULLS LAST,
             cmr.product_id           DESC NULLS LAST,
             cmr.verification_unit_id DESC NULLS LAST,
             cmr.tat_band             DESC NULLS LAST,
             cmr.id                   DESC
    LIMIT 1) com ON true`;
```

**Notes**
- The `tat_band` match: when the completed band is `NULL` (task not completed / no elapsed), `cmr.tat_band = NULL` is NULL ⇒ only `cmr.tat_band IS NULL` (any-band) rows match. Correct — a non-completed task only earns from any-band rates (and in the billing read-model every task is `COMPLETED` anyway).
- The lateral is shared by the **billing** read-model and the **pipeline (tasks)** read-model. For non-completed pipeline tasks, the anchor is `now()` (live preview, unchanged). For completed tasks, `completed_at` (stable). Both stay consistent.
- **`resolveAmount` is retired (D-g);** the lateral is the single commission resolver. (The `rates` rate_type display subquery in `cases/repository.ts:139-149` is untouched — RATE_LATERAL is unchanged, so the ⚠ sync obligation in the laterals.ts header is not triggered.)

---

## 4. Billing rollup — `bill_count` fix + breakdown

File: `apps/api/src/modules/billing/repository.ts`.

**4.1 `listCases` aggregate (lines 80–83)** — weight amounts by `bill_count`, add `billable_units`:

```sql
count(*)::int                                          AS completed_task_count,
COALESCE(SUM(ct.bill_count), 0)::int                   AS billable_units,
COALESCE(SUM(rt.bill_amount * ct.bill_count), 0)::float8  AS bill_total,
COALESCE(SUM(com.commission_amount * ct.bill_count), 0)::float8 AS commission_total,
max(ct.completed_at)                                   AS last_completed_at
```

**4.2 `caseTasks` per-task lines (lines 108–110)** — add `bill_count` (+ the completed-in band for display):

```sql
SELECT ct.id AS task_id, ct.task_number, vu.name AS unit_name, au.name AS assignee_name,
       ct.task_origin AS billing_class, ct.visit_type, rt.rate_type,
       rt.bill_amount, com.commission_amount, ct.bill_count, ct.completed_at,
       COALESCE((SELECT tp.tat_hours FROM tat_policies tp
          WHERE tp.is_active AND tp.effective_from <= COALESCE(ct.completed_at, now())
            AND (tp.effective_to IS NULL OR tp.effective_to > COALESCE(ct.completed_at, now()))
            AND tp.tat_hours >= CEIL(ct.completed_elapsed_minutes / 60.0)
          ORDER BY tp.tat_hours ASC LIMIT 1),
          CASE WHEN ct.completed_elapsed_minutes IS NULL THEN NULL ELSE -1 END) AS tat_band
```

**4.3 New breakdown query — `breakdown(o)`** — by pincode/area + by completed-in band, over the same filter as `listCases` (reuse the WHERE builder). One method returning both groupings (single round-trip, two CTE/queries acceptable). Gated `billing.view` (same as the page).

```sql
-- by location (group on the task's resolved location: area first, else pincode, else 'unmapped')
SELECT COALESCE(ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)         AS location_id,
       l.pincode, l.area,
       count(*)::int                                          AS completed_task_count,
       COALESCE(SUM(ct.bill_count), 0)::int                   AS billable_units,
       COALESCE(SUM(rt.bill_amount * ct.bill_count), 0)::float8  AS bill_total,
       COALESCE(SUM(com.commission_amount * ct.bill_count), 0)::float8 AS commission_total
${CASES_FROM} ${clause}
LEFT JOIN locations l ON l.id = COALESCE(ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)
GROUP BY 1, l.pincode, l.area
ORDER BY commission_total DESC

-- by completed-in band (the <tat_band derivation> as in 4.2, aliased completed_band)
SELECT <completed_band> AS band,
       count(*)::int AS completed_task_count,
       COALESCE(SUM(ct.bill_count),0)::int AS billable_units,
       COALESCE(SUM(rt.bill_amount * ct.bill_count),0)::float8 AS bill_total,
       COALESCE(SUM(com.commission_amount * ct.bill_count),0)::float8 AS commission_total
${CASES_FROM} ${clause}
GROUP BY 1 ORDER BY 1
```

Routes: `apps/api/src/modules/billing/routes.ts` — add `GET /breakdown` (gated `billing.view`), same query-param contract as `GET /cases` (clientId, completedFrom/To, search). Service composes `billingRepository.breakdown`.

---

## 5. Point-in-time stability (ADR-0046 §4) — how it is realized

ADR-0046 §4 requires "editing `tat_policies` or rates later never rewrites historical commission." Realized **read-derived, no persistence** (owner-approved 2026-06-19):
- The amount filter and the band derivation both anchor to `COALESCE(ct.completed_at, now())`.
- `commission_rates` and `tat_policies` are **effective-dated** (revise end-dates the old row + inserts a new one; rows are never hard-deleted). An as-of-`completed_at` read therefore returns exactly the row that was effective when the task completed — stable forever, even after later revisions.
- `completed_elapsed_minutes` is already immutable-stamped at completion (`cases/repository.ts:736,1116`). So the band inputs are frozen; only the policy lookup needed anchoring — now done.

This delivers §4's guarantee without snapshot columns, a ledger, or any write on the completion path. (Literal stored-snapshot persistence stays the future engine slice — ADR-0036 §CARRY.)

---

## 6. SDK — additive (`packages/sdk`)

**6.1 `commissionRates.ts`** — extend interfaces (all new fields nullable) + Zod schemas (additive, `.nullish()`):

```ts
export interface CommissionRate {
  // …existing…
  rateType: string | null;            // CHANGED: now nullable (optional classification label)
  locationId: number | null;          // NEW
  productId: number | null;           // NEW
  verificationUnitId: number | null;  // NEW
  tatBand: number | null;             // NEW (tat_hours | -1 overflow | null=any)
}
export interface CommissionRateView extends CommissionRate {
  // …existing userName/clientCode/clientName…
  productCode: string | null;            // NEW
  productName: string | null;            // NEW
  verificationUnitName: string | null;   // NEW
  pincode: string | null;                // NEW
  area: string | null;                   // NEW
}
// CreateCommissionRateSchema: rateType -> .nullish(); add locationId/productId/
//   verificationUnitId (positiveInt.nullish()), tatBand (z.number().int().nullish()).
// ReviseCommissionRateSchema: amount + effectiveFrom only (dimensions are fixed at create;
//   revise = new effective-dated amount). UNCHANGED.
```

**6.2 `billing.ts`** — extend `BillingCaseRow` (`billableUnits`), `BillingTaskLine` (`billCount`, `tatBand`), add breakdown types:

```ts
export interface BillingCaseRow { /* …; */ billableUnits: number; }
export interface BillingTaskLine { /* …; */ billCount: number; tatBand: number | null; }
export interface BillingLocationGroup {
  locationId: number | null; pincode: string | null; area: string | null;
  completedTaskCount: number; billableUnits: number; billTotal: number; commissionTotal: number;
}
export interface BillingBandGroup {
  band: number | null; completedTaskCount: number; billableUnits: number;
  billTotal: number; commissionTotal: number;
}
export interface BillingBreakdown { byLocation: BillingLocationGroup[]; byBand: BillingBandGroup[]; }
```

**6.3 client** — add `sdk.billing.breakdown(query)` GET method; cover it in `packages/sdk/src/client.test.ts` (URL + method + params) — coverage gate. The list view (`commissionRates.list`) gains the new view fields automatically.

---

## 7. Web

**7.1 `apps/web/src/features/commissionRates/CommissionRatesPage.tsx`** — form gains, cloning the `RateManagementPage` `SearchableSelect` + cascading-location pattern (`apps/web/src/features/rateManagement/RateManagementPage.tsx:55-117,416-501`):
- Client (existing, optional) · Product (optional, `/products/options`) · Verification Unit (optional, `/verification-units/options`).
- Cascading **pincode** (server-search `/locations/pincodes?q=`) → **area** (`/locations?pincode=…`) → sets `locationId`. All optional (blank = applies generally).
- **TAT band** select from `/tat-policies?active=true` (label + `tatHours` value) plus an explicit "Out of band (−1)" option and "Any" (null).
- **Classification** (optional free label) — the repurposed `rate_type` (LOCAL/OGL/OUTSTATION); no longer required, no resolution effect.
- DataGrid: add Product / Unit / Location (pincode — area) / TAT-band columns ("Any" when null). Revise dialog unchanged (amount + effectiveFrom + version).

**7.2 `apps/web/src/features/billing/BillingPage.tsx`** — redesign: keep the case grid (now with `billable_units` + corrected `× bill_count` totals); add two breakdown panels fed by `sdk.billing.breakdown(filter)` — **By pincode/area** (location, count, units, bill, commission) and **Completed-in TAT band** (band, count, units, bill, commission). Per-task accordion lines show `× billCount` line totals + the per-task completed-in band. Band label: `−1` → "Out of band", `N` → `≤Nh`.

**7.3 `apps/web/src/features/pipeline/PipelinePage.tsx`** — remove (ADR-0046 §6 / D-h): the Commissionable bucket (`BUCKETS` line ~60) + its search-param wiring (`commissionable` decode ~79, the `next.delete/set('commissionable')` ~85/87, the DataGrid `filters` `commissionable` ~298) **and** the `billAmount`/`commissionAmount` columns (~201–216). Remove `canViewBilling` + `money` import if they become unused. Verify the page still compiles + renders status/overdue buckets + bulk-assign.

---

## 8. RBAC (unchanged) & mobile

- Config writes stay `masterdata.manage` (SUPER_ADMIN); amounts stay `billing.view` (MANAGER + BACKEND_USER + SA). The new `GET /billing/breakdown` is `billing.view`-gated. The location dimension needs no new permission (scope registry already has PINCODE/AREA). Confirmed: `packages/access/src/permissions.ts`, `0059_billing_view_perm.sql`.
- **Mobile:** no consumer of commission/billing read-models; `/api/v2` additive-only. Verify no mobile endpoint shape changes (none in this build).

---

## 9. Acceptance test (audit §E)

Integration test (DATABASE_URL, ephemeral PG :5433). Seed: client C, product P, unit VU; locations L1, L2; `rates` R-L1(loc L1, ₹350), R-L2(loc L2, ₹500); agent U; commission `CR-base(U, all-NULL, ₹50)` + `CR-L2(U, location=L2, ₹90)`. Case CASE-1, two COMPLETED tasks `T1(area=pincode=L1)`, `T2(area=pincode=L2)`, same assignee U, `bill_count=1`.

**Assert (the §E discriminator):**
- T1 commission = **₹50** (matches CR-base only); T2 commission = **₹90** (matches CR-L2, more specific) — *different commission when only location differs* (today both ₹50).
- `commission_total = ₹140` (was ₹100); `bill_total = ₹850`; `completed_task_count = 2`.
- A `bill_count = 3` variant of T2 ⇒ its bill line = `₹500×3`, commission line = `₹90×3`; `billable_units = 4`.
- `breakdown.byLocation` has two rows (L1 ₹50, L2 ₹90); `byBand` groups by completed-in band.

---

## 10. Sync obligations & risks

- **`cases/repository.ts:139-149`** rate_type display subquery — NOT changed (RATE_LATERAL unchanged). The laterals.ts ⚠ header note stays valid.
- **Lateral complexity / perf** — the per-row band subquery hits the 6-row `tat_policies`; negligible. Mitigated by the `idx_commission_rates_resolve` index over the new tuple.
- **`bill_count` changes live historical totals** — by design (read-derived). All existing completed tasks with `bill_count ≠ 1` immediately reflect corrected totals (G-2). Acceptable in the dev-only prod env; note in COMPLIANCE §G.
- **OpenAPI** — regenerate (`pnpm openapi`) for the new `/billing/breakdown` + changed shapes.

---

## 11. Test plan (TDD per slice)

1. Migration `0079`: apply on test DB; assert columns + EXCLUDE (overlap on the new tuple rejected with `23P01`) + index; existing rows still valid.
2. `COMMISSION_LATERAL`: the §E integration test (per-location amounts; decoupled-from-rate_type proof) + tat_band match + as-of-`completed_at` stability (revise a rate's amount after completion ⇒ historical commission unchanged).
3. Billing rollup: `bill_count` weighting (incl. `bill_count=0` ⇒ ₹0 line, `=3` ⇒ ×3) + `billable_units`.
4. Breakdown: byLocation rows per pincode/area; byBand grouping.
5. SDK: schema round-trip for the new fields; `client.test.ts` for `billing.breakdown`.
6. commissionRates create/revise with the new dims (no-overlap on the new tuple); list view returns the new display fields.
7. Web: build green; live browser-verify the §E scenario (configure CR-L2, run the case, confirm per-location amounts + breakdown; confirm the pipeline has no money surface).
8. Full `pnpm verify` GREEN (sentinel `$?`, not `| tail`).
