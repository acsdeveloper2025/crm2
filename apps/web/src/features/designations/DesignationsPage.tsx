import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type Designation,
  type DepartmentOption,
  type ExportRequest,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

const BASE = '/api/v2/designations';
const QK = 'designations';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/**
 * Designations — inline-grid editing (ADR-0051): click a Name/Description/Department/Effective-From
 * cell to edit it in place, "+ Add row" to create; no modal form. Department is a `select` cell over
 * the active departments. Persistence reuses the existing PUT/POST + `version` (server owns OCC).
 */
export function DesignationsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<Designation | null>(null);

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api<DepartmentOption[]>('GET', '/api/v2/departments/options'),
  });
  const deptOptions = useMemo(
    () => [
      { value: '', label: '— None —' },
      ...departments.map((d) => ({ value: String(d.id), label: d.name })),
    ],
    [departments],
  );

  const toggle = useMutation({
    mutationFn: (d: Designation) =>
      api<Designation>('POST', `${BASE}/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`, {
        version: d.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, d: Designation) => {
      if (isStale(e)) setToggleConflict(d);
    },
  });

  // Per-cell commit hands only the CHANGED field(s); merge over the row's raw values for the PUT.
  const save = async (row: Designation, changed: Record<string, string>, version: number): Promise<void> => {
    try {
      await api<Designation>('PUT', `${BASE}/${row.id}`, {
        name: changed['name'] ?? row.name,
        description: changed['description'] ?? row.description,
        departmentId:
          changed['departmentId'] !== undefined
            ? changed['departmentId']
              ? Number(changed['departmentId'])
              : null
            : row.departmentId,
        effectiveFrom:
          changed['effectiveFrom'] !== undefined ? toIsoDate(changed['effectiveFrom']) : row.effectiveFrom,
        version,
      });
      await qc.invalidateQueries({ queryKey: [QK] });
    } catch (e) {
      if (isStale(e)) {
        await qc.invalidateQueries({ queryKey: [QK] });
        throw new Error('This row changed since you opened it — refreshed; Save again to re-apply.', {
          cause: e,
        });
      }
      if (e instanceof ApiError && e.code === 'DESIGNATION_EXISTS')
        throw new Error('A designation with this name already exists.', { cause: e });
      throw e instanceof Error ? e : new Error('Save failed');
    }
  };

  const create = async (values: Record<string, string>): Promise<void> => {
    const effectiveFrom = (values['effectiveFrom'] ?? '').trim();
    try {
      await api<Designation>('POST', BASE, {
        name: values['name'] ?? '',
        description: values['description'] ?? '',
        departmentId: values['departmentId'] ? Number(values['departmentId']) : null,
        ...(effectiveFrom ? { effectiveFrom: toIsoDate(effectiveFrom) } : {}),
      });
      await qc.invalidateQueries({ queryKey: [QK] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DESIGNATION_EXISTS')
        throw new Error('A designation with this name already exists.', { cause: e });
      throw e instanceof Error ? e : new Error('Create failed');
    }
  };

  const columns = useMemo<DataGridColumn<Designation>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        filterable: true,
        editable: true,
        required: true,
        editorPlaceholder: 'Senior Field Executive',
        cell: (d) => d.name,
      },
      {
        id: 'description',
        header: 'Description',
        editable: true,
        cell: (d) => <span className="text-muted-foreground">{d.description}</span>,
      },
      {
        id: 'department',
        header: 'Department',
        editable: true,
        editor: 'select',
        field: 'departmentId',
        editorOptions: deptOptions,
        draftValue: (d) => (d.departmentId != null ? String(d.departmentId) : ''),
        cell: (d) => <span className="text-muted-foreground">{d.departmentName ?? '—'}</span>,
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
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        editAction: true,
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
    ],
    [toggle, deptOptions],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Designations</h1>
          <p className="text-sm text-muted-foreground">
            Job titles — a required field on every user; optionally tied to a department. Click a cell to
            edit; use “+ Add row” to create.
          </p>
        </div>
        <ImportButton config={{ basePath: BASE, queryKey: QK, entityLabel: 'designation' }} />
      </div>

      <DataGrid<Designation>
        columns={columns}
        queryKey={QK}
        rowId={(d) => d.id}
        selectable
        bulkActions={(sel) => <BulkStatusActions selection={sel} basePath={BASE} queryKey={QK} />}
        defaultSort="name"
        searchPlaceholder="Search name or description…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<Designation>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
        inlineEdit={{ version: (d) => d.version, onSave: save, onCreate: create }}
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
          entityLabel="designation"
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
