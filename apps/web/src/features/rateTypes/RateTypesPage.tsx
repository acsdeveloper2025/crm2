import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type RateType,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { ImportButton } from '../../components/import/ImportModal.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

const BASE = '/api/v2/rate-types';
const QK = 'rate-types';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/**
 * Rate Types — inline-grid editing (ADR-0051): click a Name/Description/Category/Sort cell to edit it
 * in place, "+ Add row" to create; no modal form. `code` is the immutable identity (the FK key in
 * Phase C) — shown but never editable. Persistence reuses PUT/POST + `version` (server owns OCC).
 */
export function RateTypesPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<RateType | null>(null);

  const toggle = useMutation({
    mutationFn: (r: RateType) =>
      api<RateType>('POST', `${BASE}/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, r: RateType) => {
      if (isStale(e)) setToggleConflict(r);
    },
  });

  // Per-cell commit hands only the CHANGED field(s); merge over the row's raw values for the PUT.
  // `code` is never an editable column, so it can never appear in `changed` (immutable identity).
  const save = async (row: RateType, changed: Record<string, string>, version: number): Promise<void> => {
    try {
      await api<RateType>('PUT', `${BASE}/${row.id}`, {
        name: changed['name'] ?? row.name,
        description: changed['description'] ?? row.description,
        category: changed['category'] ?? row.category,
        sortOrder: changed['sortOrder'] !== undefined ? Number(changed['sortOrder']) : row.sortOrder,
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
      if (e instanceof ApiError && e.code === 'RATE_TYPE_EXISTS')
        throw new Error('A rate type with this code already exists.', { cause: e });
      throw e instanceof Error ? e : new Error('Save failed');
    }
  };

  const create = async (values: Record<string, string>): Promise<void> => {
    try {
      await api<RateType>('POST', BASE, {
        code: values['code'] ?? '',
        name: values['name'] ?? '',
        description: values['description'] ?? '',
        category: values['category'] || 'FIELD',
        ...(values['sortOrder'] ? { sortOrder: Number(values['sortOrder']) } : {}),
      });
      await qc.invalidateQueries({ queryKey: [QK] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_TYPE_EXISTS')
        throw new Error('A rate type with this code already exists.', { cause: e });
      throw e instanceof Error ? e : new Error('Create failed');
    }
  };

  const columns = useMemo<DataGridColumn<RateType>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        // Settable on create (add-row) but IMMUTABLE on edit — it's the catalog key (FK in Phase C).
        createOnly: true,
        required: true,
        editorPlaceholder: 'LOCAL6',
        cell: (r) => r.code,
      },
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        editable: true,
        required: true,
        editorPlaceholder: 'Local (within 6 km)',
        cell: (r) => r.name,
      },
      {
        id: 'description',
        header: 'Description',
        editable: true,
        cell: (r) => <span className="text-muted-foreground">{r.description ?? ''}</span>,
      },
      {
        id: 'category',
        header: 'Category',
        editable: true,
        editor: 'select',
        field: 'category',
        editorOptions: [
          { value: 'FIELD', label: 'FIELD' },
          { value: 'OFFICE', label: 'OFFICE' },
        ],
        draftValue: (r) => r.category,
        cell: (r) => r.category,
      },
      {
        id: 'sortOrder',
        header: 'Sort',
        sortable: true,
        editable: true,
        field: 'sortOrder',
        draftValue: (r) => String(r.sortOrder),
        cell: (r) => r.sortOrder,
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
        cell: (r) => <StatusChip isActive={r.isActive} effectiveFrom={r.effectiveFrom} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        editAction: true,
        cell: (r) => (
          <div className="flex items-center justify-end gap-2">
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Rate Types</h1>
          <p className="text-sm text-muted-foreground">
            The managed rate-type catalog — the label billing resolves and the key commission keys on. Code is
            the immutable identity; click a cell to edit, use “+ Add row” to create.
          </p>
        </div>
        <ImportButton config={{ basePath: BASE, queryKey: QK, entityLabel: 'rate type' }} />
      </div>

      <DataGrid<RateType>
        columns={columns}
        queryKey={QK}
        rowId={(r) => r.id}
        defaultSort="sortOrder"
        searchPlaceholder="Search code, name or description…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<RateType>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
        inlineEdit={{ version: (r) => r.version, onSave: save, onCreate: create }}
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
          entityLabel="rate type"
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
