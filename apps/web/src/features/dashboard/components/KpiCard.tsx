import { Link } from 'react-router-dom';

/**
 * A single KPI tile: a hero number with an optional trend delta and an optional drill-in link.
 * `trend` compares the current value to a baseline (e.g. today vs yesterday) and renders a coloured
 * ▲/▼ with the absolute delta — up is `--success`, down is `--destructive`, flat is muted. `tone`
 * overrides the number colour for an alert metric (overdue). The whole tile is a link when `to` is
 * set (read-only overview: tiles route, they don't act). Number is `…` until data arrives.
 */
export function KpiCard({
  label,
  value,
  sub,
  to,
  tone,
  trend,
}: {
  label: string;
  value: number | string | undefined;
  sub?: string;
  to?: string;
  tone?: 'alert';
  trend?: { current: number; baseline: number } | undefined;
}) {
  const numberClass = `mt-1 text-2xl font-bold tabular-nums ${
    tone === 'alert' && typeof value === 'number' && value > 0 ? 'text-st-rejected' : 'text-foreground'
  }`;
  const body = (
    <>
      <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className={numberClass}>{value ?? '…'}</span>
        {trend && <TrendDelta current={trend.current} baseline={trend.baseline} />}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </>
  );
  const cls = 'block rounded-lg border border-border bg-card p-3';
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-border-strong hover:bg-accent`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** ▲/▼ delta vs a baseline — coloured by direction, with a screen-reader phrase. */
function TrendDelta({ current, baseline }: { current: number; baseline: number }) {
  const delta = current - baseline;
  if (delta === 0)
    return (
      <span className="text-xs font-medium tabular-nums text-muted-foreground">
        <span aria-hidden="true">→</span> 0<span className="sr-only"> no change vs previous</span>
      </span>
    );
  const up = delta > 0;
  return (
    <span className={`text-xs font-medium tabular-nums ${up ? 'text-success' : 'text-destructive'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {Math.abs(delta)}
      <span className="sr-only">{up ? ' more than' : ' fewer than'} previous</span>
    </span>
  );
}
