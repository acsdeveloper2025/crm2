import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  type CommissionRate,
  type CommissionRateView,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { Button } from '../../components/ui/Button.js';
import { toast } from 'sonner';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/** Commission Rates (ADR-0036) — per-user agent-commission config. SUPER_ADMIN only (comp data). */
export function CommissionRatesPage() {
  const navigate = useNavigate();
  // Mirror the server write guard (masterdata.manage) so viewers don't see write controls (H-1).
  const { has } = useAuth();
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
      { id: 'user', header: 'User', sortable: true, filterable: true, cell: (r) => r.userName },
      {
        id: 'client',
        header: 'Client',
        sortable: true,
        filterable: true,
        cell: (r) => r.clientName ?? <span className="text-muted-foreground">Universal</span>,
      },
      {
        id: 'fieldRateType',
        header: 'Rate Type',
        sortable: true,
        filterable: true,
        cell: (r) =>
          r.fieldRateType ? (
            <span className="text-xs uppercase">{r.fieldRateType}</span>
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
        cell: (r) => <span className="tabular-nums">{formatMoney(r.amount)}</span>,
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/admin/commission-rates/${r.id}`)}
              >
                Revise
              </Button>
            )}
            <Button
              variant={r.isActive ? 'destructive' : 'secondary'}
              size="sm"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(r)}
            >
              {r.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle, navigate],
  );

  if (!has('masterdata.manage'))
    return <div className="text-destructive">You don’t have access to Commission Rates.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Commission Rates</h1>
          <p className="text-sm text-muted-foreground">
            Per-executive commission tariff. Required: user, location (pincode/area) &amp; rate type
            (LOCAL/OGL). Client, product, unit &amp; TAT band can be Universal (matches any). Most-specific
            row wins. The amount source for the Billing &amp; Commission view.
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
          <Button onClick={() => navigate('/admin/commission-rates/new')}>+ New Commission Rate</Button>
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
    </div>
  );
}
