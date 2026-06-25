import { useQuery } from '@tanstack/react-query';
import type { SystemHealth } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { formatDateTime } from '../../lib/format.js';

const COUNT_LABELS: { key: keyof SystemHealth['counts']; label: string }[] = [
  { key: 'clients', label: 'Clients' },
  { key: 'products', label: 'Products' },
  { key: 'verificationUnits', label: 'Verification Units' },
  { key: 'rates', label: 'Rates' },
  { key: 'locations', label: 'Locations (Areas)' },
  { key: 'users', label: 'Users' },
];

const REFETCH_MS = 15000;

export function SystemPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api<SystemHealth>('GET', '/api/v2/system/health'),
    refetchInterval: REFETCH_MS,
  });

  const ok = data?.status === 'ok';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">System Health</h1>
        <p className="text-sm text-muted-foreground">
          Live diagnostics for the API and database. Auto-refreshes every 15 seconds.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to reach the API.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Status">
              <span
                className={`rounded px-2 py-0.5 text-sm font-semibold ${
                  ok ? 'bg-st-approved-bg text-st-approved' : 'bg-st-rejected-bg text-st-rejected'
                }`}
              >
                {data.status}
              </span>
            </Card>
            <Card label="Environment">
              <span className="text-lg font-bold">{data.environment}</span>
            </Card>
            <Card label="Database">
              <span className={`text-lg font-bold ${data.database.connected ? '' : 'text-destructive'}`}>
                {data.database.connected ? `Connected · ${data.database.latencyMs} ms` : 'Disconnected'}
              </span>
            </Card>
            <Card label="Server Time">
              <span className="text-lg font-bold tabular-nums">
                {data.serverTime ? formatDateTime(data.serverTime) : '—'}
              </span>
            </Card>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Record Counts
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {COUNT_LABELS.map(({ key, label }) => (
                <div key={key} className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="mt-0.5 text-2xl font-bold tabular-nums">
                    {data.counts[key].toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
