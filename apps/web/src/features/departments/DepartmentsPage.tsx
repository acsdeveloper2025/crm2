import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';

const BASE = '/api/v2/departments';
const QK = 'departments';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

export function DepartmentsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Department | null | undefined>(undefined);
  const [toggleConflict, setToggleConflict] = useState<Department | null>(null);

  const toggle = useMutation({
    mutationFn: (d: Department) =>
      api<Department>('POST', `${BASE}/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`, {
        version: d.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, d: Department) => {
      if (isStale(e)) setToggleConflict(d);
    },
  });

  const columns = useMemo<DataGridColumn<Department>[]>(
    () => [
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (d) => d.name },
      {
        id: 'description',
        header: 'Description',
        cell: (d) => <span className="text-muted-foreground">{d.description}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
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
        cell: (d) => (
          <>
            <button className="mr-3 font-medium text-primary hover:underline" onClick={() => setEditing(d)}>
              Edit
            </button>
            <button
              className="font-medium text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => toggle.mutate(d)}
            >
              {d.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </>
        ),
      },
    ],
    [toggle],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Departments</h1>
          <p className="text-sm text-muted-foreground">
            Organisational units — a required field on every user.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton config={{ basePath: BASE, queryKey: QK, entityLabel: 'department' }} />
          <button className="btn" onClick={() => setEditing(null)}>
            + New
          </button>
        </div>
      </div>

      <DataGrid<Department>
        columns={columns}
        queryKey={QK}
        rowId={(d) => d.id}
        selectable
        bulkActions={(sel) => <BulkStatusActions selection={sel} basePath={BASE} queryKey={QK} />}
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

      {editing !== undefined && <DepartmentDialog row={editing} onClose={() => setEditing(undefined)} />}

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

function DepartmentDialog({ row, onClose }: { row: Department | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(row?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(row?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const mut = useMutation({
    mutationFn: () =>
      isEdit
        ? api<Department>('PUT', `${BASE}/${row!.id}`, {
            name,
            description,
            effectiveFrom: toIsoDate(effectiveFrom),
            version,
          })
        : api<Department>('POST', BASE, {
            name,
            description,
            effectiveFrom: toIsoDate(effectiveFrom),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      onClose();
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else if (e instanceof ApiError && e.code === 'DEPARTMENT_EXISTS') {
        setError('A department with this name already exists.');
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="department-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="department-dialog-title" className="mb-4 text-lg font-semibold">
          {isEdit ? 'Edit Department' : 'New Department'}
        </h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Name</span>
            <Input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operations"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Description</span>
            <TextArea
              className="input min-h-[5rem]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Effective From (blank = now)
            </span>
            <input
              type="date"
              className="input"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={mut.isPending || !name.trim()}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="department"
          current={conflict}
          onReload={() => {
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [QK] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [QK] });
            onClose();
          }}
        />
      )}
    </div>
  );
}
