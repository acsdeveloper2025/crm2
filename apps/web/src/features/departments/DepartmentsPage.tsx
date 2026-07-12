import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  exportQueryToParams,
  pageQueryToParams,
  type Department,
  type ExportRequest,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { friendlyNameError } from '../../lib/friendlyError.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn, type BulkSelection } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

const BASE = '/api/v2/departments';
const QK = 'departments';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/**
 * Departments — the first entity on the Twenty-style inline-grid editing standard (ADR-0051): no
 * modal add/edit form. Click a Name/Description/Effective-From cell to edit the row in place; the
 * "+ Add row" toolbar control creates one. Persistence reuses the existing PUT/POST + `version`
 * endpoints, so the server still enforces scope/ownership + OCC — the grid is defense-in-depth UI.
 */
export function DepartmentsPage() {
  const qc = useQueryClient();
  const { has } = useAuth();
  const canManage = has('user.manage'); // mirrors the server USER_MANAGE guard on every write
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<Department | null>(null);

  const toggle = useMutation({
    mutationFn: (d: Department) =>
      api<Department>('POST', `${BASE}/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`, {
        version: d.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: (_res, d: Department) => {
      qc.invalidateQueries({ queryKey: [QK] });
      toast.success(`Department “${d.name}” ${d.isActive ? 'deactivated' : 'activated'}`);
    },
    onError: (e: unknown, d: Department) => {
      if (isStale(e)) {
        setToggleConflict(d);
        return;
      }
      toast.error(friendlyNameError(e, 'Department'));
    },
  });

  // Per-cell commit hands us ONLY the changed field(s); merge them over the row's RAW values so an
  // untouched Effective From keeps its exact server timestamp (the date editor would truncate it).
  // PUT the whole record with the OCC token; on 409 refresh so a retry picks up the latest version.
  const save = async (row: Department, changed: Record<string, string>, version: number): Promise<void> => {
    const nextName = changed['name'] ?? row.name;
    try {
      await api<Department>('PUT', `${BASE}/${row.id}`, {
        name: nextName,
        description: changed['description'] ?? row.description,
        effectiveFrom:
          changed['effectiveFrom'] !== undefined ? toIsoDate(changed['effectiveFrom']) : row.effectiveFrom,
        version,
      });
      await qc.invalidateQueries({ queryKey: [QK] });
      toast.success(`Department “${nextName}” saved`);
    } catch (e) {
      if (isStale(e)) await qc.invalidateQueries({ queryKey: [QK] }); // refresh the stale row
      const msg = friendlyNameError(e, 'Department');
      toast.error(msg); // red toast …
      throw new Error(msg, { cause: e }); // … and persist inline in the grid
    }
  };

  const create = async (values: Record<string, string>): Promise<void> => {
    const effectiveFrom = (values['effectiveFrom'] ?? '').trim();
    const name = values['name'] ?? '';
    try {
      await api<Department>('POST', BASE, {
        name,
        description: values['description'] ?? '',
        // blank ⇒ omit so the server defaults Effective From to now.
        ...(effectiveFrom ? { effectiveFrom: toIsoDate(effectiveFrom) } : {}),
      });
      await qc.invalidateQueries({ queryKey: [QK] });
      toast.success(`Department “${name}” created`);
    } catch (e) {
      const msg = friendlyNameError(e, 'Department');
      toast.error(msg);
      throw new Error(msg, { cause: e });
    }
  };

  const columns = useMemo<DataGridColumn<Department>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        filterable: true,
        editable: true,
        required: true,
        editorPlaceholder: 'Operations',
        cell: (d) => d.name,
      },
      {
        id: 'description',
        header: 'Description',
        editable: true,
        editorPlaceholder: 'What this unit does',
        cell: (d) => <span className="text-muted-foreground">{d.description}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        editable: true,
        editor: 'date',
        draftValue: (d) => toDateInput(d.effectiveFrom),
        cell: (d) => <span className="text-xs text-muted-foreground">{formatDateTime(d.effectiveFrom)}</span>,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (d) => <span className="text-xs text-muted-foreground">{formatDateTime(d.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (d) => <span className="text-xs text-muted-foreground">{formatDateTime(d.updatedAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (d) => <StatusChip isActive={d.isActive} effectiveFrom={d.effectiveFrom} />,
      },
      // Write column (edit affordance + Activate/Deactivate) only for managers — mirrors the server
      // USER_MANAGE guard so a read-only user sees no dead buttons (403-on-click).
      ...(canManage
        ? ([
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              editAction: true, // while a row is edited, the grid renders Save/Cancel here
              cell: (d) => (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant={d.isActive ? 'destructive' : 'secondary'}
                    size="sm"
                    onClick={() => toggle.mutate(d)}
                  >
                    {d.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ),
            },
          ] as DataGridColumn<Department>[])
        : []),
    ],
    [toggle, canManage],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Departments</h1>
          <p className="text-sm text-muted-foreground">
            Organisational units — a required field on every user. Click a cell to edit; use “+ Add row” to
            create.
          </p>
        </div>
        {canManage && <ImportButton config={{ basePath: BASE, queryKey: QK, entityLabel: 'department' }} />}
      </div>

      <DataGrid<Department>
        columns={columns}
        queryKey={QK}
        rowId={(d) => d.id}
        selectable={canManage}
        {...(canManage
          ? {
              bulkActions: (sel: BulkSelection<Department>) => (
                <BulkStatusActions selection={sel} basePath={BASE} queryKey={QK} />
              ),
            }
          : {})}
        defaultSort="name"
        searchPlaceholder="Search name or description…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<Department>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
        {...(canManage
          ? { inlineEdit: { version: (d: Department) => d.version, onSave: save, onCreate: create } }
          : {})}
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

      {toggleConflict && (
        <ConflictDialog
          entityLabel="department"
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
