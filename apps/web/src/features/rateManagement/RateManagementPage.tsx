import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  type Option,
  type RateView,
  type RateHistory,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn, type BulkSelection } from '../../components/ui/data-grid/index.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { Button } from '../../components/ui/Button.js';
import { SearchableSelect, type Opt } from '../../components/ui/SearchableSelect.js';
import { useAuth } from '../../lib/AuthContext.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/** Leading characters a spreadsheet treats as a formula trigger (CWE-1236). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * CSV cell escaping for the client-side history export: CWE-1236 formula-injection guard FIRST
 * (leading `= + - @`/tab/CR gets a `'` prefix so no spreadsheet executes the cell as a formula),
 * THEN RFC 4180 quoting (mirrors `apps/api/src/platform/export/format.ts#escapeCsvCell` — this
 * export has no server round-trip so the guard is reimplemented here, not imported cross-package).
 */
function escapeCsvCell(raw: string): string {
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** UX-13: builds the History-dialog export CSV from rows already loaded on screen (no endpoint). */
export function buildHistoryCsv(rows: RateHistory[]): string {
  const head = ['When', 'Action', 'Old', 'New'].join(',');
  const body = rows.map((h) =>
    [
      formatDateTime(h.changedAt),
      h.action,
      h.oldAmount !== null ? h.oldAmount.toFixed(2) : '',
      h.newAmount !== null ? h.newAmount.toFixed(2) : '',
    ]
      .map(escapeCsvCell)
      .join(','),
  );
  return [head, ...body].join('\r\n');
}

/** UX-13: triggers the browser download for the built CSV (mirrors the DataGrid export's Blob pattern — no shared helper exists to reuse; ponytail: no new endpoint for data already on screen). */
function downloadHistoryCsv(rateId: number, rows: RateHistory[]): void {
  const blob = new Blob([buildHistoryCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rate-history-${rateId}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
 * Rate Management — ONE table (Universal DataGrid), one line per rate (client · product · unit ·
 * pincode · area · rate type · rate · effective from · status). Add / Revise are full record-page
 * routes (`/admin/rates/new`, `/admin/rates/:id`; ADR-0051 Wave-4 D4 — no modal). History opens as a
 * read-only dialog from the row actions.
 */
export function RateManagementPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Writes (add / revise / activate-deactivate / bulk / import) require masterdata.manage; viewing
  // (masterdata.view) does not. Gate the write affordances so a viewer doesn't hit a server 403.
  const { has } = useAuth();
  const canManage = has('masterdata.manage');
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [historyRate, setHistoryRate] = useState<RateView | null>(null);
  const [toggleConflict, setToggleConflict] = useState<RateView | null>(null);

  const clients = useQuery({
    queryKey: ['clients', 'active'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['products', 'active'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
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
        // null product = Universal (ADR-0071): one rate for all products of the client.
        cell: (r) => <span className="whitespace-nowrap">{r.productCode ?? 'Universal'}</span>,
      },
      {
        id: 'unit',
        header: 'Verification Unit',
        sortable: true,
        filterable: true,
        cell: (r) => r.unitName ?? 'Universal',
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
        id: 'clientRateType',
        header: 'Rate Type',
        sortable: true,
        filterable: true,
        cell: (r) => r.clientRateType ?? '—',
      },
      {
        id: 'amount',
        header: 'Rate',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{formatMoney(r.amount)}</span>,
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
            {canManage && (
              <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/rates/${r.id}`)}>
                Revise
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setHistoryRate(r)}>
              History
            </Button>
            {canManage && (
              <Button
                variant={r.isActive ? 'destructive' : 'secondary'}
                size="sm"
                onClick={() => toggle.mutate(r)}
              >
                {r.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [toggle, canManage, navigate],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Rate Management</h1>
          <p className="text-sm text-muted-foreground">
            One row per rate — client, product, unit, pincode/area, rate type and amount. Office rates are
            flat (no geography).
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <ImportButton config={{ basePath: '/api/v2/rates', queryKey: 'rates', entityLabel: 'rate' }} />
            <Button onClick={() => navigate('/admin/rates/new')}>+ Add rate</Button>
          </div>
        )}
      </div>

      <DataGrid<RateView>
        columns={columns}
        queryKey="rates"
        rowId={(r) => r.id}
        selectable
        {...(canManage
          ? {
              bulkActions: (sel: BulkSelection<RateView>) => (
                <BulkStatusActions selection={sel} basePath={'/api/v2/rates'} queryKey={'rates'} />
              ),
            }
          : {})}
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
          {rate.clientRateType ? ` · ${rate.clientRateType}` : ''}
          {rate.pincode ? ` · ${rate.pincode}` : ''}
        </p>
        {history.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading history…</p>
        ) : (
          <table className="rtable w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-4 font-semibold">
                  When
                </th>
                <th scope="col" className="py-1 pr-4 font-semibold">
                  Action
                </th>
                <th scope="col" className="py-1 pr-4 font-semibold">
                  Old → New
                </th>
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
                    {h.oldAmount !== null ? formatMoney(h.oldAmount) : '—'} →{' '}
                    {h.newAmount !== null ? formatMoney(h.newAmount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={!history.data?.length}
            onClick={() => downloadHistoryCsv(rate.id, history.data ?? [])}
          >
            Export CSV
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
