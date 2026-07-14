import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_BULK_RATE_LOCATIONS,
  type Option,
  type VerificationUnitOption,
  type RateTypeOption,
  type Rate,
  type RateView,
  type BulkRateResult,
  type Location,
  type Paginated,
} from '@crm2/sdk';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/sdk.js';
import { toIsoDate } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { SearchableSelect, type Opt } from '../../components/ui/SearchableSelect.js';
import { exitPath } from '../clientSetup/index.js';
import { type Pair, pairKey } from '../cpvGroup/pairs.js';
import { friendlyError } from './RateRecordPage.js';

const BASE = '/api/v2/rates';
const QK = 'rates';
const LIST_PATH = '/admin/rates';

// ADR-0071: product / verification unit can be Universal (a rate for ALL products / ALL units of a
// client) — but the choice is EXPLICIT (a money table never defaults to Universal). The select
// carries this sentinel; the payload sends null (= Universal) for it.
export const UNIVERSAL = 'UNIVERSAL';
export const toDim = (v: string): number | null => (v === UNIVERSAL ? null : Number(v));

// Owner fix 2026-07-08 (moved here with the create branch): the rate-type picker is assignment-gated
// even when product/unit is Universal — a Universal dim just OMITS its query param (the API repo
// drops that dim's predicate entirely) rather than falling back to the full, ungated catalog.
export const availableRateTypesPath = (clientId: string, productId: string, unitId: string): string => {
  const params = new URLSearchParams({ clientId });
  if (productId !== UNIVERSAL) params.set('productId', productId);
  if (unitId !== UNIVERSAL) params.set('verificationUnitId', unitId);
  return `/api/v2/rate-types/available?${params.toString()}`;
};

// UX-3 (moved with the create branch): the Rate Type picker's two gated states — distinct copy per
// state, and the empty-assignments one links straight to the form that fixes it.
export const PICK_COMBO_FIRST = 'Pick client, product & unit first';
export const NO_RATE_TYPES_FOR_COMBO = 'No rate types assigned for this combination';
export const ASSIGN_RATE_TYPES_PATH = '/admin/rate-type-assignments/new';

// UX-7 (moved with the create branch): a complete 6-digit pincode whose areas query comes back empty
// is a dead end — name it and link the fix. Gate on isSuccess so there's no flash while in flight.
export const PINCODE_NOT_FOUND = 'Pincode not found — add it in Location Management first';
export const LOCATIONS_ADMIN_PATH = '/admin/locations';
export const isPincodeNotFound = (s: { pincode: string; isSuccess: boolean; count: number }): boolean =>
  /^\d{6}$/.test(s.pincode) && s.isSuccess && s.count === 0;

// UX-9 (adapted from the old single form): switching Field/Office silently resets rate type +
// locations, so the toggle disables itself once any of them is set — with an inline Clear action as
// the recovery path (keyboard-safe, no modal).
export const modeHasDownstream = (s: {
  clientRateType: string;
  pincodeCount: number;
  selectedCount: number;
}): boolean => !!s.clientRateType || s.pincodeCount > 0 || s.selectedCount > 0;
export const MODE_LOCKED_HELPER = 'Clear rate-type/location fields to switch mode';
export const CLEAR_FIELDS_LABEL = 'Clear fields';

// UX: the create page's known 4xx codes in plain English (the shared friendlyError only maps the
// overlap code). Unknown codes still fall through to the raw code — never silently swallowed.
export const createFriendlyError = (code: string): string | null =>
  friendlyError(code) ??
  (code === 'VALIDATION'
    ? `Too many locations or an invalid field — a save is capped at ${MAX_BULK_RATE_LOCATIONS} locations.`
    : code === 'OFFICE_NOT_BULKABLE' || code === 'INVALID_RATE_TYPE'
      ? 'Pick a rate type from the list — office (location-less) rates save as a single rate.'
      : code === 'HAS_OTHER_RATE_TYPE'
        ? 'This location already has a different rate type for this client/product/unit — one location holds one rate type. Revise or deactivate the existing rate first.'
        : null);

