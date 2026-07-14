import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import type { Pair } from '../cpvGroup/pairs.js';

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

/**
 * How a save resolves given the ticked rate types and the slot's already-assigned set. Pure so the
 * single-vs-bulk decision + the count are unit-testable (the headline path has no render-test infra).
 *  - `willCreate` = ticked types that aren't already assigned (amber ones EXISTS-skip server-side).
 *  - `mode`: 'none' when nothing new would be created (submit is blocked); 'single' for exactly one
 *    ticked type (→ POST /, navigate back); 'bulk' for two or more (→ POST /bulk, result screen).
 * `ids` always includes amber types so the bulk result screen can report them as "Skipped".
 */
export type SubmitMode = 'none' | 'single' | 'bulk';
export function submitPlan(
  selected: number[],
  assigned: Set<number>,
): { mode: SubmitMode; ids: number[]; willCreate: number } {
  const ids = [...new Set(selected)];
  const willCreate = ids.filter((id) => !assigned.has(id)).length;
  const mode: SubmitMode = willCreate === 0 ? 'none' : ids.length === 1 ? 'single' : 'bulk';
  return { mode, ids, willCreate };
}

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
 * Merged single+multi create page (ADR-0093 / CREATE_PAGE_STANDARD, Fork B): set the
 * `(client, product?, unit?)` slot once, then tick MANY rate types → one assignment row per rate type.
 * One ticked type → a single POST + navigate back; two or more → the bulk endpoint + a row-result
 * screen. `masterdata.manage` only (the server enforces it too); a viewer is bounced to the list.
 */
