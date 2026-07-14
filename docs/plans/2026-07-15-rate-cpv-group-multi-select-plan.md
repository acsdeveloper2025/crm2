# Rate + Rate-Type Assignment — CPV group multi-select — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For one client, let an admin multi-select **products × verification units** (a CPV group) on the Rate and Rate-Type-Assignment create pages, instead of only one exact `(product, unit)` slot or Universal = ALL.

**Architecture:** **Frontend only — the server does not change.** Both `/bulk` endpoints already accept exactly one `(product, unit)` slot, so a CPV group is N of those calls: the page resolves the CPV-enabled pairs and loops the existing endpoint, one call per pair. New shared pure helpers live in `apps/web/src/features/cpvGroup/`; each page keeps its own hint/plan helpers as exported pure functions (this codebase has **no render-test infra** — all logic is unit-tested through exported functions).

**Tech Stack:** React 19 · TanStack Query (`useQuery`/`useQueries`/`useMutation`) · Vitest (`vitest run`) · Tailwind · `@crm2/sdk` (zod contracts) · pnpm monorepo.

**Spec:** [docs/specs/2026-07-15-rate-cpv-group-multi-select-design.md](../specs/2026-07-15-rate-cpv-group-multi-select-design.md) — read §2.2, §6 and §7 before starting.

**Scope:** spec **Phase 1 only** — the group on both create pages. Spec §9's Phase 2 (deep-linking the picked group from the rate page into the assignment page) is deliberately out of scope and gets its own plan if the owner wants it.

## Global Constraints

- **No server change.** No file under `apps/api/`, `packages/sdk/`, or `db/` may be modified except the **test-only** addition in Task 1. If a task seems to need an API change, the design has drifted — stop and escalate.
- **No ADR, no migration.** Next ADR stays `0095`; next migration stays `0119`.
- **Never widen `otherTypeAtSlot` to arrays** — `= ANY(ARRAY[NULL]::int[])` evaluates to NULL, which a `WHERE` clause drops, silently failing the ADR-0093 one-slot-one-type guard **open** on five live paths (spec §2.2, verified in psql).
- **`MAX_BULK_RATE_LOCATIONS = 500` is per request and unchanged.** No total cap; no FE-side cap.
- **Universal = `null`** on the wire (ADR-0071). A `-1` sentinel must never reach the FE.
- **Universal ⊻ concrete**: on each axis, ticking Universal clears concrete picks and vice-versa.
- **Group ⇒ never the singular endpoint** on either page. **Group ⇒ FIELD only** on rates.
- **Never clear `selected` (locations / rate types) on a product/unit toggle.**
- Lint **bans the words `todo|fixme|hack|temp|xxx` anywhere in a comment** (case-insensitive) — it fails the gate. Deliberate simplifications are marked `ponytail:` (existing convention in these files).
- No `any`, no ts-suppressions, no `eslint-disable`, no `console.*`.
- **Naming:** camelCase TS, snake_case SQL.
- **Commits:** author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional commits, **no AI / `Co-Authored-By` trailer**, never `--no-verify`.
- **A task is done only when its tests pass.** The phase is done only when `pnpm verify` is green.
- **Never push or deploy** — the owner authorises that separately.

**On the line numbers in this plan:** every citation is a coordinate in the file **as it stands at `main` today**, before any task has run. They are anchors for *finding* the code, not addresses to edit blindly — Task 5 alone shifts the rates page by ~200 lines, so from Task 6 onward you must locate the code by its content, not its line. If a cited line doesn't contain what the plan says it does, an earlier step moved it; re-find it and carry on.

**Verify commands:**
- Web unit tests: `pnpm --filter @crm2/web test`
- One web test file: `pnpm --filter @crm2/web test -- src/features/<path>/<file>.test.ts`
- API integration tests need Postgres on `:5433` with `LC_ALL=C`:
  `LC_ALL=C DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres pnpm --filter @crm2/api test -- src/modules/rates/__tests__/rates.api.test.ts`
- Full gate: `pnpm verify`

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/features/cpvGroup/pairs.ts` | **Create.** Shared pure helpers: `Pair`, Universal-exclusive toggling, unit-option narrowing, CPV pair resolution, labels. Consumed by both create pages. |
| `apps/web/src/features/cpvGroup/pairs.test.ts` | **Create.** Unit tests for the above. |
| `apps/web/src/features/cpvGroup/PairPicker.tsx` | **Create.** Presentational: two tick-lists (products, units) + resolved-pair chips + count badge + dropped-pair note. No business logic. |
| `apps/web/src/features/rateManagement/RateCreatePage.tsx` | **Modify.** Group state, pair-aware hints, FIELD lock, fan submit, result grid columns. |
| `apps/web/src/features/rateManagement/RateCreatePage.test.ts` | **Modify.** Tests for the new pair-aware helpers; retire the single-slot ones. |
| `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.tsx` | **Modify.** Group state, per-pair plan, singular-route fix, fan submit, result grid columns. |
| `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.test.ts` | **Modify.** Tests for the new group plan helpers. |
| `apps/api/src/modules/rates/__tests__/rates.api.test.ts` | **Modify — test only.** Backfills the missing Universal × located × guard coverage (Task 1). |

**Not in scope (deliberate):** extracting the 3×-duplicated `StepCard`/`Field` into a shared module. An existing `ponytail:` comment in `RateTypeAssignmentCreatePage.tsx:573-576` defers this to a dedicated refactor; this feature does not need it.

---

### Task 1: Backfill the Universal × located one-slot-one-type guard (API test only)

**Why first:** the ADR-0093 guard's Universal × located path has **zero coverage** today (all six `HAS_OTHER_RATE_TYPE` tests use a concrete product+unit; all five Universal tests omit `locationId`, and the guard is gated on `locationId != null`). This test passes on today's code — it is a **characterization test** that makes the spec §2.2 fail-open impossible to reintroduce silently. It is independent of everything else in this plan.

**Files:**
- Modify: `apps/api/src/modules/rates/__tests__/rates.api.test.ts` (append to the `POST /rates/bulk` describe block, which starts at ~line 659)

**Interfaces:**
- Consumes: the file's existing harness — `request(app)`, the `SA` auth header, and the `bulk(body, auth?)` helper defined at ~line 659.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the existing harness before writing anything**

Read `apps/api/src/modules/rates/__tests__/rates.api.test.ts` lines 1-60 (imports, `seedKey`, auth headers) and lines 655-760 (the bulk describe block and its `bulk()` helper). You must reuse the file's existing seed helpers and auth constants verbatim — do not invent new ones. Note in particular how a rate is seeded with a **concrete** product/unit, because this test needs a **Universal** (`null`) one.

- [ ] **Step 2: Write the failing-on-revert test**

Append inside the `POST /api/v2/rates/bulk` describe block, which owns the `bulk()` helper and its own `seedLoc(area, pincode?)` (line 652). `seedKey(n)` (line 39) returns `{ clientId, productId, verificationUnitId }` — there is **no bare `clientId` in scope**, so the test mints its own.

```ts
// ADR-0093 guard × ADR-0071 Universal: the one-slot-one-type rule must hold when the product/unit
// dims are Universal (NULL) exactly as it does for concrete dims — the slot is still one slot.
// Characterization test: it PASSES on today's code (the scalar guard predicate is null-aware via
// COALESCE(...,-1)). It exists to pin that behaviour, because a plausible "widen the guard to
// productIds[]" refactor silently breaks it: `= ANY(ARRAY[NULL]::int[])` evaluates to NULL, the row
// is dropped by WHERE, the guard finds no conflict and two differently-typed active rates land at
// one slot. rates_no_overlap does NOT catch that (rate_type_id is part of the EXCLUDE key).
it('a Universal-product LOCAL rate blocks a Universal-product OGL rate at the same location', async () => {
  const key = await seedKey('UGRD'); // only clientId is used — the dims are deliberately Universal
  const locationId = await seedLoc('UGRD_AREA');
  const body = {
    clientId: key.clientId,
    productId: null, // Universal (ADR-0071)
    verificationUnitId: null, // Universal
    clientRateType: 'LOCAL',
    amount: 175,
    locationIds: [locationId],
  };
  const first = await bulk(body);
  expect(first.status).toBe(200);
  expect(first.body.createdCount).toBe(1);

  // Same Universal slot, same location, DIFFERENT rate type ⇒ one slot may hold only one type.
  const second = await bulk({ ...body, clientRateType: 'OGL', amount: 220 });
  expect(second.status).toBe(200);
  expect(second.body.createdCount).toBe(0);
  expect(second.body.errorCount).toBe(1);
  expect(second.body.results[0].status).toBe('ERROR');
  expect(second.body.results[0].error).toBe('HAS_OTHER_RATE_TYPE');
});
```

- [ ] **Step 3: Run it — it must PASS on today's code**

`apps/api`'s vitest config has **coverage always-on with global thresholds** (`vitest.config.ts:37-46`, lines ≥ 85%), so any single-file filtered run reports ~14% coverage and **exits 1 no matter what the test did**. Disable coverage for the filtered run, or the exit code is meaningless:

```bash
LC_ALL=C DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm --filter @crm2/api test -- --coverage.enabled=false \
  src/modules/rates/__tests__/rates.api.test.ts -t 'Universal-product LOCAL rate blocks'
```

Expected: **the test PASSES** (read the test result line, not just the exit code). If it FAILS, stop — the guard is already broken for Universal dims on prod, which is a separate and higher-priority bug to report to the owner before continuing.

- [ ] **Step 4: Prove the test has teeth**

A characterization test is worthless if it cannot fail. Temporarily break the guard to confirm it catches the exact regression it exists for — in `apps/api/src/modules/rates/repository.ts`, in `otherTypeAtSlot`, change:

```sql
AND COALESCE(r.product_id, -1) = COALESCE($2::int, -1)
```
to the broken array form the spec rejects:
```sql
AND COALESCE(r.product_id, -1) = ANY(ARRAY[$2]::int[])
```

Re-run the command from Step 3. Expected: **the test FAILS** (`createdCount` 1, not 0 — the guard failed open). **Then `git checkout apps/api/src/modules/rates/repository.ts` to revert the break.** Confirm with `git diff --stat` that only the test file is modified.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/rates/__tests__/rates.api.test.ts
git commit -m "test(rates): pin the one-slot-one-type guard for Universal dims at a location

The ADR-0093 guard's Universal x located path had zero coverage: every
HAS_OTHER_RATE_TYPE test used a concrete product+unit, and every Universal test
omitted locationId (the guard is gated on locationId != null). Verified this
test fails when otherTypeAtSlot's predicate is widened to ANY(ARRAY[...])."
```

---

### Task 2: Shared CPV pair helpers

