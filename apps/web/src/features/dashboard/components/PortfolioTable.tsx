import { useQuery } from '@tanstack/react-query';
import type { PortfolioRow } from '@crm2/sdk';
import { api } from '../../../lib/sdk.js';
import { Button } from '../../../components/ui/Button.js';

/**
 * Portfolio rollup (Zion's Home table, scoped) — client × product with pending/completed/total case
 * counts, SA/MANAGER only. A tiny inline-SVG completion bar per row (no charting dep) reads the
 * pending↔completed split at a glance. Truthful: an empty scope renders an explicit empty state,
 * never a fabricated row. `.rtable` collapses each row to a card below md.
 */
export function PortfolioTable() {
  const q = useQuery({
    queryKey: ['dashboard', 'portfolio'],
    queryFn: () => api<PortfolioRow[]>('GET', '/api/v2/dashboard/portfolio'),
  });
  const rows = q.data;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        Portfolio — client × product
      </div>
      {q.isError ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <span>Couldn’t load the portfolio.</span>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : q.isLoading ? (
        <div className="p-3">
          <div className="h-24 w-full animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No cases in your scope yet.</div>
      ) : (
        <table className="w-full rtable text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-semibold">Client</th>
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 text-right font-semibold">Pending</th>
              <th className="px-3 py-2 text-right font-semibold">Completed</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              <th className="px-3 py-2 font-semibold">Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.clientId}-${r.productId}`} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium" data-label="Client">
                  {r.clientName}
                </td>
                <td className="px-3 py-2 text-muted-foreground" data-label="Product">
                  {r.productName}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" data-label="Pending">
                  {r.pending}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" data-label="Completed">
                  {r.completed}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums" data-label="Total">
                  {r.total}
                </td>
                <td className="px-3 py-2" data-label="Progress">
                  <CompletionBar pending={r.pending} completed={r.completed} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A hairline completion bar: completed (approved token) vs pending (pending token). Accessible. */
function CompletionBar({ pending, completed }: { pending: number; completed: number }) {
  const known = pending + completed;
  const pct = known > 0 ? Math.round((completed / known) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`${pct}% complete — ${completed} of ${known}`}
      >
        <div className="h-full bg-st-approved" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}
