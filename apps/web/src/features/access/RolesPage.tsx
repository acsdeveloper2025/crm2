import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type RoleHierarchyMode,
  type RoleView,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { formatDateTime } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

const BASE = '/api/v2/roles';
const QK = 'roles';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

const MODE_LABELS: Record<RoleHierarchyMode, string> = {
  ALL: 'All data',
  SUBTREE: 'Own subtree',
  DIRECT_TEAM: 'Direct team',
  SELF: 'Self only',
};

export function RolesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Mirror the server write guard (role.manage) so viewers don't see write controls (H-1).
  const { has } = useAuth();
  const canManage = has('role.manage');
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<RoleView | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  // Focus-trap the "Cannot deactivate" alert while it's open (a11y) — the hook no-ops when inactive.
  const toggleErrorRef = useFocusTrap<HTMLDivElement>(!!toggleError, () => setToggleError(null));

  const toggle = useMutation({
    mutationFn: (r: RoleView) =>
      api<RoleView>('POST', `${BASE}/${r.code}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version, // OCC (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, r: RoleView) => {
      if (isStale(e)) setToggleConflict(r);
      else if (e instanceof ApiError && e.code === 'ROLE_IN_USE')
        setToggleError(`${r.code} still has active users — reassign them before deactivating.`);
      else if (e instanceof ApiError && e.code === 'ROLE_LOCKED')
        setToggleError(`${r.code} is a system role and cannot be deactivated.`);
      else setToggleError(e instanceof Error ? e.message : 'Action failed');
    },
  });

  const columns = useMemo<DataGridColumn<RoleView>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (r) => r.name },
      {
        id: 'hierarchyMode',
        header: 'Sees',
        sortable: true,
        cell: (r) => <span className="text-muted-foreground">{MODE_LABELS[r.hierarchyMode]}</span>,
      },
      {
        id: 'reportsToRole',
        header: 'Reports To',
        cell: (r) => <span className="text-muted-foreground">{r.reportsToRole ?? '—'}</span>,
      },
      {
        id: 'permissions',
        header: 'Permissions',
        cell: (r) =>
          r.grantsAll ? (
            <span className="font-medium text-primary">ALL</span>
          ) : (
            <span className="text-muted-foreground">{r.permissions.length}</span>
          ),
      },
      {
        id: 'passwordExpiryDays',
        header: 'Password Expiry',
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.passwordExpiryDays != null ? `${r.passwordExpiryDays} days` : 'Never'}
          </span>
        ),
      },
      {
        id: 'idleLogoutMinutes',
        header: 'Idle Logout',
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.idleLogoutMinutes != null ? `${r.idleLogoutMinutes} min` : 'Exempt'}
          </span>
        ),
      },
      {
        id: 'maxSessionMinutes',
        header: 'Max Session',
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.maxSessionMinutes != null ? `${r.maxSessionMinutes} min` : 'No cap'}
          </span>
        ),
      },
      {
        id: 'dimensions',
        header: 'Scope Dimensions',
        cell: (r) =>
          r.dimensions.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {r.dimensions.map((d) => `${d.dimension} (${d.mode})`).join(', ')}
            </span>
          ),
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: (r) => (
          <span className="text-xs text-muted-foreground">{r.isSystem ? 'SYSTEM' : 'CUSTOM'}</span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (r) => <StatusChip isActive={r.isActive} effectiveFrom={r.createdAt} />,
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (r: RoleView) => (
                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={r.grantsAll}
                    onClick={() => navigate(`/admin/rbac/${r.code}`)}
                  >
                    {r.grantsAll ? 'Locked' : 'Edit'}
                  </Button>
                  {!r.isSystem && (
                    <Button
                      variant={r.isActive ? 'destructive' : 'secondary'}
                      size="sm"
                      onClick={() => toggle.mutate(r)}
                    >
                      {r.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  )}
                </div>
              ),
            } satisfies DataGridColumn<RoleView>,
          ]
        : []),
    ],
    [toggle, canManage, navigate],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Access Control</h1>
          <p className="text-sm text-muted-foreground">
            Roles define permissions; the admin decides what each role sees (hierarchy) and which scope
            dimensions its users can be assigned. System roles are delete-locked; Super Admin is fully locked.
          </p>
        </div>
        {canManage && <Button onClick={() => navigate('/admin/rbac/new')}>+ New Role</Button>}
      </div>

      <DataGrid<RoleView>
        columns={columns}
        queryKey={QK}
        rowId={(r) => r.code}
        defaultSort="code"
        searchPlaceholder="Search code or name…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<RoleView>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[{ id: 'createdAt', label: 'Created' }]}
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
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

      {toggleError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
          <div
            ref={toggleErrorRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-toggle-error-title"
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
          >
            <h2 id="role-toggle-error-title" className="mb-2 text-lg font-semibold">
              Cannot deactivate
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">{toggleError}</p>
            <div className="flex justify-end">
              <Button onClick={() => setToggleError(null)}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {toggleConflict && (
        <ConflictDialog
          entityLabel="role"
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            setToggleConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}
