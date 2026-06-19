import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportQueryToParams,
  pageQueryToParams,
  KINDS,
  type AssignableUser,
  type BulkAssignResult,
  type ExportRequest,
  type PageQuery,
  type Paginated,
  type TaskStats,
  type TaskView,
  type DistanceBand,
  type VisitType,
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  DISTANCE_BANDS,
} from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { DataGrid, type BulkSelection, type DataGridColumn } from '../../components/ui/data-grid/index.js';

const BASE = '/api/v2/tasks';
const QK = 'tasks';

/** Status → frozen status-token pair (COLOR_SYSTEM_FREEZE). */
const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-st-pending-bg text-st-pending',
  ASSIGNED: 'bg-st-assigned-bg text-st-assigned',
  IN_PROGRESS: 'bg-st-in-progress-bg text-st-in-progress',
  SUBMITTED: 'bg-st-under-review-bg text-st-under-review',
  COMPLETED: 'bg-st-approved-bg text-st-approved',
  REVOKED: 'bg-st-rejected-bg text-st-rejected',
  CANCELLED: 'bg-st-rejected-bg text-st-rejected',
};

/** The Zion-style work buckets. Status buckets set the `status` domain filter; the Out-of-TAT bucket
 *  sets `overdue` (a cross-status derived filter, ADR-0044). All buckets are mutually exclusive.
 *  Money (bill/commission) lives only on the Billing & Commission page (ADR-0046 §6) — there is no
 *  Commissionable bucket here. Revoked replaces the old Cancelled chip. */
const BUCKETS: {
  label: string;
  status?: string;
  overdue?: boolean;
  stat: keyof TaskStats;
}[] = [
  { label: 'All', status: '', stat: 'total' },
  { label: 'Unassigned', status: 'PENDING', stat: 'pending' },
  { label: 'Assigned', status: 'ASSIGNED', stat: 'assigned' },
  { label: 'In Progress', status: 'IN_PROGRESS', stat: 'inProgress' },
  // Submitted (ADR-0047): field-done, awaiting the office to add the report + result → COMPLETED.
  { label: 'Submitted', status: 'SUBMITTED', stat: 'submitted' },
  { label: 'Completed', status: 'COMPLETED', stat: 'completed' },
  { label: 'Revoked', status: 'REVOKED', stat: 'revoked' },
  // Out of TAT (ADR-0044): the exact overdue set (server-side `overdue=1`, urgency-ordered) — an OPEN
  // task past its `tat_hours` target since `assigned_at`.
  { label: 'Out of TAT', overdue: true, stat: 'overdue' },
];

/**
 * Pipeline — the operational task queue (design: docs/specs/2026-06-11-pipeline-design.md §5).
 * Every case_task across all cases in ONE Universal DataGrid, scoped server-side (ADR-0022 TASK
 * level). Buckets mirror Zion's work model; bulk assignment is the workbench action. Status is
 * deliberately NOT a header filter — the bucket bar owns it (and the stats endpoint excludes it).
 */
