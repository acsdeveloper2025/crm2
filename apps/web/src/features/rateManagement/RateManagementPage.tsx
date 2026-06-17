import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  KINDS,
  type Option,
  type VerificationUnitOption,
  type RateView,
  type RateHistory,
  type RateType,
  type Location,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';
const money = (n: number) => `₹${n.toFixed(2)}`;
const isoOrUndefined = (d: string): string | undefined => (d ? new Date(d).toISOString() : undefined);

type Opt = { value: string; label: string };
const KIND_LABELS: Record<string, string> = {
  FIELD_VISIT: 'Field Visit',
  KYC_DOCUMENT: 'KYC Document',
  DESK_DOCUMENT: 'Desk Document',
};
const RATE_KIND_OPTIONS = KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] ?? k }));

function ActiveChip({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-st-approved-bg text-st-approved' : 'bg-muted text-muted-foreground'
      }`}
    >
      {active ? 'ACTIVE' : 'INACTIVE'}
    </span>
  );
}

/**
 * A type-to-search dropdown. Static lists filter client-side; pass `onQueryChange` to let a parent
 * refine the option set server-side (used for the huge pincode list).
 */
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  onQueryChange,
  disabled,
  width = 'min-w-[12rem]',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  placeholder?: string;
  onQueryChange?: (q: string) => void;
  disabled?: boolean;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = onQueryChange
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={`relative ${width}`}>
      <input
        className="input w-full disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        disabled={disabled}
        placeholder={placeholder ?? 'Search…'}
        value={open ? q : (selected?.label ?? '')}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          onQueryChange?.(e.target.value);
        }}
      />
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No matches</li>}
          {filtered.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Rate Management — ONE table (Universal DataGrid), one line per rate (client · product · unit ·
 * pincode · area · rate type · rate · effective from · status). Add inline via a cascading,
 * searchable form: client → product → unit → pincode → area, plus a managed rate-type dropdown.
 * Revise (effective-dated) and History open as dialogs from the row actions.
 */
export function RateManagementPage() {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [adding, setAdding] = useState(false);
  const [reviseRate, setReviseRate] = useState<RateView | null>(null);
  const [historyRate, setHistoryRate] = useState<RateView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toggleConflict, setToggleConflict] = useState<RateView | null>(null);

  const clients = useQuery({
    queryKey: ['clients', 'active'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['products', 'active'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  const units = useQuery({
    queryKey: ['verification-units', 'active'],
    queryFn: () => api<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['rates'] });

  const toggle = useMutation({
    mutationFn: (r: RateView) =>
      api('POST', `/api/v2/rates/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: refresh,
    onError: (e: unknown, r: RateView) => {
      if (isStale(e)) setToggleConflict(r);
    },
  });

  const clientOpts: Opt[] = (clients.data ?? []).map((c) => ({
    value: String(c.id),
    label: `${c.code} — ${c.name}`,
  }));
  const productOpts: Opt[] = (products.data ?? []).map((p) => ({
    value: String(p.id),
    label: `${p.code} — ${p.name}`,
  }));

  const columns = useMemo<DataGridColumn<RateView>[]>(
    () => [
      {
        id: 'client',
        header: 'Client',
        sortable: true,
        cell: (r) => <span className="whitespace-nowrap">{r.clientCode}</span>,
      },
      {
        id: 'product',
        header: 'Product',
        sortable: true,
        cell: (r) => <span className="whitespace-nowrap">{r.productCode}</span>,
      },
      {
        id: 'kind',
        header: 'Kind',
        sortable: true,
        filterable: true,
        filterOptions: RATE_KIND_OPTIONS,
        cell: (r) => <span className="text-xs">{r.unitKind.replace(/_/g, ' ')}</span>,
      },
      {
        id: 'unit',
        header: 'Verification Unit',
        sortable: true,
        filterable: true,
        cell: (r) => r.unitName,
      },
      {
        id: 'pincode',
        header: 'Pincode',
        sortable: true,
        filterable: true,
        cell: (r) => <span className="font-mono text-xs">{r.pincode ?? '—'}</span>,
      },
      { id: 'area', header: 'Area', sortable: true, filterable: true, cell: (r) => r.area ?? '—' },
      {
        id: 'rateType',
        header: 'Rate Type',
        sortable: true,
        filterable: true,
        cell: (r) => r.rateType ?? '—',
      },
      {
        id: 'amount',
        header: 'Rate',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{money(r.amount)}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.effectiveFrom)}</span>,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</span>,
      },
      { id: 'status', header: 'Status', sortable: true, cell: (r) => <ActiveChip active={r.isActive} /> },
      {
        id: 'actions',
        header: 'Actions',
        cell: (r) => (
          <div className="flex gap-2">
            <button
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setReviseRate(r)}
            >
              Revise
            </button>
            <button
              className="text-xs font-medium text-foreground hover:underline"
              onClick={() => setHistoryRate(r)}
            >
              History
            </button>
            <button
              className="text-xs font-medium text-muted-foreground hover:underline"
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Rate Management</h1>
          <p className="text-sm text-muted-foreground">
            One row per rate — client, product, unit, pincode/area, rate type and amount. Geography is blank
            for KYC units.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportButton config={{ basePath: '/api/v2/rates', queryKey: 'rates', entityLabel: 'rate' }} />
          <button className="btn" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : '+ Add rate'}
          </button>
        </div>
      </div>

      {adding && (
        <AddRateForm
          clientOpts={clientOpts}
          productOpts={productOpts}
          units={units.data ?? []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onError={setErr}
        />
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}

      <DataGrid<RateView>
        columns={columns}
        queryKey="rates"
        rowId={(r) => r.id}
        selectable
        bulkActions={(sel) => (
          <BulkStatusActions selection={sel} basePath={'/api/v2/rates'} queryKey={'rates'} />
        )}
        defaultSort="client"
        searchPlaceholder="Search client, product, unit, pincode, area, rate type…"
        filters={{ clientId: clientId || undefined, productId: productId || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<RateView>>('GET', `/api/v2/rates?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/rates/export?${exportQueryToParams(req).toString()}`)
        }
        toolbar={
          <>
            <SearchableSelect
              value={clientId}
              onChange={setClientId}
              options={[{ value: '', label: 'All clients' }, ...clientOpts]}
              placeholder="All clients"
              width="min-w-[12rem]"
            />
            <SearchableSelect
              value={productId}
              onChange={setProductId}
              options={[{ value: '', label: 'All products' }, ...productOpts]}
              placeholder="All products"
              width="min-w-[12rem]"
            />
          </>
        }
      />

      {reviseRate && (
        <ReviseDialog
          rate={reviseRate}
          onClose={() => setReviseRate(null)}
          onDone={() => {
            setReviseRate(null);
            refresh();
          }}
          onError={setErr}
        />
      )}

      {historyRate && <HistoryDialog rate={historyRate} onClose={() => setHistoryRate(null)} />}

      {toggleConflict && (
        <ConflictDialog
          entityLabel="rate"
          current={undefined}
          onReload={() => {
            refresh();
            setToggleConflict(null);
          }}
          onDiscard={() => {
            refresh();
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}

function AddRateForm({
  clientOpts,
  productOpts,
  units,
  onClose,
  onDone,
  onError,
}: {
  clientOpts: Opt[];
  productOpts: Opt[];
  units: VerificationUnitOption[];
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState('FIELD_VISIT');
  const [unitId, setUnitId] = useState('');
  const [pincode, setPincode] = useState('');
  const [pincodeSearch, setPincodeSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [rateType, setRateType] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  // KYC documents have no geography or rate type — those fields are greyed out and forced null.
  const isKyc = kind === 'KYC_DOCUMENT';
  const onKindChange = (k: string) => {
    setKind(k);
    setUnitId('');
    setPincode('');
    setLocationId('');
    setRateType('');
  };

  const rateTypes = useQuery({
    queryKey: ['rate-types'],
    queryFn: () => api<RateType[]>('GET', '/api/v2/rate-types?active=true'),
  });
  const pincodes = useQuery({
    queryKey: ['pincodes', pincodeSearch],
    queryFn: () => api<string[]>('GET', `/api/v2/locations/pincodes?q=${encodeURIComponent(pincodeSearch)}`),
    enabled: pincodeSearch.length >= 2,
  });
  const areas = useQuery({
    queryKey: ['areas', pincode],
    queryFn: () =>
      api<Paginated<Location>>('GET', `/api/v2/locations?pincode=${pincode}&limit=200`).then((r) => r.items),
    enabled: !!pincode,
  });

  const create = useMutation({
    mutationFn: () =>
      api('POST', '/api/v2/rates', {
        clientId: Number(clientId),
        productId: Number(productId),
        verificationUnitId: Number(unitId),
        locationId: isKyc || !locationId ? null : Number(locationId),
        rateType: isKyc ? null : rateType || null,
        amount: Number(amount),
        effectiveFrom: isoOrUndefined(effectiveFrom),
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  });

  const unitOpts: Opt[] = units
    .filter((u) => u.kind === kind)
    .map((u) => ({ value: String(u.id), label: u.name }));
  const kindOpts: Opt[] = [
    { value: 'FIELD_VISIT', label: 'FIELD VISIT' },
    { value: 'KYC_DOCUMENT', label: 'KYC DOCUMENT' },
  ];
  const pincodeOpts: Opt[] = (pincodes.data ?? []).map((p) => ({ value: p, label: p }));
  const areaOpts: Opt[] = (areas.data ?? []).map((l) => ({ value: String(l.id), label: l.area }));
  const rateTypeOpts: Opt[] = (rateTypes.data ?? []).map((rt) => ({ value: rt.code, label: rt.code }));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
      <Field label="Client">
        <SearchableSelect
          value={clientId}
          onChange={setClientId}
          options={clientOpts}
          width="min-w-[12rem]"
        />
      </Field>
      <Field label="Product">
        <SearchableSelect
          value={productId}
          onChange={setProductId}
          options={productOpts}
          width="min-w-[11rem]"
        />
      </Field>
      <Field label="Kind">
        <SearchableSelect value={kind} onChange={onKindChange} options={kindOpts} width="min-w-[10rem]" />
      </Field>
      <Field label="Verification unit">
        <SearchableSelect value={unitId} onChange={setUnitId} options={unitOpts} width="min-w-[12rem]" />
      </Field>
      <Field label="Pincode (search)">
        <SearchableSelect
          value={pincode}
          onChange={(v) => {
            setPincode(v);
            setLocationId('');
          }}
          options={pincodeOpts}
          onQueryChange={setPincodeSearch}
          placeholder={isKyc ? 'n/a for KYC' : 'Type ≥2 digits…'}
          disabled={isKyc}
          width="min-w-[9rem]"
        />
      </Field>
      <Field label="Area">
        <SearchableSelect
          value={locationId}
          onChange={setLocationId}
          options={areaOpts}
          disabled={isKyc || !pincode}
          placeholder={isKyc ? 'n/a for KYC' : pincode ? 'Select area…' : 'Pick pincode first'}
          width="min-w-[12rem]"
        />
      </Field>
      <Field label="Rate type">
        <SearchableSelect
          value={rateType}
          onChange={setRateType}
          options={rateTypeOpts}
          disabled={isKyc}
          placeholder={isKyc ? 'n/a for KYC' : 'Search…'}
          width="min-w-[9rem]"
        />
      </Field>
      <Field label="Rate (₹)">
        <input
          type="number"
          min={0}
          step="0.01"
          className="input w-28"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Effective from">
        <input
          type="date"
          className="input"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </Field>
      <button
        className="btn"
        disabled={
          !clientId ||
          !productId ||
          !unitId ||
          !amount ||
          (!isKyc && (!locationId || !rateType)) ||
          create.isPending
        }
        onClick={() => create.mutate()}
      >
        {create.isPending ? 'Saving…' : 'Add'}
      </button>
      <button className="btn-ghost" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function ReviseDialog({
  rate,
  onClose,
  onDone,
  onError,
}: {
  rate: RateView;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [amount, setAmount] = useState(String(rate.amount));
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [conflict, setConflict] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const revise = useMutation({
    mutationFn: () =>
      api('POST', `/api/v2/rates/${rate.id}/revise`, {
        amount: Number(amount),
        effectiveFrom: isoOrUndefined(effectiveFrom),
        version: rate.version, // OCC: revise the row the user is looking at (ADR-0019)
      }),
    onSuccess: onDone,
    onError: (e: unknown) => {
      if (isStale(e)) setConflict(true);
      else onError(e instanceof Error ? e.message : 'Revision failed');
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rate-revise-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="rate-revise-title" className="mb-1 text-lg font-semibold">
          Revise Rate
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          New version of <b>{rate.unitName}</b>
          {rate.rateType ? ` · ${rate.rateType}` : ''}
          {rate.pincode ? ` · ${rate.pincode}` : ''} (current {money(rate.amount)}). The current row is
          end-dated, never overwritten.
        </p>
        <div className="space-y-3">
          <Field label="New rate (₹)">
            <input
              type="number"
              min={0}
              step="0.01"
              className="input w-40"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Effective from">
            <input
              type="date"
              className="input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={revise.isPending}>
            Cancel
          </button>
          <button className="btn" disabled={!amount || revise.isPending} onClick={() => revise.mutate()}>
            {revise.isPending ? 'Saving…' : 'Save revision'}
          </button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="rate"
          current={undefined}
          onReload={() => {
            setConflict(false);
            onDone(); // refresh the list to the new current row
          }}
          onDiscard={() => {
            setConflict(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function HistoryDialog({ rate, onClose }: { rate: RateView; onClose: () => void }) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const history = useQuery({
    queryKey: ['rate-history', rate.id],
    queryFn: () => api<RateHistory[]>('GET', `/api/v2/rates/${rate.id}/history`),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rate-history-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="rate-history-title" className="mb-1 text-lg font-semibold">
          Rate History
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {rate.unitName}
          {rate.rateType ? ` · ${rate.rateType}` : ''}
          {rate.pincode ? ` · ${rate.pincode}` : ''}
        </p>
        {history.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading history…</p>
        ) : (
          <table className="rtable w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-semibold">When</th>
                <th className="py-1 pr-4 font-semibold">Action</th>
                <th className="py-1 pr-4 font-semibold">Old → New</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td data-label="When" className="whitespace-nowrap py-1 pr-4">
                    {formatDateTime(h.changedAt)}
                  </td>
                  <td data-label="Action" className="py-1 pr-4">
                    {h.action}
                  </td>
                  <td data-label="Old → New" className="py-1 pr-4 tabular-nums">
                    {h.oldAmount !== null ? money(h.oldAmount) : '—'} →{' '}
                    {h.newAmount !== null ? money(h.newAmount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-5 flex justify-end">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
