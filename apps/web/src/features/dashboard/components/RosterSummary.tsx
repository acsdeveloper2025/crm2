import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { FieldMonitoringStats } from '@crm2/sdk';
import { api } from '../../../lib/sdk.js';

/**
 * Field roster summary — reuses the Field Monitoring `/stats` endpoint verbatim (no new API), so the
 * dashboard and the console can never disagree. Shown to roles with `page.field_monitoring`
 * (SA/MANAGER/TEAM_LEADER); the whole card links into the full console. Scoped server-side.
 */
const CELLS: { label: string; stat: keyof FieldMonitoringStats; tone?: 'alert' }[] = [
  { label: 'Field Agents', stat: 'agents' },
  { label: 'With Open Work', stat: 'withOpenWork' },
  { label: 'Open Tasks', stat: 'openTasks' },
  { label: 'Overdue', stat: 'overdue', tone: 'alert' },
];

export function RosterSummary() {
  const q = useQuery({
    queryKey: ['dashboard', 'roster'],
    queryFn: () => api<FieldMonitoringStats>('GET', '/api/v2/field-monitoring/stats'),
  });
  const s = q.data;
  return (
    <Link
      to="/field-monitoring"
      className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-border-strong hover:bg-accent"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Field roster</div>
      {q.isError ? (
        <div className="mt-2 text-sm text-muted-foreground">Couldn't load the roster.</div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {CELLS.map((c) => {
            const v = s?.[c.stat];
            return (
              <div key={c.stat}>
                <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </div>
                <div
                  className={`text-xl font-bold tabular-nums ${
                    c.tone === 'alert' && (v ?? 0) > 0 ? 'text-st-rejected' : 'text-foreground'
                  }`}
                >
                  {v ?? '…'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Link>
  );
}
