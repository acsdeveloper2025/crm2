import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ExportFormat, KycAttachment, KycTaskRow, PageQuery, Paginated } from '@crm2/sdk';
import { api, apiExport } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/AuthContext.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { DataGrid, type BulkSelection, type DataGridColumn } from '../../components/ui/data-grid/index.js';
import { Button } from '../../components/ui/Button.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { TextArea } from '../../components/ui/TextArea.js';

/**
 * KYC Verification queue (ADR-0085) — the verifier's ONLY work surface. Two tabs over the derived
 * export state: To Export (assigned, never exported) and Exported (first-export event exists). The
 * export buttons ARE the claim action — the server writes the export events in the same request, so
 * a task can never leave twice by accident; Re-export is explicit + reasoned. There is deliberately
 * NO complete/close/submit affordance here (the verifier relays externally; the backend records the
 * result — ADR-0025/0032).
 */

type Tab = 'TO_EXPORT' | 'EXPORTED';
const BASE = '/api/v2/kyc-tasks';

/** Grid columns per tab (keys mirror the server registry — the API validates them). */
const TO_EXPORT_COLS = [
  'taskNumber',
  'caseNumber',
  'clientName',
  'unitName',
  'documentNumber',
  'documentHolderName',
  'documentDetails',
  'trigger',
  'applicantName',
  'attachmentCount',
  'assignedAt',
  'assignedByName',
] as const;
const EXPORTED_COLS = [
  'taskNumber',
  'caseNumber',
  'unitName',
  'documentNumber',
  'documentDetails',
  'trigger',
  'exportedAt',
  'exportedBy',
  'exportCount',
  'status',
] as const;
const LABELS: Record<string, string> = {
  taskNumber: 'Task #',
  caseNumber: 'Case #',
  clientName: 'Client',
  unitName: 'Document type',
  documentNumber: 'Document number',
  documentHolderName: 'Name on document',
  documentDetails: 'Details',
  trigger: 'Trigger',
  applicantName: 'Applicant',
  assignedAt: 'Assigned',
  assignedByName: 'Assigned by',
  attachmentCount: 'Attachments',
  exportedAt: 'Exported',
  exportedBy: 'Exported by',
  exportCount: 'Exports',
  status: 'Task status',
};
const SORTABLE = new Set(['taskNumber', 'caseNumber', 'assignedAt', 'exportedAt']);
const FILTERABLE = new Set([
  'taskNumber',
  'caseNumber',
  'clientName',
  'unitName',
  'documentNumber',
  'trigger',
  'applicantName',
]);

