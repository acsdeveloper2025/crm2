/**
 * @crm2/sdk — Dashboard (read-only operations overview). One scoped scan over the actor's
 * visible tasks (`case_tasks ct` JOIN `cases cs`, hierarchy-filtered via the scope seam):
 * the pipeline counter bar + today's throughput/trend + aging of open work. Every field is a
 * real aggregate — no fabricated metric. Widgets without a truthful source (activity feed,
 * revisit/recheck, device idle/active) are deliberately absent, not zero-filled.
 */
export interface DashboardStats {
  // ── Pipeline counter bar (point-in-time, scoped) ──
  /** PENDING — created, not yet assigned (the unassigned "bucket"). */
  bucket: number;
  assigned: number;
  inProgress: number;
  /** CASE-grain (ADR-0032): cases in AWAITING_COMPLETION — all tasks done, awaiting the office to
   *  record the final verdict + close. This is the office completion queue (replaces the old
   *  task-level SUBMITTED_FOR_REVIEW count, which the two-track model retired). */
  awaitingCompletion: number;
  /** COMPLETED — all-time within scope. */
  completed: number;
  revoked: number;
  /** Out of TAT (ADR-0032): OPEN tasks past their priority SLA (URGENT 12h/HIGH 24h/MEDIUM 48h/LOW 72h). */
  outOfTat: number;

  // ── Today's throughput + trend ──
  /** tasks assigned since IST start-of-day. */
  assignedToday: number;
  /** tasks completed since IST start-of-day. */
  completedToday: number;
  /** tasks completed during the prior IST day (the throughput trend baseline). */
  completedYesterday: number;
  /** tasks completed in the trailing 7 days. */
  completed7d: number;

  // ── Aging of open work (held tasks by time-since-assignment) ──
  /** open & assigned more than 24h ago — the headline overdue count (= aging1d+aging2d+aging3dPlus). */
  overdue: number;
  /** open, assigned within the last 24h (fresh, not yet overdue). */
  agingFresh: number;
  /** open, assigned 24–48h ago. */
  aging1d: number;
  /** open, assigned 48–72h ago. */
  aging2d: number;
  /** open, assigned more than 72h ago. */
  aging3dPlus: number;
  /** oldest still-unassigned task's creation time; null when nothing is pending. */
  oldestUnassignedAt: string | null;
}

/**
 * One client × product row of the portfolio rollup (SA/MANAGER overview). Case-grain counts within
 * the viewer's scope: `pending` = NEW + IN_PROGRESS, `completed` = COMPLETED, `total` = all cases.
 */
export interface PortfolioRow {
  clientId: number;
  productId: number;
  clientName: string;
  productName: string;
  pending: number;
  completed: number;
  total: number;
}