export function PipelinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const overdue = searchParams.get('overdue') === '1';
  // All buckets are mutually exclusive — selecting one clears the others.
  const selectBucket = (b: { status?: string; overdue?: boolean }) => {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('overdue');
    if (b.overdue) next.set('overdue', '1');
    else if (b.status) next.set('status', b.status);
    next.delete('page'); // a bucket change re-anchors to page 1
    setSearchParams(next, { replace: true });
  };

  // Bucket counts honor the grid's URL state (search + column/date filters), minus `status` itself.
  // The DataGrid persists global search under the URL key `q` (mapped to the request's `search`).
  const statsQs = useMemo(() => {
    const qs = new URLSearchParams();
    const search = searchParams.get('q');
    if (search) qs.set('search', search);
    for (const [k, v] of searchParams.entries()) if (k.startsWith('f_')) qs.set(k, v);
    return qs.toString();
  }, [searchParams]);
  const stats = useQuery({
    queryKey: [QK, 'stats', statsQs],
    queryFn: () => api<TaskStats>('GET', `${BASE}/stats${statsQs ? `?${statsQs}` : ''}`),
  });

  const columns = useMemo<DataGridColumn<TaskView>[]>(
    () => [
      {
        id: 'caseNumber',
        header: 'Case',
        sortable: true,
        filterable: true,
        hideable: false,
        cell: (t) => <span className="font-mono text-xs">{t.caseNumber}</span>,
      },
      {
        id: 'taskNumber',
        header: 'Task',
        sortable: true,
        filterable: true,
        hideable: false,
        cell: (t) => <span className="font-mono text-xs">{t.taskNumber}</span>,
      },
      { id: 'clientName', header: 'Client', sortable: true, filterable: true, cell: (t) => t.clientName },
      {
        id: 'primaryName',
        header: 'Applicant',
        sortable: true,
        filterable: true,
        cell: (t) => t.primaryName ?? '—',
      },
      {
        id: 'unitName',
        header: 'Unit',
        sortable: true,
        filterable: true,
        cell: (t) => (
          <span>
            <span className="font-mono text-xs">{t.unitCode}</span> — {t.unitName}
          </span>
        ),
      },
      {
        id: 'unitKind',
        header: 'Kind',
        sortable: true,
        filterable: true,
        filterOptions: KINDS.map((k) => ({ value: k, label: k.replace(/_/g, ' ') })),
        cell: (t) => t.unitKind.replace(/_/g, ' '),
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        hideable: false,
        cell: (t) => (
          <span className="flex items-center gap-1.5">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[t.status] ?? 'bg-surface-muted'}`}
            >
              {t.status.replace(/_/g, ' ')}
            </span>
            {t.overdue && (
              <span
                className="rounded bg-st-rejected-bg px-1.5 py-0.5 text-xs font-medium text-st-rejected"
                title="Out of TAT (target turnaround exceeded)"
              >
                ⚠ TAT
                {t.dueAt
                  ? ` +${Math.max(0, Math.floor((Date.now() - new Date(t.dueAt).getTime()) / 3_600_000))}h`
                  : ''}
                {t.tatHours ? ` / ${t.tatHours}h` : ''}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'completedTatBand',
        header: 'Completed In',
        align: 'right',
        cell: (t) =>
          t.completedTatBand == null ? (
            <span className="text-muted-foreground">—</span>
          ) : t.completedTatBand === -1 ? (
            <span className="tabular-nums">&gt;48h</span>
          ) : (
            <span className="tabular-nums">{t.completedTatBand}h</span>
          ),
      },
      {
        id: 'assignedToName',
        header: 'Assignee',
        sortable: true,
        filterable: true,
        cell: (t) => t.assignedToName ?? '—',
      },
      { id: 'billCount', header: 'Bills', align: 'right', cell: (t) => t.billCount },
      {
        id: 'assignedAt',
        header: 'Assigned At',
        sortable: true,
        cell: (t) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {t.assignedAt ? formatDateTime(t.assignedAt) : '—'}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortable: true,
        cell: (t) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(t.createdAt)}</span>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        sortable: true,
        cell: (t) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(t.updatedAt)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Every verification task across all cases — assign and track field & KYC work.
          </p>
        </div>
      </div>

      {/* Status bucket bar (counts are scope+filter aware; `status` itself excluded server-side). */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status buckets">
        {BUCKETS.map((b) => {
          const active = b.overdue ? overdue : !overdue && status === (b.status ?? '');
          const count = stats.data?.[b.stat];
          return (
            <button
              key={b.label}
              type="button"
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-secondary-foreground hover:bg-accent'
              }`}
              onClick={() => selectBucket(b)}
            >
              {b.label}
              <span className={`ml-1.5 tabular-nums ${active ? '' : 'text-muted-foreground'}`}>
                {count ?? '…'}
              </span>
            </button>
          );
        })}
      </div>

      <DataGrid<TaskView>
        columns={columns}
        queryKey={QK}
        rowId={(t) => t.id}
        defaultSort="createdAt"
        defaultSortOrder="desc"
        searchPlaceholder="Search case number, applicant or unit…"
        filters={{
          status: status || undefined,
          overdue: overdue ? '1' : undefined,
        }}
        fetchPage={(query: PageQuery) =>
          api<Paginated<TaskView>>('GET', `${BASE}?${pageQueryToParams(query).toString()}`)
        }
        dateFilters={[
          { id: 'createdAt', label: 'Created' },
          { id: 'assignedAt', label: 'Assigned' },
        ]}
        exportFn={(req: ExportRequest) => apiExport(`${BASE}/export?${exportQueryToParams(req).toString()}`)}
        onRowClick={(t) => navigate(`/cases/${t.caseId}`)}
        selectable
        bulkActions={(sel) => <BulkAssignAction selection={sel} />}
        loadingLabel="Pipeline"
      />
    </div>
  );
}

