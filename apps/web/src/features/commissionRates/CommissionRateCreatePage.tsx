import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_BULK_LOCATIONS,
  type Option,
  type UserOption,
  type VerificationUnitOption,
  type CommissionTerritoryLocation,
  type TatPolicyOption,
  type RateTypeOption,
  type CommissionRate,
  type CommissionRateView,
  type BulkCommissionRateResult,
  type Paginated,
} from '@crm2/sdk';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/sdk.js';
import { toIsoDate } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { Button } from '../../components/ui/Button.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { exitPath } from '../clientSetup/index.js';
import { commissionEligibleUsers } from './eligibleUsers.js';
import {
  friendlyError,
  groupRateTypeOptions,
  isOfficeRateType,
  OFFICE_LOCATIONLESS_HELP,
} from './CommissionRateRecordPage.js';

const BASE = '/api/v2/commission-rates';
const QK = 'commission-rates';
const LIST_PATH = '/admin/commission-rates';
const USERS_ADMIN_PATH = '/admin/users';

// UX: the create page's known 4xx codes in plain English (the shared friendlyError only maps the
// overlap code). Unknown codes still fall through to the raw code — never silently swallowed.
export const createFriendlyError = (code: string): string | null =>
  friendlyError(code) ??
  (code === 'VALIDATION'
    ? `Too many locations or an invalid field — a save is capped at ${MAX_BULK_LOCATIONS} locations.`
    : code === 'USER_HAS_NO_TERRITORY'
      ? 'This user has no assigned pincodes/areas — assign territory in User Management first.'
      : code === 'OFFICE_NOT_BULKABLE' || code === 'INVALID_RATE_TYPE'
        ? 'Pick a rate type from the list — office (location-less) types save as a single rate.'
        : null);

/** One existing-rate hint on an area chip: which rate type at what amount. */
export interface ExistingRateHint {
  fieldRateType: string | null;
  amount: number;
}
/** Fold the user's existing ACTIVE rates into locationId → hints (null key = location-less OFFICE
 *  rows), so the picker can show what's already priced before the admin saves a duplicate. */
export function existingByLocation(
  items: Pick<CommissionRateView, 'locationId' | 'fieldRateType' | 'amount'>[],
): Map<number | null, ExistingRateHint[]> {
  const map = new Map<number | null, ExistingRateHint[]>();
  for (const r of items) {
    const list = map.get(r.locationId) ?? [];
    list.push({ fieldRateType: r.fieldRateType, amount: r.amount });
    map.set(r.locationId, list);
  }
  return map;
}
/** Compact "LOCAL ₹50 · OGL ₹45" label for an area chip's existing rates. */
export const existingRateLabel = (entries: ExistingRateHint[]): string =>
  entries.map((e) => `${e.fieldRateType ?? '—'} ₹${e.amount}`).join(' · ');

interface PincodeGroup {
  pincode: string;
  city: string;
  areas: { id: number; area: string }[];
}
/** Fold the field user's flat territory (one Location per pincode/area) into pincode groups. */
export function groupTerritory(locs: CommissionTerritoryLocation[]): PincodeGroup[] {
  const byPc = new Map<string, PincodeGroup>();
  for (const l of locs) {
    let g = byPc.get(l.pincode);
    if (!g) {
      g = { pincode: l.pincode, city: l.city, areas: [] };
      byPc.set(l.pincode, g);
    }
    g.areas.push({ id: l.id, area: l.area });
  }
  return [...byPc.values()];
}

/**
 * THE commission-rate create page (owner 2026-07-10: ONE entry point — the old single-location
 * cascade and the separate bulk screen merged). Set the rate once — user / client / product / unit /
 * rate type / TAT band / amount / effective-from — then:
 *  - FIELD rate type: tick 1..N of the user's assigned pincode/area locations (the picker shows ONLY
 *    their territory) → POST /commission-rates/bulk creates one rate per location; active overlaps
 *    are skipped and reported, never overwritten.
 *  - OFFICE rate type: location-less (desk/KYC commission) → one plain POST.
 * Revise stays on the record page (/:id) — keys immutable, one row at a time. masterdata.manage only.
 */
