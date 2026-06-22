import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../lib/format.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { BulkStatusActions } from './BulkStatusActions.js';
import { ImportButton } from './import/ImportModal.js';
import { StatusChip } from './StatusChip.js';
import { ConflictDialog } from './ConflictDialog.js';
import { DataGrid, type DataGridColumn } from './ui/data-grid/index.js';
import { Input } from './ui/Input.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

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

export function MasterDataCrud({ config }: { config: Config }) {
  const qc = useQueryClient();
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<MasterRow | null | undefined>(undefined); // undefined=closed, null=create
  const [toggleConflict, setToggleConflict] = useState<MasterRow | null>(null);

  const toggle = useMutation({
    mutationFn: (r: MasterRow) =>
      api<MasterRow>('POST', `${config.basePath}/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`, {
        version: r.version, // OCC: (de)activation is a version-guarded edit (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [config.queryKey] }),
    onError: (e: unknown, r: MasterRow) => {
      if (isStale(e)) setToggleConflict(r); // someone else changed this record first
    },
  });

  const columns = useMemo<DataGridColumn<MasterRow>[]>(
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
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
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
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (r) => (
          <>
            <button className="mr-3 font-medium text-primary hover:underline" onClick={() => setEditing(r)}>
              Edit
            </button>
            <button
              className="font-medium text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => toggle.mutate(r)}
            >
              {r.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </>
        ),
      },
    ],
    [toggle],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{config.title}</h1>
          <p className="text-sm text-muted-foreground">{config.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton
            config={{
              basePath: config.basePath,
              queryKey: config.queryKey,
              entityLabel: config.title.replace(/s$/, '').toLowerCase(),
            }}
          />
          <button className="btn" onClick={() => setEditing(null)}>
            + New
          </button>
        </div>
      </div>

      <DataGrid<MasterRow>
        columns={columns}
        queryKey={config.queryKey}
        rowId={(r) => r.id}
        selectable
        bulkActions={(sel) => (
          <BulkStatusActions selection={sel} basePath={config.basePath} queryKey={config.queryKey} />
        )}
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

      {editing !== undefined && (
        <MasterDataDialog config={config} row={editing} onClose={() => setEditing(undefined)} />
      )}

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

function MasterDataDialog({
  config,
  row,
  onClose,
}: {
  config: Config;
  row: MasterRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(row?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(row?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const mut = useMutation({
    mutationFn: () =>
      isEdit
        ? api<MasterRow>('PUT', `${config.basePath}/${row!.id}`, {
            code,
            name,
            effectiveFrom: toIsoDate(effectiveFrom),
            version,
          })
        : api<MasterRow>('POST', config.basePath, { code, name, effectiveFrom: toIsoDate(effectiveFrom) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [config.queryKey] });
      onClose();
    },
    onError: (e: unknown) => {
      if (isStale(e)) {
        const current = (e.body as { current?: { updatedAt?: string; version?: number } } | null)?.current;
        setConflict(current ?? {});
      } else if (e instanceof ApiError && e.code === 'CODE_LOCKED') {
        setError(
          'This code is in use by other records and can’t be changed. Deactivate and recreate to fix it.',
        );
      } else setError(e instanceof Error ? e.message : 'Save failed');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="masterdata-dialog-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="masterdata-dialog-title" className="mb-4 text-lg font-semibold">
          {isEdit ? 'Edit' : 'New'} {config.title.replace(/s$/, '')}
        </h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Code (UPPER_SNAKE)</span>
            <Input
              className="input"
              uppercase={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={config.codePlaceholder}
            />
            {isEdit && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Correctable only while unused — locked once referenced by other records (ADR-0020).
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">Name</span>
            <Input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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
            disabled={mut.isPending || !name || !code}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel={config.title.replace(/s$/, '').toLowerCase()}
          current={conflict}
          onReload={() => {
            // adopt the latest version, keep the user's edits, let them save again
            if (conflict.version !== undefined) setVersion(conflict.version);
            qc.invalidateQueries({ queryKey: [config.queryKey] });
            setConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: [config.queryKey] });
            onClose();
          }}
        />
      )}
    </div>
  );
}
