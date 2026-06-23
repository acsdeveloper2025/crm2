import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pageQueryToParams, type PageQuery, type Paginated, type Policy } from '@crm2/sdk';
import { api, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { formatDateTime } from '../../lib/format.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { Button } from '../../components/ui/Button.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

export function PoliciesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Mirror the server write guard (policy.manage) so viewers don't see write controls (H-1).
  const { has } = useAuth();
  const canManage = has('policy.manage');
  const [toggleConflict, setToggleConflict] = useState<Policy | null>(null);

  const toggle = useMutation({
    mutationFn: (p: Policy) =>
      api<Policy>(
        'POST',
        `/api/v2/policies/${p.id}/${p.isActive ? 'deactivate' : 'activate'}`,
        { version: p.version }, // OCC: (de)activation is a version-guarded edit (ADR-0019)
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
    onError: (e: unknown, p: Policy) => {
      if (isStale(e)) setToggleConflict(p);
    },
  });

  const columns = useMemo<DataGridColumn<Policy>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        cell: (p) => <span className="font-mono text-xs">{p.code}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (p) => p.name },
      {
        id: 'contentVersion',
        header: 'Version',
        sortable: true,
        cell: (p) => <span className="text-xs text-muted-foreground">{p.contentVersion}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (p) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTime(p.effectiveFrom)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (p) => <StatusChip isActive={p.isActive} effectiveFrom={p.effectiveFrom} />,
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (p: Policy) => (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/policies/${p.id}`)}>
                    Edit
                  </Button>
                  <Button
                    variant={p.isActive ? 'destructive' : 'secondary'}
                    size="sm"
                    onClick={() => toggle.mutate(p)}
                  >
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ),
            } satisfies DataGridColumn<Policy>,
          ]
        : []),
    ],
    [toggle, canManage],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Policies</h1>
          <p className="text-sm text-muted-foreground">
            Admin-managed, versioned policies every user must accept at login.
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && <Button onClick={() => navigate('/admin/policies/new')}>+ New Policy</Button>}
        </div>
      </div>

      <DataGrid<Policy>
        columns={columns}
        queryKey="policies"
        rowId={(p) => p.id}
        defaultSort="createdAt"
        searchPlaceholder="Search code or name…"
        fetchPage={(query: PageQuery) =>
          api<Paginated<Policy>>('GET', `/api/v2/policies?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[{ id: 'effectiveFrom', label: 'Effective From' }]}
      />

      {toggleConflict && (
        <ConflictDialog
          entityLabel="policy"
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: ['policies'] });
            setToggleConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['policies'] });
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}
