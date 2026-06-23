import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useAuth } from '../../lib/AuthContext.js';
import { formatDateTime } from '../../lib/format.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';

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
  const navigate = useNavigate();
  // Mirror the server write guard (report_template.manage) so viewers don't see write controls (H-1).
  const { has } = useAuth();
  const canManage = has('report_template.manage');
  const [active, setActive] = useState('');
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
      ...(canManage
        ? [
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (t: ReportTemplate) => (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/templates/${t.id}`)}>
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
            } satisfies DataGridColumn<ReportTemplate>,
          ]
        : []),
    ],
    [toggle, canManage, navigate],
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
        {canManage && <Button onClick={() => navigate('/admin/templates/new')}>+ New</Button>}
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
