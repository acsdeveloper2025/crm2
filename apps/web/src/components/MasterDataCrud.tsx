import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../lib/format.js';
import { friendlyMasterError } from '../lib/friendlyError.js';
import { useAuth } from '../lib/AuthContext.js';
import { BulkStatusActions } from './BulkStatusActions.js';
import { ImportButton } from './import/ImportModal.js';
import { StatusChip } from './StatusChip.js';
import { ConflictDialog } from './ConflictDialog.js';
import { DataGrid, type DataGridColumn, type BulkSelection } from './ui/data-grid/index.js';
import { Button } from './ui/Button.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/**
 * Tooltip for the code cell (UX-12) — unlike a DataGrid `createOnly` column, this code stays
 * editable until CODE_LOCKED (the server rejects the edit once another record references it —
 * see `save` above), hence the different copy from the grid's "Locked — set at creation".
 */
export const MASTER_DATA_CODE_TITLE = 'Code locks once referenced';

/** A simple code/name/is-active master-data row (clients, products). */
export interface MasterRow {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  effectiveFrom: string;
  /** OCC concurrency token (ADR-0019). */
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Config {
  title: string;
  subtitle: string;
  /** API base path, e.g. `/api/v2/clients`. */
  basePath: string;
  /** TanStack query key root, e.g. `clients`. */
  queryKey: string;
  codePlaceholder: string;
}

/**
 * The flat code/name master-data manager (Clients, Products) — inline-grid editing (ADR-0051): click
 * a Code/Name/Effective-From cell to edit it in place, "+ Add row" to create; no modal form. Code is
 * coerced to UPPER at submit (WYSIWYG while typing). A code in use by other records is CODE_LOCKED —
 * the server rejects the edit and the message renders inline. Persistence reuses the existing PUT/POST
 * + `version`, so the server still owns OCC + scope.
 */
export function MasterDataCrud({ config }: { config: Config }) {
  const qc = useQueryClient();
  const { has } = useAuth();
  const canManage = has('masterdata.manage'); // mirrors the server MASTERDATA_MANAGE guard on every write
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<MasterRow | null>(null);
  const entity = config.title.replace(/s$/, ''); // "Clients" → "Client" (singular label for copy)

  const toggle = useMutation({
    mutationFn: (r: MasterRow) =>
      api<MasterRow>('POST', `${config.basePath}/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version, // OCC: (de)activation is a version-guarded edit (ADR-0019)
      }),
    onSuccess: (_res, r: MasterRow) => {
      qc.invalidateQueries({ queryKey: [config.queryKey] });
      toast.success(`${entity} “${r.code}” ${r.isActive ? 'deactivated' : 'activated'}`);
    },
    onError: (e: unknown, r: MasterRow) => {
      if (isStale(e)) {
        setToggleConflict(r); // someone else changed this record first → OCC dialog, no toast
        return;
      }
      toast.error(friendlyMasterError(e, entity));
    },
  });

  const save = async (row: MasterRow, changed: Record<string, string>, version: number): Promise<void> => {
    const nextCode = changed['code'] !== undefined ? changed['code'].toUpperCase() : row.code;
    try {
      await api<MasterRow>('PUT', `${config.basePath}/${row.id}`, {
        code: nextCode,
        name: changed['name'] ?? row.name,
        effectiveFrom:
          changed['effectiveFrom'] !== undefined ? toIsoDate(changed['effectiveFrom']) : row.effectiveFrom,
        version,
      });
      await qc.invalidateQueries({ queryKey: [config.queryKey] });
      toast.success(`${entity} “${nextCode}” saved`);
    } catch (e) {
      if (isStale(e)) await qc.invalidateQueries({ queryKey: [config.queryKey] }); // refresh the stale row
      const msg = friendlyMasterError(e, entity, nextCode);
      toast.error(msg); // red toast (§5) …
      throw new Error(msg, { cause: e }); // … and persist inline in the grid
    }
  };

  const create = async (values: Record<string, string>): Promise<void> => {
    const effectiveFrom = (values['effectiveFrom'] ?? '').trim();
    const code = (values['code'] ?? '').toUpperCase();
    try {
      await api<MasterRow>('POST', config.basePath, {
        code,
        name: values['name'] ?? '',
        ...(effectiveFrom ? { effectiveFrom: toIsoDate(effectiveFrom) } : {}),
      });
      await qc.invalidateQueries({ queryKey: [config.queryKey] });
      toast.success(`${entity} “${code}” created`);
    } catch (e) {
      const msg = friendlyMasterError(e, entity, code);
      toast.error(msg); // red toast (§5) …
      throw new Error(msg, { cause: e }); // … and persist inline under the add-row
    }
  };

  const columns = useMemo<DataGridColumn<MasterRow>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        editable: true,
        required: true,
        editorPlaceholder: config.codePlaceholder,
        cell: (r) => (
          <span className="font-mono text-xs" title={MASTER_DATA_CODE_TITLE}>
            {r.code}
          </span>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        filterable: true,
        editable: true,
        required: true,
        cell: (r) => r.name,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        editable: true,
        editor: 'date',
        draftValue: (r) => toDateInput(r.effectiveFrom),
        cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.effectiveFrom)}</span>,
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
      // The write column (Edit affordance + Activate/Deactivate) shows only for users who can manage —
      // mirrors the server MASTERDATA_MANAGE guard so a read-only user sees no dead buttons (403-on-click).
      ...(canManage
        ? ([
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
          ] as DataGridColumn<MasterRow>[])
        : []),
    ],
    [toggle, config.codePlaceholder, canManage],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{config.title}</h1>
          <p className="text-sm text-muted-foreground">{config.subtitle}</p>
        </div>
        {canManage && (
          <ImportButton
            config={{
              basePath: config.basePath,
              queryKey: config.queryKey,
              entityLabel: entity.toLowerCase(),
            }}
          />
        )}
      </div>

      <DataGrid<MasterRow>
        columns={columns}
        queryKey={config.queryKey}
        rowId={(r) => r.id}
        selectable={canManage}
        {...(canManage
          ? {
              bulkActions: (sel: BulkSelection<MasterRow>) => (
                <BulkStatusActions selection={sel} basePath={config.basePath} queryKey={config.queryKey} />
              ),
            }
          : {})}
        defaultSort="name"
        searchPlaceholder="Search code or name…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<MasterRow>>('GET', `${config.basePath}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) =>
          apiExport(`${config.basePath}/export?${exportQueryToParams(req).toString()}`)
        }
        {...(canManage
          ? { inlineEdit: { version: (r: MasterRow) => r.version, onSave: save, onCreate: create } }
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
          entityLabel={config.title.replace(/s$/, '').toLowerCase()}
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: [config.queryKey] });
            setToggleConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [config.queryKey] });
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}
