import type { DashboardStats, PortfolioRow } from '@crm2/sdk';
import { dashboardRepository as repo, type DashboardWindows } from './repository.js';
import type { Actor } from '../../platform/scope/index.js';
import { istMidnightUtcMs } from '../../platform/istTime.js';

const MS_PER_DAY = 86_400_000;
const TREND_WINDOW_DAYS = 7;

/** The dashboard time windows (IST day boundaries) as ISO strings for the scoped scan. */
function windows(): DashboardWindows {
  const now = Date.now();
  const istMidnight = istMidnightUtcMs(now);
  return {
    startOfToday: new Date(istMidnight).toISOString(),
    startOfYesterday: new Date(istMidnight - MS_PER_DAY).toISOString(),
    sevenDaysAgo: new Date(now - TREND_WINDOW_DAYS * MS_PER_DAY).toISOString(),
  };
}

/**
 * Dashboard service (ADR-0029). Read-only operations overview: one scoped scan over the actor's
 * visible tasks → pipeline counter + today's throughput/trend + aging. Scope is resolved in the
 * repository via the shared seam (`resolveScope` + `taskScopePredicate`) — no new scope logic, so
 * the dashboard's numbers are exactly the rows the Pipeline would show. Truthful data only.
 */
export const dashboardService = {
  async stats(actor: Actor): Promise<DashboardStats> {
    // Office-pool roles (KYC_VERIFIER) get their OFFICE queue, not the cross-visit pipeline.
    const officeOnly = await repo.isOfficePoolRole(actor.role);
    return repo.stats(actor, windows(), officeOnly);
  },

  async portfolio(actor: Actor): Promise<PortfolioRow[]> {
    return repo.portfolio(actor);
  },
};
