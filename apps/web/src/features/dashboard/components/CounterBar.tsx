import { Link } from 'react-router-dom';
import type { DashboardStats } from '@crm2/sdk';

/**
 * The pipeline counter bar (Zion's spine, subtree-scoped) — the dashboard's at-a-glance hero. One
 * card per pipeline state, each a link INTO the Pipeline pre-filtered to that status (read-only
 * overview: the dashboard never acts, it routes). Status hues are the frozen `--st-*` tokens, so
 * the bar reads the same colour language as the Pipeline badges. `…` until the scoped scan returns.
 */
// `to` overrides the default /pipeline?status= link (e.g. the case-grain Awaiting Completion queue
// lives on the Cases list, not the task Pipeline).
const CELLS: { label: string; stat: keyof DashboardStats; status: string; dot: string; to?: string }[] = [
  { label: 'Bucket', stat: 'bucket', status: 'PENDING', dot: 'bg-st-pending' },
  { label: 'Assigned', stat: 'assigned', status: 'ASSIGNED', dot: 'bg-st-assigned' },
  { label: 'In Progress', stat: 'inProgress', status: 'IN_PROGRESS', dot: 'bg-st-in-progress' },
  {
    label: 'Awaiting Completion',
    stat: 'awaitingCompletion',
    status: 'AWAITING_COMPLETION',
    dot: 'bg-st-under-review',
    // Cases grid honors DataGrid column-filter URL keys (`f_<id>`), not a bespoke `?status=` bridge.
    to: '/cases?f_status=AWAITING_COMPLETION',
  },
  { label: 'Completed', stat: 'completed', status: 'COMPLETED', dot: 'bg-st-approved' },
  { label: 'Revoked', stat: 'revoked', status: 'REVOKED', dot: 'bg-st-rejected' },
];

export function CounterBar({ stats }: { stats: DashboardStats | undefined }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {CELLS.map((c) => {
        const v = stats?.[c.stat] as number | undefined;
        return (
          <Link
            key={c.stat}
            to={c.to ?? `/pipeline${c.status ? `?status=${c.status}` : ''}`}
            className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-border-strong hover:bg-accent"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} aria-hidden="true" />
              <span className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                {c.label}
              </span>
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{v ?? '…'}</div>
          </Link>
        );
      })}
    </div>
  );
}
