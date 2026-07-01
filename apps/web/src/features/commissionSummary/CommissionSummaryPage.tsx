import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  exportQueryToParams,
  type Option,
  type Paginated,
  type CommissionSummaryRow,
  type CommissionPeriod,
  type CommissionGroupBy,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { formatMoney } from '../../lib/format.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { Button } from '../../components/ui/Button.js';
import { DownloadIcon } from '../../components/ui/icons.js';
import { ScrollRegion } from '../../components/ui/ScrollRegion.js';
import { toast } from 'sonner';

const DEFAULT_PAGE_SIZE = 50;

/** Commission Summary (ADR-0081) — periodic per-field-user commission rollup with export.
 *  Mirrors MisPage: client-side filter form → Generate → server-paginated table + DataGrid export. */
export function CommissionSummaryPage() {
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));

  const [period, setPeriod] = useState<CommissionPeriod>('month');
  const [groupBy, setGroupBy] = useState<CommissionGroupBy>('agent');
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Result state: set on Generate, cleared on filter change.
  const [result, setResult] = useState<Paginated<CommissionSummaryRow> | null>(null);
  const [generated, setGenerated] = useState(false);

  const clientOpts = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const productOpts = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  const buildParams = (p: URLSearchParams): void => {
    p.set('period', period);
    p.set('groupBy', groupBy);
    if (clientId) p.set('clientId', clientId);
    if (productId) p.set('productId', productId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (search) p.set('search', search);
  };

  const generate = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      buildParams(params);
      params.set('page', String(page));
      params.set('limit', String(DEFAULT_PAGE_SIZE));
      return api<Paginated<CommissionSummaryRow>>(
        'GET',
        `/api/v2/billing/commission-summary?${params.toString()}`,
      );
    },
    onSuccess: (data) => {
      setResult(data);
      setGenerated(true);
    },
    onError: () => {
      toast.error('Failed to load commission summary');
    },
  });

  const exportSummary = useMutation({
    mutationFn: (fmt: 'xlsx' | 'csv') => {
      const req: ExportRequest = {
        format: fmt,
        mode: 'all',
        ...(search ? { search } : {}),
      };
      const p = exportQueryToParams(req);
      buildParams(p);
      return apiExport(`/api/v2/billing/commission-summary/export?${p.toString()}`);
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'file') {
        const url = URL.createObjectURL(outcome.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outcome.filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast.success('Export queued — check the Jobs tray when done.');
      }
    },
    onError: () => {
      toast.error('Export failed');
    },
  });

  const handleGenerate = () => {
    setPage(1);
    generate.mutate();
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    generate.mutate();
  };

  if (!has('billing.commission_summary.view'))
    return <div className="text-destructive">You don&apos;t have access to Commission Summary.</div>;

  const rows = result?.items ?? [];
  const totalCount = result?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / DEFAULT_PAGE_SIZE));
  const splitCols = groupBy === 'agentClientProduct';
  const colCount = splitCols ? 6 : 4;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Commission Summary</h1>
        <p className="text-sm text-muted-foreground">
          Per-agent commission by period (week / fortnight / month / quarter) for export &amp; payout.
        </p>
      </div>

      {/* Filter form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Period</span>
            <select
              className="input"
              aria-label="Select period"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as CommissionPeriod);
                setGenerated(false);
                setResult(null);
              }}
            >
              <option value="week">Weekly</option>
              <option value="fortnight">Fortnightly (15-day)</option>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Group by</span>
            <select
              className="input"
              aria-label="Select grouping"
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as CommissionGroupBy);
                setGenerated(false);
                setResult(null);
              }}
            >
              <option value="agent">By agent</option>
              <option value="agentClientProduct">By agent + client + product</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Client</span>
            <select
              className="input"
              aria-label="Select client"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setGenerated(false);
                setResult(null);
              }}
            >
              <option value="">All clients</option>
              {(clientOpts.data ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Product</span>
            <select
              className="input"
              aria-label="Select product"
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setGenerated(false);
                setResult(null);
              }}
            >
              <option value="">All products</option>
              {(productOpts.data ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">From</span>
            <input
              type="date"
              className="input"
              aria-label="Earned-at from date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">To</span>
            <input
              type="date"
              className="input"
              aria-label="Earned-at to date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-foreground">Search</span>
            <input
              className="input"
              placeholder="Agent, client, product…"
              aria-label="Search commission summary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGenerate();
              }}
            />
          </label>

          <div className="flex gap-2 pb-0.5">
            <Button loading={generate.isPending} onClick={handleGenerate}>
              Generate
            </Button>

            {generated && (
              <>
                <Button
                  variant="secondary"
                  disabled={exportSummary.isPending}
                  onClick={() => exportSummary.mutate('xlsx')}
                >
                  <DownloadIcon />
                  Export XLSX
                </Button>
                <Button
                  variant="secondary"
                  disabled={exportSummary.isPending}
                  onClick={() => exportSummary.mutate('csv')}
                >
                  <DownloadIcon />
                  Export CSV
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {generate.isPending && <HexagonLoader operation="Loading commission summary" />}

      {!generate.isPending && generated && (
        <div className="rounded-lg border border-border bg-card">
          <ScrollRegion label="Commission summary results">
            <table className="rtable w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Agent
                  </th>
                  {splitCols && (
                    <>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Client
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Product
                      </th>
                    </>
                  )}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Period
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Tasks
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Billable Units
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Commission Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground" colSpan={colCount}>
                      No results for the selected filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-border hover:bg-surface-muted">
                      <td data-label="Agent" className="px-3 py-2">
                        {row.agentName}
                      </td>
                      {splitCols && (
                        <>
                          <td data-label="Client" className="px-3 py-2">
                            {row.clientName ?? '—'}
                          </td>
                          <td data-label="Product" className="px-3 py-2">
                            {row.productName ?? '—'}
                          </td>
                        </>
                      )}
                      <td data-label="Period" className="px-3 py-2">
                        {row.periodKey}
                      </td>
                      <td data-label="Tasks" className="px-3 py-2">
                        {row.taskCount}
                      </td>
                      <td data-label="Billable Units" className="px-3 py-2">
                        {row.billableUnits}
                      </td>
                      <td data-label="Commission Total" className="px-3 py-2">
                        {formatMoney(row.commissionTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollRegion>

          {/* Pagination */}
          {totalCount > DEFAULT_PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <span>
                {totalCount} total · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Row count footer */}
          {totalCount <= DEFAULT_PAGE_SIZE && rows.length > 0 && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {totalCount} row{totalCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
