import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CASE_STATUSES, pageQueryToParams, type CaseView, type PageQuery, type Paginated } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';

const STATUS_OPTIONS = CASE_STATUSES.map((s) => ({
  value: s,
  label: s
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' '),
}));

export function CasesPage() {
  const navigate = useNavigate();
  const { has } = useAuth();

  const columns = useMemo<DataGridColumn<CaseView>[]>(
    () => [
      {
        id: 'caseNumber',
        header: 'Case No',
        sortable: true,
        filterable: true,
        cell: (c) => <span className="font-mono text-xs">{c.caseNumber}</span>,
      },
      {
        id: 'primaryName',
        header: 'Customer',
        label: 'Customer',
        sortable: true,
        filterable: true,
        cell: (c) => c.primaryName,
      },
      { id: 'clientName', header: 'Client', sortable: true, cell: (c) => c.clientName },
      { id: 'productName', header: 'Product', sortable: true, cell: (c) => c.productName },
      {
        id: 'taskCount',
        header: 'Tasks',
        align: 'right',
        cell: (c) => <span className="tabular-nums">{c.taskCount}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        filterable: true,
        filterOptions: STATUS_OPTIONS,
        cell: (c) => c.status.replace(/_/g, ' '),
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (c) => <span className="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Cases</h1>
          <p className="text-sm text-muted-foreground">Verification cases across all clients.</p>
        </div>
        {has('case.create') && (
          <button className="btn" onClick={() => navigate('/cases/new')}>
            + New Case
          </button>
        )}
      </div>

      <DataGrid<CaseView>
        columns={columns}
        queryKey="cases"
        rowId={(c) => c.id}
        defaultSort="createdAt"
        defaultSortOrder="desc"
        searchPlaceholder="Search customer or case no…"
        onRowClick={(c) => navigate(`/cases/${c.id}`)}
        fetchPage={(query: PageQuery) =>
          api<Paginated<CaseView>>('GET', `/api/v2/cases?${pageQueryToParams(query).toString()}`)
        }
      />
    </div>
  );
}