/** One existing-rate hint on an area chip: which rate type at what amount. */
export interface ExistingRateHint {
  clientRateType: string | null;
  amount: number;
}
/** The existing ACTIVE rates that live at THIS slot — same client + product + unit (null-aware:
 *  Universal only matches Universal, mirroring the DB key's COALESCE sentinels). The one-type rule
 *  and the EXISTS skip are both slot-scoped, so rates at other products/units are irrelevant here. */
export function slotRates(
  items: Pick<RateView, 'productId' | 'verificationUnitId' | 'locationId' | 'clientRateType' | 'amount'>[],
  productId: number | null,
  unitId: number | null,
): Pick<RateView, 'productId' | 'verificationUnitId' | 'locationId' | 'clientRateType' | 'amount'>[] {
  return items.filter((r) => r.productId === productId && r.verificationUnitId === unitId);
}
/** Fold the slot's existing ACTIVE rates into locationId → hints (null key = location-less OFFICE
 *  rows), so the picker can show what's already priced before the admin saves a duplicate. */
export function existingByLocation(
  items: Pick<RateView, 'locationId' | 'clientRateType' | 'amount'>[],
): Map<number | null, ExistingRateHint[]> {
  const map = new Map<number | null, ExistingRateHint[]>();
  for (const r of items) {
    const list = map.get(r.locationId) ?? [];
    list.push({ clientRateType: r.clientRateType, amount: r.amount });
    map.set(r.locationId, list);
  }
  return map;
}
/** Compact "LOCAL ₹500 · OGL ₹650" label for an area chip's existing rates. */
export const existingRateLabel = (entries: ExistingRateHint[]): string =>
  entries.map((e) => `${e.clientRateType ?? '—'} ₹${e.amount}`).join(' · ');

/** Owner rule (2026-07-11): one (client, product, unit, location) slot holds ONE rate type.
 *  Locations whose existing slot rates carry a DIFFERENT type than the chosen one can't be ticked
 *  (the server rejects them per-row). */
