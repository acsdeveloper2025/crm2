import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  exportQueryToParams,
  type Option,
  type Paginated,
  type CommissionSummaryRow,
  type CommissionDetailRow,
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

  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [period, setPeriod] = useState<CommissionPeriod>('month');
  const [groupBy, setGroupBy] = useState<CommissionGroupBy>('agent');
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Result state: set on Generate, cleared on filter change. Only one view's result is live at a time.
  const [result, setResult] = useState<Paginated<CommissionSummaryRow> | null>(null);
  const [detailResult, setDetailResult] = useState<Paginated<CommissionDetailRow> | null>(null);
  const [generated, setGenerated] = useState(false);

  // Any filter change invalidates the current result (matches the existing per-field reset).
  const resetResult = () => {
    setGenerated(false);
    setResult(null);
    setDetailResult(null);
  };

  const clientOpts = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const productOpts = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  // Shared filters used by both views.
  const buildSharedParams = (p: URLSearchParams): void => {
    if (clientId) p.set('clientId', clientId);
    if (productId) p.set('productId', productId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (search) p.set('search', search);
  };

  // Summary adds period + groupBy on top of the shared filters.
  const buildParams = (p: URLSearchParams): void => {
    p.set('period', period);
    p.set('groupBy', groupBy);
    buildSharedParams(p);
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

  const onExportSuccess = (outcome: Awaited<ReturnType<typeof apiExport>>) => {
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
  };

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
    onSuccess: onExportSuccess,
    onError: () => {
      toast.error('Export failed');
    },
  });

  const generateDetail = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      buildSharedParams(params);
      params.set('page', String(page));
      params.set('limit', String(DEFAULT_PAGE_SIZE));
      return api<Paginated<CommissionDetailRow>>(
        'GET',
        `/api/v2/billing/commission-detail?${params.toString()}`,
      );
    },
    onSuccess: (data) => {
      setDetailResult(data);
      setGenerated(true);
    },
    onError: () => {
      toast.error('Failed to load commission detail');
    },
  });

  const exportDetail = useMutation({
    mutationFn: (fmt: 'xlsx' | 'csv') => {
      const req: ExportRequest = {
        format: fmt,
        mode: 'all',
        ...(search ? { search } : {}),
      };
      const p = exportQueryToParams(req);
      buildSharedParams(p);
      return apiExport(`/api/v2/billing/commission-detail/export?${p.toString()}`);
    },
    onSuccess: onExportSuccess,
    onError: () => {
      toast.error('Export failed');
    },
  });

  const isDetail = view === 'detail';
  const activeGenerate = isDetail ? generateDetail : generate;
  const activeExport = isDetail ? exportDetail : exportSummary;

  const handleGenerate = () => {
    setPage(1);
    activeGenerate.mutate();
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    activeGenerate.mutate();
  };

  if (!has('billing.commission_summary.view'))
    return <div className="text-destructive">You don&apos;t have access to Commission Summary.</div>;

  const rows = result?.items ?? [];
  const detailRows = detailResult?.items ?? [];
  const totalCount = isDetail ? (detailResult?.totalCount ?? 0) : (result?.totalCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / DEFAULT_PAGE_SIZE));
  const splitCols = groupBy === 'agentClientProduct' || groupBy === 'agentClientProductRateType';
  const rateTypeCols = groupBy === 'agentClientProductRateType';
  // 4 base (Agent, Period, Tasks, Billable Units) + Bill Total; +2 client/product; +2 rate-type.
  const colCount = 5 + (splitCols ? 2 : 0) + (rateTypeCols ? 2 : 0);
  const detailColCount = 14;

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
            <span className="mb-1 block text-xs font-medium text-foreground">View</span>
            <select
              className="input"
              aria-label="Select view"
              value={view}
              onChange={(e) => {
                setView(e.target.value as 'summary' | 'detail');
                resetResult();
              }}
            >
              <option value="summary">Summary</option>
              <option value="detail">Detail (per task)</option>
            </select>
          </label>

          {!isDetail && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">Period</span>
                <select
                  className="input"
                  aria-label="Select period"
                  value={period}
                  onChange={(e) => {
                    setPeriod(e.target.value as CommissionPeriod);
                    resetResult();
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
                    resetResult();
                  }}
                >
                  <option value="agent">By agent</option>
                  <option value="agentClientProduct">By agent + client + product</option>
                  <option value="agentClientProductRateType">By agent + client + product + rate type</option>
                </select>
              </label>
            </>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Client</span>
            <select
              className="input"
              aria-label="Select client"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                resetResult();
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
                resetResult();
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
            <Button loading={activeGenerate.isPending} onClick={handleGenerate}>
              Generate
            </Button>

            {generated && (
              <>
                <Button
                  variant="secondary"
                  disabled={activeExport.isPending}
                  onClick={() => activeExport.mutate('xlsx')}
                >
                  <DownloadIcon />
                  Export XLSX
                </Button>
                <Button
                  variant="secondary"
                  disabled={activeExport.isPending}
                  onClick={() => activeExport.mutate('csv')}
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
      {activeGenerate.isPending && (
        <HexagonLoader operation={isDetail ? 'Loading commission detail' : 'Loading commission summary'} />
      )}

      {!activeGenerate.isPending && generated && (
        <div className="rounded-lg border border-border bg-card">
          <ScrollRegion label={isDetail ? 'Commission detail results' : 'Commission summary results'}>
            {isDetail ? (
              <table className="rtable w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Earned On
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Agent
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Client
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Unit
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Case
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Task
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Visit Type
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Client Rate Type
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Field Rate Type
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Client Bill
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Commission
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Bill Count
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-muted-foreground" colSpan={detailColCount}>
                        No results for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    detailRows.map((row) => (
                      <tr key={row.taskId} className="border-t border-border hover:bg-surface-muted">
                        <td data-label="Earned On" className="px-3 py-2">
                          {row.earnedOn ?? '—'}
                        </td>
                        <td data-label="Agent" className="px-3 py-2">
                          {row.agentName}
                        </td>
                        <td data-label="Client" className="px-3 py-2">
                          {row.clientName}
                        </td>
                        <td data-label="Product" className="px-3 py-2">
                          {row.productName}
                        </td>
                        <td data-label="Unit" className="px-3 py-2">
                          {row.unitName}
                        </td>
                        <td data-label="Case" className="px-3 py-2">
                          {row.caseNumber}
                        </td>
                        <td data-label="Task" className="px-3 py-2">
                          {row.taskNumber}
                        </td>
                        <td data-label="Visit Type" className="px-3 py-2">
                          {row.visitType ?? '—'}
                        </td>
                        <td data-label="Client Rate Type" className="px-3 py-2">
                          {row.clientRateType ?? '—'}
                        </td>
                        <td data-label="Field Rate Type" className="px-3 py-2">
                          {row.fieldRateType ?? '—'}
                        </td>
                        <td data-label="Client Bill" className="px-3 py-2">
                          {row.billAmount === null ? '—' : formatMoney(row.billAmount)}
                        </td>
                        <td data-label="Commission" className="px-3 py-2">
                          {row.commissionAmount === null ? '—' : formatMoney(row.commissionAmount)}
                        </td>
                        <td data-label="Bill Count" className="px-3 py-2">
                          {row.billCount}
                        </td>
                        <td data-label="Status" className="px-3 py-2">
                          {row.status}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
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
                    {rateTypeCols && (
                      <>
                        <th scope="col" className="px-3 py-2 font-semibold">
                          Client Rate Type
                        </th>
                        <th scope="col" className="px-3 py-2 font-semibold">
                          Field Rate Type
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
                      Bill Total
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
                        {rateTypeCols && (
                          <>
                            <td data-label="Client Rate Type" className="px-3 py-2">
                              {row.clientRateType ?? '—'}
                            </td>
                            <td data-label="Field Rate Type" className="px-3 py-2">
                              {row.fieldRateType ?? '—'}
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
                        <td data-label="Bill Total" className="px-3 py-2">
                          {formatMoney(row.billTotal)}
                        </td>
                        <td data-label="Commission Total" className="px-3 py-2">
                          {formatMoney(row.commissionTotal)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
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
          {totalCount <= DEFAULT_PAGE_SIZE && (isDetail ? detailRows.length : rows.length) > 0 && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {totalCount} row{totalCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