/**
 * Bulk assignment for a DataGrid selection (design §5): ONE executive for all ticked tasks, with
 * shared visit/distance/bill attributes. The pool is the server-side INTERSECTION of per-task
 * eligibility; per-row OCC outcomes are summarized (a partial run keeps the selection so the user
 * can re-tick and retry — BulkStatusActions precedent).
 */
function BulkAssignAction({ selection }: { selection: BulkSelection<TaskView> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('FIELD');
  // ADR-0050: the trip distance band is the executive-commission resolution key — REQUIRED, no default
  // (a conscious LOCAL/OGL choice shared across the whole selection).
  const [distanceBand, setDistanceBand] = useState<DistanceBand | ''>('');
  const [billCount, setBillCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [poolError, setPoolError] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(open, () => setOpen(false));

  const pool = useQuery({
    queryKey: [QK, 'assignable-users', [...selection.ids].sort().join(','), visitType],
    queryFn: async () => {
      try {
        setPoolError(false);
        return await api<AssignableUser[]>(
          'GET',
          `${BASE}/assignable-users?taskIds=${selection.ids.join(',')}&visitType=${visitType}`,
        );
      } catch (e) {
        setPoolError(true);
        throw e;
      }
    },
    enabled: open && !selection.allMatching && selection.ids.length > 0,
    retry: false,
  });

  if (selection.allMatching)
    return <span className="text-xs text-muted-foreground">Tick individual rows to assign.</span>;

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<BulkAssignResult>('POST', `${BASE}/bulk-assign`, {
        items: selection.rows.map((r) => ({ id: r.id, version: r.version })),
        assignedTo,
        visitType,
        // distanceBand is OPTIONAL (ADR-0050 commission key) — send only when chosen.
        ...(distanceBand ? { distanceBand } : {}),
        billCount,
      });
      void qc.invalidateQueries({ queryKey: [QK] });
      const parts = [`${res.okCount} assigned`];
      if (res.conflictCount) parts.push(`${res.conflictCount} changed by someone else`);
      if (res.notAssignableCount) parts.push(`${res.notAssignableCount} not assignable`);
      if (res.ineligibleCount) parts.push(`${res.ineligibleCount} ineligible for this executive`);
      if (res.notFoundCount) parts.push(`${res.notFoundCount} not found`);
      setMessage(parts.join(' · '));
      const clean = res.okCount === res.results.length;
      setOpen(false);
      if (clean) selection.clear(); // partial → keep the selection visible for a retry
    } catch {
      setMessage('Bulk assignment failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        Assign…
      </button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-assign-title"
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
          >
            <h2 id="bulk-assign-title" className="text-base font-semibold">
              Assign {selection.count} task{selection.count === 1 ? '' : 's'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The executive list shows only users eligible for EVERY selected task (role + territory).
            </p>
            <div className="mt-4 space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Executive</span>
                <select
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                >
                  <option value="">
                    {pool.isLoading
                      ? 'Loading…'
                      : poolError
                        ? 'Could not load eligible users'
                        : (pool.data?.length ?? 0) === 0
                          ? 'No user is eligible for every selected task'
                          : 'Select…'}
                  </option>
                  {(pool.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Visit type</span>
                  <select
                    className="h-9 w-36 rounded-md border border-border bg-background px-2 text-sm"
                    value={visitType}
                    onChange={(e) => {
                      setVisitType(e.target.value as VisitType);
                      setAssignedTo(''); // pool changes with the visit type
                    }}
                  >
                    {VISIT_TYPES.map((v) => (
                      <option key={v} value={v}>
                        {VISIT_TYPE_LABELS[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Distance band</span>
                  <select
                    className="h-9 w-36 rounded-md border border-border bg-background px-2 text-sm"
                    value={distanceBand}
                    onChange={(e) => setDistanceBand(e.target.value as DistanceBand | '')}
                  >
                    <option value="">Select…</option>
                    {DISTANCE_BANDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Bill count</span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm"
                    value={billCount}
                    onChange={(e) => setBillCount(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-md border border-border px-4 text-sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                onClick={() => void run()}
                disabled={busy || !assignedTo}
              >
                {busy ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
