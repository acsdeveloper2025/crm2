import { logger } from '@crm2/logger';
import { AppError } from '../errors.js';
import { caseRepository } from '../../modules/cases/repository.js';
import { emitTaskUpdate } from '../../modules/cases/case-events.js';
import { notifyTaskRevoked } from '../../modules/notifications/service.js';
import { AUTO_REVOKE_REASON, SYSTEM_ACTOR_ID, TASK_ABANDONED_DAYS } from './overdue.js';

/**
 * Auto-revoke tasks an agent has held past the abandonment window (ADR-0095).
 *
 * Owner (2026-07-16): "for assign and inprogress task older than 45 days make them auto revoke so
 * backend user understand task auto revoke."
 *
 * WHY THE SERVER OWNS THIS. The device's retention sweep used to delete any task older than 45 days
 * regardless of status, so a job ASSIGNED 46 days ago that the agent never did simply vanished off the
 * phone — and because down-sync is incremental (`?lastSyncTimestamp=`), an unchanged task is never
 * re-sent, so it never came back. The agent silently lost work they still owed, and the office was never
 * told. Mobile now reaps terminal states only; this is the other half. It cannot live on the device: a
 * device-side revoke only fires when THAT agent opens the app, so an agent on leave or with a lost phone
 * would hold the task forever and the backend user — the very person the owner wants informed — would
 * never hear about it.
 *
 * The notification IS the deliverable, not the status change: the revoked row can never be re-assigned
 * in place (`assignTask` requires PENDING), so a human must dispatch a replacement via
 * `reassignRevokedTask`. Nothing auto-reassigns — picking an agent for work that already sat 45 days
 * would hide the exact fact this exists to surface.
 */
export interface AbandonSweepResult {
  revoked: number;
  failed: number;
}

/**
 * The per-tick cap. The FIRST run revokes the entire historical backlog, and every row fires
 * notifications — so the batch is bounded and the remainder is taken on the next tick. At hourly ticks a
 * backlog of any realistic size drains within a day, against a 45-day window.
 */
export const ABANDON_SWEEP_BATCH = 200;

/** How often the api role sweeps. Hourly — see startAbandonSweep in main.ts for why not daily. */
export const ABANDON_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first tick so boot isn't competing with a sweep for the connection pool. */
export const ABANDON_SWEEP_FIRST_DELAY_MS = 60 * 1000;

/**
 * One pass. Safe to call concurrently with anything: each row is re-guarded by the UPDATE's own
 * `WHERE status IN ('ASSIGNED','IN_PROGRESS')`, so a task submitted between the SELECT and the UPDATE
 * throws INVALID_TRANSITION and is skipped rather than clobbering the agent's submission.
 */
export async function runAbandonSweep(batch: number = ABANDON_SWEEP_BATCH): Promise<AbandonSweepResult> {
  const due = await caseRepository.listAbandonedTasks(batch);
  if (due.length === 0) {
    return { revoked: 0, failed: 0 };
  }

  let revoked = 0;
  let failed = 0;

  for (const task of due) {
    try {
      // The repository write, NOT casesService.revokeTask: that resolves a scope for its actor, and
      // scope fail-closes an unknown role to SELF — a system actor would match no task and silently
      // revoke nothing. Going direct still reuses the audit row, the revoked_at stamp (mig 0119) and the
      // case-status rollup.
      const view = await caseRepository.revokeTaskInPlace(
        task.caseId,
        task.id,
        SYSTEM_ACTOR_ID,
        AUTO_REVOKE_REASON,
      );

      // The office user who dispatched it — the recipient the owner asked for ("so backend user
      // understand"). The device path notifies this party; the office path notifies the agent instead,
      // which is the wrong party for an unattended revoke.
      notifyTaskRevoked(view, task.assignedBy, SYSTEM_ACTOR_ID);
      // ...and the agent, whose device drops the task on TASK_REVOKED. Both fire: notifyTaskLifecycle
      // no-ops only when the recipient is missing or IS the actor, and a nil-UUID actor is neither.
      notifyTaskRevoked(view, task.assignedTo, SYSTEM_ACTOR_ID);
      emitTaskUpdate(view); // live office refresh, same as the human revoke paths

      revoked += 1;
    } catch (err) {
      // A racing submit/revoke → INVALID_TRANSITION. Per-row, so one racing task cannot abort the sweep
      // and strand the rest of the batch.
      failed += 1;
      const conflict = err instanceof AppError;
      logger.warn(
        conflict ? 'abandon-sweep: task changed under us, skipped' : 'abandon-sweep: revoke failed',
        {
          taskId: task.id,
          caseId: task.caseId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  logger.info('abandon-sweep: auto-revoked tasks past the abandonment window', {
    revoked,
    failed,
    windowDays: TASK_ABANDONED_DAYS,
  });
  return { revoked, failed };
}
