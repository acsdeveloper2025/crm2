import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  type Option,
  type UserOption,
  type RateType,
  type VerificationUnitOption,
  type Location,
  type TatPolicy,
  type CommissionRate,
  type CommissionRateView,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { toast } from 'sonner';

const money = (n: number) => `₹${n.toFixed(2)}`;
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/** Create (full fields) or Revise (amount + effectiveFrom, version-guarded) a commission rate. */
function CommissionRateDialog({ row, onClose }: { row: CommissionRateView | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isRevise = !!row;
  const [userId, setUserId] = useState(row?.userId ?? '');
  const [rateType, setRateType] = useState(row?.rateType ?? '');
  const [clientId, setClientId] = useState(row?.clientId ? String(row.clientId) : '');
  const [productId, setProductId] = useState(row?.productId ? String(row.productId) : '');
  const [unitId, setUnitId] = useState(row?.verificationUnitId ? String(row.verificationUnitId) : '');
  const [pincode, setPincode] = useState(row?.pincode ?? '');
  const [locationId, setLocationId] = useState(row?.locationId ? String(row.locationId) : '');
  const [tatBand, setTatBand] = useState(row?.tatBand != null ? String(row.tatBand) : '');
  const [amount, setAmount] = useState(row ? String(row.amount) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(row?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const validPincode = /^\d{6}$/.test(pincode);

  const users = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api<UserOption[]>('GET', '/api/v2/users/options'),
  });
  const rateTypes = useQuery({
    queryKey: ['rate-types'],
    queryFn: () => api<RateType[]>('GET', '/api/v2/rate-types?active=true'),
  });
  const clients = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  const units = useQuery({
    queryKey: ['verification-unit-options'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });
  // Cascading location: type a pincode (server-search suggestions) → pick the area = a locations row.
  const pincodes = useQuery({
    queryKey: ['location-pincodes', pincode],
    queryFn: () => api<string[]>('GET', `/api/v2/locations/pincodes?q=${encodeURIComponent(pincode)}`),
    enabled: !isRevise && pincode.length >= 2,
  });
  const areas = useQuery({
    queryKey: ['location-areas', pincode],
    queryFn: () =>
      api<Paginated<Location>>('GET', `/api/v2/locations?pincode=${pincode}&limit=200`).then((r) => r.items),
    enabled: !isRevise && validPincode,
  });
  const tatPolicies = useQuery({
    queryKey: ['tat-policies', 'active'],
    queryFn: () =>
      api<Paginated<TatPolicy>>('GET', '/api/v2/tat-policies?active=true&limit=100').then((r) => r.items),
  });

  const mut = useMutation({
    mutationFn: () =>
      isRevise
        ? api<CommissionRate>('POST', `/api/v2/commission-rates/${row!.id}/revise`, {
            amount: Number(amount),
            effectiveFrom: toIsoDate(effectiveFrom),
            version: row!.version,
          })
        : api<CommissionRate>('POST', '/api/v2/commission-rates', {
            userId,
            rateType: rateType || null,
            clientId: clientId ? Number(clientId) : null,
            productId: productId ? Number(productId) : null,
            verificationUnitId: unitId ? Number(unitId) : null,
            locationId: locationId ? Number(locationId) : null,
            tatBand: tatBand === '' ? null : Number(tatBand),
            amount: Number(amount),
            effectiveFrom: toIsoDate(effectiveFrom),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-rates'] });
      onClose();
    },
    onError: (e: unknown) =>
      setError(
        isStale(e)
          ? 'This rate changed since you opened it — reload and retry.'
          : e instanceof ApiError
            ? e.code
            : 'Save failed',
      ),
  });

  const valid = isRevise ? amount !== '' : !!userId && amount !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 className="mb-4 text-lg font-semibold">
          {isRevise ? 'Revise Commission Rate' : 'New Commission Rate'}
        </h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">User</span>
            <select
              className="input"
              value={userId}
              disabled={isRevise}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role.replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Classification (optional)</span>
            <select
              className="input"
              value={rateType}
              disabled={isRevise}
              onChange={(e) => setRateType(e.target.value)}
            >
              <option value="">None — descriptive label, not a resolution key</option>
              {(rateTypes.data ?? []).map((rt) => (
                <option key={rt.id} value={rt.code}>
                  {rt.code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Client (blank = universal)</span>
            <select
              className="input"
              value={clientId}
              disabled={isRevise}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Universal (all clients)</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!isRevise && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">Product (blank = any)</span>
                <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Any product</option>
                  {(products.data ?? []).map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">
                  Verification Unit (blank = any)
                </span>
                <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">Any unit</option>
                  {(units.data ?? []).map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">
                  Pincode (blank = any location)
                </span>
                <input
                  className="input"
                  list="commission-pincodes"
                  value={pincode}
                  placeholder="Type ≥2 digits…"
                  onChange={(e) => {
                    setPincode(e.target.value);
                    setLocationId('');
                  }}
                />
                <datalist id="commission-pincodes">
                  {(pincodes.data ?? []).map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">Area</span>
                <select
                  className="input"
                  value={locationId}
                  disabled={!validPincode}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">
                    {validPincode ? 'Select an area…' : 'Enter a 6-digit pincode first'}
                  </option>
                  {(areas.data ?? []).map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.area}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">TAT Band (blank = any)</span>
                <select className="input" value={tatBand} onChange={(e) => setTatBand(e.target.value)}>
                  <option value="">Any band</option>
                  {(tatPolicies.data ?? []).map((tp) => (
                    <option key={tp.id} value={String(tp.tatHours)}>
                      {tp.label}
                    </option>
                  ))}
                  <option value="-1">Out of band</option>
                </select>
              </label>
            </>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Amount (₹)</span>
            <input
              className="input tabular-nums"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50.00"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Effective From (blank = now)
            </span>
            <input
              type="date"
              className="input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={mut.isPending || !valid}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Commission Rates (ADR-0036) — per-user agent-commission config. SUPER_ADMIN only (comp data). */
export function CommissionRatesPage() {
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
  const [dialog, setDialog] = useState<{ row: CommissionRateView | null } | null>(null);
  const [active, setActive] = useState('');
  const qc = useQueryClient();
  // Per-row activate/deactivate (OCC version-guarded; single-row routes — no bulk endpoint exists).
  const toggle = useMutation({
    mutationFn: (r: CommissionRateView) =>
      api<CommissionRate>(
        'POST',
        `/api/v2/commission-rates/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`,
        { version: r.version },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commission-rates'] }),
    onError: (e: unknown) =>
      toast.error(
        isStale(e)
          ? 'This rate changed — reload and retry.'
          : e instanceof ApiError
            ? e.code
            : 'Update failed',
      ),
  });
  const columns = useMemo<DataGridColumn<CommissionRateView>[]>(
    () => [
      { id: 'user', header: 'User', sortable: true, cell: (r) => r.userName },
      {
        id: 'client',
        header: 'Client',
        sortable: true,
        cell: (r) => r.clientName ?? <span className="text-muted-foreground">Universal</span>,
      },
      {
        id: 'rateType',
        header: 'Classification',
        sortable: true,
        cell: (r) =>
          r.rateType ? (
            <span className="text-xs uppercase">{r.rateType}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'product',
        header: 'Product',
        cell: (r) =>
          r.productName ? (
            `${r.productCode ?? ''} ${r.productName}`.trim()
          ) : (
            <span className="text-muted-foreground">Any</span>
          ),
      },
      {
        id: 'verificationUnit',
        header: 'Unit',
        cell: (r) => r.verificationUnitName ?? <span className="text-muted-foreground">Any</span>,
      },
      {
        id: 'location',
        header: 'Location',
        cell: (r) =>
          r.pincode || r.area ? (
            `${r.pincode ?? ''} ${r.area ?? ''}`.trim()
          ) : (
            <span className="text-muted-foreground">Any</span>
          ),
      },
      {
        id: 'tatBand',
        header: 'TAT Band',
        align: 'right',
        cell: (r) =>
          r.tatBand == null ? (
            <span className="text-muted-foreground">Any</span>
          ) : r.tatBand === -1 ? (
            'Out of band'
          ) : (
            `${r.tatBand}h`
          ),
      },
      {
        id: 'amount',
        header: 'Amount',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{money(r.amount)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => <span className="text-xs uppercase">{r.isActive ? 'Active' : 'Inactive'}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (r) => formatDateTime(r.effectiveFrom),
      },
      { id: 'createdAt', header: 'Created', sortable: true, cell: (r) => formatDateTime(r.createdAt) },
      { id: 'updatedAt', header: 'Updated', sortable: true, cell: (r) => formatDateTime(r.updatedAt) },
      {
        id: 'actions',
        header: '',
        hideable: false,
        align: 'right',
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {r.isActive && (
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ row: r })}>
                Revise
              </button>
            )}
            <button
              className="btn-ghost px-2 py-1 text-xs"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(r)}
            >
              {r.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ),
      },
    ],
    [toggle],
  );

  if (!has('masterdata.manage'))
    return <div className="text-destructive">You don’t have access to Commission Rates.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Commission Rates</h1>
          <p className="text-sm text-muted-foreground">
            Per-executive commission by location (pincode/area), client, product, unit &amp; completed-in TAT
            band — decoupled from the client rate. The amount source for the Billing &amp; Commission view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportButton
            config={{
              basePath: '/api/v2/commission-rates',
              queryKey: 'commission-rates',
              entityLabel: 'commission rate',
            }}
          />
          <button className="btn" onClick={() => setDialog({ row: null })}>
            + New Commission Rate
          </button>
        </div>
      </div>
      <DataGrid<CommissionRateView>
        columns={columns}
        queryKey="commission-rates"
        rowId={(r) => r.id}
        defaultSort="user"
        searchPlaceholder="Search user, client, rate type…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<CommissionRateView>>(
            'GET',
            `/api/v2/commission-rates?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/commission-rates/export?${exportQueryToParams(req).toString()}`)
        }
        toolbar={
          <select
            className="input w-[10rem]"
            aria-label="Filter by status"
            value={active}
            onChange={(e) => setActive(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        }
      />
      {dialog && <CommissionRateDialog row={dialog.row} onClose={() => setDialog(null)} />}
    </div>
  );
}
