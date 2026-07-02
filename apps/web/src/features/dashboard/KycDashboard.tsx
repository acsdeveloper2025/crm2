import { useQuery } from '@tanstack/react-query';
import type { KycTaskRow, Paginated } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';
import { KpiCard } from './components/KpiCard.js';

const BASE = '/api/v2/kyc-tasks';

/** One state's count (+ the oldest row for the "waiting longest" read) — reuses the shipped queue
 *  endpoint (kyc_tasks.view), so no new API. pageSize=1: we only need totalCount + the head row. */
function useQueueState(state: 'TO_EXPORT' | 'EXPORTED', oldestFirst = false) {
  return useQuery({
    queryKey: ['kyc-dash', state, oldestFirst],
    queryFn: () => {
      const p = new URLSearchParams({ state, pageSize: '1' });
      if (oldestFirst) {
        p.set('sortBy', 'assignedAt');
        p.set('sortOrder', 'asc');
      }
      return api<Paginated<KycTaskRow>>('GET', `${BASE}?${p.toString()}`);
    },
  });
}

/**
 * KYC-verifier dashboard (ADR-0085) — the read-only KYC verifier's landing surface. The shared ops
 * dashboard is pipeline-centric (its tiles link into /pipeline, which the verifier can't open), so
 * he gets his own: the two queue counts + how long the oldest task has been waiting to export, each
 * routing INTO /kyc-queue. No completion/close metric (he never completes — ADR-0025). Numbers come
 * from the same scoped /kyc-tasks read-model as the queue, so they match exactly.
 */
export function KycDashboard({ name }: { name?: string }) {
  const toExport = useQueueState('TO_EXPORT', true);
  const exported = useQueueState('EXPORTED');

  const toExportCount = toExport.data?.totalCount;
  const exportedCount = exported.data?.totalCount;
  const total =
    toExportCount !== undefined && exportedCount !== undefined ? toExportCount + exportedCount : undefined;
  const oldestAt = toExport.data?.items[0]?.['assignedAt'];

  const isError = toExport.isError || exported.isError;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">KYC Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your KYC verification queue at a glance{name ? `, ${name.split(' ')[0]}` : ''} — export your
          assigned tasks, verify them with the source outside the app, and relay the result back.
        </p>
      </div>

      {isError ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Couldn&apos;t load your KYC queue. Please retry.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard
              label="To Export"
              value={toExportCount}
              sub="assigned, not yet exported — click to work"
              to="/kyc-queue?tab=TO_EXPORT"
              tone="alert"
            />
            <KpiCard
              label="Exported"
              value={exportedCount}
              sub="already exported — click to review"
              to="/kyc-queue?tab=EXPORTED"
            />
            <KpiCard label="Total Assigned" value={total} sub="all your KYC tasks" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <KpiCard
                label="Oldest Waiting to Export"
                value={oldestAt ? formatDateTime(String(oldestAt)) : toExport.data ? 'None' : undefined}
                sub="the task that has waited longest — export it next"
                to="/kyc-queue?tab=TO_EXPORT"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
