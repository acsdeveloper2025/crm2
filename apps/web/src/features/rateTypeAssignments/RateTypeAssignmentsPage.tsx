import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  type RateTypeAssignment,
  type RateTypeAssignmentView,
  type PageQuery,
  type Paginated,
  type ExportRequest,
  type BulkResult,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn, type BulkSelection } from '../../components/ui/data-grid/index.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { Button } from '../../components/ui/Button.js';
import { toast } from 'sonner';

/**
 * Bulk "Deactivate selected" for the RTA grid (UX-11). RTA has no version column (no per-row OCC —
 * unlike `BulkStatusActions`, which requires it), so this is deactivate-only and sends bare ids;
 * mirrors `BulkStatusActions`'s shape (busy/message/clear-on-clean-run) with the OCC parts dropped.
 * Inlined here rather than a shared component — RTA is the only no-OCC bulk-selectable resource today.
 */
function RtaBulkDeactivate({ selection }: { selection: BulkSelection<RateTypeAssignmentView> }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const ids = selection.rows.map((r) => r.id);
      const res = await api<BulkResult>('POST', '/api/v2/rate-type-assignments/bulk-deactivate', { ids });
      qc.invalidateQueries({ queryKey: ['rate-type-assignments'] });
      const parts = [`${res.okCount} deactivated`];
      if (res.notFoundCount) parts.push(`${res.notFoundCount} not found`);
      setMessage(parts.join(' · '));
      if (!res.notFoundCount) selection.clear();
    } catch {
      setMessage('Bulk deactivate failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (selection.allMatching)
    return <span className="text-xs text-muted-foreground">Tick individual rows to deactivate.</span>;

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        disabled={selection.rows.length === 0 || busy}
        loading={busy}
        onClick={() => void run()}
      >
        Deactivate selected
      </Button>
      {message && (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </>
  );
}

/** Rate Type Assignments (ADR-0067 / ADR-0069) — which rate type a (client × product × unit) combo may
 *  use. Standard CRUD master data (mirrors Commission Rates): page.masterdata to view, masterdata.manage
 *  to write. Product/Unit render "Universal" when null (applies to all). */
export function RateTypeAssignmentsPage() {
  const navigate = useNavigate();
  // Mirror the server write guard so viewers don't see write controls.
  const { has } = useAuth();
  const canManage = has('masterdata.manage');
  const [active, setActive] = useState('');
  const qc = useQueryClient();
  // Per-row deactivate (soft toggle; re-creating the same combo re-activates it — there is no activate route).
  const deactivate = useMutation({
    mutationFn: (r: RateTypeAssignmentView) =>
      api<RateTypeAssignment>('POST', `/api/v2/rate-type-assignments/${r.id}/deactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rate-type-assignments'] }),
    onError: (e: unknown) => toast.error(e instanceof ApiError ? e.code : 'Update failed'),
  });
  const columns = useMemo<DataGridColumn<RateTypeAssignmentView>[]>(
    () => [
      {
        id: 'client',
        header: 'Client',
        sortable: true,
        filterable: true,
        cell: (r) => r.clientName ?? r.clientCode,
      },
      {
        id: 'product',
        header: 'Product',
        sortable: true,
        filterable: true,
        cell: (r) =>
          r.productName ? (
            `${r.productCode ?? ''} ${r.productName}`.trim()
          ) : (
            <span className="text-muted-foreground">Universal</span>
          ),
      },
      {
        id: 'verificationUnit',
        header: 'Unit',
        sortable: true,
        filterable: true,
        cell: (r) => r.verificationUnitName ?? <span className="text-muted-foreground">Universal</span>,
      },
      {
        id: 'rateType',
        header: 'Rate Type',
        sortable: true,
        filterable: true,
        cell: (r) => <span className="text-xs uppercase">{r.rateTypeCode}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => <span className="text-xs uppercase">{r.isActive ? 'Active' : 'Inactive'}</span>,
      },
      { id: 'createdAt', header: 'Created', sortable: true, cell: (r) => formatDateTime(r.createdAt) },
      { id: 'updatedAt', header: 'Updated', sortable: true, cell: (r) => formatDateTime(r.updatedAt) },
      {
        id: 'actions',
        header: '',
        hideable: false,
        align: 'right',
        cell: (r) =>
          canManage ? (
            <div className="flex justify-end gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/admin/rate-type-assignments/${r.id}`)}
              >
                Edit
              </Button>
              {r.isActive && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deactivate.isPending}
                  onClick={() => deactivate.mutate(r)}
                >
                  Deactivate
                </Button>
              )}
            </div>
          ) : null,
      },
    ],
    [deactivate, navigate, canManage],
  );

  if (!has('page.masterdata'))
    return <div className="text-destructive">You don’t have access to Rate Type Assignments.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Rate Type Assignments</h1>
          <p className="text-sm text-muted-foreground">
            Which rate type a Client × Product × Verification Unit combination may use. Required: client &amp;
            rate type. Product and unit can be Universal (matches any). The source for the rate-type picker on
            case creation.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <ImportButton
              config={{
                basePath: '/api/v2/rate-type-assignments',
                queryKey: 'rate-type-assignments',
                entityLabel: 'rate type assignment',
              }}
            />
            <Button onClick={() => navigate('/admin/rate-type-assignments/new')}>+ New Assignment</Button>
          </div>
        )}
      </div>
      <DataGrid<RateTypeAssignmentView>
        columns={columns}
        queryKey="rate-type-assignments"
        rowId={(r) => r.id}
        selectable={canManage}
        bulkActions={(sel) => <RtaBulkDeactivate selection={sel} />}
        defaultSort="client"
        searchPlaceholder="Search client, product, unit, rate type…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<RateTypeAssignmentView>>(
            'GET',
            `/api/v2/rate-type-assignments?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[{ id: 'createdAt', label: 'Created' }]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/rate-type-assignments/export?${exportQueryToParams(req).toString()}`)
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