**Files:**
- Create: `apps/web/src/features/cpvGroup/pairs.ts`
- Test: `apps/web/src/features/cpvGroup/pairs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3, 5, 7, 8):
  - `interface Pair { productId: number | null; unitId: number | null }`
  - `toggleUniversalExclusive(current: (number|null)[], value: number|null): (number|null)[]`
  - `unitOptionIds(products: (number|null)[], cpvUnitsByProduct: Map<number, Set<number>>, allUnitIds: number[]): number[]`
  - `resolvePairs(products: (number|null)[], units: (number|null)[], cpvUnitsByProduct: Map<number, Set<number>>): { pairs: Pair[]; dropped: Pair[] }`
  - `retainUnits(nextProducts: (number|null)[], units: (number|null)[], cpvUnitsByProduct: Map<number, Set<number>>, allUnitIds: number[]): (number|null)[]`
  - `pairKey(p: Pair): string`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/cpvGroup/pairs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  pairKey,
  resolvePairs,
  retainUnits,
  toggleUniversalExclusive,
  unitOptionIds,
} from './pairs.js';

/** CPV matrix: product 1 → units {10, 11}; product 2 → units {11, 12}. Deliberately JAGGED. */
const cpv = new Map<number, Set<number>>([
  [1, new Set([10, 11])],
  [2, new Set([11, 12])],
]);

describe('toggleUniversalExclusive (Universal XOR concrete, ADR-0071)', () => {
  it('adds and removes concrete ids', () => {
    expect(toggleUniversalExclusive([], 1)).toEqual([1]);
    expect(toggleUniversalExclusive([1], 2)).toEqual([1, 2]);
    expect(toggleUniversalExclusive([1, 2], 1)).toEqual([2]);
  });
  it('ticking Universal clears every concrete pick', () => {
    expect(toggleUniversalExclusive([1, 2], null)).toEqual([null]);
  });
  it('ticking a concrete id clears Universal', () => {
    expect(toggleUniversalExclusive([null], 1)).toEqual([1]);
  });
  it('unticking Universal empties the axis', () => {
    expect(toggleUniversalExclusive([null], null)).toEqual([]);
  });
});

describe('unitOptionIds (the unit picker is the UNION across picked products)', () => {
  it('a Universal product offers every active unit (mirrors the single-select unitCpvScoped gate)', () => {
    expect(unitOptionIds([null], cpv, [10, 11, 12, 13])).toEqual([10, 11, 12, 13]);
  });
  it('no product picked yet offers every active unit', () => {
    expect(unitOptionIds([], cpv, [10, 11, 12, 13])).toEqual([10, 11, 12, 13]);
  });
  it('one concrete product offers only its CPV units', () => {
    expect(unitOptionIds([1], cpv, [10, 11, 12, 13])).toEqual([10, 11]);
  });
  it('several concrete products offer the UNION, not the intersection', () => {
    expect(unitOptionIds([1, 2], cpv, [10, 11, 12, 13])).toEqual([10, 11, 12]);
  });
  it('preserves the caller’s unit ordering (sort_order from the API)', () => {
    expect(unitOptionIds([1, 2], cpv, [13, 12, 11, 10])).toEqual([12, 11, 10]);
  });
  it('a product with no CPV mapping contributes nothing', () => {
    expect(unitOptionIds([9], cpv, [10, 11, 12])).toEqual([]);
  });
});

describe('resolvePairs (the group is JAGGED, not a rectangle)', () => {
  it('intersects each product with its own CPV units and reports the drops', () => {
    // The rectangle is 2x2 = 4; CPV allows only 3 — (2,10) is not mapped.
    const { pairs, dropped } = resolvePairs([1, 2], [10, 11], cpv);
    expect(pairs).toEqual([
      { productId: 1, unitId: 10 },
      { productId: 1, unitId: 11 },
      { productId: 2, unitId: 11 },
    ]);
    expect(dropped).toEqual([{ productId: 2, unitId: 10 }]);
  });
  it('a Universal product is not CPV-constrained (no per-product mapping exists to consult)', () => {
    const { pairs, dropped } = resolvePairs([null], [10, 12], cpv);
    expect(pairs).toEqual([
      { productId: null, unitId: 10 },
      { productId: null, unitId: 12 },
    ]);
    expect(dropped).toEqual([]);
  });
  it('a Universal unit is not CPV-constrained', () => {
    const { pairs, dropped } = resolvePairs([1, 2], [null], cpv);
    expect(pairs).toEqual([
      { productId: 1, unitId: null },
      { productId: 2, unitId: null },
    ]);
    expect(dropped).toEqual([]);
  });
  it('fully Universal resolves to the single Universal slot', () => {
    expect(resolvePairs([null], [null], cpv).pairs).toEqual([{ productId: null, unitId: null }]);
  });
  it('an empty axis resolves to no pairs (a money table never defaults to Universal)', () => {
    expect(resolvePairs([], [10], cpv).pairs).toEqual([]);
    expect(resolvePairs([1], [], cpv).pairs).toEqual([]);
  });
  it('one concrete pair reproduces the single-slot case exactly', () => {
    expect(resolvePairs([1], [10], cpv).pairs).toEqual([{ productId: 1, unitId: 10 }]);
  });
});

describe('retainUnits (a product tick must not destroy the user’s other picks)', () => {
  it('keeps units still offered by the new product set', () => {
    expect(retainUnits([1, 2], [10, 11], cpv, [10, 11, 12, 13])).toEqual([10, 11]);
  });
  it('drops only units no remaining product offers', () => {
    // Untick product 2 → unit 12 (only product 2 had it) must go; unit 10 stays.
    expect(retainUnits([1], [10, 12], cpv, [10, 11, 12, 13])).toEqual([10]);
  });
  it('never drops Universal', () => {
    expect(retainUnits([1], [null], cpv, [10, 11, 12, 13])).toEqual([null]);
  });
  it('keeps everything when the new product set is Universal', () => {
    expect(retainUnits([null], [10, 12], cpv, [10, 11, 12, 13])).toEqual([10, 12]);
  });
  it('adding a product never drops an existing unit (the set only widens)', () => {
    expect(retainUnits([1, 2], [10], cpv, [10, 11, 12, 13])).toEqual([10]);
  });
});

describe('pairKey', () => {
  it('distinguishes Universal from every concrete id', () => {
    expect(pairKey({ productId: null, unitId: null })).not.toBe(pairKey({ productId: 1, unitId: 1 }));
    expect(pairKey({ productId: null, unitId: 1 })).not.toBe(pairKey({ productId: 1, unitId: null }));
  });
  it('is stable for equal pairs', () => {
    expect(pairKey({ productId: 1, unitId: 10 })).toBe(pairKey({ productId: 1, unitId: 10 }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @crm2/web test -- src/features/cpvGroup/pairs.test.ts
```

Expected: FAIL — `Failed to resolve import "./pairs.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/cpvGroup/pairs.ts`:

```ts
/**
 * CPV group = "these products × these verification units" for one client — the middle ground between
 * one exact (product, unit) slot and Universal = ALL (ADR-0071). A group is NOT a new row type: it
 * fans into N ordinary slots, each saved through the existing single-slot `/bulk` endpoint
 * (docs/specs/2026-07-15-rate-cpv-group-multi-select-design.md §2).
 *
 * Shared by RateCreatePage and RateTypeAssignmentCreatePage. Pure — this app has no render-test
 * infra, so every decision the pages make lives in a function like these.
 */

/** One resolved slot of a group. `null` = Universal on that axis (ADR-0071 stores it as NULL). */
export interface Pair {
  productId: number | null;
  unitId: number | null;
}

/**
 * Tick/untick `value` on one axis, keeping Universal (`null`) and concrete ids mutually exclusive.
 * `Universal + product A` would write a Universal row AND an A row — legal under the RANK resolver
 * but incoherent as one user intent, so the picker forbids it; wanting both is two saves (which is
 * today's behaviour anyway).
 */
export function toggleUniversalExclusive(
  current: (number | null)[],
  value: number | null,
): (number | null)[] {
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (value === null) return [null]; // Universal replaces every concrete pick
  return [...current.filter((v) => v !== null), value]; // a concrete pick evicts Universal
}

/**
 * The unit ids offerable for the picked products — the UNION of each product's CPV-mapped units, so
 * a unit valid for at least one picked product stays offerable (`resolvePairs` drops the individual
 * pairs it isn't valid for). Ordering follows `allUnitIds` (the API's sort_order).
 *
 * No product picked, or a Universal product ⇒ every active unit: a Universal dim has no per-product
 * CPV mapping to consult. This mirrors the single-select pages' `unitCpvScoped` gate exactly
 * (ADR-0074: a Universal CPV mapping already means "all units").
 */
export function unitOptionIds(
  products: (number | null)[],
  cpvUnitsByProduct: Map<number, Set<number>>,
  allUnitIds: number[],
): number[] {
  if (products.length === 0 || products.includes(null)) return allUnitIds;
  const union = new Set<number>();
  for (const p of products) if (p !== null) for (const u of cpvUnitsByProduct.get(p) ?? []) union.add(u);
  return allUnitIds.filter((id) => union.has(id));
}

/**
 * Resolve the picked axes into real slots. The picker offers a RECTANGLE (products × units) but CPV
 * is JAGGED — product A maps to units 1-2, product B to 2-3 — so the rectangle is intersected with
 * each product's own CPV set and the difference is returned as `dropped`. The count shown before
 * save must come from `pairs`, never from the rectangle, or the page promises rows the save will not
 * produce.
 *
 * CPV constrains only a concrete product × concrete unit: a Universal dim has no mapping to consult.
 */
export function resolvePairs(
  products: (number | null)[],
  units: (number | null)[],
  cpvUnitsByProduct: Map<number, Set<number>>,
): { pairs: Pair[]; dropped: Pair[] } {
  const pairs: Pair[] = [];
  const dropped: Pair[] = [];
  for (const productId of products) {
    for (const unitId of units) {
      const enabled =
        productId === null || unitId === null || (cpvUnitsByProduct.get(productId)?.has(unitId) ?? false);
      (enabled ? pairs : dropped).push({ productId, unitId });
    }
  }
  return { pairs, dropped };
}

/**
 * Narrow the picked units to those the NEW product set still offers, dropping nothing else.
 *
 * This is the whole invalidation on a product tick. What it deliberately does NOT touch is the
 * caller's `selected` (locations / rate types): those are ORTHOGONAL to the CPV axes. The
 * single-select pages cleared them on every product change — correct when one change meant one new
 * decision, catastrophic for a tick-list, where ticking a 2nd product would erase 200 hand-ticked
 * areas with no undo.
 */
export function retainUnits(
  nextProducts: (number | null)[],
  units: (number | null)[],
  cpvUnitsByProduct: Map<number, Set<number>>,
  allUnitIds: number[],
): (number | null)[] {
  const offered = unitOptionIds(nextProducts, cpvUnitsByProduct, allUnitIds);
  return units.filter((id) => id === null || offered.includes(id));
}

/** Stable map/Set key for a pair. 'U' marks Universal so it can never collide with an id. */
export const pairKey = (p: Pair): string => `${p.productId ?? 'U'}:${p.unitId ?? 'U'}`;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @crm2/web test -- src/features/cpvGroup/pairs.test.ts
```

Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/cpvGroup/pairs.ts apps/web/src/features/cpvGroup/pairs.test.ts
git commit -m "feat(web): shared CPV-group pair resolution helpers

A group's picker offers a rectangle but CPV is jagged, so resolvePairs
intersects each product with its own CPV units and reports the drops -- the
pre-save count must come from the resolved pairs, never the rectangle."
```

---

### Task 3: Shared `PairPicker` component

**Files:**
- Create: `apps/web/src/features/cpvGroup/PairPicker.tsx`

**Interfaces:**
- Consumes: `Pair`, `pairKey`, `toggleUniversalExclusive` from `./pairs.js` (Task 2).
- Produces (used by Tasks 5 and 8):
  ```ts
  interface PairPickerOption { id: number; label: string }
  interface PairPickerProps {
    products: (number | null)[];
    units: (number | null)[];
    productOptions: PairPickerOption[];
    unitOptions: PairPickerOption[];
    pairs: Pair[];
    dropped: Pair[];
    labelFor: (p: Pair) => string;
    onProductsChange: (next: (number | null)[]) => void;
    onUnitsChange: (next: (number | null)[]) => void;
    isLoading?: boolean;
  }
  export function PairPicker(props: PairPickerProps): React.JSX.Element
  export const CPV_DROPPED_NOTE: string
  export const CPV_ADMIN_PATH: string
  ```

**No test:** this file is presentational only — every decision it renders is computed by Task 2's tested helpers, and this app has no render-test infra. Its wiring is covered by the browser verification in Task 9.

- [ ] **Step 1: Write the component**

Create `apps/web/src/features/cpvGroup/PairPicker.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { type Pair, pairKey, toggleUniversalExclusive } from './pairs.js';

/** The CPV mapping admin — where a dropped pair gets fixed. */
export const CPV_ADMIN_PATH = '/admin/cpv';
export const CPV_DROPPED_NOTE = 'not in this client’s CPV mapping';

export interface PairPickerOption {
  id: number;
  label: string;
}

export interface PairPickerProps {
  /** picked product ids; `null` = Universal (ADR-0071). Mutually exclusive with concrete ids. */
  products: (number | null)[];
  units: (number | null)[];
  productOptions: PairPickerOption[];
  /** already narrowed to the union of the picked products' CPV units (`unitOptionIds`). */
  unitOptions: PairPickerOption[];
  /** resolved, CPV-intersected slots — the truth the save will act on. */
  pairs: Pair[];
  /** rectangle members CPV rejected — surfaced so the count explains itself. */
  dropped: Pair[];
  labelFor: (p: Pair) => string;
  onProductsChange: (next: (number | null)[]) => void;
  onUnitsChange: (next: (number | null)[]) => void;
  isLoading?: boolean | undefined;
}

