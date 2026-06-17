import type { DashboardStats } from '@crm2/sdk';

/**
 * Aging of open held work as one proportional bar (severity-ramped, token-coloured) + a legend.
 * Buckets are time-since-assignment: fresh ≤24h (healthy) → 24-48h → 48-72h → >72h (critical).
 * Pure-CSS proportional segments (no charting dep); each segment's width is its share of the open
 * total. Truthful: when there is no open work the bar is an empty "No open work" state, never a
 * fabricated sliver. Accessible: the bar is one `img` with a text description; the legend repeats
 * the exact counts for non-visual reads.
 */
const SEGMENTS: { key: keyof DashboardStats; label: string; bar: string; dot: string }[] = [
  { key: 'agingFresh', label: '≤24h', bar: 'bg-st-approved', dot: 'bg-st-approved' },
  { key: 'aging1d', label: '24–48h', bar: 'bg-st-pending', dot: 'bg-st-pending' },
  { key: 'aging2d', label: '48–72h', bar: 'bg-st-submitted', dot: 'bg-st-submitted' },
  { key: 'aging3dPlus', label: '>72h', bar: 'bg-st-rejected', dot: 'bg-st-rejected' },
];

export function AgingBuckets({ stats }: { stats: DashboardStats | undefined }) {
  const rows = SEGMENTS.map((s) => ({ ...s, count: (stats?.[s.key] as number | undefined) ?? 0 }));
  const total = rows.reduce((a, r) => a + r.count, 0);
  const desc = rows.map((r) => `${r.label}: ${r.count}`).join(', ');

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Open work by age</div>

      {stats === undefined ? (
        <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none" />
      ) : total === 0 ? (
        <div className="mt-3 flex h-3 w-full items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground">
          No open work
        </div>
      ) : (
        <div
          className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="img"
          aria-label={`Open work by age — ${desc}`}
        >
          {rows.map((r) =>
            r.count > 0 ? (
              <div
                key={r.key}
                className={r.bar}
                style={{ width: `${(r.count / total) * 100}%` }}
                title={`${r.label}: ${r.count}`}
              />
            ) : null,
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${r.dot}`} aria-hidden="true" />
            <span className="text-xs text-muted-foreground">{r.label}</span>
            <span className="text-xs font-medium tabular-nums text-foreground">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
