import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_BULK_RATE_TYPE_ASSIGNMENTS,
  type Option,
  type VerificationUnitOption,
  type RateTypeOption,
  type RateTypeAssignmentView,
  type BulkRateTypeAssignmentResult,
  type Paginated,
} from '@crm2/sdk';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/index.js';
import {
  type Pair,
  pairKey,
  resolvePairs,
  unitOptionIds,
  retainUnits,
  PairPicker,
} from '../cpvGroup/index.js';

const BASE = '/api/v2/rate-type-assignments';
const QK = 'rate-type-assignments';
const LIST_PATH = '/admin/rate-type-assignments';

// UX-3 (moved from the record page): a concrete client + product with no CPV mapping returns [] from
// /cpv-units/available — warn (with the link that fixes it) but leave the unit picker unchanged.
export const NO_CPV_MAPPING = 'This client + product has no CPV mapping yet';
export const CPV_ADMIN_PATH = '/admin/cpv';

// The create page's known 4xx codes in plain English. Unknown codes fall through to the raw code —
// never silently swallowed (one small map per page; a shared error registry is YAGNI).
export const rtaFriendlyError = (code: string): string | null =>
  code === 'INVALID_ASSIGNMENT_REF'
    ? 'Unknown client, product, unit, or rate type — refresh the page and try again.'
    : code === 'VALIDATION'
      ? `Pick at least one rate type (a save is capped at ${MAX_BULK_RATE_TYPE_ASSIGNMENTS} rate types).`
      : null;

/** The rate types ALREADY active on THIS slot — same client + product + unit (null-aware: Universal
 *  only matches Universal, mirroring the NULLS-NOT-DISTINCT key). Re-adding one of these is a skip
 *  (amber hint before save), not a duplicate. Assignments at other product/unit slots are irrelevant. */
export function assignedRateTypeIds(
  items: Pick<RateTypeAssignmentView, 'productId' | 'verificationUnitId' | 'rateTypeId'>[],
  slotProductId: number | null,
  slotUnitId: number | null,
): Set<number> {
  return new Set(
    items
      .filter((a) => a.productId === slotProductId && a.verificationUnitId === slotUnitId)
      .map((a) => a.rateTypeId),
  );
}

/** The rate types RESOLVABLE at this slot — including those inherited from a broader (Universal or
 *  partially-Universal) parent assignment. Mirrors the server resolver `rate-types/available`
 *  (`rateTypes/repository.ts`): `(product_id IS NULL OR = P) AND (verification_unit_id IS NULL OR = U)`.
 *  Directional: a Universal `(∅,∅)` assignment covers every specific slot, but a specific assignment
 *  does NOT bubble up to Universal. Superset of `assignedRateTypeIds` (which is the exact-slot subset);
 *  the difference = "already covered here, so adding it at this slot is redundant". */
export function coveredRateTypeIds(
  items: Pick<RateTypeAssignmentView, 'productId' | 'verificationUnitId' | 'rateTypeId'>[],
  slotProductId: number | null,
  slotUnitId: number | null,
): Set<number> {
  return new Set(
    items
      .filter(
        (a) =>
          (a.productId === null || a.productId === slotProductId) &&
          (a.verificationUnitId === null || a.verificationUnitId === slotUnitId),
      )
      .map((a) => a.rateTypeId),
  );
}

/** The single-vs-bulk save mode: 'none' blocks submit, 'single' → one POST + navigate, 'bulk' → the
 *  bulk endpoint + a row-result screen. */
export type SubmitMode = 'none' | 'single' | 'bulk';

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
): number => pairs.filter((p) => assignedRateTypeIds(existing, p.productId, p.unitId).has(rateTypeId)).length;

/** How many of the group's pairs already RESOLVE this type via a broader Universal parent (muted =
 *  redundant). Superset of `assignedPairCount` — the UNION resolver, ADR-0067. */
export const coveredPairCount = (
  existing: Pick<RateTypeAssignmentView, 'productId' | 'verificationUnitId' | 'rateTypeId'>[],
  pairs: Pair[],
  rateTypeId: number,
): number => pairs.filter((p) => coveredRateTypeIds(existing, p.productId, p.unitId).has(rateTypeId)).length;

/**
 * CPV-group create page (ADR-0093 / CREATE_PAGE_STANDARD, Fork B + the 2026-07-15 multi-select
 * design): pick a client, tick MANY products × MANY units (the resolved CPV pairs are the fan-out),
 * then tick MANY rate types → one assignment row per (pair × rate type). Exactly one pair + one type
 * keeps the shipped single-POST path (navigate back); anything larger fans the existing `/bulk`
 * endpoint once per pair and shows a row-result screen. `masterdata.manage` only (the server enforces
 * it too); a viewer is bounced to the list.
 */
