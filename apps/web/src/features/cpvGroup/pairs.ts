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
