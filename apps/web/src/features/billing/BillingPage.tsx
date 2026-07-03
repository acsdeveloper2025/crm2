import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  pageQueryToParams,
  exportQueryToParams,
  type Option,
  type BillingLineRow,
  type BillingLinesSummary,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';

/** Completed-in TAT band label: -1 = completed outside every band; null = not derivable. */
const bandLabel = (b: number | null) => (b == null ? '—' : b === -1 ? 'Out of band' : `≤${b}h`);

/** TAT-band filter options — match the server's TAT_BAND_FILTER_VALUES (standard ACS SLA bands + out-of-band). */
const TAT_BAND_OPTIONS = [
  { value: '4', label: '≤4h' },
  { value: '6', label: '≤6h' },
  { value: '8', label: '≤8h' },
  { value: '12', label: '≤12h' },
  { value: '24', label: '≤24h' },
  { value: '48', label: '≤48h' },
  { value: '-1', label: 'Out of band' },
];

/** Filter-aware bill total for the grid footer — sums ALL matching lines (not just the page) via the summary
 *  endpoint, re-fetching only when the filters/search change (keyed off filters, not page). */
function BillTotal({ query }: { query: PageQuery }) {
  const filtersKey = JSON.stringify({ search: query.search ?? '', filters: query.filters ?? {} });
  const q = useQuery({
    queryKey: ['billing-lines-summary', filtersKey],
    queryFn: () =>
      api<BillingLinesSummary>('GET', `/api/v2/billing/lines/summary?${pageQueryToParams(query).toString()}`),
  });
  if (!q.data) return null;
  return <span className="font-medium text-foreground">Bill total: {formatMoney(q.data.billTotal)}</span>;
}

/** Billing (ADR-0046; commission separated out by ADR-0086) — one flat, filterable row per COMPLETED
 *  billable task (bill_count-weighted). Commission lives on /commission-summary. */
export function BillingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
  const [clientId, setClientId] = useState('');
  const clientOpts = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const columns = useMemo<DataGridColumn<BillingLineRow>[]>(
    () => [
      {
        id: 'caseNumber',
        header: 'Case',
        sortable: true,
        cell: (r) => <span className="whitespace-nowrap font-medium">{r.caseNumber}</span>,
      },
      { id: 'client', header: 'Client', sortable: true, filterable: true, cell: (r) => r.clientName },
      { id: 'product', header: 'Product', sortable: true, filterable: true, cell: (r) => r.productName },
      {
        id: 'unit',
        header: 'Verification Unit',
        sortable: true,
        filterable: true,
        cell: (r) => r.unitName,
      },
      { id: 'assignee', header: 'Assignee', sortable: true, cell: (r) => r.assigneeName ?? '—' },
      {
        id: 'rateType',
        header: 'Rate Type',
        sortable: true,
        filterable: true,
        cell: (r) => <span className="text-xs uppercase">{r.clientRateType ?? '—'}</span>,
      },
      {
        id: 'tatBand',
        header: 'TAT Band',
        sortable: true,
        align: 'right',
        filterable: true,
        filterOptions: TAT_BAND_OPTIONS,
        cell: (r) => bandLabel(r.tatBand),
      },
      {
        id: 'location',
        header: 'Location',
        cell: (r) => (r.pincode || r.area ? `${r.pincode ?? ''} ${r.area ?? ''}`.trim() : '—'),
      },
      {
        id: 'billCount',
        header: 'Units',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{r.billCount}</span>,
      },
      {
        id: 'billTotal',
        header: 'Bill',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{formatMoney(r.billTotal)}</span>,
      },
      {
        id: 'completedAt',
        header: 'Completed',
        sortable: true,
        cell: (r) => (r.completedAt ? formatDateTime(r.completedAt) : '—'),
      },
    ],
    [],
  );

  if (!has('billing.view')) return <div className="text-destructive">You don’t have access to Billing.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Per-completed-task client billing (bill_count-weighted). Filter, sort and export the lines below.
          </p>
        </div>
        {has('commission_summary.view') && (
          <Link
            to="/commission-summary"
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            View Commission Summary →
          </Link>
        )}
      </div>
      <DataGrid<BillingLineRow>
        columns={columns}
        queryKey="billing-lines"
        rowId={(r) => r.taskId}
        defaultSort="completedAt"
        defaultSortOrder="desc"
        searchPlaceholder="Search case, client, product, unit, assignee, pincode…"
        filters={{ clientId: clientId || undefined }}
        footerSummary={(q) => <BillTotal query={q} />}
        fetchPage={(query: PageQuery) =>
          api<Paginated<BillingLineRow>>(
            'GET',
            `/api/v2/billing/lines?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[{ id: 'completedAt', label: 'Completed' }]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/billing/lines/export?${exportQueryToParams(req).toString()}`)
        }
        onRowClick={(r) => navigate(`/cases/${r.caseId}`)}
        toolbar={
          <select
            className="input w-[12rem]"
            aria-label="Filter by client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">All clients</option>
            {(clientOpts.data ?? []).map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </select>
        }
      />
    </div>
  );
}
