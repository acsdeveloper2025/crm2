# Commission Rebuild Implementation Plan (ADR-0046)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Authoritative companion:** [docs/specs/2026-06-19-commission-rebuild-design.md](../specs/2026-06-19-commission-rebuild-design.md). The spec holds the exact migration DDL (§2), the full `COMMISSION_LATERAL` SQL (§3), the rollup/breakdown SQL (§4), and the SDK/web details (§6–7). Each task below references the spec section it implements; **read that section before the task.** When this plan shows code, it is the implementation — type it as written.

**Goal:** Rebuild field-executive commission to resolve from the executive's own location + client + product/VU + completed-in-TAT-band, decoupled from the client rate, fix the `bill_count` rollup, remove the pipeline money surface, and add a per-pincode/area + by-band Billing breakdown.

**Architecture:** Read-derived (no ledger). One additive migration (`0079`) adds nullable dimensions + a generalized GiST no-overlap EXCLUDE. The shared `COMMISSION_LATERAL` SQL becomes a most-specific location+dims cascade resolved point-in-time as-of `COALESCE(ct.completed_at, now())`. SDK + web are additive; the pipeline loses its money surface.

**Tech Stack:** Node 24, pnpm monorepo, Postgres 18 (raw SQL in repositories + migrations only), Express + `@crm2/sdk`, React + react-query (web), Vitest + supertest (integration tests need `DATABASE_URL` on `:5433`, `LC_ALL=C`).

**Commit rule (CONTRIBUTING.md):** author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional commits, **NO AI / Co-Authored-By trailer**, never `--no-verify`. Commit only at green steps. **Never push/merge/deploy** without explicit owner OK.

**Verify after every task:** `pnpm verify` is the gate (typecheck → lint → format → no-suppressions → boundaries → test → build). Capture the exit code in a sentinel — do NOT pipe to `tail` (it masks `$?`): `pnpm verify; echo "EXIT=$?"`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `db/v2/migrations/0079_commission_rates_dimensions.sql` | Add dims + regen EXCLUDE/index | 1 |
| `apps/api/src/platform/billing/laterals.ts` | `COMMISSION_LATERAL` rewrite | 2 |
| `apps/api/src/modules/commissionRates/repository.ts` | retire `resolveAmount`; create/revise/list gain dims | 2, 6 |
| `apps/api/src/modules/commissionRates/{service,routes,controller,import}.ts` | validate + carry new dims | 6 |
| `apps/api/src/modules/billing/repository.ts` | `× bill_count`, `billable_units`, `breakdown()` | 3, 4 |
| `apps/api/src/modules/billing/{service,routes}.ts` | `GET /breakdown` | 4 |
| `packages/sdk/src/commissionRates.ts` | additive fields + schemas | 5 |
| `packages/sdk/src/billing.ts` + `client.ts` + `client.test.ts` | breakdown types + method | 5 |
| `apps/web/src/features/commissionRates/CommissionRatesPage.tsx` | dimension pickers | 7 |
| `apps/web/src/features/billing/BillingPage.tsx` | breakdown panels + corrected totals | 8 |
| `apps/web/src/features/pipeline/PipelinePage.tsx` | remove money surface | 9 |
| `apps/api/src/openapi/openapi.json` (generated) | regen | 10 |

---

## Task 1: Migration 0079 — commission_rates dimensions

**Spec:** §2. **Files:** Create `db/v2/migrations/0079_commission_rates_dimensions.sql`; Test `apps/api/src/modules/commissionRates/__tests__/commissionRates.migration.test.ts`.