export function CommissionRateCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const exitTo = exitPath(searchParams.get('returnTo'), LIST_PATH);

  const [userId, setUserId] = useState('');
  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? '');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [fieldRateType, setRateType] = useState('');
  const [tatBand, setTatBand] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkCommissionRateResult | null>(null);

  const users = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api<UserOption[]>('GET', '/api/v2/users/options'),
  });
  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  // ADR-0074: a specific client+product narrows units to the CPV-mapped set; else all active units.
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
  const tatPolicies = useQuery({
    queryKey: ['tat-policies', 'options'],
    queryFn: () => api<TatPolicyOption[]>('GET', '/api/v2/tat-policies/options'),
  });
  const rateTypes = useQuery({
    queryKey: ['rate-types', 'options'],
    queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
  });
  // The selected user's assigned (pincode, area) locations — the ONLY locations offered (owner
  // 2026-07-10: the picker is scoped to the user's territory, not the full locations catalog).
  const territory = useQuery({
    queryKey: ['commission-territory', userId],
    queryFn: () =>
      api<CommissionTerritoryLocation[]>(
        'GET',
        `${BASE}/lookups/territory?userId=${encodeURIComponent(userId)}`,
      ),
    enabled: !!userId,
  });

  // The user's existing ACTIVE rates — surfaced on the area chips so the admin sees which rate
  // type + amount a location already has BEFORE saving a duplicate (owner 2026-07-11). 500 = the
  // server page cap; a user beyond it still saves fine — the server skip-check is authoritative.
  const existing = useQuery({
    queryKey: ['commission-existing', userId],
    queryFn: () =>
      api<Paginated<CommissionRateView>>('GET', `${BASE}?userId=${userId}&active=true&limit=500`).then(
        (r) => r.items,
      ),
    enabled: !!userId,
  });

  const isOffice = isOfficeRateType(fieldRateType, rateTypes.data ?? []);
  const rateTypeGroups = groupRateTypeOptions(rateTypes.data ?? []);
  const selectedUserName = (users.data ?? []).find((u) => u.id === userId)?.name ?? '';
  const existingByLoc = useMemo(() => existingByLocation(existing.data ?? []), [existing.data]);
  const groups = useMemo(() => groupTerritory(territory.data ?? []), [territory.data]);
  const locLabel = useMemo(
    () => new Map((territory.data ?? []).map((l) => [l.id, `${l.pincode} ${l.area}`])),
    [territory.data],
  );

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
      const all = g.areas.every((a) => n.has(a.id));
      for (const a of g.areas) {
        if (all) n.delete(a.id);
        else n.add(a.id);
      }
      return n;
    });
  const changeUser = (id: string) => {
    setUserId(id);
    setSelected(new Set()); // territory changed → drop the old selection
  };
  // Changing client/product re-scopes the CPV unit list (ADR-0074) — clear the unit so a stale,
  // no-longer-offered unit can't be silently submitted (same Clear-fields pattern as changeUser).
  const changeClient = (id: string) => {
    setClientId(id);
    setUnitId('');
  };
  const changeProduct = (id: string) => {
    setProductId(id);
    setUnitId('');
  };

  const count = selected.size;
  const overCap = !isOffice && count > MAX_BULK_LOCATIONS;
  // ADR-0050: user + rate type + amount are required; FIELD needs ≥1 location (≤ the bulk cap),
  // OFFICE is location-less.
  const valid = !!userId && !!fieldRateType && amount !== '' && (isOffice || (count > 0 && !overCap));

  const shared = () => ({
    userId,
    clientId: clientId ? Number(clientId) : null,
    productId: productId ? Number(productId) : null,
    verificationUnitId: unitId ? Number(unitId) : null,
    fieldRateType,
    tatBand: tatBand === '' ? null : Number(tatBand),
    amount: Number(amount),
    effectiveFrom: toIsoDate(effectiveFrom),
  });
  // OFFICE → one plain create (location-less); FIELD → the bulk endpoint (one rate per ticked area).
  const mut = useMutation({
    mutationFn: async () => {
      if (isOffice) {
        await api<CommissionRate>('POST', BASE, { ...shared(), locationId: null });
        return null;
      }
      return api<BulkCommissionRateResult>('POST', `${BASE}/bulk`, {
        ...shared(),
        locationIds: [...selected],
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [QK] });
      qc.invalidateQueries({ queryKey: ['commission-existing'] }); // refresh the area-chip hints
      if (r) {
        // FIELD bulk: the result panel is the primary confirmation; the toast is the at-a-glance
        // recap (created / skipped) since the list sorts by user, not recency.
        setResult(r);
        toast.success(
          `${r.createdCount} rate${r.createdCount === 1 ? '' : 's'} created` +
            (r.existsCount > 0 ? ` · ${r.existsCount} skipped (already exist)` : '') +
            (r.errorCount > 0 ? ` · ${r.errorCount} errored` : ''),
        );
      } else {
        // OFFICE single create navigates straight back to the list — the toast is its only confirmation.
        toast.success('Commission rate created');
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

  // ── Result summary — one row per submitted location, styled like the Commission Rates list
  //    (owner 2026-07-11: show the created rates as rows, not a blank panel) ─────────────────────
  if (result) {
    const clientName = clientId
      ? ((clients.data ?? []).find((c) => String(c.id) === clientId)?.name ?? '…')
      : 'Universal';
    const productName = productId
      ? ((products.data ?? []).find((p) => String(p.id) === productId)?.name ?? '…')
      : 'Any';
    const unitName = unitId ? ((units.data ?? []).find((u) => String(u.id) === unitId)?.name ?? '…') : 'Any';
    const tatLabel = tatBand === '' ? 'Any' : tatBand === '-1' ? 'Out of band' : `${tatBand}h`;
    const rows = [...result.results].sort((a, b) =>
      (locLabel.get(a.locationId) ?? '').localeCompare(locLabel.get(b.locationId) ?? ''),
    );
    return (
      <div className="max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {result.createdCount > 0 ? 'Commission rates created' : 'No new rates created'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {selectedUserName} —{' '}
            <strong className="tabular-nums text-foreground">{result.createdCount}</strong> created
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
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Rate Type</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">TAT Band</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.locationId} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 tabular-nums">{locLabel.get(r.locationId) ?? r.locationId}</td>
                  <td className="px-3 py-2 text-xs uppercase">{fieldRateType}</td>
                  <td className="px-3 py-2">{clientName}</td>
                  <td className="px-3 py-2">{productName}</td>
                  <td className="px-3 py-2">{unitName}</td>
                  <td className="px-3 py-2">{tatLabel}</td>
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
                        {r.error === 'NOT_IN_TERRITORY'
                          ? 'Not in territory'
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
          <Button onClick={() => navigate(exitTo)}>View commission rates</Button>
        </div>
      </div>
    );
  }

  // ── Entry (layout mirrors the owner-approved mockup: numbered step cards, wide field grid,
  //    territory badge, sticky summary bar) ──────────────────────────────────────────────────────
  const pincodesSelected = groups.filter((g) => g.areas.some((a) => selected.has(a.id))).length;
  return (
    <div className="max-w-4xl space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to commission rates
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">New Commission Rate</h1>
        <p className="text-sm text-muted-foreground">
          Set the rate once, then apply it across the user’s assigned pincodes &amp; areas. One save creates
          one rate per location.
        </p>
      </div>

      {/* Step 1 — the shared fields, identical on every row created */}
      <StepCard
        n={1}
        title="Applies to every rate"
        hint="These values are identical on every row created below."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="User" required>
            <select className="input" value={userId} onChange={(e) => changeUser(e.target.value)}>
              <option value="">Select a user…</option>
              {commissionEligibleUsers(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Client" optional>
            <select className="input" value={clientId} onChange={(e) => changeClient(e.target.value)}>
              <option value="">Universal (all clients)</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product" optional>
            <select className="input" value={productId} onChange={(e) => changeProduct(e.target.value)}>
              <option value="">Universal (all products)</option>
              {(products.data ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Verification Unit" optional>
            <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Universal (all units)</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rate Type" required>
            <select
              className="input"
              value={fieldRateType}
              disabled={rateTypes.isLoading}
              onChange={(e) => {
                const code = e.target.value;
                setRateType(code);
                // Switching to OFFICE makes the location list irrelevant — clear it so a stale
                // selection can't silently survive a switch back to FIELD (UX-9 Clear-fields pattern).
                if (isOfficeRateType(code, rateTypes.data ?? [])) setSelected(new Set());
              }}
            >
              <option value="">{rateTypes.isLoading ? 'Loading rate types…' : 'Select a rate type…'}</option>
              <optgroup label="Field">
                {rateTypeGroups.FIELD.map((rt) => (
                  <option key={rt.id} value={rt.code}>
                    {rt.code}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Office">
                {rateTypeGroups.OFFICE.map((rt) => (
                  <option key={rt.id} value={rt.code}>
                    {rt.code}
                  </option>
                ))}
              </optgroup>
            </select>
            {rateTypes.isError && (
              <span className="mt-1 block text-xs text-destructive">Couldn’t load rate types.</span>
            )}
          </Field>
          <Field label="TAT Band" optional>
            <select className="input" value={tatBand} onChange={(e) => setTatBand(e.target.value)}>
              <option value="">Universal (all bands)</option>
              {(tatPolicies.data ?? []).map((tp) => (
                <option key={tp.id} value={String(tp.tatHours)}>
                  {tp.label}
                </option>
              ))}
              <option value="-1">Out of band</option>
            </select>
          </Field>
          <Field label="Amount (₹)" required>
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
                placeholder="50.00"
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
            <b className="font-semibold text-foreground">{OFFICE_LOCATIONLESS_HELP}</b> — picking one skips
            the location step and saves a single rate. Field rate types apply per location below.
          </span>
        </div>
      </StepCard>

      {/* Step 2 — the user's assigned territory (hidden for location-less OFFICE types) */}
      {!isOffice && (
        <StepCard
          n={2}
          title="Locations"
          badge={
            userId && territory.isSuccess
              ? `${groups.length} pincode${groups.length === 1 ? '' : 's'} assigned`
              : undefined
          }
          hint={
            userId ? (
              <>
                Only <b className="font-semibold text-foreground">{selectedUserName}</b>’s assigned pincodes
                &amp; areas are shown — tick the ones to rate. Each ticked area becomes one rate.
              </>
            ) : (
              'Select a user to see their assigned locations.'
            )
          }
        >
          {!userId ? null : territory.isLoading ? (
            <div className="py-4">
              <HexagonLoader operation="Loading territory" />
            </div>
          ) : territory.isError ? (
            // A failed lookup must NOT read as "no territory" — that sends the admin off to
            // re-assign territory that already exists.
            <p className="text-sm text-destructive" role="alert">
              Couldn’t load this user’s territory — check your connection and re-select the user to retry.
            </p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No territory assigned to this user — field (location-based) rates need one. Assign
              pincodes/areas in{' '}
              <Link to={USERS_ADMIN_PATH} className="text-primary hover:underline">
                User Management
              </Link>
              , or pick an OFFICE rate type for location-less commission.
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => {
                const on = g.areas.filter((a) => selected.has(a.id)).length;
                const allOn = on === g.areas.length && on > 0;
                return (
                  <div
                    key={g.pincode}
                    className="overflow-hidden rounded-md border border-border bg-surface-muted"
                  >
                    <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                      <span className="font-semibold tabular-nums">{g.pincode}</span>
                      <span className="text-xs text-muted-foreground">{g.city}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {on}/{g.areas.length} areas
                      </span>
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
                    </div>
                    <div className="flex flex-wrap gap-2 p-3">
                      {g.areas.map((a) => {
                        // What this user already earns here — visible BEFORE saving a duplicate.
                        const have = existingByLoc.get(a.id) ?? [];
                        const clash = !!fieldRateType && have.some((h) => h.fieldRateType === fieldRateType);
                        return (
                          <label
                            key={a.id}
                            title={
                              clash
                                ? `Already has a ${fieldRateType} rate here — saving will skip it (revise the existing rate to change the amount)`
                                : undefined
                            }
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted ${
                              clash
                                ? 'border-st-under-review bg-st-under-review-bg'
                                : 'border-border-strong bg-card'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={selected.has(a.id)}
                              onChange={() => toggleArea(a.id)}
                            />
                            {a.area}
                            {have.length > 0 && (
                              <span
                                className={`text-[10px] tabular-nums ${
                                  clash ? 'font-semibold text-st-under-review' : 'text-muted-foreground'
                                }`}
                              >
                                {existingRateLabel(have)}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </StepCard>
      )}

      {/* OFFICE: surface the user's existing location-less rates so a duplicate is visible before Save */}
      {isOffice &&
        !!userId &&
        (() => {
          const office = (existing.data ?? []).filter((r) => r.locationId === null);
          if (office.length === 0) return null;
          return (
            <div className="rounded-lg border border-st-under-review bg-st-under-review-bg px-4 py-3 text-xs text-st-under-review">
              <b className="font-semibold">{selectedUserName} already has office rates:</b>{' '}
              {office
                .map(
                  (r) =>
                    `${r.fieldRateType ?? '—'} ₹${r.amount} (${r.clientName ?? 'Universal'}${
                      r.productName ? ` · ${r.productName}` : ''
                    })`,
                )
                .join(' · ')}{' '}
              — an identical combination will be rejected; use Revise on the list to change an amount.
            </div>
          );
        })()}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Sticky summary bar — the live count + actions (mockup). Echoes WHO and HOW MUCH so the
          money-determining fields are visible at the moment of commit even when Step 1 is scrolled
          away (a wrong-amount bulk is N single revises to undo). */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-strong bg-card px-4 py-3 shadow-md">
        <div>
          <p className="text-sm font-semibold">
            <span className="text-lg tabular-nums">{isOffice ? 1 : count}</span> rate
            {!isOffice && count !== 1 ? 's' : ''} will be created
          </p>
          {userId && fieldRateType && (
            <p className="text-xs text-muted-foreground">
              {selectedUserName} · {fieldRateType} ·{' '}
              <span className="tabular-nums">₹{amount === '' ? '—' : amount}</span> ·{' '}
              {clientId
                ? ((clients.data ?? []).find((c) => String(c.id) === clientId)?.name ?? '…')
                : 'Universal (all clients)'}
            </p>
          )}
        </div>
        {!isOffice &&
          (overCap ? (
            <p className="text-xs font-medium text-destructive" role="alert">
              A save is capped at {MAX_BULK_LOCATIONS} locations — deselect{' '}
              <span className="tabular-nums">{count - MAX_BULK_LOCATIONS}</span> or save in batches.
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

/** A numbered step card (mockup): blue circle badge + title (+ optional right-side pill) + hint. */
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
