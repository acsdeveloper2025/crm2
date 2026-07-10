import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Option,
  UserOption,
  VerificationUnitOption,
  Location,
  TatPolicyOption,
  RateTypeOption,
  CommissionRate,
  BulkCommissionRateResult,
} from '@crm2/sdk';
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

interface PincodeGroup {
  pincode: string;
  city: string;
  areas: { id: number; area: string }[];
}
/** Fold the field user's flat territory (one Location per pincode/area) into pincode groups. */
export function groupTerritory(locs: Location[]): PincodeGroup[] {
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
    queryFn: () => api<Location[]>('GET', `${BASE}/lookups/territory?userId=${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const isOffice = isOfficeRateType(fieldRateType, rateTypes.data ?? []);
  const rateTypeGroups = groupRateTypeOptions(rateTypes.data ?? []);
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

  const count = selected.size;
  // ADR-0050: user + rate type + amount are required; FIELD needs ≥1 location, OFFICE is location-less.
  const valid = !!userId && !!fieldRateType && amount !== '' && (isOffice || count > 0);

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
      if (r) setResult(r);
      else navigate(exitTo); // OFFICE single create — straight back to the list
    },
    onError: (e: unknown) =>
      setError(
        e instanceof ApiError
          ? (friendlyError(e.code) ?? e.code)
          : e instanceof Error
            ? e.message
            : 'Save failed',
      ),
  });

  if (!has('masterdata.manage')) return <Navigate to={LIST_PATH} replace />;

  // ── Result summary (created / skipped / errored) ──────────────────────────────────────────────
  if (result) {
    const skipped = result.results.filter((r) => r.status === 'EXISTS');
    const errored = result.results.filter((r) => r.status === 'ERROR');
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Commission rates created</h1>
          <p className="text-sm text-muted-foreground">
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
        {(skipped.length > 0 || errored.length > 0) && (
          <div className="max-w-md space-y-2 rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
            {skipped.length > 0 && (
              <p className="text-muted-foreground">
                Skipped rows already had an active rate for this combination — they kept their existing amount
                and weren’t touched. Revise them one at a time on the list.
              </p>
            )}
            <ul className="space-y-1">
              {skipped.map((r) => (
                <li key={r.locationId} className="flex items-baseline justify-between gap-3">
                  <span className="tabular-nums">{locLabel.get(r.locationId) ?? r.locationId}</span>
                  <span className="text-xs text-muted-foreground">already exists</span>
                </li>
              ))}
              {errored.map((r) => (
                <li key={r.locationId} className="flex items-baseline justify-between gap-3">
                  <span className="tabular-nums">{locLabel.get(r.locationId) ?? r.locationId}</span>
                  <span className="text-xs text-destructive">{r.error}</span>
                </li>
              ))}
            </ul>
          </div>
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

  // ── Entry ─────────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Button variant="link" size="sm" onClick={() => navigate(exitTo)}>
        ← Back to commission rates
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">New Commission Rate</h1>
        <p className="text-sm text-muted-foreground">
          Set the rate once, then pick the user’s assigned pincodes &amp; areas — one save creates one rate
          per location. OFFICE rate types are location-less (one rate). Client, product, unit &amp; TAT band
          can be Universal (matches any).
        </p>
      </div>

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        <Field label="User">
          <select className="input" value={userId} onChange={(e) => changeUser(e.target.value)}>
            <option value="">Select a user…</option>
            {commissionEligibleUsers(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Client (blank = Universal)">
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Universal (all clients)</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product (blank = Universal)">
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Universal (all products)</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Verification Unit (blank = Universal)">
          <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Universal (all units)</option>
            {(units.data ?? []).map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rate Type">
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
        <Field label="TAT Band (blank = Universal)">
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
        <Field label="Amount (₹)">
          <input
            className="input tabular-nums"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50.00"
          />
        </Field>
        <Field label="Effective From (blank = now)">
          <input
            type="date"
            className="input"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
      </div>

      {/* Locations — the selected user's assigned territory (hidden for location-less OFFICE types) */}
      {!isOffice && (
        <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Locations</p>
            {count > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="tabular-nums">{count}</span> selected
              </p>
            )}
          </div>
          {!userId ? (
            <p className="text-sm text-muted-foreground">Select a user to see their assigned locations.</p>
          ) : territory.isLoading ? (
            <div className="py-4">
              <HexagonLoader operation="Loading territory" />
            </div>
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
                const allOn = g.areas.every((a) => selected.has(a.id));
                return (
                  <div key={g.pincode} className="rounded-md border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                      <span className="font-semibold tabular-nums">{g.pincode}</span>
                      <span className="text-xs text-muted-foreground">{g.city}</span>
                      <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <input type="checkbox" checked={allOn} onChange={() => toggleGroup(g)} />
                        Select all
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2 p-3">
                      {g.areas.map((a) => (
                        <label
                          key={a.id}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={selected.has(a.id)}
                            onChange={() => toggleArea(a.id)}
                          />
                          {a.area}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {isOffice && <p className="max-w-md text-xs text-muted-foreground">{OFFICE_LOCATIONLESS_HELP}.</p>}

      {error && <p className="max-w-md text-sm text-destructive">{error}</p>}
      <div className="flex max-w-md items-center gap-3">
        <p className="text-sm">
          <strong className="text-lg tabular-nums">{isOffice ? 1 : count}</strong> rate
          {!isOffice && count !== 1 ? 's' : ''} will be created
        </p>
        <div className="ml-auto flex gap-2">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
