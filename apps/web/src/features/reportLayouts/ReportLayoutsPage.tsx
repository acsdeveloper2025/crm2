import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  pageQueryToParams,
  LAYOUT_KINDS,
  type LayoutKind,
  type ReportLayout,
  type ReportLayoutView,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { toast } from 'sonner';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

const KIND_LABEL: Record<LayoutKind, string> = {
  DATA_ENTRY: 'Data Entry',
  MIS: 'MIS',
  BILLING_MIS: 'Billing MIS',
  // FIELD_REPORT layouts are authored in the Field Report designer (S2); listed here for completeness.
  FIELD_REPORT: 'Field Report',
  // CASE_REPORT layouts are authored in the Case Report designer (S5 slice 3); placeholder label.
  CASE_REPORT: 'Case Report',
};

// Enum filter options for the `kind` column — reuse KIND_LABEL so the dropdown labels match the cell.
const LAYOUT_KIND_OPTIONS = LAYOUT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));

/** MIS Layouts (ADR-0037) — per-(client,product) data-entry / MIS / Billing-MIS column config.
 *  Admin only (report_template.manage). No default format; every layout is built from blank. */
export function ReportLayoutsPage() {
  // Mirror the server write guard (report_template.manage) via the shared useAuth().has (H-1).
  const { has } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const toggle = useMutation({
    mutationFn: (r: ReportLayoutView) =>
      api<ReportLayout>('POST', `/api/v2/report-layouts/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-layouts'] }),
    onError: (e: unknown) =>
      toast.error(
        isStale(e)
          ? 'This layout changed — reload and retry.'
          : e instanceof ApiError
            ? e.code === 'REPORT_LAYOUT_EXISTS'
              ? 'Another active layout exists for this client + product + kind.'
              : e.code
            : 'Update failed',
      ),
  });

  const columns = useMemo<DataGridColumn<ReportLayoutView>[]>(
    () => [
      { id: 'client', header: 'Client', sortable: true, filterable: true, cell: (r) => r.clientName },
      { id: 'product', header: 'Product', sortable: true, filterable: true, cell: (r) => r.productName },
      {
        id: 'kind',
        header: 'Kind',
        sortable: true,
        filterable: true,
        filterOptions: LAYOUT_KIND_OPTIONS,
        cell: (r) => <span className="text-xs uppercase">{KIND_LABEL[r.kind]}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (r) => r.name },
      { id: 'columns', header: 'Columns', align: 'right', cell: (r) => r.columnCount },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${r.isActive ? 'bg-st-approved-bg text-st-approved' : 'bg-surface-muted text-muted-foreground'}`}
          >
            {r.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (r) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</span>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (r) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.updatedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: (r) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/report-layouts/${r.id}`)}>
              Edit
            </Button>
            <Button
              variant={r.isActive ? 'destructive' : 'secondary'}
              size="sm"
              onClick={() => toggle.mutate(r)}
            >
              {r.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle],
  );

  if (!has('report_template.manage'))
    return <div className="text-destructive">You don’t have access to MIS Layouts.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">MIS Layouts</h1>
          <p className="text-sm text-muted-foreground">
            Per client + product layouts — Data Entry, MIS, Billing MIS columns and Field Report narrative
            templates — built from blank, no default format.
          </p>
        </div>
        <Button onClick={() => navigate('/admin/report-layouts/new')}>New Layout</Button>
      </div>

      <DataGrid<ReportLayoutView>
        columns={columns}
        queryKey="report-layouts"
        rowId={(r) => String(r.id)}
        defaultSort="updatedAt"
        defaultSortOrder="desc"
        searchPlaceholder="Search client, product or name…"
        fetchPage={(query: PageQuery) =>
          api<Paginated<ReportLayoutView>>(
            'GET',
            `/api/v2/report-layouts?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'updatedAt', label: 'Updated' },
        ]}
        loadingLabel="MIS Layouts"
      />
    </div>
  );
}
