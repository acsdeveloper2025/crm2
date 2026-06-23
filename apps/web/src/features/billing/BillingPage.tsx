import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  pageQueryToParams,
  exportQueryToParams,
  type Option,
  type BillingCaseRow,
  type BillingTaskLine,
  type BillingBreakdown,
  type PageQuery,
  type Paginated,
  type ExportRequest,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';

/** Line total = per-unit amount × billable-units (ADR-0046 §5 / G-2). */
const lineMoney = (amount: number | null, count: number) =>
  formatMoney(amount === null ? null : amount * count);
/** Completed-in TAT band label: -1 = completed outside every band; null = not derivable. */
const bandLabel = (b: number | null) => (b == null ? '—' : b === -1 ? 'Out of band' : `≤${b}h`);

/**
 * Inline per-case detail (DATAGRID accordion): the COMPLETED-task billing lines for one case,
 * lazy-loaded on expand. Owner's no-empty-pane rule → detail renders below the row, not a side pane.
 * Bill/Commission are shown as line totals (per-unit amount × bill_count).
 */
function BillingCaseLines({ caseId }: { caseId: string }) {
  const q = useQuery({
    queryKey: ['billing-case-tasks', caseId],
    queryFn: () => api<BillingTaskLine[]>('GET', `/api/v2/billing/cases/${caseId}/tasks`),
  });
  if (q.isLoading) return <HexagonLoader operation="Loading Billing Lines" />;
  const lines = q.data ?? [];
  if (lines.length === 0) return <div className="p-3 text-sm text-muted-foreground">No completed tasks.</div>;
  const billSum = lines.reduce((s, l) => s + (l.billAmount ?? 0) * l.billCount, 0);
  const commSum = lines.reduce((s, l) => s + (l.commissionAmount ?? 0) * l.billCount, 0);
  return (
    <table className="rtable w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          <th scope="col" className="py-1">
            Task
          </th>
          <th scope="col" className="py-1">
            Verification Unit
          </th>
          <th scope="col" className="py-1">
            Assignee
          </th>
          <th scope="col" className="py-1">
            Class
          </th>
          <th scope="col" className="py-1">
            Rate Type
          </th>
          <th scope="col" className="py-1 text-right">
            TAT Band
          </th>
          <th scope="col" className="py-1 text-right">
            Units
          </th>
          <th scope="col" className="py-1 text-right">
            Bill
          </th>
          <th scope="col" className="py-1 text-right">
            Commission
          </th>
          <th scope="col" className="py-1">
            Completed
          </th>
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
              {l.clientRateType ?? '—'}
            </td>
            <td data-label="TAT Band" className="py-1 text-right">
              {bandLabel(l.tatBand)}
            </td>
            <td data-label="Units" className="py-1 text-right tabular-nums">
              {l.billCount}
            </td>
            <td data-label="Bill" className="py-1 text-right tabular-nums">
              {lineMoney(l.billAmount, l.billCount)}
            </td>
            <td data-label="Commission" className="py-1 text-right tabular-nums">
              {lineMoney(l.commissionAmount, l.billCount)}
            </td>
            <td data-label="Completed" className="py-1">
              {l.completedAt ? formatDateTime(l.completedAt) : '—'}
            </td>
          </tr>
        ))}
        <tr className="border-t-2 border-border font-semibold">
          <td className="py-1" colSpan={7}>
            Case total
          </td>
          <td className="py-1 text-right tabular-nums">{formatMoney(billSum)}</td>
          <td className="py-1 text-right tabular-nums">{formatMoney(commSum)}</td>
          <td className="py-1" />
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Breakdown panels (ADR-0046 §6): completed-task bill/commission grouped by pincode/area and by the
 * completed-in TAT band, over the currently selected client filter. Amounts are bill_count-weighted.
 */