export function RateTypeAssignmentCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { has } = useAuth();
  const [searchParams] = useSearchParams();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);

  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? '');
  // Universal is ticked by default — the shipped default for this page (ADR-0069: "pick client, then
  // optionally Universal product + Universal unit"). It is now an explicit chip rather than a blank.
  const [products, setProducts] = useState<(number | null)[]>([null]);
  const [units, setUnits] = useState<(number | null)[]>([null]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pair: Pair; res: BulkRateTypeAssignmentResult }[] | null>(null);

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const productCatalog = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
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
  // needs a lint escape hatch, and the no-suppressions gate forbids those outright.
  const cpvUnitsByProduct = new Map(
    concreteProducts.map((p, i) => [p, new Set((cpvQueries[i]?.data ?? []).map((u) => u.id))]),
  );
  const allUnitIds = (allUnits.data ?? []).map((u) => u.id);
  const offerableUnitIds = unitOptionIds(products, cpvUnitsByProduct, allUnitIds);
  const { pairs, dropped } = resolvePairs(products, units, cpvUnitsByProduct);

  const rateTypes = useQuery({
    queryKey: ['rate-types', 'options'],
    queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
  });
  // The client's active assignments — the source for the amber "already assigned" hints (slot-filtered
  // client-side; keyed by clientId so switching product/unit needs no refetch).
  // ponytail: limit=500 (== MAX_PAGE_SIZE, matches RateCreatePage). A client with >500 active
  // assignments under-reports amber for the overflow; harmless — the server pre-read still EXISTS-skips
  // any true duplicate on save. Raise to a slot-scoped fetch only if a client ever exceeds that.
  const existing = useQuery({
    queryKey: ['rate-type-assignment-existing', clientId],
    queryFn: () =>
      api<Paginated<RateTypeAssignmentView>>(
        'GET',
        `${BASE}?clientId=${clientId}&active=true&limit=500`,
      ).then((r) => r.items),
    enabled: !!clientId,
  });
  // A concrete product with no CPV mapping contributes no pairs; PairPicker names the drops + links CPV.
  const noCpvMapping = concreteProducts.length > 0 && !cpvLoading && offerableUnitIds.length === 0;

  const existingItems = existing.data ?? [];
  const plan = groupSubmitPlan(pairs, [...selected], existingItems);
  const willCreate = plan.willCreate;
  // Ticked types already assigned at SOME pair — they EXISTS-skip there, never an error.
  const skipCount = [...selected].reduce((n, id) => n + assignedPairCount(existingItems, pairs, id), 0);

  const rtById = useMemo(
    () => new Map((rateTypes.data ?? []).map((rt) => [rt.id, rt.code])),
    [rateTypes.data],
  );
  const clientLabel = clients.data?.find((c) => String(c.id) === clientId)?.name ?? clientId;
  const productName = (id: number) => productCatalog.data?.find((p) => p.id === id)?.name ?? String(id);
  const unitName = (id: number) => allUnits.data?.find((u) => u.id === id)?.name ?? String(id);
  const pairLabelOf = (p: Pair) =>
    `${p.productId === null ? 'Universal' : productName(p.productId)} · ${p.unitId === null ? 'Universal' : unitName(p.unitId)}`;

  const count = selected.size;
  // Gate on willCreate (not count): an all-amber selection creates nothing across every pair, so a
  // pure no-op save is blocked. Inactive combos aren't amber (existing is active=true-filtered), so
  // legitimate re-activations still count.
  const valid = !!clientId && pairs.length > 0 && plan.mode !== 'none';

  // Changing the CLIENT redefines everything downstream (the CPV mapping, the existing-assignment
  // hints) — reset the axes to their Universal default and wipe the selection.
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

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allRateTypeIds = (rateTypes.data ?? []).map((rt) => rt.id);
  const allOn = allRateTypeIds.length > 0 && allRateTypeIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(allRateTypeIds));

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
      // The amber-hint source is a separate query key — invalidate it too, or "Add more" (same slot)
      // shows the just-created rows as un-assigned.
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

  if (!has('masterdata.manage')) return <Navigate to={LIST_PATH} replace />;

  // ── Result screen (group save) — one row per (pair × rate type), styled like the list.
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
    return (
      <div className="max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {createdCount > 0 ? 'Rate type assignments created' : 'No new assignments created'}
          </h1>
          <p
            className="text-sm text-muted-foreground"
            {...(errorCount > 0 ? { role: 'alert' as const } : {})}
          >
            {clientLabel} · {result.length} pair{result.length === 1 ? '' : 's'} —{' '}
            <strong className="tabular-nums text-foreground">{createdCount}</strong> created
            {existsCount > 0 && (
              <>
                {' · '}
                <strong className="tabular-nums text-foreground">{existsCount}</strong> skipped (already
                assigned)
              </>
            )}
            {errorCount > 0 && (
              <>
                {' · '}
                <strong className="tabular-nums text-destructive">{errorCount}</strong> errored
              </>
            )}
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full border-collapse whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Verification Unit</th>
                <th className="px-3 py-2">Rate Type</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pair, r }) => (
                <tr
                  key={`${pairKey(pair)}:${r.rateTypeId}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-3 py-2">
                    {pair.productId === null ? 'Universal' : productName(pair.productId)}
                  </td>
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
            </tbody>
          </table>
        </div>
        {existsCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Skipped rate types were already assigned to this combination — they weren’t touched.
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setResult(null);
              setSelected(new Set());
            }}
          >
            Add more
          </Button>
          <Button onClick={() => navigate(exitTo)}>View assignments</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to rate type assignments
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">New Rate Type Assignment</h1>
        <p className="text-sm text-muted-foreground">
          Pick a client, tick the products &amp; verification units it covers, then choose which rate types
          apply — one assignment is created per resolved pair × rate type.
        </p>
      </div>

      <StepCard
        n={1}
        title="Client"
        hint="The rate types ticked below apply to this client, across every resolved pair."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Client" required>
            <select
              className="input"
              value={clientId}
              disabled={clients.isLoading}
              onChange={(e) => changeClient(e.target.value)}
            >
              <option value="">{clients.isLoading ? 'Loading clients…' : 'Select a client…'}</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            {clients.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load clients.</span>
            )}
          </Field>
        </div>
      </StepCard>

      <StepCard
        n={2}
        title="Products & verification units"
        badge={pairs.length > 0 ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'}` : undefined}
        hint="Tick every product and unit this applies to. Each resolved pair below gets its own assignment per ticked rate type."
      >
        <PairPicker
          products={products}
          units={units}
          productOptions={(productCatalog.data ?? []).map((p) => ({
            id: p.id,
            label: `${p.code} — ${p.name}`,
          }))}
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

      <StepCard
        n={3}
        title="Rate types"
        badge={count > 0 ? `${count} selected` : undefined}
        hint="Tick every rate type these pairs may use. Amber = already assigned (skipped); muted = already covered by a broader assignment."
      >
        {rateTypes.isLoading ? (
          <HexagonLoader operation="Loading rate types" />
        ) : rateTypes.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Couldn’t load rate types.
          </p>
        ) : (rateTypes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No active rate types in the catalog.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              {/* The caption must match reality: amber comes from the `existing` query, which fails
                  open (empty set) on error/in-flight — so only claim "already assigned" once it's
                  actually loaded, and warn (don't lie) when the check couldn't run. */}
              {!clientId ? (
                <span className="text-xs text-muted-foreground">
                  Pick a client to see what’s already assigned.
                </span>
              ) : existing.isError ? (
                <span className="text-xs text-st-under-review" role="alert">
                  Couldn’t check existing assignments — any duplicates will be skipped on save.
                </span>
              ) : existing.isLoading ? (
                <span className="text-xs text-muted-foreground">Checking existing assignments…</span>
              ) : (rateTypes.data ?? []).some(
                  (rt) =>
                    coveredPairCount(existingItems, pairs, rt.id) >
                    assignedPairCount(existingItems, pairs, rt.id),
                ) ? (
                <span className="text-xs text-muted-foreground">
                  Amber = already assigned here; muted = already covered by a broader assignment (redundant).
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Amber chips are already assigned to these pairs.
                </span>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allOn}
                  aria-label="Select all rate types"
                  ref={(el) => {
                    if (el) el.indeterminate = count > 0 && !allOn;
                  }}
                  onChange={toggleAll}
                />
                Select all
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>
        )}
      </StepCard>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Sticky summary bar — the live count + actions, visible at commit regardless of scroll. */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-strong bg-card px-4 py-3 shadow-md">
        <div>
          <p className="text-sm font-semibold">
            <span className="text-lg tabular-nums">{willCreate}</span> assignment
            {willCreate === 1 ? '' : 's'} will be created
          </p>
          {clientId && (
            <p className="text-xs text-muted-foreground">
              {clientLabel} · {pairs.length} pair{pairs.length === 1 ? '' : 's'}
              {skipCount > 0 && (
                <span className="tabular-nums"> · {skipCount} already assigned (skipped)</span>
              )}
            </p>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setSelected(new Set())}
            disabled={mut.isPending || count === 0}
          >
            Clear
          </Button>
          <Button variant="ghost" onClick={() => navigate(exitTo)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={!valid}
            loading={mut.isPending}
          >
            {pairs.length === 1 && count <= 1 ? 'Save' : willCreate > 0 ? `Create ${willCreate}` : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ponytail: StepCard + Field are adapted from RateCreatePage / CommissionRateCreatePage (3rd copy;
// this Field drops the unused `optional` prop). Extract to a shared components/ui module in a dedicated
// refactor — not on this feature diff, to keep the two prod-live create pages untouched here. The
// eventual shared component should be the SUPERSET (keep `optional`).
/** A numbered step card (CREATE_PAGE_STANDARD): blue circle badge + title (+ optional pill) + hint. */
function StepCard({
  n,
  title,
  badge,
  hint,
  children,
}: {
  n: number;
  title: string;
  badge?: string | undefined;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {n}
          </span>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {badge && (
            <span className="ml-auto rounded-full bg-primary-muted px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              {badge}
            </span>
          )}
        </div>
        <p className="ml-[34px] mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  /** short inline marker after the label (e.g. "blank = Universal"). */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {hint && <span className="ml-1 font-normal text-muted-foreground">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
