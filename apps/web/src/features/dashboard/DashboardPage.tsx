import { useQuery } from '@tanstack/react-query';
import type { DashboardStats } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';
import { useAuth } from '../../lib/AuthContext.js';
import { formatDateTime } from '../../lib/format.js';
import { CounterBar } from './components/CounterBar.js';
import { KpiCard } from './components/KpiCard.js';
import { AgingBuckets } from './components/AgingBuckets.js';
import { PortfolioTable } from './components/PortfolioTable.js';
import { RosterSummary } from './components/RosterSummary.js';

const BASE = '/api/v2/dashboard';
const QK = 'dashboard';

/**
 * Dashboard — the read-only operations overview (ADR-0029). One scoped scan (`/dashboard/stats`)
 * drives the pipeline counter bar + today's throughput/trend + aging of open work, all filtered to
 * the actor's hierarchy server-side (SA org-wide → KYC_VERIFIER own queue). Every tile routes INTO
 * the Pipeline pre-filtered; the dashboard itself never acts. Truthful data only — no widget shows
 * a number without a real source behind it.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
  const stats = useQuery({
    queryKey: [QK, 'stats'],
    queryFn: () => api<DashboardStats>('GET', `${BASE}/stats`),
  });
  const s = stats.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your operations at a glance{user ? `, ${user.name.split(' ')[0]}` : ''} — pipeline, today's
          throughput and aging across the work you can see.
        </p>
      </div>

      {stats.isError ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Couldn't load the dashboard. Please retry.
        </div>
      ) : (
        <>
          {/* Pipeline counter bar — the universal spine, every cell links into the Pipeline. */}
          <CounterBar stats={s} />

          {/* Today's throughput + the queues that need attention. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              label="Completed Today"
              value={s?.completedToday}
              sub="vs yesterday"
              {...(s ? { trend: { current: s.completedToday, baseline: s.completedYesterday } } : {})}
            />
            <KpiCard label="Assigned Today" value={s?.assignedToday} />
            <KpiCard label="Completed (7d)" value={s?.completed7d} />
            <KpiCard label="Out of TAT" value={s?.outOfTat} to="/pipeline?outOfTat=1" tone="alert" />
            <KpiCard label="Overdue" value={s?.overdue} tone="alert" />
          </div>

          {/* Aging viz + the oldest-unassigned read, side by side. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AgingBuckets stats={s} />
            </div>
            <KpiCard
              label="Oldest Unassigned"
              value={s?.oldestUnassignedAt ? formatDateTime(s.oldestUnassignedAt) : s ? 'None' : undefined}
              sub="awaiting assignment"
              to="/pipeline?status=PENDING"
            />
          </div>

          {/* Field roster is a supervisor surface (page.field_monitoring). The client × product
              portfolio is part of the dashboard for everyone — it self-scopes to what the role sees. */}
          {has('page.field_monitoring') && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <RosterSummary />
            </div>
          )}
          <PortfolioTable />
        </>
      )}
    </div>
  );
}