function BillingBreakdownPanels({ clientId }: { clientId: string }) {
  const q = useQuery({
    queryKey: ['billing-breakdown', clientId],
    queryFn: () =>
      api<BillingBreakdown>('GET', `/api/v2/billing/breakdown${clientId ? `?clientId=${clientId}` : ''}`),
  });
  if (q.isLoading) return <HexagonLoader operation="Loading Breakdown" />;
  const data = q.data ?? { byLocation: [], byBand: [] };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">By pincode / area</h2>
        <table className="rtable w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th scope="col" className="py-1">
                Location
              </th>
              <th scope="col" className="py-1 text-right">
                Tasks
              </th>
              <th scope="col" className="py-1 text-right">
                Units
              </th>
              <th scope="col" className="py-1 text-right">
                Bill
              </th>
              <th scope="col" className="py-1 text-right">
                Commission
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byLocation.length === 0 ? (
              <tr>
                <td className="py-2 text-muted-foreground" colSpan={5}>
                  No completed tasks.
                </td>
              </tr>
            ) : (
              data.byLocation.map((g) => (
                <tr key={g.locationId ?? 'unmapped'} className="border-t border-border">
                  <td data-label="Location" className="py-1">
                    {g.pincode || g.area ? `${g.pincode ?? ''} ${g.area ?? ''}`.trim() : 'Unmapped'}
                  </td>
                  <td data-label="Tasks" className="py-1 text-right tabular-nums">
                    {g.completedTaskCount}
                  </td>
                  <td data-label="Units" className="py-1 text-right tabular-nums">
                    {g.billableUnits}
                  </td>
                  <td data-label="Bill" className="py-1 text-right tabular-nums">
                    {formatMoney(g.billTotal)}
                  </td>
                  <td data-label="Commission" className="py-1 text-right tabular-nums">
                    {formatMoney(g.commissionTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">By completed-in TAT band</h2>
        <table className="rtable w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th scope="col" className="py-1">
                Band
              </th>
              <th scope="col" className="py-1 text-right">
                Tasks
              </th>
              <th scope="col" className="py-1 text-right">
                Units
              </th>
              <th scope="col" className="py-1 text-right">
                Bill
              </th>
              <th scope="col" className="py-1 text-right">
                Commission
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byBand.length === 0 ? (
              <tr>
                <td className="py-2 text-muted-foreground" colSpan={5}>
                  No completed tasks.
                </td>
              </tr>
            ) : (
              data.byBand.map((g) => (
                <tr key={g.band ?? 'none'} className="border-t border-border">
                  <td data-label="Band" className="py-1">
                    {bandLabel(g.band)}
                  </td>
                  <td data-label="Tasks" className="py-1 text-right tabular-nums">
                    {g.completedTaskCount}
                  </td>
                  <td data-label="Units" className="py-1 text-right tabular-nums">
                    {g.billableUnits}
                  </td>
                  <td data-label="Bill" className="py-1 text-right tabular-nums">
                    {formatMoney(g.billTotal)}
                  </td>
                  <td data-label="Commission" className="py-1 text-right tabular-nums">
                    {formatMoney(g.commissionTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Billing & Commission (ADR-0046) — per-case client billing + per-executive commission over completed
 *  tasks, with per-pincode/area + completed-in-band breakdowns. */
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
        id: 'billableUnits',
        header: 'Units',
        align: 'right',
        cell: (r) => <span className="tabular-nums">{r.billableUnits}</span>,
      },
      {
        id: 'billTotal',
        header: 'Bill Total',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{formatMoney(r.billTotal)}</span>,
      },
      {
        id: 'commissionTotal',
        header: 'Commission',
        sortable: true,
        align: 'right',
        cell: (r) => <span className="tabular-nums">{formatMoney(r.commissionTotal)}</span>,
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
          Per-case client billing and per-executive commission over completed tasks (bill_count-weighted).
          Expand a case for its per-task lines; the breakdowns below group by location and completed-in TAT
          band.
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
      <BillingBreakdownPanels clientId={clientId} />
    </div>
  );
}
