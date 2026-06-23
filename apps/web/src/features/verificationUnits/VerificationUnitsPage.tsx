import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KINDS,
  exportQueryToParams,
  pageQueryToParams,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type VerificationUnit,
} from '@crm2/sdk';
import { api, apiExport, ApiError } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { DataGrid, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { BulkStatusActions } from '../../components/BulkStatusActions.js';
import { ImportButton } from '../../components/import/ImportModal.js';

const HTTP_CONFLICT = 409;
const isStale = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === HTTP_CONFLICT && e.code === 'STALE_UPDATE';

/** Unit kind → semantic chip tokens (no raw colors). */
function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    FIELD_VISIT: 'bg-st-in-progress-bg text-st-in-progress',
    KYC_DOCUMENT: 'bg-st-assigned-bg text-st-assigned',
    DESK_DOCUMENT: 'bg-st-under-review-bg text-st-under-review',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${map[kind] ?? 'bg-muted text-muted-foreground'}`}
    >
      {kind.replace('_', ' ')}
    </span>
  );
}

const KIND_LABELS: Record<string, string> = {
  FIELD_VISIT: 'Field Visit',
  KYC_DOCUMENT: 'KYC Document',
  DESK_DOCUMENT: 'Desk Document',
};
const KIND_OPTIONS = KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] ?? k }));

export function VerificationUnitsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [active, setActive] = useState('');
  const [toggleConflict, setToggleConflict] = useState<VerificationUnit | null>(null);

  const toggle = useMutation({
    mutationFn: (u: VerificationUnit) =>
      api<VerificationUnit>(
        'POST',
        `/api/v2/verification-units/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`,
        { version: u.version }, // OCC: (de)activation is a version-guarded edit (ADR-0019)
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verification-units'] }),
    onError: (e: unknown, u: VerificationUnit) => {
      if (isStale(e)) setToggleConflict(u);
    },
  });

  const columns = useMemo<DataGridColumn<VerificationUnit>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        sortable: true,
        filterable: true,
        cell: (u) => <span className="font-mono text-xs">{u.code}</span>,
      },
      { id: 'name', header: 'Name', sortable: true, filterable: true, cell: (u) => u.name },
      {
        id: 'category',
        header: 'Category',
        sortable: true,
        filterable: true,
        cell: (u) => <span className="text-muted-foreground">{u.category}</span>,
      },
      {
        id: 'kind',
        header: 'Kind',
        sortable: true,
        filterable: true,
        filterOptions: KIND_OPTIONS,
        cell: (u) => <KindBadge kind={u.kind} />,
      },
      {
        id: 'billing',
        header: 'Billing',
        cell: (u) => <span className="text-xs text-muted-foreground">{u.billingProfile}</span>,
      },
      {
        id: 'effectiveFrom',
        header: 'Effective From',
        sortable: true,
        cell: (u) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTime(u.effectiveFrom)}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (u) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTime(u.createdAt)}
          </span>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (u) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTime(u.updatedAt)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        cell: (u) => <StatusChip isActive={u.isActive} effectiveFrom={u.effectiveFrom} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (u) =>
          u.isSystem ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="Linked to the mobile app — locked. These field-visit types cannot be edited or deactivated."
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              System
            </span>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/admin/verification-units/${u.id}`)}
              >
                Edit
              </Button>
              <Button
                variant={u.isActive ? 'destructive' : 'secondary'}
                size="sm"
                onClick={() => toggle.mutate(u)}
              >
                {u.isActive ? 'Deactivate' : 'Activate'}
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
          <h1 className="text-xl font-bold tracking-tight">Verification Units</h1>
          <p className="text-sm text-muted-foreground">
            The unified catalog — field visits and KYC documents.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportButton
            config={{
              basePath: '/api/v2/verification-units',
              queryKey: 'verification-units',
              entityLabel: 'verification unit',
            }}
          />
          <Button onClick={() => navigate('/admin/verification-units/new')}>+ New Unit</Button>
        </div>
      </div>

      <DataGrid<VerificationUnit>
        columns={columns}
        queryKey="verification-units"
        rowId={(u) => u.id}
        selectable
        defaultSort="sortOrder"
        searchPlaceholder="Search code or name…"
        filters={{ active: active || undefined }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<VerificationUnit>>(
            'GET',
            `/api/v2/verification-units?${pageQueryToParams(query).toString()}`,
          )
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'effectiveFrom', label: 'Effective From' },
        ]}
        exportFn={(req: ExportRequest) =>
          apiExport(`/api/v2/verification-units/export?${exportQueryToParams(req).toString()}`)
        }
        bulkActions={(sel) => (
          <BulkStatusActions
            selection={sel}
            basePath="/api/v2/verification-units"
            queryKey="verification-units"
          />
        )}
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
          entityLabel="verification unit"
          current={undefined}
          onReload={() => {
            qc.invalidateQueries({ queryKey: ['verification-units'] });
            setToggleConflict(null);
          }}
          onDiscard={() => {
            qc.invalidateQueries({ queryKey: ['verification-units'] });
            setToggleConflict(null);
          }}
        />
      )}
    </div>
  );
}