/** One tick-list axis: an explicit Universal chip + the concrete options, Universal XOR concrete. */
function Axis({
  legend,
  universalLabel,
  picked,
  options,
  onChange,
}: {
  legend: string;
  universalLabel: string;
  picked: (number | null)[];
  options: PairPickerOption[];
  onChange: (next: (number | null)[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 block text-xs font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        <label
          title="Applies to every one of them — cannot be combined with a specific pick"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={picked.includes(null)}
            onChange={() => onChange(toggleUniversalExclusive(picked, null))}
          />
          {universalLabel}
        </label>
        {options.map((o) => (
          <label
            key={o.id}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={picked.includes(o.id)}
              onChange={() => onChange(toggleUniversalExclusive(picked, o.id))}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Pick MANY products × MANY units for one client (a CPV group), and show the slots that actually
 * resolve. The two tick-lists describe a RECTANGLE; CPV is JAGGED, so the resolved pairs — not the
 * rectangle — are rendered as read-only chips and are what the caller counts and saves.
 */
export function PairPicker({
  products,
  units,
  productOptions,
  unitOptions,
  pairs,
  dropped,
  labelFor,
  onProductsChange,
  onUnitsChange,
  isLoading,
}: PairPickerProps) {
  return (
    <div className="space-y-4">
      <Axis
        legend="Products"
        universalLabel="Universal (all products)"
        picked={products}
        options={productOptions}
        onChange={onProductsChange}
      />
      <Axis
        legend="Verification units"
        universalLabel="Universal (all units)"
        picked={units}
        options={unitOptions}
        onChange={onUnitsChange}
      />
      {isLoading ? (
        <HexagonLoader operation="Checking CPV mapping" />
      ) : pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tick at least one product and one verification unit — each resolved pair below is one slot.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <p className="text-xs font-medium text-foreground">These slots will be priced:</p>
          <div className="flex flex-wrap gap-2">
            {pairs.map((p) => (
              <span
                key={pairKey(p)}
                className="inline-flex items-center rounded-full border border-border-strong bg-card px-3 py-1.5 text-xs"
              >
                {labelFor(p)}
              </span>
            ))}
          </div>
        </div>
      )}
      {dropped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="tabular-nums">{dropped.length}</span> pair{dropped.length === 1 ? '' : 's'}{' '}
          {CPV_DROPPED_NOTE} and {dropped.length === 1 ? 'was' : 'were'} left out:{' '}
          {dropped.map(labelFor).join(', ')} —{' '}
          <Link to={CPV_ADMIN_PATH} className="text-primary hover:underline">
            map {dropped.length === 1 ? 'it' : 'them'} in CPV
          </Link>
          .
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and the suite is still green**

```bash
pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test
```

Expected: typecheck clean; all existing tests pass (nothing consumes this yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/cpvGroup/PairPicker.tsx
git commit -m "feat(web): shared CPV-group pair picker

Two tick-lists describe a rectangle; the resolved (jagged) pairs are rendered
as read-only chips, and dropped pairs are named with the link that fixes them."
```

---

### Task 4: Pair-aware location hints for the rates page (helpers only)

**Why additive:** changing `slotRates`/`existingByLocation`/`blockedLocations` in place would break the page mid-task. This task **adds** the group-aware helper next to them and tests it; Task 5 rewires the page and deletes the dead ones.

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateCreatePage.tsx` (add exports near the existing helpers, ~line 113-127)
- Test: `apps/web/src/features/rateManagement/RateCreatePage.test.ts`

**Interfaces:**
- Consumes: `Pair`, `pairKey` from `../cpvGroup/pairs.js` (Task 2); the file's existing `ExistingRateHint`.
- Produces (used by Task 5):
  ```ts
  export interface PairHit { pair: Pair; hints: ExistingRateHint[] }
  export interface LocationGroupState {
    totalPairs: number;
    blocked: PairHit[]; // pairs where a DIFFERENT type sits here → per-row HAS_OTHER_RATE_TYPE
    exists: PairHit[];  // pairs where the SAME type sits here → per-row EXISTS (skipped)
  }
  export function locationGroupStates(
    items: Pick<RateView, 'productId'|'verificationUnitId'|'locationId'|'clientRateType'|'amount'>[],
    pairs: Pair[],
    chosenType: string,
  ): Map<number, LocationGroupState>
  export const isHardBlocked: (st: LocationGroupState | undefined) => boolean
  export const groupOutcome: (
    states: Map<number, LocationGroupState>, selectedLocationIds: number[], totalPairs: number,
  ) => { created: number; skipped: number; blocked: number }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/rateManagement/RateCreatePage.test.ts`. Add `groupOutcome`, `isHardBlocked`, `locationGroupStates` to the existing import block at the top of the file.

```ts
describe('locationGroupStates (per-location state across a CPV group)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const pairs = [P1U1, P2U1];
  // LOCAL at (P1,U1,L5); OGL at (P2,U1,L5). Same location, different slots.
  const items = [row(1, 10, 5, 'LOCAL', 175), row(2, 10, 5, 'OGL', 220)];

  it('scopes each pair to its OWN slot — a different product at the same location is a different slot', () => {
    const st = locationGroupStates(items, pairs, 'LOCAL');
    // (P1,U1,L5) already has LOCAL → EXISTS-skip. (P2,U1,L5) has OGL → blocked for a LOCAL save.
    expect(st.get(5)?.exists.map((h) => h.pair)).toEqual([P1U1]);
    expect(st.get(5)?.blocked.map((h) => h.pair)).toEqual([P2U1]);
    expect(st.get(5)?.totalPairs).toBe(2);
  });

  it('does not leak a rate from one pair into another pair’s state', () => {
    // Regression: folding by bare locationId would merge P1's LOCAL into P2's state and vice-versa.
    const st = locationGroupStates(items, [P2U1], 'OGL');
    expect(st.get(5)?.exists.map((h) => h.pair)).toEqual([P2U1]);
    expect(st.get(5)?.blocked).toEqual([]);
  });

  it('ignores rates at locations and pairs outside the group', () => {
    const other = [row(9, 99, 5, 'OGL', 1), row(1, 10, 6, 'OGL', 1)];
    const st = locationGroupStates(other, [P1U1], 'LOCAL');
    expect(st.get(5)).toBeUndefined(); // pair (9,99) is not in the group
    expect(st.get(6)?.blocked.map((h) => h.pair)).toEqual([P1U1]); // location 6 is
  });

  it('a Universal pair matches only Universal rates (null === null)', () => {
    const uni = [row(null, null, 5, 'OGL', 300)];
    const st = locationGroupStates(uni, [{ productId: null, unitId: null }], 'LOCAL');
    expect(st.get(5)?.blocked).toHaveLength(1);
    expect(locationGroupStates(uni, [P1U1], 'LOCAL').get(5)).toBeUndefined();
  });

  it('never blocks on a typeless row, and never before a type is chosen', () => {
    const typeless = [row(1, 10, 5, null, 100)];
    expect(locationGroupStates(typeless, [P1U1], 'LOCAL').get(5)?.blocked).toEqual([]);
    expect(locationGroupStates(items, pairs, '').get(5)?.blocked).toEqual([]);
  });

  it('ignores office (null location) rows — a group only fans over real locations', () => {
    expect(locationGroupStates([row(1, 10, null, 'OGL', 1)], [P1U1], 'LOCAL').size).toBe(0);
  });
});

describe('isHardBlocked (red+disabled only when EVERY pair is blocked)', () => {
  const hit = (productId: number) => ({ pair: { productId, unitId: 10 }, hints: [] });

  it('blocks when every pair is blocked', () => {
    expect(isHardBlocked({ totalPairs: 2, blocked: [hit(1), hit(2)], exists: [] })).toBe(true);
  });
  it('does NOT block when only some pairs are blocked — those become per-row errors', () => {
    expect(isHardBlocked({ totalPairs: 2, blocked: [hit(1)], exists: [] })).toBe(false);
  });
  it('a ONE-pair group reduces to today’s single-slot behaviour exactly', () => {
    expect(isHardBlocked({ totalPairs: 1, blocked: [hit(1)], exists: [] })).toBe(true);
    expect(isHardBlocked({ totalPairs: 1, blocked: [], exists: [hit(1)] })).toBe(false);
  });
  it('is false for an untouched location', () => {
    expect(isHardBlocked(undefined)).toBe(false);
    expect(isHardBlocked({ totalPairs: 2, blocked: [], exists: [] })).toBe(false);
  });
});

describe('groupOutcome (the honest pre-save strip)', () => {
  const hit = (productId: number) => ({ pair: { productId, unitId: 10 }, hints: [] });

  it('counts created / skipped / blocked across pairs × locations', () => {
    const states = new Map([
      [5, { totalPairs: 3, blocked: [hit(1)], exists: [hit(2)] }], // 3 pairs: 1 blocked, 1 skip, 1 new
      [6, { totalPairs: 3, blocked: [], exists: [] }], // untouched: 3 new
    ]);
    expect(groupOutcome(states, [5, 6], 3)).toEqual({ created: 4, skipped: 1, blocked: 1 });
  });
  it('a location with no existing rates contributes one row per pair', () => {
    expect(groupOutcome(new Map(), [5, 6], 4)).toEqual({ created: 8, skipped: 0, blocked: 0 });
  });
  it('counts only the SELECTED locations', () => {
    const states = new Map([[5, { totalPairs: 1, blocked: [hit(1)], exists: [] }]]);
    expect(groupOutcome(states, [6], 1)).toEqual({ created: 1, skipped: 0, blocked: 0 });
  });
  it('is zero across the board with nothing selected', () => {
    expect(groupOutcome(new Map(), [], 3)).toEqual({ created: 0, skipped: 0, blocked: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @crm2/web test -- src/features/rateManagement/RateCreatePage.test.ts
```

Expected: FAIL — `locationGroupStates is not exported` (and the other two).

- [ ] **Step 3: Write the implementation**

In `apps/web/src/features/rateManagement/RateCreatePage.tsx`, add this import at the top:

```ts
import { type Pair, pairKey } from '../cpvGroup/pairs.js';
```

and add these exports immediately **after** the existing `blockedLocations` function (~line 127):

```ts
/** An existing-rate hit at one pair of the group. */
export interface PairHit {
  pair: Pair;
  hints: ExistingRateHint[];
}
/** What a location already holds across EVERY pair of the group, for the chosen rate type. */
export interface LocationGroupState {
  totalPairs: number;
  /** pairs whose slot here holds a DIFFERENT type — the server rejects each as HAS_OTHER_RATE_TYPE. */
  blocked: PairHit[];
  /** pairs whose slot here already holds the SAME type — the server EXISTS-skips each. */
  exists: PairHit[];
}

/**
 * Fold the client's existing ACTIVE rates into locationId → per-pair state.
 *
 * The slot is `(client, product, unit, location)` — so state MUST be keyed by pair AND location, not
 * by location alone: a LOCAL rate at (P1,U1,L5) says nothing about (P2,U1,L5), which is a different,
 * legal slot. (Folding by bare locationId is exactly the over-block the design rejected — spec §2.2.)
 * Null-aware, mirroring the DB key's COALESCE sentinels: a Universal pair matches only Universal rows.
 * Office (null-location) rows are ignored — a group only ever fans across real locations.
 */
export function locationGroupStates(
  items: Pick<RateView, 'productId' | 'verificationUnitId' | 'locationId' | 'clientRateType' | 'amount'>[],
  pairs: Pair[],
  chosenType: string,
): Map<number, LocationGroupState> {
  const byPair = new Map(pairs.map((p) => [pairKey(p), p]));
  const out = new Map<number, LocationGroupState>();
  for (const r of items) {
    if (r.locationId === null) continue;
    const pair = byPair.get(pairKey({ productId: r.productId, unitId: r.verificationUnitId }));
    if (!pair) continue; // a rate at a slot outside this group is irrelevant
    const st = out.get(r.locationId) ?? { totalPairs: pairs.length, blocked: [], exists: [] };
    const bucket =
      chosenType && r.clientRateType && r.clientRateType !== chosenType
        ? st.blocked
        : chosenType && r.clientRateType === chosenType
          ? st.exists
          : null; // typeless rows never block; nothing decides before a type is chosen
    if (bucket) {
      const hit = bucket.find((h) => h.pair === pair);
      if (hit) hit.hints.push({ clientRateType: r.clientRateType, amount: r.amount });
      else bucket.push({ pair, hints: [{ clientRateType: r.clientRateType, amount: r.amount }] });
    }
    out.set(r.locationId, st);
  }
  return out;
}

/**
 * A chip is red + untickable only when EVERY pair of the group is blocked here — otherwise the pick
 * is legal for the rest and the blocked pairs surface as per-row errors in the result grid. Blocking
 * a whole location because 1 of 12 pairs clashes would make a group unusable.
 * A one-pair group therefore reproduces the single-slot behaviour exactly — one code path, not two.
 */
export const isHardBlocked = (st: LocationGroupState | undefined): boolean =>
  !!st && st.totalPairs > 0 && st.blocked.length === st.totalPairs;

/** The honest pre-save counts across pairs × selected locations (CREATE_PAGE_STANDARD's commit surface). */
export const groupOutcome = (
  states: Map<number, LocationGroupState>,
  selectedLocationIds: number[],
  totalPairs: number,
): { created: number; skipped: number; blocked: number } => {
  let created = 0;
  let skipped = 0;
  let blocked = 0;
  for (const id of selectedLocationIds) {
    const st = states.get(id);
    const b = st?.blocked.length ?? 0;
    const e = st?.exists.length ?? 0;
    created += totalPairs - b - e;
    skipped += e;
    blocked += b;
  }
  return { created, skipped, blocked };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @crm2/web test -- src/features/rateManagement/RateCreatePage.test.ts
```

Expected: PASS — the new suites plus every pre-existing one (the old helpers are untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rateManagement/RateCreatePage.tsx apps/web/src/features/rateManagement/RateCreatePage.test.ts
git commit -m "feat(web): pair-aware location state for rate CPV groups

State is keyed by pair AND location: a LOCAL rate at (P1,U1,L5) says nothing
about (P2,U1,L5), a different legal slot. A chip is hard-blocked only when
every pair is blocked, so a one-pair group is today's behaviour exactly."
```

---

### Task 5: Rewire the rates page to CPV groups

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateCreatePage.tsx`
- Modify: `apps/web/src/features/rateManagement/RateCreatePage.test.ts`

**Interfaces:**
- Consumes: `PairPicker`, `PairPickerOption` (Task 3); `Pair`, `pairKey`, `resolvePairs`, `unitOptionIds` (Task 2); `locationGroupStates`, `isHardBlocked`, `groupOutcome`, `LocationGroupState` (Task 4).
- Produces: `modeHasDownstream` gains a `pairCount` field (breaking its existing callers' object shape — both are in this file and its test).

- [ ] **Step 1: Write the failing test for the FIELD lock**

`modeHasDownstream` is the tested guard that locks the Field/Office toggle. A group must lock it too: OFFICE does one plain `POST /rates` with no product/unit fan, so ticking 5 products then flipping to Office would write **one** rate and toast success (spec §5.1). Replace the existing `modeHasDownstream` describe block in `RateCreatePage.test.ts` with:

```ts
describe('modeHasDownstream (Field/Office toggle guard)', () => {
  const base = { clientRateType: '', pincodeCount: 0, selectedCount: 0, pairCount: 0 };

  it('is false when nothing downstream is set', () => {
    expect(modeHasDownstream(base)).toBe(false);
  });
  it('is true when a rate type, a pincode group, or a selection exists', () => {
    expect(modeHasDownstream({ ...base, clientRateType: 'LOCAL' })).toBe(true);
    expect(modeHasDownstream({ ...base, pincodeCount: 1 })).toBe(true);
    expect(modeHasDownstream({ ...base, selectedCount: 1 })).toBe(true);
  });
  it('a single pair leaves the toggle free — office rates are single-slot too', () => {
    expect(modeHasDownstream({ ...base, pairCount: 1 })).toBe(false);
  });
  it('a GROUP locks the toggle: office does one flat create and would silently drop the group', () => {
    expect(modeHasDownstream({ ...base, pairCount: 2 })).toBe(true);
  });
  it('pins the helper + action copy', () => {
    expect(MODE_LOCKED_HELPER).toBe('Clear rate-type/location fields to switch mode');
    expect(CLEAR_FIELDS_LABEL).toBe('Clear fields');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @crm2/web test -- src/features/rateManagement/RateCreatePage.test.ts -t 'GROUP locks the toggle'
```

Expected: FAIL — `pairCount` is not part of the guard, so a 2-pair group returns `false`.

- [ ] **Step 3: Extend the guard**

Replace `modeHasDownstream` (~line 61-65) with:

```ts
export const modeHasDownstream = (s: {
  clientRateType: string;
  pincodeCount: number;
  selectedCount: number;
  /** resolved CPV pairs; >1 = a group. OFFICE saves ONE flat rate with no product/unit fan, so a
   *  group must not be able to reach it — flipping the toggle would silently write a single rate
   *  and report success. Mirrors the shipped commission precedent (FIELD only; OFFICE single). */
  pairCount: number;
}): boolean =>
  !!s.clientRateType || s.pincodeCount > 0 || s.selectedCount > 0 || s.pairCount > 1;
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter @crm2/web test -- src/features/rateManagement/RateCreatePage.test.ts -t 'modeHasDownstream'
```

Expected: PASS (typecheck will still fail at the call site — Step 5 fixes it).

- [ ] **Step 5: Replace the single-select state with group state**

In `RateCreatePage.tsx`, replace the `productId` / `unitId` state (lines 146-147) with:

```ts
  const [products, setProducts] = useState<(number | null)[]>([]);
  const [units, setUnits] = useState<(number | null)[]>([]);
```

**Two symbols die with that state — fix them in this same step or the file will not typecheck:**

1. `shared()` (lines 332-338) reads both. The fan now supplies the dims per pair, so drop them:

```ts
  const shared = () => ({
    clientId: Number(clientId),
    amount: Number(amount),
    effectiveFrom: toIsoDate(effectiveFrom),
  });
```

2. `toDim` (line 33) loses its last caller — the group never holds a select's string value. It is now
   dead: **delete it and its `describe('toDim …')` block**. Step 6 needs its *inverse* twice, so
   replace it in place (keep `UNIVERSAL`, which `availableRateTypesPath` still uses):

```ts
/** A dim → its `availableRateTypesPath` query value; null (Universal) omits the param (ADR-0071). */
export const dimParam = (v: number | null): string => (v === null ? UNIVERSAL : String(v));
```

   Add to `RateCreatePage.test.ts`, replacing the `toDim` block:

```ts
describe('dimParam (explicit Universal sentinel, ADR-0071)', () => {
  it('maps null to the UNIVERSAL sentinel and ids to strings', () => {
    expect(dimParam(null)).toBe(UNIVERSAL);
    expect(dimParam(7)).toBe('7');
  });
});
```

Replace the `units` query (lines 168-178) with a **per-product CPV fan** (`useQueries` is already imported for the areas fan — same precedent):

```ts
  // Every active unit — the option pool a Universal product draws from, and the ordering (sort_order)
  // every narrowed list preserves.
  const allUnits = useQuery({
    queryKey: ['verification-unit-options'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
  // ADR-0074: CPV is per (client, product) — one query per PICKED concrete product, cached under the
  // key the single-select page already used. A Universal product has no mapping to consult.
  const concreteProducts = products.filter((p): p is number => p !== null);
  const cpvQueries = useQueries({
    queries: concreteProducts.map((p) => ({
      queryKey: ['cpv-available-units', clientId, String(p)],
      queryFn: () =>
        api<{ id: number; code: string; name: string }[]>(
          'GET',
          `/api/v2/cpv-units/available?clientId=${clientId}&productId=${p}`,
        ),
      enabled: !!clientId,
    })),
  });
  // Gate the pair resolution on a settled CPV read: an in-flight product contributes an EMPTY unit
  // set, which would transiently drop its pairs and flash a wrong count on the commit surface.
  const cpvLoading = cpvQueries.some((q) => q.isLoading);
  // Computed inline, not memoised: memoising a value derived from a fresh-every-render query array
  // needs a lint escape hatch, and the no-suppressions gate forbids those outright. The map holds a
  // handful of entries and resolvePairs is O(products × units) — the render cost is noise next to
  // the round trips it describes.
  const cpvUnitsByProduct = new Map(
    concreteProducts.map((p, i) => [p, new Set((cpvQueries[i]?.data ?? []).map((u) => u.id))]),
  );
```

- [ ] **Step 6: Resolve the pairs and narrow the unit options**

After the `cpvUnitsByProduct` computation, add:

```ts
  const allUnitIds = (allUnits.data ?? []).map((u) => u.id);
  const offerableUnitIds = unitOptionIds(products, cpvUnitsByProduct, allUnitIds);
  const { pairs, dropped } = resolvePairs(products, units, cpvUnitsByProduct);
  const isGroup = pairs.length > 1;
```

Replace the `comboReady` / `slotReady` definitions (lines **182** and **210**) with the two lines below. **Leave `isOffice` (line 181) alone** — re-declaring it is `TS2451`:

```ts
  // One resolved pair = a concrete slot; for a group the rate-type picker shows the union (below).
  const comboReady = !isOffice && !!clientId && pairs.length > 0;
  const slotReady = !!clientId && pairs.length > 0;
```

Replace the rate-types query (lines 183-188) with a **union across pairs** (spec §6.1 — the intersection was rejected: omitting a dim returns the client-wide union, the gate is UI-only, and an empty intersection dead-ends the flagship case):

```ts
  // The rate types offerable for the group = the UNION across its pairs. Same query key as the
  // single-select page, so a one-pair group shares cache and behaves identically.
  // ponytail: UX policy, not an invariant — the server validates catalog existence + category only
  // (rates/service.ts), so a type unassigned at some pair still saves and still bills. We surface
  // that below rather than block a save the server accepts.
  const rateTypeQueries = useQueries({
    queries: pairs.map((p) => ({
      queryKey: ['rate-types-available', clientId, dimParam(p.productId), dimParam(p.unitId)],
      queryFn: () =>
        api<RateTypeOption[]>(
          'GET',
          availableRateTypesPath(clientId, dimParam(p.productId), dimParam(p.unitId)),
        ),
      enabled: comboReady,
    })),
  });
  const rateTypesLoading = rateTypeQueries.some((q) => q.isLoading);
  const rateTypeUnion = new Map<string, RateTypeOption>();
  for (const q of rateTypeQueries) for (const rt of q.data ?? []) rateTypeUnion.set(rt.code, rt);
  // Pairs where the CHOSEN type isn't assigned — named, never blocking (see the ponytail note above).
  const unassignedPairs = clientRateType
    ? pairs.filter((_, i) => !(rateTypeQueries[i]?.data ?? []).some((rt) => rt.code === clientRateType))
    : [];
  const noRateTypesForCombo = comboReady && !rateTypesLoading && rateTypeUnion.size === 0;
```

**Then rewire the four surviving readers of the deleted `rateTypes` query** — miss these and the file
does not compile, and the union never reaches the dropdown (which is the entire point of spec §6.1):

| line | today | becomes |
|---|---|---|
| 395 | `const rateTypeOpts: Opt[] = (rateTypes.data ?? []).map(...)` | `const rateTypeOpts: Opt[] = [...rateTypeUnion.values()].map((rt) => ({ value: rt.code, label: rt.code }));` |
| 588 | `disabled={!comboReady \|\| rateTypes.isLoading}` | `disabled={!comboReady \|\| rateTypesLoading}` |
| 590 | `rateTypes.isLoading ? 'Loading rate types…'` | `rateTypesLoading ? 'Loading rate types…'` |
| 603 | `{rateTypes.isError && (` | `{rateTypeQueries.some((q) => q.isError) && (` |

- [ ] **Step 7: Fix the invalidation (the work-loss bug)**

Replace `changeClient` / `changeProduct` / `changeUnit` (lines 292-308) with:

```ts
  // Changing the CLIENT redefines everything downstream (the CPV mapping, the assignable rate types,
  // the existing-rate hints) — wipe it all, as before.
  const changeClient = (id: string) => {
    setClientId(id);
    setProducts([]);
    setUnits([]);
    setRateType('');
    setSelected(new Set());
  };
  // Changing a product/unit TICK re-resolves the pairs, so a rate type that is no longer offered
  // anywhere must go. Locations are ORTHOGONAL to the CPV axes and are never cleared: ticking a 2nd
  // product used to erase every hand-ticked area (correct for a single-select, catastrophic here).
  const changeProducts = (next: (number | null)[]) => {
    setProducts(next);
    setUnits((u) => retainUnits(next, u, cpvUnitsByProduct, allUnitIds));
  };
  const changeUnits = (next: (number | null)[]) => setUnits(next);
```

> **On testing the no-clear guarantee.** Spec §8 asks for a regression test that "add/remove a product does not clear `selected`". It cannot be unit-tested: `changeProducts` is an unexported closure over component state, and this app has no render-test infra — so a future edit reinstating `setSelected(new Set())` here would pass `pnpm verify`. What IS pinned is `retainUnits` (Task 2), which owns every drop the tick is allowed to make; the absence of a `selected` wipe is verified in the browser (Task 9, Step 3.4) and recorded as invariant 4 in spec §7. Do not paper over this with a test that doesn't actually exercise the handler.

Then, so a now-unofferable rate type cannot ride along, add this effect (import `useEffect` from `react`):

```ts
  // A type that no pair offers any more can't stay picked — but only decide once the union has
  // actually loaded, or an in-flight query would clear the user's pick.
  useEffect(() => {
    if (clientRateType && comboReady && !rateTypesLoading && !rateTypeUnion.has(clientRateType))
      setRateType('');
  }, [clientRateType, comboReady, rateTypesLoading, rateTypeUnion]);
```

- [ ] **Step 8: Rewire the hints, the chips and the counter**

Replace the `existingByLoc` / `blocked` memos (lines 220-229) with:

```ts
  // Inline for the same reason as cpvUnitsByProduct (Step 5): memoising on `pairs` would need a lint
  // escape hatch the gate forbids.
  const groupStates = locationGroupStates(slotReady ? (existing.data ?? []) : [], pairs, clientRateType);
  const outcome = groupOutcome(groupStates, [...selected], pairs.length);
```

> `existing.data` is `RateView[]` here because the query still ends in `.then((r) => r.items)`. **Task 6 restores the `Paginated` envelope and updates this one reference to `existing.data?.items ?? []`** — don't pre-empt it, or this task won't typecheck.

`useMemo` may now be unused in this file — the repo compiles with `noUnusedLocals: true`, so drop it from the `react` import if nothing else uses it.

`blocked` has **three** call sites, all of which must swap to `isHardBlocked(groupStates.get(a.id))` — miss one and `blocked` is deleted while still referenced:

| line | site |
|---|---|
| 281 | `toggleGroup`'s `selectable` (Select-all only toggles tickable areas) |
| **674** | the per-group `selectable` feeding `allOn` / the indeterminate Select-all checkbox |
| 750 | the chip's own `isBlocked` |

**The OFFICE banner (lines 804-818) also dies here** and no other step mentions it: it reads
`existingByLoc`, plus `productLabel` and `unitLabel` (both deleted in Step 9). `locationGroupStates`
**cannot** replace it — it `continue`s on `r.locationId === null`, so office rows are unreachable by
construction, and Step 13's grep won't catch it (`existingByLoc.get(null)` doesn't match the string
`existingByLocation`). OFFICE is single-pair only (Step 9), so fold it against that one pair:

```tsx
      {isOffice &&
        slotReady &&
        (() => {
          const only = pairs[0];
          if (!only) return null;
          // Office rows are location-less, so they live outside groupStates by construction.
          const office = (existing.data ?? []).filter(
            (r) =>
              r.locationId === null &&
              r.productId === only.productId &&
              r.verificationUnitId === only.unitId,
          );
          if (office.length === 0) return null;
          return (
            <div className="rounded-lg border border-st-under-review bg-st-under-review-bg px-4 py-3 text-xs text-st-under-review">
              <b className="font-semibold">
                {clientLabel} · {pairLabelOf(only)} already has office rates:
              </b>{' '}
              {office.map((r) => `₹${r.amount}`).join(' · ')} — an identical combination will be rejected; use
              Revise on the list to change an amount.
            </div>
          );
        })()}
```

(Task 6 changes `existing.data ?? []` here to `existing.data?.items ?? []` along with the other reader.)

The chip's three states become:

```tsx
                        g.areas.map((a) => {
                          const st = groupStates.get(a.id);
                          const isBlocked = isHardBlocked(st);
                          // Amber = some pairs would skip or error here, but the pick is still legal
                          // for the rest — the result grid reports each pair's own outcome.
                          const isAmber = !isBlocked && !!st && st.blocked.length + st.exists.length > 0;
                          const detail = [...(st?.blocked ?? []), ...(st?.exists ?? [])]
                            .map((h) => `${pairLabelOf(h.pair)} — ${existingRateLabel(h.hints)}`)
                            .join('\n');
                          return (
                            <label
                              key={a.id}
                              title={
                                isBlocked
                                  ? `Every picked pair already has a different rate type here:\n${detail}\nOne location holds one rate type — revise or deactivate the existing rates first.`
                                  : isAmber
                                    ? `Already priced for part of this group:\n${detail}\nThe rest will be created; these are skipped or reported per row.`
                                    : undefined
                              }
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted ${
                                isBlocked
                                  ? 'cursor-not-allowed border-st-rejected bg-st-rejected-bg opacity-80'
                                  : isAmber
                                    ? 'cursor-pointer border-st-under-review bg-st-under-review-bg'
                                    : 'cursor-pointer border-border-strong bg-card'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                disabled={isBlocked}
                                checked={selected.has(a.id)}
                                onChange={() => toggleArea(a.id)}
                              />
                              {a.area}
                              {isGroup ? (
                                (st?.blocked.length ?? 0) + (st?.exists.length ?? 0) > 0 && (
                                  <span
                                    className={`text-[10px] tabular-nums ${isBlocked ? 'font-semibold text-st-rejected' : 'font-semibold text-st-under-review'}`}
                                  >
                                    priced for {(st?.blocked.length ?? 0) + (st?.exists.length ?? 0)} of{' '}
                                    {pairs.length}
                                  </span>
                                )
                              ) : (
                                // One pair → the concrete hint the standard requires ("LOCAL ₹175").
                                <span
                                  className={`text-[10px] tabular-nums ${isBlocked ? 'font-semibold text-st-rejected' : isAmber ? 'font-semibold text-st-under-review' : 'text-muted-foreground'}`}
                                >
                                  {existingRateLabel([
                                    ...(st?.blocked ?? []),
                                    ...(st?.exists ?? []),
                                  ].flatMap((h) => h.hints))}
                                </span>
                              )}
                            </label>
                          );
                        })
```

Add the pair label helper next to `clientLabel` (~line 398):

```ts
  const productName = (id: number) =>
    (productCatalog.data ?? []).find((p) => p.id === id)?.name ?? String(id);
  const unitName = (id: number) => (allUnits.data ?? []).find((u) => u.id === id)?.name ?? String(id);
  const pairLabelOf = (p: Pair) =>
    `${p.productId === null ? 'Universal' : productName(p.productId)} · ${p.unitId === null ? 'Universal' : unitName(p.unitId)}`;
```

> **Naming — do this rename FIRST, in one pass, before Step 5 adds the state.** The existing `products` **query** variable (line 162) collides with the new `products` **state**. Rename the query to `productCatalog` and update its references: `products.data` in `productOpts` (line 389), `products.isError` (line 547), and the `productLabel` lookup (line 405). `productLabel` itself is deleted in Step 9 along with the single-select Field. A half-renamed file will not typecheck.

- [ ] **Step 9: Replace Step 1's single-selects with the PairPicker (Step 2 of the card layout)**

Remove the Product and Verification Unit `<Field>` blocks from StepCard 1 (lines 540-556) — Step 1's hint says *"These values are identical on every row created below"*, and the multi-picks are the fan-out axis, so leaving them there makes that line false. Insert a new StepCard between 1 and the Locations card, and renumber Locations to `n={3}`:

```tsx
      <StepCard
        n={2}
        title="Products & verification units"
        badge={pairs.length > 0 ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'}` : undefined}
        hint="Tick every product and unit this rate applies to. Each resolved pair below becomes one slot; only pairs in this client’s CPV mapping are offered."
      >
        <PairPicker
          products={products}
          units={units}
          productOptions={(productCatalog.data ?? []).map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
          unitOptions={(allUnits.data ?? [])
            .filter((u) => offerableUnitIds.includes(u.id))
            .map((u) => ({ id: u.id, label: u.name }))}
          pairs={pairs}
          dropped={dropped}
          labelFor={pairLabelOf}
          onProductsChange={changeProducts}
          onUnitsChange={changeUnits}
          isLoading={cpvLoading}
        />
      </StepCard>
```

Update `modeLocked` (line 309) to pass the new field:

```ts
  const modeLocked = modeHasDownstream({
    clientRateType,
    pincodeCount: addedPincodes.length,
    selectedCount: selected.size,
    pairCount: pairs.length,
  });
```

Also delete, in this same step, everything the removed Fields orphaned — the repo compiles with `noUnusedLocals: true`, so a survivor is a build error, not a warning: **`productOpts`** (387-390), **`unitOpts`** (391-394), **`productLabel`** (401-406) and **`unitLabel`** (407-412). The `PairPicker` builds its own options inline and `pairLabelOf` replaces both labels. (`clientOpts`/`clientLabel` stay.)

Update `valid` (lines 325-330). **The Office gate is the load-bearing part:**

```ts
  const valid =
    !!clientId &&
    pairs.length > 0 &&
    amount !== '' &&
    // OFFICE writes ONE flat rate with no product/unit fan, so it must carry exactly ONE pair.
    // Locking the toggle is NOT enough: the toggle is free while nothing is picked, so an admin can
    // switch to Office FIRST and tick a group after — the lock then holds them IN Office with N
    // pairs, and the save would write pairs[0] and silently drop the rest (spec §5.1, the exact
    // defect this feature exists to fix). The state is what's unsafe, so gate the SAVE on it.
    (isOffice ? pairs.length === 1 : !!clientRateType && count > 0 && !overCap && outcome.created > 0);
```

- [ ] **Step 10: Fan the submit across pairs**

Replace the mutation (lines 340-351). OFFICE keeps its single-pair plain POST, and **refuses rather than truncates** — Step 9's `valid` should make this unreachable, but this is the money table: a second guard costs one line, and truncating to `pairs[0]` is precisely the silent wrong-price write:

```ts
  const mut = useMutation({
    mutationFn: async () => {
      if (isOffice) {
        const only = pairs[0];
        // Refuse, never truncate: a flat office rate carries no product/unit fan, so N pairs here
        // would mean writing one and dropping N-1 under a success toast.
        if (!only || pairs.length !== 1)
          throw new Error('An office rate applies to one product & unit — narrow the selection.');
        await api<Rate>('POST', BASE, {
          ...shared(),
          productId: only.productId,
          verificationUnitId: only.unitId,
          locationId: null,
          clientRateType: null,
        });
        return null;
      }
      // A CPV group is N single-slot saves: /rates/bulk already takes ONE (product, unit) slot + N
      // locations, so each pair is byte-identical to today's save — the ADR-0093 guard, the sorted
      // deadlock order and the per-row EXISTS-skip all stay untouched server-side. Sequential: the
      // rows are small, and re-submitting is safe because EXISTS-skip is idempotent.
      const out: { pair: Pair; res: BulkRateResult }[] = [];
      for (const pair of pairs) {
        const res = await api<BulkRateResult>('POST', `${BASE}/bulk`, {
          ...shared(),
          productId: pair.productId,
          verificationUnitId: pair.unitId,
          clientRateType,
          locationIds: [...selected],
        });
        out.push({ pair, res });
      }
      return out;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [QK] });
      qc.invalidateQueries({ queryKey: ['rate-existing'] });
      if (r) {
        setResult(r);
        const created = r.reduce((n, x) => n + x.res.createdCount, 0);
        const exists = r.reduce((n, x) => n + x.res.existsCount, 0);
        const errors = r.reduce((n, x) => n + x.res.errorCount, 0);
        toast.success(
          `${created} rate${created === 1 ? '' : 's'} created` +
            (exists > 0 ? ` · ${exists} skipped (already exist)` : '') +
            (errors > 0 ? ` · ${errors} errored` : ''),
        );
      } else {
        toast.success('Rate created');
        navigate(exitTo);
      }
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiError
          ? (createFriendlyError(e.code) ?? e.code)
          : e instanceof Error
            ? e.message
            : 'Save failed';
      setError(msg);
      toast.error(msg);
    },
  });
```

Change the result state's type (line 156):

```ts
  const [result, setResult] = useState<{ pair: Pair; res: BulkRateResult }[] | null>(null);
```

- [ ] **Step 11: Rebuild the result grid over pairs × locations**

Replace the result block's row construction (lines 416-419) and its `<tbody>`. The grid already has Product and Verification Unit columns — they simply stop being constants:

```tsx
  if (result) {
    const rows = result
      .flatMap(({ pair, res }) => res.results.map((r) => ({ pair, r })))
      .sort(
        (a, b) =>
          pairLabelOf(a.pair).localeCompare(pairLabelOf(b.pair)) ||
          (locLabel.get(a.r.locationId) ?? '').localeCompare(locLabel.get(b.r.locationId) ?? ''),
      );
    const createdCount = result.reduce((n, x) => n + x.res.createdCount, 0);
    const existsCount = result.reduce((n, x) => n + x.res.existsCount, 0);
    const errorCount = result.reduce((n, x) => n + x.res.errorCount, 0);
```

then in `<tbody>`:

```tsx
              {rows.map(({ pair, r }) => (
                <tr key={`${pairKey(pair)}:${r.locationId}`} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">{clientLabel}</td>
                  <td className="px-3 py-2">{pair.productId === null ? 'Universal' : productName(pair.productId)}</td>
                  <td className="px-3 py-2">{pair.unitId === null ? 'Universal' : unitName(pair.unitId)}</td>
                  <td className="px-3 py-2 tabular-nums">{locLabel.get(r.locationId) ?? r.locationId}</td>
                  <td className="px-3 py-2 text-xs uppercase">{clientRateType}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.status === 'CREATED' ? `₹${amount}` : '—'}</td>
                  <td className="px-3 py-2">
                    {r.status === 'CREATED' ? (
                      <span className="text-xs font-semibold uppercase text-st-approved">Created</span>
                    ) : r.status === 'EXISTS' ? (
                      <span className="text-xs font-semibold uppercase text-st-under-review">
                        Skipped — already exists
                      </span>
                    ) : (
                      <span className="text-xs font-semibold uppercase text-destructive">
                        {r.error === 'HAS_OTHER_RATE_TYPE'
                          ? 'Has another rate type'
                          : r.error === 'INVALID_REFERENCE'
                            ? 'Invalid reference'
                            : r.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
```

Replace **every** `result.createdCount` / `result.existsCount` / `result.errorCount` reference **inside the whole `if (result)` block** with the locals computed above — not just the header paragraph. `result` is now `{ pair; res }[]`, so each survivor is a type error; note in particular the `{result.existsCount > 0 && (` skipped-rows footnote at line 490, below the table.

- [ ] **Step 12: Update the sticky bar to the honest counts**

Replace the sticky bar's count paragraph (lines 831-834) and add the pre-save strip:

```tsx
        <div>
          <p className="text-sm font-semibold">
            <span className="text-lg tabular-nums">{isOffice ? 1 : outcome.created}</span> rate
            {!isOffice && outcome.created !== 1 ? 's' : ''} will be created
          </p>
          {clientId && (
            <p className="text-xs text-muted-foreground">
              {clientLabel} · {pairs.length} pair{pairs.length === 1 ? '' : 's'}
              {!isOffice && clientRateType ? ` · ${clientRateType}` : ''} ·{' '}
              <span className="tabular-nums">₹{amount === '' ? '—' : amount}</span>
              {!isOffice && outcome.skipped > 0 && (
                <span className="tabular-nums"> · {outcome.skipped} skipped (already priced)</span>
              )}
              {!isOffice && outcome.blocked > 0 && (
                <span className="tabular-nums text-st-under-review">
                  {' '}
                  · {outcome.blocked} blocked (different rate type)
                </span>
              )}
            </p>
          )}
        </div>
```

and the Save button's label (line 876):

```tsx
            {isOffice
              ? 'Save'
              : outcome.created > 0
                ? `Create ${outcome.created} rate${outcome.created === 1 ? '' : 's'}`
                : 'Create rates'}
```

Add the unassigned-type note under the Rate Type field (after the `noRateTypesForCombo` block, ~line 602):

```tsx
              {unassignedPairs.length > 0 && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {clientRateType} isn’t assigned for {unassignedPairs.length} of {pairs.length} pairs (
                  {unassignedPairs.map(pairLabelOf).join(', ')}) — the rates still save.{' '}
                  <Link to={ASSIGN_RATE_TYPES_PATH} className="text-primary hover:underline">
                    assign it
                  </Link>
                  .
                </span>
              )}
```

- [ ] **Step 13: Delete the now-dead single-slot helpers and their tests**

`slotRates`, `existingByLocation` and `blockedLocations` (lines 86-127) have no remaining callers — `locationGroupStates` subsumes all three. Delete them, delete the `ExistingRateHint`-adjacent JSDoc that references them, and delete their three describe blocks from `RateCreatePage.test.ts` (`slotRates`, `existingByLocation + existingRateLabel`, `blockedLocations`). **Keep `existingRateLabel`** — the chip tooltip and the one-pair hint still use it; keep its test by folding the `existingRateLabel` assertions into their own describe block.

Confirm nothing else imports them:

```bash
grep -rn "slotRates\|existingByLocation\|blockedLocations" apps/web/src || echo "clean"
```

Expected: `clean`.

- [ ] **Step 14: Run the full web suite and typecheck**

```bash
pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test
```

Expected: PASS. If `react-hooks/exhaustive-deps` or the no-suppressions gate objects, apply the inline-computation fallbacks noted in Steps 5 and 8.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/features/rateManagement/
git commit -m "feat(web): assign a rate to a CPV group (multi product x unit)

/rates/bulk already takes one (product, unit) slot, so the page fans the
CPV-resolved pairs across the existing endpoint -- one call per pair, no server
change. Locations are no longer wiped when a product/unit tick changes, the
Field/Office toggle locks once the group has >1 pair (office writes one flat
rate and would silently drop the group), and a chip is hard-blocked only when
every pair is blocked."
```

---

### Task 6: Honest hint data on the rates page

**Why:** the hint query fetches `limit=500` and **discards `totalCount`** (`.then((r) => r.items)`, lines 214-216); `MAX_PAGE_SIZE = 500` is the server's hard ceiling. In group mode the relevant rows multiply by `|pairs|`, so truncation becomes normal — and a *stated* count computed from truncated data is worse than no count on a money page. The page already has the honest-disclosure pattern twice ("showing N of M"; RTA's "Couldn't check…").

**Files:**
- Modify: `apps/web/src/features/rateManagement/RateCreatePage.tsx`

**Interfaces:**
- Consumes: `groupOutcome` (Task 4), `outcome` (Task 5).
- Produces: nothing consumed later.

- [ ] **Step 1: Keep the Paginated envelope**

Replace the `existing` query (lines 211-218):

```ts
  // The group's existing ACTIVE rates — the source of the chip hints and the pre-save counts. 500 =
  // MAX_PAGE_SIZE, the server's hard ceiling. Keep the envelope: a client past it means the hints are
  // INCOMPLETE, and a group multiplies the rows that matter by |pairs|, so say so rather than state a
  // count we can't substantiate. The server's per-row check stays authoritative either way.
  const existing = useQuery({
    queryKey: ['rate-existing', clientId],
    queryFn: () => api<Paginated<RateView>>('GET', `${BASE}?clientId=${clientId}&active=true&limit=500`),
    enabled: slotReady,
  });
  const hintsTruncated = (existing.data?.totalCount ?? 0) > (existing.data?.items.length ?? 0);
```

Then update the one consumer — Task 5 Step 8's `groupStates` memo — from `existing.data ?? []` to:

```ts
    () => locationGroupStates(slotReady ? (existing.data?.items ?? []) : [], pairs, clientRateType),
```

`grep -n "existing.data" apps/web/src/features/rateManagement/RateCreatePage.tsx` must show only the `groupStates` memo and `hintsTruncated`.

- [ ] **Step 2: Disclose truncation on the commit surface**

In the sticky bar, replace the skipped/blocked spans added in Task 5 Step 12 with a truncation-aware version:

```tsx
              {!isOffice && hintsTruncated ? (
                <span className="text-st-under-review">
                  {' '}
                  · existing-rate check is incomplete for this client — duplicates are still skipped on save
                </span>
              ) : (
                <>
                  {!isOffice && outcome.skipped > 0 && (
                    <span className="tabular-nums"> · {outcome.skipped} skipped (already priced)</span>
                  )}
                  {!isOffice && outcome.blocked > 0 && (
                    <span className="tabular-nums text-st-under-review">
                      {' '}
                      · {outcome.blocked} blocked (different rate type)
                    </span>
                  )}
                </>
              )}
```

- [ ] **Step 3: Do not gate Save on a truncated count**

`valid` (Task 5 Step 9) requires `outcome.created > 0`. With truncated hints `outcome.created` is a floor, never an over-count (unseen rows can only *reduce* it), so the gate stays safe — but a truncated read must not *block* a legitimate save. Confirm the guard reads:

```ts
  const valid =
    !!clientId &&
    pairs.length > 0 &&
    amount !== '' &&
    (isOffice || (!!clientRateType && count > 0 && !overCap && (hintsTruncated || outcome.created > 0)));
```

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rateManagement/RateCreatePage.tsx
git commit -m "fix(web): don't state rate-hint counts computed from truncated data

The hint query discarded totalCount while fetching at MAX_PAGE_SIZE. A group
multiplies the rows that matter by |pairs|, so truncation is normal -- say the
check is incomplete instead of asserting a count we can't substantiate."
```

---

### Task 7: Group-aware plan for the rate-type assignment page (helpers only)

**Files:**
- Modify: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.tsx`
- Test: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.test.ts`

**Interfaces:**
- Consumes: `Pair`, `pairKey` (Task 2); the file's existing `SubmitMode`, `assignedRateTypeIds`, `coveredRateTypeIds`.
- Produces (used by Task 8):
  ```ts
  export interface PairPlan { pair: Pair; ids: number[]; willCreate: number }
  export function groupSubmitPlan(
    pairs: Pair[],
    selected: number[],
    existing: Pick<RateTypeAssignmentView, 'productId'|'verificationUnitId'|'rateTypeId'>[],
  ): { mode: SubmitMode; perPair: PairPlan[]; willCreate: number }
  export function coveredPairCount(
    existing: Pick<RateTypeAssignmentView, 'productId'|'verificationUnitId'|'rateTypeId'>[],
    pairs: Pair[], rateTypeId: number,
  ): number
  export function assignedPairCount(...same args...): number
  ```

- [ ] **Step 1: Write the failing tests**

Append to `RateTypeAssignmentCreatePage.test.ts` (add the new names to the existing import block):

```ts
describe('groupSubmitPlan (a group is N slots)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const a = (productId: number | null, unitId: number | null, rateTypeId: number) => ({
    productId,
    verificationUnitId: unitId,
    rateTypeId,
  });

  it('plans one call per pair, each with the ticked types', () => {
    const plan = groupSubmitPlan([P1U1, P2U1], [100, 200], []);
    expect(plan.mode).toBe('bulk');
    expect(plan.willCreate).toBe(4); // 2 pairs x 2 types
    expect(plan.perPair).toEqual([
      { pair: P1U1, ids: [100, 200], willCreate: 2 },
      { pair: P2U1, ids: [100, 200], willCreate: 2 },
    ]);
  });

  it('counts willCreate PER PAIR — an existing assignment at one pair doesn’t mask another', () => {
    const plan = groupSubmitPlan([P1U1, P2U1], [100], [a(1, 10, 100)]);
    expect(plan.willCreate).toBe(1); // only (P2,U1) is new
    expect(plan.perPair[0]?.willCreate).toBe(0);
    expect(plan.perPair[1]?.willCreate).toBe(1);
    expect(plan.perPair[0]?.ids).toEqual([100]); // amber ids still submit → reported as Skipped
  });

  it('a GROUP with one ticked type is NOT single — the singular endpoint writes ONE row', () => {
    // Regression: mode === 'single' on ids.length === 1 alone silently wrote 1 row for an N-pair group.
    const plan = groupSubmitPlan([P1U1, P2U1], [100], []);
    expect(plan.mode).toBe('bulk');
  });

  it('exactly one pair AND one type stays single (today’s behaviour)', () => {
    expect(groupSubmitPlan([P1U1], [100], []).mode).toBe('single');
  });

  it('is none when nothing new would be created anywhere', () => {
    expect(groupSubmitPlan([P1U1, P2U1], [100], [a(1, 10, 100), a(2, 10, 100)]).mode).toBe('none');
    expect(groupSubmitPlan([], [100], []).mode).toBe('none');
    expect(groupSubmitPlan([P1U1], [], []).mode).toBe('none');
  });

  it('dedupes ticked ids', () => {
    expect(groupSubmitPlan([P1U1], [100, 100], []).perPair[0]?.ids).toEqual([100]);
  });

  it('a Universal pair matches only Universal assignments', () => {
    const uni = { productId: null, unitId: null };
    expect(groupSubmitPlan([uni], [100], [a(null, null, 100)]).mode).toBe('none');
    expect(groupSubmitPlan([uni], [100], [a(1, 10, 100)]).willCreate).toBe(1);
  });
});

describe('coveredPairCount / assignedPairCount (group chip hints)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const a = (productId: number | null, unitId: number | null, rateTypeId: number) => ({
    productId,
    verificationUnitId: unitId,
    rateTypeId,
  });

  it('counts pairs already carrying the type at their exact slot', () => {
    expect(assignedPairCount([a(1, 10, 100)], [P1U1, P2U1], 100)).toBe(1);
  });
  it('counts pairs where a broader Universal parent already covers the type', () => {
    // A Universal (null, null) assignment resolves at every pair (UNION resolver, ADR-0067).
    expect(coveredPairCount([a(null, null, 100)], [P1U1, P2U1], 100)).toBe(2);
  });
  it('a specific assignment does not bubble up to a Universal pair', () => {
    expect(coveredPairCount([a(1, 10, 100)], [{ productId: null, unitId: null }], 100)).toBe(0);
  });
  it('is zero for an unrelated rate type', () => {
    expect(coveredPairCount([a(null, null, 100)], [P1U1], 999)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @crm2/web test -- src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.test.ts
```

Expected: FAIL — `groupSubmitPlan is not exported`.

- [ ] **Step 3: Write the implementation**

In `RateTypeAssignmentCreatePage.tsx`, add the import:

```ts
import type { Pair } from '../cpvGroup/pairs.js';
```

and add after the existing `submitPlan` (~line 92):

```ts
/** One pair's share of a group save — one existing `/bulk` call each. */
export interface PairPlan {
  pair: Pair;
  /** every ticked type (amber ones included, so the result grid can report them as Skipped). */
  ids: number[];
  willCreate: number;
}

/**
 * How a GROUP save resolves: `/rate-type-assignments/bulk` already takes ONE (client, product?,
 * unit?) slot + N rate types, so a group is N of those calls — one per pair, with the same ticked
 * set. `willCreate` is counted PER PAIR against that pair's own assignments (a type already assigned
 * at pair A says nothing about pair B).
 *
 * `mode` is 'single' only when there is exactly ONE pair AND one ticked type. Gating it on
 * `ids.length === 1` alone routes an N-pair group to the SINGULAR endpoint, which writes one row and
 * reports success — a silent loss of the rest of the group.
 */
export function groupSubmitPlan(
  pairs: Pair[],
  selected: number[],
  existing: Pick<RateTypeAssignmentView, 'productId' | 'verificationUnitId' | 'rateTypeId'>[],
): { mode: SubmitMode; perPair: PairPlan[]; willCreate: number } {
  const ids = [...new Set(selected)];
  const perPair = pairs.map((pair) => {
    const assigned = assignedRateTypeIds(existing, pair.productId, pair.unitId);
    return { pair, ids, willCreate: ids.filter((id) => !assigned.has(id)).length };
  });
  const willCreate = perPair.reduce((n, p) => n + p.willCreate, 0);
  const mode: SubmitMode =
    willCreate === 0 ? 'none' : pairs.length === 1 && ids.length === 1 ? 'single' : 'bulk';
  return { mode, perPair, willCreate };
}

/** How many of the group's pairs already carry this type at their EXACT slot (amber = would skip). */
export const assignedPairCount = (
  existing: Pick<RateTypeAssignmentView, 'productId' | 'verificationUnitId' | 'rateTypeId'>[],
  pairs: Pair[],
  rateTypeId: number,
): number =>
  pairs.filter((p) => assignedRateTypeIds(existing, p.productId, p.unitId).has(rateTypeId)).length;

/** How many of the group's pairs already RESOLVE this type via a broader Universal parent (muted =
 *  redundant). Superset of `assignedPairCount` — the UNION resolver, ADR-0067. */
export const coveredPairCount = (
  existing: Pick<RateTypeAssignmentView, 'productId' | 'verificationUnitId' | 'rateTypeId'>[],
  pairs: Pair[],
  rateTypeId: number,
): number =>
  pairs.filter((p) => coveredRateTypeIds(existing, p.productId, p.unitId).has(rateTypeId)).length;
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm --filter @crm2/web test -- src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.test.ts
```

Expected: PASS — the new suites plus every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rateTypeAssignments/
git commit -m "feat(web): group-aware submit plan for rate-type assignments

willCreate is counted per pair, and mode='single' now requires exactly one pair
AND one type: gating on ids.length alone routed an N-pair group to the singular
endpoint, writing one row and reporting success."
```

---

### Task 8: Rewire the rate-type assignment page to CPV groups

**Files:**
- Modify: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentCreatePage.tsx`

**Interfaces:**
- Consumes: `PairPicker` (Task 3); `Pair`, `pairKey`, `resolvePairs`, `unitOptionIds` (Task 2); `groupSubmitPlan`, `assignedPairCount`, `coveredPairCount` (Task 7).
- Produces: nothing consumed later.

> **Behaviour note — an intentional, spec-backed change.** Today this page treats a **blank** product/unit as Universal, so a fresh page *defaults* to Universal. A tick-list has no blank, so the Universal choice becomes an explicit chip — **ticked by default here**, which preserves today's default exactly while making the state visible. The rates page keeps its empty default (a money table must never default to Universal). Same component, different initial state.

- [ ] **Step 1: Fix the imports, then replace the slot state with group state**

Task 7 added `import type { Pair } from '../cpvGroup/pairs.js';` — a **type-only** import. This task calls `pairKey` as a *value* (Step 8), which would be `TS1362: 'pairKey' cannot be used as a value because it was imported using 'import type'`. Restate the whole import rather than amend it, and add the picker + `useQueries`:

```ts
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Pair, pairKey, resolvePairs, unitOptionIds } from '../cpvGroup/pairs.js';
import { PairPicker } from '../cpvGroup/PairPicker.js';
```

Then replace lines 108-109:

```ts
  // Universal is ticked by default — the shipped default for this page (ADR-0069: "pick client, then
  // optionally Universal product + Universal unit"). It is now an explicit chip rather than a blank.
  const [products, setProducts] = useState<(number | null)[]>([null]);
  const [units, setUnits] = useState<(number | null)[]>([null]);
```

- [ ] **Step 2: Fan the CPV query per product**

Replace the `units` query (lines 122-133) with the same shape as Task 5 Step 5:

```ts
  const allUnits = useQuery({
    queryKey: ['verification-unit-options'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
  const concreteProducts = products.filter((p): p is number => p !== null);
  const cpvQueries = useQueries({
    queries: concreteProducts.map((p) => ({
      queryKey: ['cpv-available-units', clientId, String(p)],
      queryFn: () =>
        api<{ id: number; code: string; name: string }[]>(
          'GET',
          `/api/v2/cpv-units/available?clientId=${clientId}&productId=${p}`,
        ),
      enabled: !!clientId,
    })),
  });
  const cpvLoading = cpvQueries.some((q) => q.isLoading);
  const cpvUnitsByProduct = new Map(
    concreteProducts.map((p, i) => [p, new Set((cpvQueries[i]?.data ?? []).map((u) => u.id))]),
  );
  const allUnitIds = (allUnits.data ?? []).map((u) => u.id);
  const offerableUnitIds = unitOptionIds(products, cpvUnitsByProduct, allUnitIds);
  const { pairs, dropped } = resolvePairs(products, units, cpvUnitsByProduct);
```

Add `useQueries` to the `@tanstack/react-query` import (line 3). Replace `noCpvMapping` (line 152) — the `PairPicker`'s own dropped-pair note supersedes it:

```ts
  // A concrete product with no CPV mapping contributes no pairs; PairPicker names the drops + links CPV.
  const noCpvMapping = concreteProducts.length > 0 && !cpvLoading && offerableUnitIds.length === 0;
```

- [ ] **Step 3: Replace the per-slot memos with per-group ones**

Replace **two separate ranges**: `slotProductId` / `slotUnitId` / `assigned` / `coveredByParent` (lines **154-167**) **and** `skipCount` / `plan` / `willCreate` (lines **180-182**). Missing the second range is `TS2451 Cannot redeclare block-scoped variable` ×3 plus a call to the just-deleted `assigned`. **Keep `const count = selected.size;` (line 179)** — it still feeds lines 431, 473, 550 and 565. Both ranges collapse into:

```ts
  const existingItems = existing.data ?? [];
  const plan = groupSubmitPlan(pairs, [...selected], existingItems);
  const willCreate = plan.willCreate;
  // Ticked types already assigned at SOME pair — they EXISTS-skip there, never an error.
  const skipCount = [...selected].reduce(
    (n, id) => n + assignedPairCount(existingItems, pairs, id),
    0,
  );
```

Replace the label lines (173-177):

```ts
  const clientLabel = clients.data?.find((c) => String(c.id) === clientId)?.name ?? clientId;
  const productName = (id: number) => productCatalog.data?.find((p) => p.id === id)?.name ?? String(id);
  const unitName = (id: number) => allUnits.data?.find((u) => u.id === id)?.name ?? String(id);
  const pairLabelOf = (p: Pair) =>
    `${p.productId === null ? 'Universal' : productName(p.productId)} · ${p.unitId === null ? 'Universal' : unitName(p.unitId)}`;
```

> **Naming — do this rename FIRST, in one pass, before Step 1 adds the state.** As in Task 5, the new `products` state collides with the existing `products` query. Rename the query to `productCatalog` and update its references (the `<option>` map at lines 388-392, `products.isError` at 394, `products.isLoading` at 384). The old `productLabel`/`unitLabel` consts (174-177) are deleted — `pairLabelOf` replaces them. A half-renamed file will not typecheck.

- [ ] **Step 4: Fix the invalidation**

Replace `changeClient` / `changeProduct` / `changeUnit` (lines 192-206):

```ts
  const changeClient = (v: string) => {
    setClientId(v);
    setProducts([null]);
    setUnits([null]);
    setSelected(new Set());
  };
  // Ticks re-resolve the pairs; the rate-type selection is ORTHOGONAL to the CPV axes and is never
  // cleared (the amber/covered hints simply recompute against the new pairs).
  const changeProducts = (next: (number | null)[]) => {
    setProducts(next);
    setUnits((u) => retainUnits(next, u, cpvUnitsByProduct, allUnitIds));
  };
  const changeUnits = (next: (number | null)[]) => setUnits(next);
```

(Add `retainUnits` to this file's `../cpvGroup/pairs.js` import from Step 1.)

Update `valid` (line 186):

```ts
  const valid = !!clientId && pairs.length > 0 && plan.mode !== 'none';
```

- [ ] **Step 5: Replace StepCard 1's three selects with the PairPicker**

Keep the Client `<select>` in StepCard 1; remove the Product and Verification Unit `<Field>` blocks (lines 380-424) and insert them as a new card, renumbering "Rate types" to `n={3}`:

```tsx
      <StepCard
        n={2}
        title="Products & verification units"
        badge={pairs.length > 0 ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'}` : undefined}
        hint="Tick every product and unit this applies to. Each resolved pair below gets its own assignment per ticked rate type."
      >
        <PairPicker
          products={products}
          units={units}
          productOptions={(productCatalog.data ?? []).map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
          unitOptions={(allUnits.data ?? [])
            .filter((u) => offerableUnitIds.includes(u.id))
            .map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` }))}
          pairs={pairs}
          dropped={dropped}
          labelFor={pairLabelOf}
          onProductsChange={changeProducts}
          onUnitsChange={changeUnits}
          isLoading={cpvLoading}
        />
        {noCpvMapping && (
          <p className="text-xs text-muted-foreground">
            {NO_CPV_MAPPING} —{' '}
            <Link to={CPV_ADMIN_PATH} className="text-primary hover:underline">
              map it in CPV
            </Link>
            .
          </p>
        )}
      </StepCard>
```

- [ ] **Step 6: Make the rate-type chips group-aware**

First rewire the **caption above the chips** (line 458), which also reads the deleted `coveredByParent` — Step 3 removes it, so this branch is `Cannot find name`:

```tsx
              ) : (rateTypes.data ?? []).some(
                  (rt) =>
                    coveredPairCount(existingItems, pairs, rt.id) >
                    assignedPairCount(existingItems, pairs, rt.id),
                ) ? (
```

Then replace `isAssigned` / `isCovered` in the chip map (lines 482-485) and the chip's trailing marker (511-515):

```tsx
              {(rateTypes.data ?? []).map((rt) => {
                const assignedAt = assignedPairCount(existingItems, pairs, rt.id);
                const coveredAt = coveredPairCount(existingItems, pairs, rt.id) - assignedAt;
                const isAssigned = assignedAt > 0;
                const isCovered = !isAssigned && coveredAt > 0;
                const all = pairs.length;
                return (
                  <label
                    key={rt.id}
                    title={
                      isAssigned
                        ? `Already assigned at ${assignedAt} of ${all} pair${all === 1 ? '' : 's'} — those are skipped; the rest are created`
                        : isCovered
                          ? `Already available at ${coveredAt} of ${all} pair${all === 1 ? '' : 's'} via a broader (Universal) assignment — adding it there creates a redundant row`
                          : undefined
                    }
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted ${
                      isAssigned
                        ? 'border-st-under-review bg-st-under-review-bg'
                        : isCovered
                          ? 'border-border bg-surface-muted'
                          : 'border-border-strong bg-card'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={selected.has(rt.id)}
                      onChange={() => toggle(rt.id)}
                    />
                    <span className="uppercase">{rt.code}</span>
                    {isAssigned ? (
                      <span className="text-[10px] font-semibold tabular-nums text-st-under-review">
                        {all === 1 ? 'assigned' : `assigned ${assignedAt}/${all}`}
                      </span>
                    ) : isCovered ? (
                      <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                        {all === 1 ? 'covered' : `covered ${coveredAt}/${all}`}
                      </span>
                    ) : null}
                  </label>
                );
              })}
```

- [ ] **Step 7: Fan the submit across pairs**

Replace the mutation (lines 219-227) and the result state's type (line 112 → `useState<{ pair: Pair; res: BulkRateTypeAssignmentResult }[] | null>(null)`):

```ts
  const mut = useMutation({
    mutationFn: async (): Promise<{ pair: Pair; res: BulkRateTypeAssignmentResult }[] | null> => {
      // Exactly one pair + one type keeps the shipped single-POST path (navigate back, no result panel).
      if (plan.mode === 'single') {
        const only = plan.perPair[0];
        if (!only) return null;
        await api('POST', BASE, {
          clientId: Number(clientId),
          productId: only.pair.productId,
          verificationUnitId: only.pair.unitId,
          rateTypeId: only.ids[0],
        });
        return null;
      }
      // A group is N single-slot saves — /bulk already takes ONE slot + N rate types, so each pair is
      // byte-identical to today's save. Re-submitting is safe: the server pre-read EXISTS-skips.
      const out: { pair: Pair; res: BulkRateTypeAssignmentResult }[] = [];
      for (const { pair, ids } of plan.perPair) {
        const res = await api<BulkRateTypeAssignmentResult>('POST', `${BASE}/bulk`, {
          clientId: Number(clientId),
          productId: pair.productId,
          verificationUnitId: pair.unitId,
          rateTypeIds: ids,
        });
        out.push({ pair, res });
      }
      return out;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [QK] });
      qc.invalidateQueries({ queryKey: ['rate-type-assignment-existing'] });
      if (!res) {
        toast.success('Assignment created');
        navigate(exitTo);
        return;
      }
      const created = res.reduce((n, x) => n + x.res.createdCount, 0);
      const exists = res.reduce((n, x) => n + x.res.existsCount, 0);
      const errors = res.reduce((n, x) => n + x.res.errorCount, 0);
      const parts = [`${created} created`];
      if (exists) parts.push(`${exists} skipped (already assigned)`);
      if (errors) parts.push(`${errors} errored`);
      const notify = created === 0 && errors > 0 ? toast.error : toast.success;
      notify(parts.join(' · '));
      setResult(res);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiError
          ? (rtaFriendlyError(e.code) ?? e.code)
          : e instanceof Error
            ? e.message
            : 'Save failed';
      setError(msg);
      toast.error(msg);
    },
  });
```

- [ ] **Step 8: Rebuild the result grid over pairs × rate types**

Replace the result block's rows (262-264) and its table. The grid gains Product and Verification Unit columns:

```tsx
  if (result) {
    const rows = result
      .flatMap(({ pair, res }) => res.results.map((r) => ({ pair, r })))
      .sort(
        (a, b) =>
          pairLabelOf(a.pair).localeCompare(pairLabelOf(b.pair)) ||
          (rtById.get(a.r.rateTypeId) ?? '').localeCompare(rtById.get(b.r.rateTypeId) ?? ''),
      );
    const createdCount = result.reduce((n, x) => n + x.res.createdCount, 0);
    const existsCount = result.reduce((n, x) => n + x.res.existsCount, 0);
    const errorCount = result.reduce((n, x) => n + x.res.errorCount, 0);
```

The header paragraph's `{clientLabel} · {productLabel} · {unitLabel}` (line 275) becomes `{clientLabel} · {result.length} pair{result.length === 1 ? '' : 's'}`; its three count references become the locals above. `<thead>` gains two columns before Rate Type:

```tsx
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Verification Unit</th>
                <th className="px-3 py-2">Rate Type</th>
                <th className="px-3 py-2">Status</th>
```

and `<tbody>`:

```tsx
              {rows.map(({ pair, r }) => (
                <tr key={`${pairKey(pair)}:${r.rateTypeId}`} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">{pair.productId === null ? 'Universal' : productName(pair.productId)}</td>
                  <td className="px-3 py-2">{pair.unitId === null ? 'Universal' : unitName(pair.unitId)}</td>
                  <td className="px-3 py-2 text-xs uppercase">{rtById.get(r.rateTypeId) ?? r.rateTypeId}</td>
                  <td className="px-3 py-2">
                    {r.status === 'CREATED' ? (
                      <span className="text-xs font-semibold uppercase text-st-approved">Created</span>
                    ) : r.status === 'EXISTS' ? (
                      <span className="text-xs font-semibold uppercase text-st-under-review">
                        Skipped — already assigned
                      </span>
                    ) : (
                      <span className="text-xs font-semibold uppercase text-destructive">
                        {r.error === 'INVALID_ASSIGNMENT_REF' ? 'Invalid reference' : r.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
```

Add `pairKey` to the `../cpvGroup/pairs.js` import.

- [ ] **Step 9: Update the sticky bar**

Replace its context line (539):

```tsx
              {clientLabel} · {pairs.length} pair{pairs.length === 1 ? '' : 's'}
              {skipCount > 0 && <span className="tabular-nums"> · {skipCount} already assigned (skipped)</span>}
```

and the Save label (565):

```tsx
            {pairs.length === 1 && count <= 1 ? 'Save' : willCreate > 0 ? `Create ${willCreate}` : 'Create'}
```

- [ ] **Step 10: Retire the superseded single-slot plan helper**

`submitPlan` is superseded by `groupSubmitPlan` and has no callers left. Confirm, then delete it **and** its test describe block:

```bash
grep -rn "submitPlan" apps/web/src | grep -v groupSubmitPlan || echo "clean"
```

Expected: `clean`. Keep `assignedRateTypeIds` and `coveredRateTypeIds` — `groupSubmitPlan`, `assignedPairCount` and `coveredPairCount` all call them, and their tests still pass unchanged.

- [ ] **Step 11: Typecheck + full suite**

```bash
pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/features/rateTypeAssignments/
git commit -m "feat(web): assign rate types to a CPV group (multi product x unit)

The page fans the CPV-resolved pairs across the existing /bulk endpoint, one
call per pair. Universal becomes an explicit chip (ticked by default, matching
the page's shipped default) instead of a blank select."
```

---

### Task 9: Gate, browser-verify, and record

**Files:**
- Modify: `CRM2_MASTER_MEMORY.md` (§8)
- Modify: `docs/COMPLIANCE_GAPS_REGISTRY.md`
- Modify: `~/.claude/projects/-Users-mayurkulkarni-Downloads-crm2/memory/` (a new topic file + a `MEMORY.md` index line)

- [ ] **Step 1: Run the full gate**

```bash
pnpm verify
```

Expected: green through typecheck → lint → format → no-suppressions → boundaries → test → build. **Do not proceed past a red gate.** Note that `pnpm verify` excludes Playwright; these pages have no e2e specs, so no extra run is needed.

- [ ] **Step 2: Confirm the server really did not change**

```bash
git diff --stat main -- apps/api packages/sdk db
```

Expected: **only** `apps/api/src/modules/rates/__tests__/rates.api.test.ts` (Task 1). Any other file means the design drifted — stop and escalate.

- [ ] **Step 3: Browser-verify the rates page (mandatory)**

Per `feedback_browser_verify_perform_actions`, tests are not enough — perform the action and confirm it persisted.

1. `preview_start` the web dev server from `.claude/launch.json`, log in as an admin, and open `/admin/rates/new`.
2. Pick a client with a CPV mapping across ≥2 products. Tick **2 products × 2 units**; confirm the pair chips show the **jagged** truth (fewer than 4 if the mapping says so) and any dropped pair is named.
3. Tick a rate type, enter an amount, add a pincode, tick **2 areas**. Confirm the sticky bar reads **pairs × 2**.
4. Tick a 3rd product → **confirm the ticked areas are still ticked** (the work-loss regression).
5. Try to flip Field → Office → **confirm the toggle is locked** with the "Clear fields" recovery.
6. Save. Confirm the result grid shows one row per **pair × location** with real Product and Verification Unit values.
7. Open `/admin/rates` and confirm the rows **persisted** with the right product/unit dims.
8. Re-save the identical group → confirm every row reports **Skipped — already exists** (idempotent retry).

- [ ] **Step 4: Browser-verify the assignment page**

1. Open `/admin/rate-type-assignments/new`. Confirm **Universal is ticked by default** on both axes (today's default, now explicit).
2. Tick 2 products × 2 units and **one** rate type. Save. **Confirm one row per pair is created — not one row total** (the silent-collapse regression).
3. Confirm the rows persisted on `/admin/rate-type-assignments`.

- [ ] **Step 5: Record the outcome**

Append to `docs/COMPLIANCE_GAPS_REGISTRY.md` a `§RATE-CPV-GROUP-2026-07-15` section: the three FE defects fixed (location wipe · singular-route collapse · OFFICE group collapse), the rejected server design and why (spec §2.2), and the backfilled guard test — each dispositioned **FIXED**. Update `CRM2_MASTER_MEMORY.md` §8 with the shipped state. Add a memory topic file `project_rate_cpv_group_2026_07_15.md` plus its one-line `MEMORY.md` index entry, carrying the don't-regress list from spec §7.

- [ ] **Step 6: Commit**

```bash
git add CRM2_MASTER_MEMORY.md docs/COMPLIANCE_GAPS_REGISTRY.md
git commit -m "docs: record the rate CPV-group ship + dispositions"
```

- [ ] **Step 7: Stop. Do not push.**

Report to the owner: the gate result, the browser-verification findings, and that `main` is ready to push when they authorise it. **Pushing to `main` deploys STAGING; pushing to `prod` deploys PRODUCTION.** Neither happens without an explicit OK.

---

## Appendix: what NOT to do

Re-litigating these has a cost the spec already paid — read spec §2.2 and §6 before proposing any of them.

1. **Do not add `productIds[]` / `verificationUnitIds[]` to the bulk schemas.** The wire contract already expresses every row a group creates.
2. **Do not widen `otherTypeAtSlot` to arrays.** `= ANY(ARRAY[NULL]::int[])` → NULL → the row is dropped → the ADR-0093 guard fails **open** on five live paths → double-billing, with CI green.
3. **Do not key a fanned guard result by bare `locationId`.** Under a cross product it is not unique; it over-blocks legal slots and the test pinning the invariant still passes.
4. **Do not add a total row cap.** `MAX_BULK_RATE_LOCATIONS = 500` per request is the trust boundary, enforced server-side. An FE cap is theatre.
5. **Do not import `IMPORT_JOB_THRESHOLD` into the web app.** It is unreachable (`@crm2/sdk` depends only on `zod`), env-tunable at runtime, and semantically the sync/async boundary — not a row cap.
6. **Do not intersect the rate types across a group.** Omitting a dim returns the client-wide **union**; the gate is UI-only (the server checks catalog existence + category, mig 0013 dropped the trigger, `RATE_LATERAL` never joins `rate_type_assignments`); and an empty intersection dead-ends the flagship case.
7. **Do not add a per-row `NOT_IN_CPV` server skip.** No CPV check exists on any rate write path; adding one only to `/bulk` is a new rule on one of three doors and breaks ~14 existing tests.
8. **Do not extract `StepCard`/`Field`.** Already 3×-duplicated with a `ponytail:` comment deferring it to a dedicated refactor. Not this feature's job.