- [ ] **Step 1: Write the failing test** — `commissionRates.migration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { query, pool } from '../../../platform/db.js';
// Test harness applies all migrations in db/v2/migrations on connect (see existing __tests__ setup).

describe('0079 commission_rates dimensions', () => {
  it('has the new dimension columns', async () => {
    const cols = await query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'commission_rates'
         AND column_name = ANY($1)`,
      [['location_id', 'product_id', 'verification_unit_id', 'tat_band']],
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['location_id', 'product_id', 'tat_band', 'verification_unit_id'],
    );
    expect(cols.every((c) => c.is_nullable === 'YES')).toBe(true);
  });

  it('rate_type is now nullable', async () => {
    const [rt] = await query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name='commission_rates' AND column_name='rate_type'`,
    );
    expect(rt?.is_nullable).toBe('YES');
  });

  it('no-overlap EXCLUDE rejects two active rows on the same (user,location,client,product,vu,band) period', async () => {
    const [{ id: uid }] = await query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash)
       VALUES ('mig79@x.io','Mig 79','SUPER_ADMIN','x') RETURNING id`,
    );
    const ins = (loc: number | null) =>
      query(
        `INSERT INTO commission_rates (user_id, location_id, amount) VALUES ($1, $2, 10)`,
        [uid, loc],
      );
    await ins(null);
    await ins(7); // different location -> OK (no overlap)
    await expect(ins(7)).rejects.toMatchObject({ code: '23P01' }); // same tuple+period -> reject
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @crm2/api test commissionRates.migration` → FAIL (file/migration missing).

- [ ] **Step 3: Create the migration** — write `db/v2/migrations/0079_commission_rates_dimensions.sql` **exactly as spec §2** (header + `ALTER TABLE … ADD COLUMN`, `ALTER COLUMN rate_type DROP NOT NULL`, drop+recreate `commission_rates_no_overlap` over the coalesced tuple incl. `COALESCE(rate_type,'')` and `COALESCE(tat_band,0)`, drop+recreate `idx_commission_rates_resolve`).

- [ ] **Step 4: Run it, verify it passes** — `pnpm --filter @crm2/api test commissionRates.migration` → PASS.

- [ ] **Step 5: Commit** — `git add db/v2/migrations/0079_commission_rates_dimensions.sql apps/api/src/modules/commissionRates/__tests__/commissionRates.migration.test.ts && git commit -m "feat(db): commission_rates gains location/product/VU/TAT-band dimensions (ADR-0046)"`

---

## Task 2: COMMISSION_LATERAL rewrite + retire resolveAmount

**Spec:** §3, §5, §9, D-d/D-e/D-g. **Files:** Modify `apps/api/src/platform/billing/laterals.ts`; Modify `apps/api/src/modules/commissionRates/repository.ts` (delete `resolveAmount`); Test `apps/api/src/modules/billing/__tests__/billing.commission.test.ts` (new); Modify `apps/api/src/modules/commissionRates/__tests__/commissionRates.api.test.ts` (remove the `resolveAmount` unit test, D-g).

- [ ] **Step 1: Write the failing §E acceptance test** — `billing.commission.test.ts`. Seed exactly the spec §9 scenario through the existing seed helpers / raw SQL (client C, product P, unit VU; locations L1,L2; rates R-L1 ₹350 / R-L2 ₹500; agent U; `CR-base(U, all-NULL, ₹50)`, `CR-L2(U, location=L2, ₹90)`; case CASE-1 with COMPLETED `T1(area=pincode=L1)`, `T2(area=pincode=L2)`, assignee U). Then:

```ts
it('§E: commission differs per-location for the same executive (decoupled from rate_type)', async () => {
  const lines = await billingRepository.caseTasks(caseId); // T1, T2
  const t1 = lines.find((l) => l.taskNumber === t1Number)!;
  const t2 = lines.find((l) => l.taskNumber === t2Number)!;
  expect(t1.commissionAmount).toBe(50); // CR-base
  expect(t2.commissionAmount).toBe(90); // CR-L2 (more specific by location)
  const { items } = await billingRepository.listCases(baseOpts);
  const c = items.find((i) => i.caseId === caseId)!;
  expect(c.commissionTotal).toBe(140); // was 100
  expect(c.billTotal).toBe(850);
  expect(c.completedTaskCount).toBe(2);
});

it('§4: editing a commission rate after completion does NOT rewrite historical commission', async () => {
  await commissionRateRepository.revise(crL2Id, 999, /*effectiveFrom*/ null, saId, crL2Version);
  const lines = await billingRepository.caseTasks(caseId);
  expect(lines.find((l) => l.taskNumber === t2Number)!.commissionAmount).toBe(90); // unchanged (as-of completed_at)
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @crm2/api test billing.commission` → FAIL (T2 resolves ₹50 today; `resolveAmount`/columns not present).

- [ ] **Step 3: Rewrite `COMMISSION_LATERAL`** — replace lines 33–42 of `laterals.ts` with the spec §3 block (decoupled, dimensioned, `ORDER BY` location cascade → client → product → VU → tat_band → `cmr.id DESC`, anchor `COALESCE(ct.completed_at, now())`, inline band subquery). Update the doc comment per spec §3.

- [ ] **Step 4: Retire `resolveAmount`** — delete the `resolveAmount` method from `commissionRates/repository.ts` and delete the `resolveAmount: most-specific-client-wins…` test from `commissionRates.api.test.ts` (D-g). Grep to confirm no remaining references: `grep -rn resolveAmount apps packages` → none.

- [ ] **Step 5: Run it, verify it passes** — `pnpm --filter @crm2/api test billing.commission commissionRates.api` → PASS.

- [ ] **Step 6: Commit** — `git commit -am "feat(api): decouple commission from client rate; location+dims+TAT-band cascade, point-in-time as-of completed_at (ADR-0046)"`

---

## Task 3: Billing rollup — bill_count weighting + billable_units

**Spec:** §4.1, D-f. **Files:** Modify `apps/api/src/modules/billing/repository.ts` (lines 80–83, 108–110); Modify `packages/sdk/src/billing.ts` (`BillingCaseRow.billableUnits`, `BillingTaskLine.billCount` — full schema in Task 5, but add these two now so types compile); Test: extend `billing.commission.test.ts`.

- [ ] **Step 1: Write the failing test** — add to `billing.commission.test.ts`:

```ts
it('bill_count multiplies bill+commission and reports billable_units', async () => {
  await query(`UPDATE case_tasks SET bill_count = 3 WHERE task_number = $1`, [t2Number]);
  const { items } = await billingRepository.listCases(baseOpts);
  const c = items.find((i) => i.caseId === caseId)!;
  expect(c.billTotal).toBe(350 + 500 * 3);        // 1850
  expect(c.commissionTotal).toBe(50 + 90 * 3);    // 320
  expect(c.billableUnits).toBe(4);                // 1 + 3
  expect(c.completedTaskCount).toBe(2);           // task count unchanged
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @crm2/api test billing.commission` → FAIL (`billableUnits` undefined; totals not weighted).

- [ ] **Step 3: Implement** — in `listCases` SELECT (spec §4.1) change `SUM(rt.bill_amount)` → `SUM(rt.bill_amount * ct.bill_count)`, `SUM(com.commission_amount)` → `SUM(com.commission_amount * ct.bill_count)`, add `COALESCE(SUM(ct.bill_count),0)::int AS billable_units`. In `caseTasks` add `ct.bill_count` to the SELECT (spec §4.2). Add `billableUnits: number` to `BillingCaseRow` and `billCount: number` to `BillingTaskLine` in `packages/sdk/src/billing.ts`.

- [ ] **Step 4: Run it, verify it passes** — `pnpm --filter @crm2/api test billing.commission` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "fix(billing): weight bill/commission totals by bill_count; expose billable_units (G-2)"`

---

## Task 4: Billing breakdown — by pincode/area + by completed-in band

**Spec:** §4.3, §6.2. **Files:** Modify `apps/api/src/modules/billing/repository.ts` (add `breakdown()`), `service.ts`, `routes.ts`; `packages/sdk/src/billing.ts` (breakdown types — Task 5 finalizes, add here to compile); Test: `billing.commission.test.ts`.

- [ ] **Step 1: Write the failing test:**

```ts
it('breakdown groups by location and by completed-in band', async () => {
  const bd = await billingRepository.breakdown(baseOpts);
  const l1 = bd.byLocation.find((r) => r.area === 'L1AREA');
  const l2 = bd.byLocation.find((r) => r.area === 'L2AREA');
  expect(l1?.commissionTotal).toBe(50);
  expect(l2?.commissionTotal).toBe(90);
  expect(bd.byBand.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (`breakdown` undefined).

- [ ] **Step 3: Implement** — add `billingRepository.breakdown(o)` (spec §4.3: byLocation `GROUP BY COALESCE(ct.area_id, ct.pincode_id, cs.area_id, cs.pincode_id)` + `locations` join; byBand `GROUP BY` the completed-in band derivation), reusing the same WHERE builder as `listCases` (extract the WHERE/params construction into a shared private helper so it is DRY). Add `GET /breakdown` to `routes.ts` (gated `PERMISSIONS.BILLING_VIEW`), service method `billingService.breakdown(rawQuery, actor)`. Add `BillingLocationGroup`/`BillingBandGroup`/`BillingBreakdown` to `packages/sdk/src/billing.ts`.

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(billing): per-pincode/area + completed-in-band breakdown endpoint (ADR-0046)"`

---

## Task 5: SDK — additive fields, schemas, breakdown client method

**Spec:** §6. **Files:** `packages/sdk/src/commissionRates.ts`, `packages/sdk/src/billing.ts`, `packages/sdk/src/client.ts`, Test `packages/sdk/src/client.test.ts`.

- [ ] **Step 1: Write the failing client test** — add to `client.test.ts` (follow the existing `fakeFetch` pattern):

```ts
it('billing.breakdown builds a versioned URL with query params', async () => {
  const { impl, calls } = fakeFetch(200, { byLocation: [], byBand: [] });
  const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
  await sdk.billing.breakdown({ clientId: 5, completedFrom: '2026-01-01' });
  expect(calls[0]?.url).toBe('http://x/api/v2/billing/breakdown?clientId=5&completedFrom=2026-01-01');
  expect(calls[0]?.init.method).toBe('GET');
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @crm2/sdk test client` → FAIL (`billing.breakdown` not a function).

- [ ] **Step 3: Implement** — in `commissionRates.ts`: make `rateType: string | null`; add `locationId/productId/verificationUnitId/tatBand` (nullable) to `CommissionRate`; add `productCode/productName/verificationUnitName/pincode/area` to `CommissionRateView`; extend `CreateCommissionRateSchema` (`rateType.nullish()`, `locationId/productId/verificationUnitId` `positiveInt.nullish()`, `tatBand z.number().int().nullish()`); leave `ReviseCommissionRateSchema` unchanged (spec §6.1). In `billing.ts` finalize the breakdown types (spec §6.2). In `client.ts` add `breakdown` to the `billing` group (GET `/billing/breakdown` with `paramsFromQuery`).

- [ ] **Step 4: Run it, verify it passes** — `pnpm --filter @crm2/sdk test` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(sdk): commission dimension fields + billing breakdown types/method (ADR-0046)"`

---

## Task 6: commissionRates create/revise/list carry the new dimensions

**Spec:** §1 D-c, §6, §7.1 (server side). **Files:** `apps/api/src/modules/commissionRates/repository.ts` (create/revise/list SELECT + joins), `service.ts` (Zod already in SDK schema), `import.ts` (optional new columns), `routes.ts`/`controller.ts` (no change expected); Test: `commissionRates.api.test.ts`.

- [ ] **Step 1: Write the failing test** — add to `commissionRates.api.test.ts`:

```ts
it('create accepts location/product/VU/tatBand and the list view returns them', async () => {
  const res = await request(app).post('/api/v2/commission-rates').set(SA).send({
    userId, locationId: locId, productId: prodId, verificationUnitId: vuId, tatBand: 24, amount: 70,
  });
  expect(res.status).toBe(201);
  const list = await request(app).get(`/api/v2/commission-rates?userId=${userId}`).set(SA);
  const row = (list.body.items as CommissionRateView[]).find((r) => r.amount === 70)!;
  expect(row.locationId).toBe(locId);
  expect(row.tatBand).toBe(24);
  expect(row.area).toBeTruthy();
});

it('no-overlap holds on the new dimension tuple', async () => {
  const body = { userId, locationId: locId, amount: 5 };
  await request(app).post('/api/v2/commission-rates').set(SA).send(body); // ok
  const dup = await request(app).post('/api/v2/commission-rates').set(SA).send(body); // overlap
  expect(dup.status).toBe(409);
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (columns not inserted/selected).

- [ ] **Step 3: Implement** — `create`/`revise` INSERT: add `location_id, product_id, verification_unit_id, tat_band` columns + binds (carry through `revise`'s end-date+insert so the new version preserves the dimensions; `revise` only changes amount/effective_from). `list` FROM: `LEFT JOIN products p2 ON p2.id = cr.product_id LEFT JOIN verification_units vu2 ON vu2.id = cr.verification_unit_id LEFT JOIN locations l2 ON l2.id = cr.location_id`; SELECT add `p2.code/p2.name`, `vu2.name`, `l2.pincode/l2.area`, `cr.location_id/product_id/verification_unit_id/tat_band`. Update `COLS` used by create/revise RETURNING. `import.ts`: add optional `Location Pincode`/`Product Code`/`Unit Code`/`TAT Band` columns to the import schema + FK resolution (optional — blank = NULL).

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(api): commission-rates CRUD + import carry location/product/VU/TAT-band (ADR-0046)"`

---

## Task 7: Web — CommissionRatesPage dimension pickers

**Spec:** §7.1. **Files:** `apps/web/src/features/commissionRates/CommissionRatesPage.tsx`. No jsdom (frozen stack) → covered by `pnpm build` typecheck + live-verify (Task 10).

- [ ] **Step 1: Implement the form** — clone the `SearchableSelect` + cascading pincode→area pattern from `apps/web/src/features/rateManagement/RateManagementPage.tsx:55-117,416-501`. Add optional Product (`/products/options`), Verification Unit (`/verification-units/options`), cascading Pincode (`/locations/pincodes?q=`) → Area (`/locations?pincode=`) → `locationId`, TAT band (`/tat-policies?active=true` + "Out of band (−1)" + "Any"), and relabel the existing rate-type field as optional **Classification**. Submit the new nullable fields. Add Product / Unit / Location / TAT-band DataGrid columns ("Any" when null). Revise dialog unchanged.

- [ ] **Step 2: Typecheck** — `pnpm --filter @crm2/web build` → PASS (no TS errors).

- [ ] **Step 3: Commit** — `git commit -am "feat(web): commission-rates form gains location/product/VU/TAT-band pickers (ADR-0046)"`

---

## Task 8: Web — Billing & Commission page redesign

**Spec:** §7.2. **Files:** `apps/web/src/features/billing/BillingPage.tsx`.

- [ ] **Step 1: Implement** — keep the case grid; surface `billableUnits` + corrected `× bill_count` totals (already from the API). Add two panels fed by `sdk.billing.breakdown(filter)`: **By pincode/area** and **Completed-in TAT band** (band label: `-1` → "Out of band", `N` → `≤Nh`). Per-task accordion lines show `× billCount` line totals + per-task completed-in band.

- [ ] **Step 2: Typecheck** — `pnpm --filter @crm2/web build` → PASS.

- [ ] **Step 3: Commit** — `git commit -am "feat(web): Billing & Commission page — per-pincode/area + completed-in-band breakdown (ADR-0046)"`

---

## Task 9: Web — remove the pipeline money surface

**Spec:** §7.3, D-h. **Files:** `apps/web/src/features/pipeline/PipelinePage.tsx`.

- [ ] **Step 1: Implement** — delete the Commissionable `BUCKETS` entry (~line 60) + its search-param wiring (`commissionable` decode ~79; `next.delete/set('commissionable')` ~85/87; DataGrid `filters.commissionable` ~298) AND the `billAmount`/`commissionAmount` columns (~201–216). Remove `canViewBilling` + the `money` import if now unused. Keep status/overdue buckets + bulk-assign.

- [ ] **Step 2: Typecheck** — `pnpm --filter @crm2/web build` → PASS (no unused-var/import errors — the gate forbids them).

- [ ] **Step 3: Commit** — `git commit -am "feat(web): remove the pipeline Commissionable + money surface — money lives only on Billing (ADR-0046)"`

---

## Task 10: OpenAPI regen, full verify, live browser-verify

**Spec:** §9, §10, §11.

- [ ] **Step 1: Regenerate OpenAPI** — `pnpm openapi` (regenerates `openapi.json` for the new `/billing/breakdown` + changed shapes). Commit: `git commit -am "chore(api): regenerate openapi.json for /billing/breakdown (ADR-0046)"`.

- [ ] **Step 2: Full gate** — `pnpm verify; echo "EXIT=$?"` → `EXIT=0`. (Integration tests need `DATABASE_URL` on `:5433`, `LC_ALL=C`.) Fix any failure before proceeding.

- [ ] **Step 3: Live browser-verify (§E)** — start the web+api preview; as SUPER_ADMIN configure `CR-L2(U, location=L2, ₹90)` over a base `CR-base(U, ₹50)`; run/complete a case with tasks in two pincodes for executive U; on the Billing & Commission page confirm per-location amounts (T1 ₹50, T2 ₹90; total ₹140) + the by-pincode/area breakdown + the completed-in-band panel; confirm the Pipeline shows **no** money columns or Commissionable bucket. Capture a screenshot.

- [ ] **Step 4: Finalize** (separate task #6 in the orchestration list) — stamp ADR-0036 superseded, update `docs/COMPLIANCE_GAPS_REGISTRY.md §G` (G-1…G-7 → FIXED/DEFERRED), `docs/adr/README.md`, `PROJECT_INDEX.md`, update Claude memory. **Do not push/merge/deploy without explicit owner OK.**

---

## Self-review notes

- **Spec coverage:** §1 decouple → T2; §2 dims → T1/T6; §3 cascade → T2; §4 point-in-time → T2 (the §4 stability test); §5 bill_count → T3; §6 pipeline removal → T9 + breakdown UI T8; §7 EXCLUDE/OCC → T1/T6; §8 RBAC → unchanged (T4 route gate). Audit §E → T2/T3/T4 + T10 live.
- **Type consistency:** `billableUnits`/`billCount`/`tatBand`/`BillingBreakdown`/`billing.breakdown` are introduced in T3–T5 and consumed consistently in T8/T10.
- **Sequencing:** T1→T2 (lateral needs the columns), T3/T4 depend on T2's seed/test file, T5 SDK before T7/T8 web, T6 independent of web. T7–T9 web after SDK (T5). T10 last.
