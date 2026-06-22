import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  REPORT_TEMPLATE_TYPES,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type ReportTemplate,
  type ReportTemplateType,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime, toDateInput, toIsoDate } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { TextArea } from '../../components/ui/TextArea.js';

const BASE = '/api/v2/report-templates';
const QK = 'report-templates';
const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

const TYPE_LABELS: Record<ReportTemplateType, string> = {
  FIELD_NARRATIVE: 'Field Narrative',
  KYC_DOCUMENT: 'KYC Document',
};
const TYPE_OPTIONS = REPORT_TEMPLATE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));

export function TemplatesPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<ReportTemplate | null | undefined>(undefined);
  const [toggleConflict, setToggleConflict] = useState<ReportTemplate | null>(null);

  const toggle = useMutation({
    mutationFn: (t: ReportTemplate) =>
      api<ReportTemplate>('POST', `${BASE}/${t.id}/${t.isActive ? 'deactivate' : 'activate'}`, {
        version: t.version, // OCC: (de)activation is version-guarded (ADR-0019)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
    onError: (e: unknown, t: ReportTemplate) => {
      if (isStale(e)) setToggleConflict(t);
    },
  });

  const columns = useMemo<DataGridColumn<ReportTemplate>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        cell: (t) => <span className="font-mono text-xs">{t.code}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (t) => t.name },
      {
        id: 'templateType',
        header: 'Type',
        sortable: true,
        filterable: true,
        filterOptions: TYPE_OPTIONS,
        cell: (t) => t.templateType.replace(/_/g, ' '),
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (t) => <span className="text-xs text-muted-foreground">{formatDateTime(t.effectiveFrom)}</span>,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (t) => <span className="text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</span>,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (t) => <span className="text-xs text-muted-foreground">{formatDateTime(t.updatedAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (t) => <StatusChip isActive={t.isActive} effectiveFrom={t.effectiveFrom} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (t) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(t)}>
              Edit
            </Button>
            <Button
              variant={t.isActive ? 'destructive' : 'secondary'}
              size="sm"
              onClick={() => toggle.mutate(t)}
            >
              {t.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Report Templates</h1>
          <p className="text-sm text-muted-foreground">
            Authored report bodies the report engine renders per verification type.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>+ New</Button>
      </div>

      <DataGrid<ReportTemplate>
        columns={columns}
        queryKey={QK}
        rowId={(t) => t.id}
        selectable
        bulkActions={(sel) => <BulkStatusActions selection={sel} basePath={BASE} queryKey={QK} />}
        defaultSort="name"
        searchPlaceholder="Search code or name…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<ReportTemplate>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
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

      {editing !== undefined && <TemplateDialog row={editing} onClose={() => setEditing(undefined)} />}

      {toggleConflict && (
        <ConflictDialog
          entityLabel="template"
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

function TemplateDialog({ row, onClose }: { row: ReportTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [templateType, setTemplateType] = useState<ReportTemplateType>(
    row?.templateType ?? 'FIELD_NARRATIVE',
  );
  const [content, setContent] = useState(row?.content ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(row?.effectiveFrom));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(row?.version ?? 0); // OCC token the edit started from
  const [conflict, setConflict] = useState<{ updatedAt?: string; version?: number } | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const mut = useMutation({
    mutationFn: () =>
      isEdit
        ? api<ReportTemplate>('PUT', `${BASE}/${row!.id}`, {
            code,
            name,
            templateType,
            content,
            effectiveFrom: toIsoDate(effectiveFrom),
            version,
          })
        : api<ReportTemplate>('POST', BASE, {
            code,
            name,
            templateType,
            content,
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
        aria-labelledby="template-dialog-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="template-dialog-title" className="mb-4 text-lg font-semibold">
          {isEdit ? 'Edit Template' : 'New Template'}
        </h2>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Code (UPPER_SNAKE)</span>
              <Input
                className="input"
                uppercase={false}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="FIELD_RESIDENCE_V1"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Type</span>
              <select
                className="input"
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value as ReportTemplateType)}
              >
                {REPORT_TEMPLATE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Template body (Handlebars / text)
            </span>
            <TextArea
              className="input min-h-[10rem] font-mono text-xs"
              uppercase={false}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Verification report for {{applicantName}} at {{address}}…"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={!name || code.length < 2}
            loading={mut.isPending}
          >
            Save
          </Button>
        </div>
      </div>

      {conflict && (
        <ConflictDialog
          entityLabel="template"
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