export function RateTypeAssignmentCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { has } = useAuth();
  const [searchParams] = useSearchParams();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);

  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? '');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkRateTypeAssignmentResult | null>(null);

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  // ADR-0074: a concrete client + product ⇒ the CPV-mapped units (Universal CPV ⇒ all units); else all.
  const unitCpvScoped = !!clientId && !!productId;
  const units = useQuery({
    queryKey: unitCpvScoped ? ['cpv-available-units', clientId, productId] : ['verification-unit-options'],
    queryFn: () =>
      unitCpvScoped
        ? api<{ id: number; code: string; name: string }[]>(
            'GET',
            `/api/v2/cpv-units/available?clientId=${clientId}&productId=${productId}`,
          )
        : api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
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
  const noCpvMapping = unitCpvScoped && units.isSuccess && units.data.length === 0;

  const slotProductId = productId ? Number(productId) : null;
  const slotUnitId = unitId ? Number(unitId) : null;
  const assigned = useMemo(
    () => assignedRateTypeIds(existing.data ?? [], slotProductId, slotUnitId),
    [existing.data, slotProductId, slotUnitId],
  );
  // Rate types already RESOLVABLE here via a broader (Universal) parent — assigning them at this
  // specific slot is redundant (the resolver already unions the parent). `assigned` (exact slot) is a
  // subset of this; the difference is what we flag "covered by Universal". Empty at a fully-Universal
  // slot (no broader parent).
  const coveredByParent = useMemo(() => {
    const covered = coveredRateTypeIds(existing.data ?? [], slotProductId, slotUnitId);
    return new Set([...covered].filter((id) => !assigned.has(id)));
  }, [existing.data, slotProductId, slotUnitId, assigned]);

  const rtById = useMemo(
    () => new Map((rateTypes.data ?? []).map((rt) => [rt.id, rt.code])),
    [rateTypes.data],
  );
  const clientLabel = clients.data?.find((c) => String(c.id) === clientId)?.name ?? clientId;
  const productLabel = productId
    ? (products.data?.find((p) => String(p.id) === productId)?.name ?? productId)
    : 'Universal';
  const unitLabel = unitId ? (units.data?.find((u) => String(u.id) === unitId)?.name ?? unitId) : 'Universal';

  const count = selected.size;
  const skipCount = [...selected].filter((id) => assigned.has(id)).length;
  const plan = submitPlan([...selected], assigned);
  const willCreate = plan.willCreate;
  // Gate on willCreate (not count): an all-amber selection creates nothing, so a pure no-op save (a
  // single idempotent re-activate reported as "created", or a "Create 0" batch) is blocked. Inactive
  // combos aren't amber (existing is active=true-filtered), so legitimate re-activations still count.
  const valid = !!clientId && plan.mode !== 'none';

  // Any slot-field change redefines the (client, product?, unit?) slot the ticks fan across, and the
  // unit list is CPV-scoped by client+product — so clear downstream fields + the selection, else the
  // amber hints / willCreate recompute under a slot the user didn't intend (or Save posts a hidden
  // stale unit id no longer in the re-scoped dropdown).
  const changeClient = (v: string) => {
    setClientId(v);
    setProductId('');
    setUnitId('');
    setSelected(new Set());
  };
  const changeProduct = (v: string) => {
    setProductId(v);
    setUnitId('');
    setSelected(new Set());
  };
  const changeUnit = (v: string) => {
    setUnitId(v);
    setSelected(new Set());
  };

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
    mutationFn: async (): Promise<BulkRateTypeAssignmentResult | null> => {
      const slot = { clientId: Number(clientId), productId: slotProductId, verificationUnitId: slotUnitId };
      if (plan.mode === 'single') {
        await api('POST', BASE, { ...slot, rateTypeId: plan.ids[0] });
        return null; // single → navigate back (no result panel)
      }
      return api<BulkRateTypeAssignmentResult>('POST', `${BASE}/bulk`, { ...slot, rateTypeIds: plan.ids });
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
      const parts = [`${res.createdCount} created`];
      if (res.existsCount) parts.push(`${res.existsCount} skipped (already assigned)`);
      if (res.errorCount) parts.push(`${res.errorCount} errored`);
      // Red toast when the batch produced only errors (nothing created); otherwise green.
      const notify = res.createdCount === 0 && res.errorCount > 0 ? toast.error : toast.success;
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

  // ── Result screen (batch save) — one row per submitted rate type, styled like the list.
  if (result) {
    const rows = [...result.results].sort((a, b) =>
      (rtById.get(a.rateTypeId) ?? '').localeCompare(rtById.get(b.rateTypeId) ?? ''),
    );
    return (
      <div className="max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {result.createdCount > 0 ? 'Rate type assignments created' : 'No new assignments created'}
          </h1>
          <p
            className="text-sm text-muted-foreground"
            {...(result.errorCount > 0 ? { role: 'alert' as const } : {})}
          >
            {clientLabel} · {productLabel} · {unitLabel} —{' '}
            <strong className="tabular-nums text-foreground">{result.createdCount}</strong> created
            {result.existsCount > 0 && (
              <>
                {' · '}
                <strong className="tabular-nums text-foreground">{result.existsCount}</strong> skipped
                (already assigned)
              </>
            )}
            {result.errorCount > 0 && (
              <>
                {' · '}
                <strong className="tabular-nums text-destructive">{result.errorCount}</strong> errored
              </>
            )}
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full border-collapse whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Rate Type</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rateTypeId} className="border-b border-border last:border-b-0">
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
        {result.existsCount > 0 && (
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
          Set the Client × Product × Verification Unit slot once, then choose which rate types it may use —
          one assignment is created per rate type.
        </p>
      </div>

      <StepCard
        n={1}
        title="The slot"
        hint="These apply to every rate type ticked below. Product and unit can be Universal (matches any)."
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
          <Field label="Product" hint="blank = Universal">
            <select
              className="input"
              value={productId}
              disabled={products.isLoading}
              onChange={(e) => changeProduct(e.target.value)}
            >
              <option value="">Universal (all products)</option>
              {(products.data ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            {products.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load products.</span>
            )}
          </Field>
          <Field label="Verification Unit" hint="blank = Universal">
            <select
              className="input"
              value={unitId}
              disabled={units.isLoading}
              onChange={(e) => changeUnit(e.target.value)}
            >
              <option value="">Universal (all units)</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
            {units.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load units.</span>
            )}
            {noCpvMapping && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {NO_CPV_MAPPING} —{' '}
                <Link to={CPV_ADMIN_PATH} className="text-primary hover:underline">
                  map it in CPV
                </Link>
                .
              </span>
            )}
          </Field>
        </div>
      </StepCard>

      <StepCard
        n={2}
        title="Rate types"
        badge={count > 0 ? `${count} selected` : undefined}
        hint="Tick every rate type this slot may use. Amber = already assigned (skipped); muted = already covered by a broader assignment."
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
              ) : coveredByParent.size > 0 ? (
                <span className="text-xs text-muted-foreground">
                  Amber = already assigned here; muted = already covered by a broader assignment (redundant).
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Amber chips are already assigned to this slot.
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
                const isAssigned = assigned.has(rt.id);
                // Covered by a broader (Universal) parent → available here already; ticking it makes a
                // redundant row. Still tickable (a deliberate slot-specific pin is legitimate).
                const isCovered = !isAssigned && coveredByParent.has(rt.id);
                return (
                  <label
                    key={rt.id}
                    title={
                      isAssigned
                        ? 'Already assigned to this slot — an identical assignment will be skipped'
                        : isCovered
                          ? 'Already available here via a broader assignment (a Universal or partially-Universal parent) — adding it at this slot creates a redundant row'
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
                      <span className="text-[10px] font-semibold text-st-under-review">assigned</span>
                    ) : isCovered ? (
                      <span className="text-[10px] font-medium text-muted-foreground">covered</span>
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
              {clientLabel} · {productLabel} · {unitLabel}
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
            {count <= 1 ? 'Save' : willCreate > 0 ? `Create ${willCreate}` : 'Create'}
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
