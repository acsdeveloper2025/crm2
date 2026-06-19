import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  exportQueryToParams,
  type Option,
  type MisColumn,
  type MisRowsResponse,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { toast } from 'sonner';

const DEFAULT_PAGE_SIZE = 50;

/** MIS Report (ADR-0037) — layout-driven tabular view of completed tasks, scoped to the actor.
 *  Columns are server-authoritative; money columns are absent for users without billing.view. */
export function MisPage() {
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));

  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [completedFrom, setCompletedFrom] = useState('');
  const [completedTo, setCompletedTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Result state: set on Generate, cleared on filter change.
  const [result, setResult] = useState<MisRowsResponse | null>(null);
  const [generated, setGenerated] = useState(false);

  const clientOpts = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const productOpts = useQuery({
    queryKey: ['product-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  const canGenerate = clientId !== '' && productId !== '';

  const generate = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      params.set('clientId', clientId);
      params.set('productId', productId);
      if (completedFrom) params.set('completedFrom', completedFrom);
      if (completedTo) params.set('completedTo', completedTo);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('pageSize', String(DEFAULT_PAGE_SIZE));
      return api<MisRowsResponse>('GET', `/api/v2/mis/rows?${params.toString()}`);
    },
    onSuccess: (data) => {
      setResult(data);
      setGenerated(true);
    },
    onError: () => {
      toast.error('Failed to load MIS data');
    },
  });

  const exportMis = useMutation({
    mutationFn: (fmt: 'xlsx' | 'csv') => {
      const req: ExportRequest = {
        format: fmt,
        mode: 'all',
        ...(search ? { search } : {}),
      };
      const p = exportQueryToParams(req);
      p.set('clientId', clientId);
      p.set('productId', productId);
      if (completedFrom) p.set('completedFrom', completedFrom);
      if (completedTo) p.set('completedTo', completedTo);
      return apiExport(`/api/v2/mis/export?${p.toString()}`);
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

  if (!has('page.mis')) return <div className="text-destructive">You don&apos;t have access to MIS.</div>;

  const columns: MisColumn[] = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const totalCount = result?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / DEFAULT_PAGE_SIZE));
  const noLayout = generated && columns.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">MIS</h1>
        <p className="text-sm text-muted-foreground">
          Layout-driven management information report for completed tasks. Select a client and product, then
          click Generate.
        </p>
      </div>

      {/* Filter form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Client</span>
            <select
              className="input"
              aria-label="Select client"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProductId('');
                setGenerated(false);
                setResult(null);
              }}
            >
              <option value="">Select client…</option>
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
              disabled={clientId === ''}
              onChange={(e) => {
                setProductId(e.target.value);
                setGenerated(false);
                setResult(null);
              }}
            >
              <option value="">{clientId === '' ? 'Select client first' : 'Select product…'}</option>
              {(productOpts.data ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Completed from</span>
            <input
              type="date"
              className="input"
              aria-label="Completed from date"
              value={completedFrom}
              onChange={(e) => setCompletedFrom(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Completed to</span>
            <input
              type="date"
              className="input"
              aria-label="Completed to date"
              value={completedTo}
              onChange={(e) => setCompletedTo(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-foreground">Search</span>
            <input
              className="input"
              placeholder="Case number, client, product, task…"
              aria-label="Search MIS"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canGenerate) handleGenerate();
              }}
            />
          </label>

          <div className="flex gap-2 pb-0.5">
            <button className="btn" disabled={!canGenerate || generate.isPending} onClick={handleGenerate}>
              {generate.isPending ? 'Loading…' : 'Generate'}
            </button>

            {generated && columns.length > 0 && (
              <>
                <button
                  className="btn-ghost"
                  disabled={exportMis.isPending}
                  onClick={() => exportMis.mutate('xlsx')}
                >
                  Export XLSX
                </button>
                <button
                  className="btn-ghost"
                  disabled={exportMis.isPending}
                  onClick={() => exportMis.mutate('csv')}
                >
                  Export CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {generate.isPending && <HexagonLoader operation="Loading MIS" />}

      {noLayout && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No MIS layout configured for this client + product. Configure one in MIS Layouts (Admin).
          </p>
        </div>
      )}

      {!generate.isPending && generated && columns.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="rtable w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  {columns.map((col) => (
                    <th key={col.key} className="px-3 py-2 font-semibold">
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground" colSpan={columns.length}>
                      No results for the selected filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-border hover:bg-surface-muted">
                      {columns.map((col) => {
                        const val = row[col.key];
                        return (
                          <td key={col.key} data-label={col.header} className="px-3 py-2">
                            {val === null || val === undefined ? '—' : String(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalCount > DEFAULT_PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <span>
                {totalCount} total · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button className="btn-ghost" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                  Previous
                </button>
                <button
                  className="btn-ghost"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </button>
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
