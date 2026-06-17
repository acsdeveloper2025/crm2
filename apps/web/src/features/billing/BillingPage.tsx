import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  type Option,
  type BillingCaseRow,
  type BillingTaskLine,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

const money = (n: number | null) => (n === null ? '—' : `₹${n.toFixed(2)}`);

/**
 * Inline per-case detail (DATAGRID accordion): the COMPLETED-task billing lines for one case,
 * lazy-loaded on expand. Owner's no-empty-pane rule → detail renders below the row, not a side pane.
 */
function BillingCaseLines({ caseId }: { caseId: string }) {
  const q = useQuery({
    queryKey: ['billing-case-tasks', caseId],
    queryFn: () => api<BillingTaskLine[]>('GET', `/api/v2/billing/cases/${caseId}/tasks`),
  });
  if (q.isLoading) return <HexagonLoader operation="Loading Billing Lines" />;
  const lines = q.data ?? [];
  if (lines.length === 0) return <div className="p-3 text-sm text-muted-foreground">No completed tasks.</div>;
  const billSum = lines.reduce((s, l) => s + (l.billAmount ?? 0), 0);
  const commSum = lines.reduce((s, l) => s + (l.commissionAmount ?? 0), 0);
  return (
    <table className="rtable w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          <th className="py-1">Task</th>
          <th className="py-1">Verification Unit</th>
          <th className="py-1">Assignee</th>
          <th className="py-1">Class</th>
          <th className="py-1">Rate Type</th>
          <th className="py-1 text-right">Bill</th>
          <th className="py-1 text-right">Commission</th>
          <th className="py-1">Completed</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.taskId} className="border-t border-border">
            <td data-label="Task" className="py-1 font-medium">
              {l.taskNumber}
            </td>
            <td data-label="Verification Unit" className="py-1">
              {l.unitName}
            </td>
            <td data-label="Assignee" className="py-1">
              {l.assigneeName ?? '—'}
            </td>
            <td data-label="Class" className="py-1 text-xs uppercase">
              {l.billingClass}
            </td>
            <td data-label="Rate Type" className="py-1 text-xs uppercase">
              {l.rateType ?? '—'}
            </td>
            <td data-label="Bill" className="py-1 text-right tabular-nums">
              {money(l.billAmount)}
            </td>
            <td data-label="Commission" className="py-1 text-right tabular-nums">
              {money(l.commissionAmount)}
            </td>
            <td data-label="Completed" className="py-1">
              {l.completedAt ? formatDateTime(l.completedAt) : '—'}
            </td>
          </tr>
        ))}
        <tr className="border-t-2 border-border font-semibold">
          <td className="py-1" colSpan={5}>
            Case total
          </td>
          <td className="py-1 text-right tabular-nums">{money(billSum)}</td>
          <td className="py-1 text-right tabular-nums">{money(commSum)}</td>
          <td className="py-1" />
        </tr>
      </tbody>
    </table>
  );
}

/** Billing & Commission (ADR-0036) — per-case client billing + agent commission over completed tasks. */
export function BillingPage() {
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
  const [clientId, setClientId] = useState('');
  const clientOpts = useQuery({
    queryKey: ['client-options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const columns = useMemo<DataGridColumn<BillingCaseRow>[]>(
    () => [
      {
        id: 'caseNumber',
        header: 'Case',
        sortable: true,
        cell: (r) => <span className="whitespace-nowrap font-medium">{r.caseNumber}</span>,
      },
      { id: 'client', header: 'Client', sortable: true, cell: (r) => r.clientName },
      { id: 'product', header: 'Product', sortable: true, cell: (r) => r.productName },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => <span className="text-xs uppercase">{r.status.replace(/_/g, ' ')}</span>,
      },
      {
        id: 'completedTaskCount',
        header: 'Completed',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{r.completedTaskCount}</span>,
      },
      {
        id: 'billTotal',
        header: 'Bill Total',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{money(r.billTotal)}</span>,
      },
      {
        id: 'commissionTotal',
        header: 'Commission',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{money(r.commissionTotal)}</span>,
      },
      {
        id: 'lastCompletedAt',
        header: 'Last Completed',
        sortable: true,
        cell: (r) => (r.lastCompletedAt ? formatDateTime(r.lastCompletedAt) : '—'),
      },
    ],
    [],
  );

  if (!has('billing.view')) return <div className="text-destructive">You don’t have access to Billing.</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Billing &amp; Commission</h1>
        <p className="text-sm text-muted-foreground">
          Per-case client billing and agent commission over completed tasks. Expand a case to see its per-task
          lines.
        </p>
      </div>
      <DataGrid<BillingCaseRow>
        columns={columns}
        queryKey="billing-cases"
        rowId={(r) => r.caseId}
        defaultSort="lastCompletedAt"
        defaultSortOrder="desc"
        searchPlaceholder="Search case, client, product…"
        filters={{ clientId: clientId || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<BillingCaseRow>>(
            'GET',
            `/api/v2/billing/cases?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[{ id: 'completedAt', label: 'Completed' }]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/billing/cases/export?${exportQueryToParams(req).toString()}`)
        }
        renderExpanded={(r) => <BillingCaseLines caseId={r.caseId} />}
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