function cellFor(key: string, row: KycTaskRow): ReactNode {
  const v = row[key];
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (key === 'documentDetails' && typeof v === 'object')
    // one line per label — never one flattened blob (owner 2026-07-02)
    return (
      <div className="space-y-0.5">
        {Object.entries(v as Record<string, string>).map(([label, value]) => (
          <div key={label} className="flex gap-2 text-xs">
            <span className="min-w-[110px] text-muted-foreground">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    );
  if (key === 'assignedAt' || key === 'exportedAt') return formatDateTime(String(v));
  if (key === 'status')
    return <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-medium">{String(v)}</span>;
  // attachmentCount is rendered as an interactive button in the columns map (needs a handler).
  return String(v);
}

/** The Attachments cell — a button that opens the own-task download dialog (ADR-0085; the verifier
 *  has no case page, so this is his only way to fetch the creator's reference docs). */
function attachmentCell(
  row: KycTaskRow,
  onOpen: (t: { taskId: string; taskNumber: string }) => void,
): ReactNode {
  const n = Number(row['attachmentCount'] ?? 0);
  if (!n) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      className="rounded bg-surface-muted px-2 py-0.5 text-xs font-medium text-primary hover:underline"
      onClick={() => onOpen({ taskId: String(row['id']), taskNumber: String(row['taskNumber']) })}
    >
      {n} file{n === 1 ? '' : 's'}
    </button>
  );
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function KycQueuePage() {
  const { has } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'EXPORTED' ? 'EXPORTED' : 'TO_EXPORT';
  // Bumped after every export so the grid refetches (rows MOVE between tabs when claimed).
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reexport, setReexport] = useState<{ selection: BulkSelection<KycTaskRow>; reason: string } | null>(
    null,
  );
  const [attach, setAttach] = useState<{ taskId: string; taskNumber: string } | null>(null);
  // Focus-trap + Escape for the re-export dialog (app dialog pattern — adversarial review 2026-07-02).
  const dialogRef = useFocusTrap<HTMLDivElement>(!!reexport, () => setReexport(null));

  const keys = tab === 'TO_EXPORT' ? TO_EXPORT_COLS : EXPORTED_COLS;
  const columns = useMemo<DataGridColumn<KycTaskRow>[]>(
    () =>
      keys.map((k) => ({
        id: k,
        header: LABELS[k] ?? k,
        sortable: SORTABLE.has(k),
        filterable: FILTERABLE.has(k),
        cell: (row: KycTaskRow) =>
          k === 'attachmentCount' ? attachmentCell(row, setAttach) : cellFor(k, row),
      })),
    [keys],
  );

  const canExport = has('kyc_tasks.export');

  if (!has('kyc_tasks.view'))
    return <div className="text-destructive">You don&apos;t have access to the KYC queue.</div>;

  const setTab = (t: Tab): void => {
    const next = new URLSearchParams();
    next.set('tab', t);
    setSearchParams(next, { replace: true });
  };

  const fetchPage = (q: PageQuery): Promise<Paginated<KycTaskRow>> => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
    p.set('state', tab);
    p.set('cols', keys.join(','));
    return api<Paginated<KycTaskRow>>('GET', `${BASE}?${p.toString()}`);
  };

  /** Run an export URL, download the file, refresh the grid (claimed rows move tabs). */
  const runExport = async (params: URLSearchParams, after?: () => void): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const out = await apiExport(`${BASE}/export?${params.toString()}`);
      if (out.kind === 'file') saveBlob(out.blob, out.filename);
      after?.();
      setTick((t) => t + 1);
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as Error).message;
      setError(
        code === 'ALREADY_EXPORTED'
          ? 'Those tasks were already exported — refresh shows them under Exported.'
          : code === 'NOT_RE_EXPORTABLE'
            ? 'Only your already-exported tasks can be re-exported.'
            : `Export failed (${code}).`,
      );
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  };

  const exportParams = (format: ExportFormat, mode: 'selected' | 'all', ids?: string[]): URLSearchParams => {
    const p = new URLSearchParams({ format, mode });
    if (ids?.length) p.set('ids', ids.join(','));
    return p;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">KYC Verification</h1>
          <p className="text-sm text-muted-foreground">
            Export your assigned tasks, verify with the issuing source outside the app, and relay the result
            back — the backend records the official outcome.
          </p>
        </div>
        {tab === 'TO_EXPORT' && canExport && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void runExport(exportParams('csv', 'all'))}
            >
              Export all pending (CSV)
            </Button>
            <Button loading={busy} onClick={() => void runExport(exportParams('xlsx', 'all'))}>
              Export all pending (XLSX)
            </Button>
          </div>
        )}
      </div>

      <Tabs
        tabs={[
          { key: 'TO_EXPORT', label: 'To Export' },
          { key: 'EXPORTED', label: 'Exported' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}

      <DataGrid<KycTaskRow>
        key={tab}
        columns={columns}
        queryKey={`kyc-queue-${tab}-${tick}`}
        rowId={(r) => String(r['id'])}
        fetchPage={fetchPage}
        searchPlaceholder="Search case / document / applicant…"
        dateFilters={tab === 'TO_EXPORT' ? [{ id: 'assignedAt', label: 'Assigned' }] : []}
        loadingLabel="KYC queue"
        selectable={canExport}
        bulkActions={(selection) =>
          tab === 'TO_EXPORT' ? (
            <>
              <Button
                size="sm"
                loading={busy}
                onClick={() =>
                  void runExport(exportParams('xlsx', 'selected', selection.ids), selection.clear)
                }
              >
                Export selected (XLSX)
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() =>
                  void runExport(exportParams('csv', 'selected', selection.ids), selection.clear)
                }
              >
                Export selected (CSV)
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setReexport({ selection, reason: '' })}>
              Re-export…
            </Button>
          )
        }
      />

      {reexport && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/70 p-4"
          onClick={() => setReexport(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Re-export tasks"
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Re-export {reexport.selection.count} task(s)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These tasks were already exported. A reason is required and is recorded permanently.
            </p>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-foreground">Reason (required)</span>
              <TextArea
                value={reexport.reason}
                onChange={(e) => setReexport({ ...reexport, reason: e.target.value })}
                placeholder="e.g. email to the issuing source bounced"
                rows={3}
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReexport(null)}>
                Cancel
              </Button>
              <Button
                disabled={!reexport.reason.trim()}
                loading={busy}
                onClick={() => {
                  const p = exportParams('xlsx', 'selected', reexport.selection.ids);
                  p.set('reexportReason', reexport.reason.trim());
                  void runExport(p, () => {
                    reexport.selection.clear();
                    setReexport(null);
                  });
                }}
              >
                Re-export (XLSX)
              </Button>
            </div>
          </div>
        </div>
      )}

      {attach && <AttachmentsDialog task={attach} onClose={() => setAttach(null)} />}
    </div>
  );
}

/** Own-task reference-document downloader (ADR-0085). Lists the task's attachments (scoped server-side
 *  to the verifier's own task) and opens a presigned URL per file — the verifier's only doc-fetch path
 *  now that he has no case page. */
function AttachmentsDialog({
  task,
  onClose,
}: {
  task: { taskId: string; taskNumber: string };
  onClose: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['kyc-attachments', task.taskId],
    queryFn: () => api<KycAttachment[]>('GET', `/api/v2/kyc-tasks/${task.taskId}/attachments`),
  });

  const download = async (a: KycAttachment): Promise<void> => {
    setDownloadingId(a.id);
    try {
      const { url } = await api<{ url: string }>(
        'GET',
        `/api/v2/kyc-tasks/${task.taskId}/attachments/${a.id}/url`,
      );
      window.open(url, '_blank', 'noopener');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/70 p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Task attachments"
        className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Attachments — {task.taskNumber}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reference documents attached to your task. Click to download.
        </p>
        <div className="mt-3 space-y-2">
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : list.isError ? (
            <p className="text-sm text-destructive">Couldn&apos;t load attachments.</p>
          ) : (list.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No attachments.</p>
          ) : (
            list.data!.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded border border-border p-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm" title={a.originalName}>
                  {a.originalName}
                </span>
                <Button size="sm" loading={downloadingId === a.id} onClick={() => void download(a)}>
                  Download
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