export function blockedLocations(
  existing: Map<number | null, ExistingRateHint[]>,
  chosenType: string,
): Set<number> {
  const out = new Set<number>();
  if (!chosenType) return out;
  for (const [locationId, hints] of existing) {
    if (locationId !== null && hints.some((h) => h.clientRateType && h.clientRateType !== chosenType))
      out.add(locationId);
  }
  return out;
}

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
  /**
   * SUBSET of `exists` whose existing amount differs from the one being entered. `amount` is NOT in
   * the `rates_no_overlap` key (mig 0098:44-51), so these skip like any other duplicate — meaning
   * the admin's new price is silently discarded and the old one stands. Same outcome as a benign
   * re-save, opposite intent: this one is someone repricing and being ignored.
   */
  repriced: PairHit[];
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
  /** the amount being entered; null while the field is empty (nothing to compare, nothing claimed). */
  enteredAmount: number | null,
): Map<number, LocationGroupState> {
  const byPair = new Map(pairs.map((p) => [pairKey(p), p]));
  const out = new Map<number, LocationGroupState>();
  for (const r of items) {
    if (r.locationId === null) continue;
    const pair = byPair.get(pairKey({ productId: r.productId, unitId: r.verificationUnitId }));
    if (!pair) continue; // a rate at a slot outside this group is irrelevant
    const st = out.get(r.locationId) ?? {
      totalPairs: pairs.length,
      blocked: [],
      exists: [],
      repriced: [],
    };
    const bucket =
      chosenType && r.clientRateType && r.clientRateType !== chosenType
        ? st.blocked
        : chosenType && r.clientRateType === chosenType
          ? st.exists
          : null; // typeless rows never block; nothing decides before a type is chosen
    if (bucket) {
      const hint = { clientRateType: r.clientRateType, amount: r.amount };
      const hit = bucket.find((h) => h.pair === pair);
      if (hit) hit.hints.push(hint);
      else bucket.push({ pair, hints: [hint] });
      // An EXISTS whose amount differs = a discarded price change (see the type's doc comment).
      // Grandfathered legacy rows can put >1 rate at a slot, so ANY differing amount counts.
      if (bucket === st.exists && enteredAmount !== null && r.amount !== enteredAmount) {
        const already = st.repriced.find((h) => h.pair === pair);
        if (already) already.hints.push(hint);
        else st.repriced.push({ pair, hints: [hint] });
      }
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

/**
 * The honest pre-save counts across pairs × selected locations — CREATE_PAGE_STANDARD's commit
 * surface. `created` is what the save will ACTUALLY write: today's page shows `selected.size`, which
 * counts every will-skip area as a creation, so ticking 5 already-priced areas reads "Create 5
 * rates" and creates zero. `repriced` is a subset of `skipped`, never of `created`.
 */
export const groupOutcome = (
  states: Map<number, LocationGroupState>,
  selectedLocationIds: number[],
  totalPairs: number,
): { created: number; skipped: number; blocked: number; repriced: number } => {
  let created = 0;
  let skipped = 0;
  let blocked = 0;
  let repriced = 0;
  for (const id of selectedLocationIds) {
    const st = states.get(id);
    const b = st?.blocked.length ?? 0;
    const e = st?.exists.length ?? 0;
    created += totalPairs - b - e;
    skipped += e;
    blocked += b;
    repriced += st?.repriced.length ?? 0;
  }
  return { created, skipped, blocked, repriced };
};

/**
 * THE rate create page (owner 2026-07-11: same one-entry upgrade as commission rates). Set the rate
 * once — client / product / unit / rate type / amount / effective-from — then:
 *  - FIELD: search pincodes and tick 1..N of their areas (the full location catalog, pincode-scoped —
 *    a client rate has no user, so there is no territory to scope by) → POST /rates/bulk creates one
 *    rate per location; active overlaps are skipped and reported, never overwritten.
 *  - OFFICE: flat (no geography, no rate type) → one plain POST.
 * Revise stays on the record page (/:id) — keys immutable, one row at a time. masterdata.manage only.
 */
export function RateCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);

  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? '');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [mode, setMode] = useState('FIELD');
  const [clientRateType, setRateType] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [pincodeSearch, setPincodeSearch] = useState('');
  const [addedPincodes, setAddedPincodes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkRateResult | null>(null);

  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  // ADR-0074: with a specific client + product chosen, the unit options are the CPV-mapped units (a
  // Universal CPV ⇒ all units); else (no product, or Universal product) all active units.
  const unitCpvScoped = !!clientId && !!productId && productId !== UNIVERSAL;
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
  // Rate types are assignment-gated by the (client × product × unit) combo (ADR-0067 Phase B) —
  // enabled only once all three dims are chosen; office rates carry no rate type at all.
  const isOffice = mode === 'OFFICE';
  const comboReady = !isOffice && !!clientId && !!productId && !!unitId;
  const rateTypes = useQuery({
    queryKey: ['rate-types-available', clientId, productId, unitId],
    queryFn: () => api<RateTypeOption[]>('GET', availableRateTypesPath(clientId, productId, unitId)),
    enabled: comboReady,
  });
  const noRateTypesForCombo = comboReady && rateTypes.isSuccess && rateTypes.data.length === 0;
  const pincodes = useQuery({
    queryKey: ['pincodes', pincodeSearch],
    queryFn: () => api<string[]>('GET', `/api/v2/locations/pincodes?q=${encodeURIComponent(pincodeSearch)}`),
    enabled: !isOffice && pincodeSearch.length >= 2,
  });
  // One areas query per ADDED pincode (cached per pincode) — the picker accumulates pincode groups,
  // unlike commission's preloaded territory: a client rate has no user, so the source is the catalog.
  // limit = the bulk cap (500); we keep the Paginated envelope so a pincode with MORE areas than we
  // fetched is surfaced (the group's "showing N of M" note) rather than silently asserting the ticked
  // set is the whole pincode — a real hazard now that "Select all" implies completeness.
  const areaQueries = useQueries({
    queries: addedPincodes.map((pc) => ({
      queryKey: ['areas', pc],
      queryFn: () =>
        api<Paginated<Location>>('GET', `/api/v2/locations?pincode=${pc}&limit=${MAX_BULK_RATE_LOCATIONS}`),
    })),
  });

  // The slot's existing ACTIVE rates — surfaced on the area chips so the admin sees which rate type
  // + amount a location already has BEFORE saving a duplicate. 500 = the server page cap; a client
  // beyond it still saves fine — the server skip-check is authoritative.
  const slotReady = !!clientId && !!productId && !!unitId;
  const existing = useQuery({
    queryKey: ['rate-existing', clientId],
    queryFn: () =>
      api<Paginated<RateView>>('GET', `${BASE}?clientId=${clientId}&active=true&limit=500`).then(
        (r) => r.items,
      ),
    enabled: slotReady,
  });

  const existingByLoc = useMemo(
    () =>
      existingByLocation(slotReady ? slotRates(existing.data ?? [], toDim(productId), toDim(unitId)) : []),
    [existing.data, slotReady, productId, unitId],
  );
  // One slot = one rate type (owner 2026-07-11): areas holding a DIFFERENT type are untickable.
  const blocked = useMemo(
    () => blockedLocations(existingByLoc, clientRateType),
    [existingByLoc, clientRateType],
  );

  interface PincodeGroup {
    pincode: string;
    areas: Location[];
    /** total areas the catalog has for this pincode; > areas.length ⇒ the fetch was truncated. */
    totalAreas: number;
    isLoading: boolean;
    isSuccess: boolean;
    isError: boolean;
  }
  const groups: PincodeGroup[] = addedPincodes.map((pc, i) => ({
    pincode: pc,
    areas: areaQueries[i]?.data?.items ?? [],
    totalAreas: areaQueries[i]?.data?.totalCount ?? 0,
    isLoading: areaQueries[i]?.isLoading ?? true,
    isSuccess: areaQueries[i]?.isSuccess ?? false,
    isError: areaQueries[i]?.isError ?? false,
  }));
  const locLabel = useMemo(
    () =>
      new Map(
        areaQueries.flatMap((q) =>
          (q.data?.items ?? []).map((l) => [l.id, `${l.pincode} ${l.area}`] as const),
        ),
      ),
    [areaQueries],
  );

  const addPincode = (pc: string) => {
    if (pc && !addedPincodes.includes(pc)) setAddedPincodes((a) => [...a, pc]);
    setPincodeSearch('');
  };
  const removePincode = (g: PincodeGroup) => {
    setAddedPincodes((a) => a.filter((pc) => pc !== g.pincode));
    setSelected((s) => {
      const n = new Set(s);
      for (const a of g.areas) n.delete(a.id);
      return n;
    });
  };
  const toggleArea = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleGroup = (g: PincodeGroup) =>
    setSelected((s) => {
      const n = new Set(s);
      // Select-all only ever toggles the tickable areas — blocked ones (different rate type) stay out.
      const selectable = g.areas.filter((a) => !blocked.has(a.id));
      const all = selectable.length > 0 && selectable.every((a) => n.has(a.id));
      for (const a of selectable) {
        if (all) n.delete(a.id);
        else n.add(a.id);
      }
      return n;
    });
  // Changing any slot dimension re-scopes the CPV unit list (ADR-0074), the assignment-gated rate
  // types (ADR-0067) AND the existing-rate hints/blocked chips — clear everything downstream so a
  // stale value or a now-blocked area can't ride along (UX-9 Clear-fields pattern).
  const changeClient = (id: string) => {
    setClientId(id);
    setUnitId('');
    setRateType('');
    setSelected(new Set());
  };
  const changeProduct = (id: string) => {
    setProductId(id);
    setUnitId('');
    setRateType('');
    setSelected(new Set());
  };
  const changeUnit = (id: string) => {
    setUnitId(id);
    setRateType('');
    setSelected(new Set());
  };
  const modeLocked = modeHasDownstream({
    clientRateType,
    pincodeCount: addedPincodes.length,
    selectedCount: selected.size,
  });
  const clearModeDownstream = () => {
    setRateType('');
    setAddedPincodes([]);
    setSelected(new Set());
    setPincodeSearch('');
  };

  const count = selected.size;
  const overCap = !isOffice && count > MAX_BULK_RATE_LOCATIONS;
  // Client/product/unit/amount are required (product & unit may be the explicit Universal choice);
  // FIELD also needs a rate type + ≥1 location (≤ the bulk cap); OFFICE is flat.
  const valid =
    !!clientId &&
    !!productId &&
    !!unitId &&
    amount !== '' &&
    (isOffice || (!!clientRateType && count > 0 && !overCap));

  const shared = () => ({
    clientId: Number(clientId),
    productId: toDim(productId), // null = Universal (ADR-0071)
    verificationUnitId: toDim(unitId), // null = Universal
    amount: Number(amount),
    effectiveFrom: toIsoDate(effectiveFrom),
  });
  // OFFICE → one plain create (flat: no geography, no rate type); FIELD → the bulk endpoint.
  const mut = useMutation({
    mutationFn: async () => {
      if (isOffice) {
        await api<Rate>('POST', BASE, { ...shared(), locationId: null, clientRateType: null });
        return null;
      }
      return api<BulkRateResult>('POST', `${BASE}/bulk`, {
        ...shared(),
        clientRateType,
        locationIds: [...selected],
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [QK] });
      qc.invalidateQueries({ queryKey: ['rate-existing'] }); // refresh the area-chip hints
      if (r) {
        // FIELD bulk: the result panel is the primary confirmation; the toast is the recap.
        setResult(r);
        toast.success(
          `${r.createdCount} rate${r.createdCount === 1 ? '' : 's'} created` +
            (r.existsCount > 0 ? ` · ${r.existsCount} skipped (already exist)` : '') +
            (r.errorCount > 0 ? ` · ${r.errorCount} errored` : ''),
        );
      } else {
        // OFFICE single create navigates straight back to the list — the toast is its confirmation.
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
      setError(msg); // stays on the page while the admin fixes it (persistent, role=alert)
      toast.error(msg); // + a top-right toast so a failure is impossible to miss
    },
  });

  if (!has('masterdata.manage')) return <Navigate to={LIST_PATH} replace />;

  const clientOpts: Opt[] = (clients.data ?? []).map((c) => ({
    value: String(c.id),
    label: `${c.code} — ${c.name}`,
  }));
  const productOpts: Opt[] = [
    { value: UNIVERSAL, label: 'Universal (all products)' },
    ...(products.data ?? []).map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` })),
  ];
  const unitOpts: Opt[] = [
    { value: UNIVERSAL, label: 'Universal (all units)' },
    ...(units.data ?? []).map((u) => ({ value: String(u.id), label: u.name })),
  ];
  const rateTypeOpts: Opt[] = (rateTypes.data ?? []).map((rt) => ({ value: rt.code, label: rt.code }));
  const pincodeOpts: Opt[] = (pincodes.data ?? []).map((p) => ({ value: p, label: p }));

  const clientLabel = clientId
    ? ((clients.data ?? []).find((c) => String(c.id) === clientId)?.name ?? '…')
    : '—';
  const productLabel =
    productId === UNIVERSAL
      ? 'Universal'
      : productId
        ? ((products.data ?? []).find((p) => String(p.id) === productId)?.name ?? '…')
        : '—';
  const unitLabel =
    unitId === UNIVERSAL
      ? 'Universal'
      : unitId
        ? ((units.data ?? []).find((u) => String(u.id) === unitId)?.name ?? '…')
        : '—';

  // ── Result summary — one row per submitted location, styled like the Rate Management list
  //    (owner 2026-07-11: show the created rates as rows, not a blank panel) ─────────────────────
  if (result) {
    const rows = [...result.results].sort((a, b) =>
      (locLabel.get(a.locationId) ?? '').localeCompare(locLabel.get(b.locationId) ?? ''),
    );
    return (
      <div className="max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {result.createdCount > 0 ? 'Rates created' : 'No new rates created'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {clientLabel} — <strong className="tabular-nums text-foreground">{result.createdCount}</strong>{' '}
            created
            {result.existsCount > 0 && (
              <>
                {' · '}
                <strong className="tabular-nums text-foreground">{result.existsCount}</strong> skipped
                (already exist)
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
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Verification Unit</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Rate Type</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.locationId} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">{clientLabel}</td>
                  <td className="px-3 py-2">{productLabel}</td>
                  <td className="px-3 py-2">{unitLabel}</td>
                  <td className="px-3 py-2 tabular-nums">{locLabel.get(r.locationId) ?? r.locationId}</td>
                  <td className="px-3 py-2 text-xs uppercase">{clientRateType}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.status === 'CREATED' ? `₹${amount}` : '—'}
                  </td>
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
            </tbody>
          </table>
        </div>
        {result.existsCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Skipped rows already had an active rate for this combination — they kept their existing amount and
            weren’t touched. Change one with Revise on the list.
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
            Add more rates
          </Button>
          <Button onClick={() => navigate(exitTo)}>View rates</Button>
        </div>
      </div>
    );
  }

  // ── Entry (CREATE_PAGE_STANDARD: numbered step cards, wide field grid, sticky summary bar) ──────
  const pincodesSelected = groups.filter((g) => g.areas.some((a) => selected.has(a.id))).length;
  return (
    <div className="max-w-4xl space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to rate management
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">New Rate</h1>
        <p className="text-sm text-muted-foreground">
          Set the rate once, then apply it across pincodes &amp; areas. One save creates one rate per
          location.
        </p>
      </div>

      {/* Step 1 — the shared fields, identical on every row created */}
      <StepCard
        n={1}
        title="Applies to every rate"
        hint="These values are identical on every row created below."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Client" required>
            <SearchableSelect value={clientId} onChange={changeClient} options={clientOpts} width="w-full" />
            {clients.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load clients.</span>
            )}
          </Field>
          <Field label="Product" required hint="Universal = all products">
            <SearchableSelect
              value={productId}
              onChange={changeProduct}
              options={productOpts}
              width="w-full"
            />
            {products.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load products.</span>
            )}
          </Field>
          <Field label="Verification Unit" required hint="Universal = all units">
            <SearchableSelect value={unitId} onChange={changeUnit} options={unitOpts} width="w-full" />
            {units.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load units.</span>
            )}
          </Field>
          <Field label="Field / Office" required>
            {/* a fixed 2-option choice → a native select (freely switchable), not a search-first dropdown */}
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={modeLocked}
            >
              <option value="FIELD">Field</option>
              <option value="OFFICE">Office</option>
            </select>
            {modeLocked && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {MODE_LOCKED_HELPER} —{' '}
                <button type="button" className="text-primary hover:underline" onClick={clearModeDownstream}>
                  {CLEAR_FIELDS_LABEL}
                </button>
              </span>
            )}
          </Field>
          {!isOffice && (
            <Field label="Rate Type" required>
              <SearchableSelect
                value={clientRateType}
                onChange={(v) => {
                  setRateType(v);
                  // The type decides which areas are tickable (one slot = one rate type) — clear the
                  // selection on EVERY type change so a now-blocked area can't ride along (UX-9).
                  setSelected(new Set());
                }}
                options={rateTypeOpts}
                disabled={!comboReady || rateTypes.isLoading}
                placeholder={
                  !comboReady ? PICK_COMBO_FIRST : rateTypes.isLoading ? 'Loading rate types…' : 'Search…'
                }
                width="w-full"
              />
              {noRateTypesForCombo && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {NO_RATE_TYPES_FOR_COMBO} —{' '}
                  <Link to={ASSIGN_RATE_TYPES_PATH} className="text-primary hover:underline">
                    assign one
                  </Link>
                  .
                </span>
              )}
              {rateTypes.isError && (
                <span className="mt-1 block text-xs text-destructive">Couldn’t load rate types.</span>
              )}
            </Field>
          )}
          <Field label="Rate (₹)" required>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₹
              </span>
              <input
                className="input pl-6 tabular-nums"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500.00"
              />
            </div>
          </Field>
          <Field label="Effective From" hint="blank = now">
            <input
              type="date"
              className="input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span aria-hidden>ℹ️</span>
          <span>
            <b className="font-semibold text-foreground">Office rates are flat</b> — no geography, no rate
            type — and save as a single rate. Field rates apply per location below.
          </span>
        </div>
      </StepCard>

      {/* Step 2 — pincode search + accumulated area groups (hidden for flat OFFICE rates) */}
      {!isOffice && (
        <StepCard
          n={2}
          title="Locations"
          badge={
            addedPincodes.length > 0
              ? `${addedPincodes.length} pincode${addedPincodes.length === 1 ? '' : 's'} added`
              : undefined
          }
          hint="Search a pincode, then tick its areas — each ticked area becomes one rate. Add as many pincodes as needed."
        >
          <div className="max-w-xs">
            <Field label="Add pincode">
              <SearchableSelect
                value=""
                onChange={addPincode}
                options={pincodeOpts}
                onQueryChange={setPincodeSearch}
                placeholder="Type ≥2 digits…"
                width="w-full"
              />
            </Field>
          </div>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pincodes added yet — search one above to list its areas.
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => {
                const on = g.areas.filter((a) => selected.has(a.id)).length;
                const selectable = g.areas.filter((a) => !blocked.has(a.id));
                const allOn = selectable.length > 0 && on === selectable.length;
                const notFound = isPincodeNotFound({
                  pincode: g.pincode,
                  isSuccess: g.isSuccess,
                  count: g.areas.length,
                });
                return (
                  <div
                    key={g.pincode}
                    className="overflow-hidden rounded-md border border-border bg-surface-muted"
                  >
                    <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                      <span className="font-semibold tabular-nums">{g.pincode}</span>
                      <span className="text-xs text-muted-foreground">{g.areas[0]?.city ?? ''}</span>
                      {g.totalAreas > g.areas.length && (
                        // The catalog has more areas than we fetched — say so rather than let "Select
                        // all" imply the ticked set is the whole pincode (it would silently miss the rest).
                        <span
                          className="text-[10px] font-medium text-st-under-review"
                          title="Add the remaining areas in Location Management, or search a narrower pincode"
                        >
                          showing {g.areas.length} of {g.totalAreas}
                        </span>
                      )}
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {on}/{g.areas.length} areas
                      </span>
                      {/* Select-all only when the group actually has areas — an empty group (loading /
                          error / not-found) would otherwise render a dead, no-op checkbox. */}
                      {g.areas.length > 0 && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={allOn}
                            aria-label={`Select all areas in ${g.pincode}`}
                            // Partially-ticked group reads as mixed, not untouched (DataGrid pattern).
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && !allOn;
                            }}
                            onChange={() => toggleGroup(g)}
                          />
                          Select all
                        </label>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove pincode ${g.pincode}`}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => removePincode(g)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 p-3">
                      {g.isLoading ? (
                        <HexagonLoader operation="Loading areas" />
                      ) : g.isError ? (
                        <p className="text-sm text-destructive" role="alert">
                          Couldn’t load areas for {g.pincode} — remove and re-add the pincode to retry.
                        </p>
                      ) : notFound ? (
                        <p className="text-sm text-muted-foreground">
                          {PINCODE_NOT_FOUND} —{' '}
                          <Link to={LOCATIONS_ADMIN_PATH} className="text-primary hover:underline">
                            open Location Management
                          </Link>
                          .
                        </p>
                      ) : (
                        g.areas.map((a) => {
                          // What this slot already bills here — visible BEFORE saving a duplicate.
                          const have = existingByLoc.get(a.id) ?? [];
                          const clash =
                            !!clientRateType && have.some((h) => h.clientRateType === clientRateType);
                          // One slot = one rate type: a different existing type makes the area untickable.
                          const isBlocked = blocked.has(a.id);
                          return (
                            <label
                              key={a.id}
                              title={
                                isBlocked
                                  ? `Has a different rate type here (${existingRateLabel(have)}) — one location holds one rate type; revise or deactivate the existing rate first`
                                  : clash
                                    ? `Already has a ${clientRateType} rate here — an identical combination will be skipped (revise the existing rate to change its amount)`
                                    : undefined
                              }
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted ${
                                isBlocked
                                  ? 'cursor-not-allowed border-st-rejected bg-st-rejected-bg opacity-80'
                                  : clash
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
                              {have.length > 0 && (
                                <span
                                  className={`text-[10px] tabular-nums ${
                                    isBlocked
                                      ? 'font-semibold text-st-rejected'
                                      : clash
                                        ? 'font-semibold text-st-under-review'
                                        : 'text-muted-foreground'
                                  }`}
                                >
                                  {existingRateLabel(have)}
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </StepCard>
      )}

      {/* OFFICE: surface the slot's existing flat rates so a duplicate is visible before Save */}
      {isOffice &&
        slotReady &&
        (() => {
          const office = existingByLoc.get(null) ?? [];
          if (office.length === 0) return null;
          return (
            <div className="rounded-lg border border-st-under-review bg-st-under-review-bg px-4 py-3 text-xs text-st-under-review">
              <b className="font-semibold">
                {clientLabel} · {productLabel} · {unitLabel} already has office rates:
              </b>{' '}
              {office.map((r) => `₹${r.amount}`).join(' · ')} — an identical combination will be rejected; use
              Revise on the list to change an amount.
            </div>
          );
        })()}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Sticky summary bar — the live count + actions. Echoes WHO is billed and HOW MUCH so the
          money-determining fields are visible at the moment of commit even when Step 1 is scrolled
          away (a wrong-amount bulk is N single revises to undo). */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-strong bg-card px-4 py-3 shadow-md">
        <div>
          <p className="text-sm font-semibold">
            <span className="text-lg tabular-nums">{isOffice ? 1 : count}</span> rate
            {!isOffice && count !== 1 ? 's' : ''} will be created
          </p>
          {clientId && (
            <p className="text-xs text-muted-foreground">
              {clientLabel} · {productLabel}
              {!isOffice && clientRateType ? ` · ${clientRateType}` : ''} ·{' '}
              <span className="tabular-nums">₹{amount === '' ? '—' : amount}</span>
            </p>
          )}
        </div>
        {!isOffice &&
          (overCap ? (
            <p className="text-xs font-medium text-destructive" role="alert">
              A save is capped at {MAX_BULK_RATE_LOCATIONS} locations — deselect{' '}
              <span className="tabular-nums">{count - MAX_BULK_RATE_LOCATIONS}</span> or save in batches.
            </p>
          ) : (
            <p className="text-xs tabular-nums text-muted-foreground">
              {pincodesSelected} pincode{pincodesSelected === 1 ? '' : 's'} · {count} area
              {count === 1 ? '' : 's'} selected
            </p>
          ))}
        <div className="ml-auto flex gap-2">
          {!isOffice && (
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={mut.isPending || count === 0}
            >
              Clear
            </Button>
          )}
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
            {isOffice ? 'Save' : count > 0 ? `Create ${count} rate${count === 1 ? '' : 's'}` : 'Create rates'}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  optional,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  /** short inline marker after the label (e.g. "blank = now"); `optional` renders "· optional". */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {(optional || hint) && (
          <span className="ml-1 font-normal text-muted-foreground">· {optional ? 'optional' : hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}
