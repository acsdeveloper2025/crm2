import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import type { JobType, JobView, NotifyInput } from '@crm2/sdk';
import { AppError } from '../errors.js';
import { getRealtime } from '../realtime/index.js';
import { jobRepository } from './repository.js';

/**
 * Background-job engine (ADR-0030, B-7). The config-gated seam for the >8s / ≥10k worker tier,
 * mirroring platform/realtime/storage/geocode: a process with Valkey runs jobs on a BullMQ worker
 * (added in the worker slice); without it, jobs run in-process after the HTTP response (dev/tests need
 * no Valkey, exactly as realtime degrades to its in-memory adapter). Both paths call the SAME runJob,
 * so the contract — progress events, completion notification — is identical.
 *
 * Persistence lives in ./repository (the jobs table). Producers call `enqueue(type, payload, userId)`;
 * domains register a processor per type at boot via `registerJobProcessor`.
 */
export interface JobContext {
  jobId: string;
  userId: string;
  payload: unknown;
  /** Report real progress (0..100, clamped) + an optional stage label → row + a `job:progress` event. */
  progress(pct: number, stage?: string): Promise<void>;
}
export type JobProcessor = (ctx: JobContext) => Promise<Record<string, unknown>>;

const processors = new Map<JobType, JobProcessor>();

/** Register the processor for a job type (called at api + worker boot). Last registration wins. */
export function registerJobProcessor(type: JobType, fn: JobProcessor): void {
  processors.set(type, fn);
}
export function hasJobProcessor(type: JobType): boolean {
  return processors.has(type);
}

/**
 * Completion notifier (injected at boot to keep platform free of module deps, like setRealtime). Boot
 * wires this to notificationService.notify so a finished job lands in the bell + a toast. Optional —
 * unset in a bare worker/test, where the socket `job:done` event still fires.
 */
type JobNotifier = (n: NotifyInput) => void;
let notifier: JobNotifier | null = null;
export function setJobNotifier(fn: JobNotifier | null): void {
  notifier = fn;
}

// In-flight in-process runs, so tests can deterministically await completion (no Valkey).
const inFlight = new Set<Promise<void>>();
/** Test helper: resolve once every in-process job started so far has settled. */
export async function awaitAllJobs(): Promise<void> {
  await Promise.all([...inFlight]);
}

// Harden the engine against a misbehaving processor: a NaN/∞ progress would violate the row's
// `progress int CHECK 0..100` and fail the job — coerce to 0 instead.
const clampPct = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0);

function emit(userId: string, event: string, payload: unknown): void {
  getRealtime().emitToUser(userId, event, payload);
}

const DONE_TITLE: Record<JobType, string> = {
  EXPORT: 'Export ready to download',
  IMPORT: 'Import complete',
  CASE_REPORT: 'Report ready to download',
};
const FAIL_TITLE: Record<JobType, string> = {
  EXPORT: 'Export failed',
  IMPORT: 'Import failed',
  CASE_REPORT: 'Report generation failed',
};

// Job types whose completed artifact is downloaded via a presigned URL (DOWNLOAD action in the bell).
const DOWNLOAD_TYPES: ReadonlySet<JobType> = new Set<JobType>(['EXPORT', 'CASE_REPORT']);

/** Run a job to terminal state: RUNNING → SUCCEEDED|FAILED, emitting progress + a completion notice. */
export async function runJob(jobId: string, type: JobType, payload: unknown, userId: string): Promise<void> {
  const proc = processors.get(type);
  if (!proc) {
    await jobRepository.setFailed(jobId, `NO_PROCESSOR:${type}`);
    emit(userId, 'job:done', { id: jobId, status: 'FAILED', progress: 0 });
    logger.error('job has no registered processor', { jobId, type });
    return;
  }
  await jobRepository.setRunning(jobId);
  emit(userId, 'job:progress', { id: jobId, status: 'RUNNING', progress: 0, stage: null });
  try {
    const result = await proc({
      jobId,
      userId,
      payload,
      progress: async (pct, stage) => {
        const p = clampPct(pct);
        await jobRepository.setProgress(jobId, p, stage ?? null);
        emit(userId, 'job:progress', { id: jobId, status: 'RUNNING', progress: p, stage: stage ?? null });
      },
    });
    await jobRepository.setSucceeded(jobId, result);
    emit(userId, 'job:done', { id: jobId, status: 'SUCCEEDED', progress: 100 });
    notifier?.({
      userId,
      type: 'JOB_COMPLETED',
      title: DONE_TITLE[type],
      payload: { jobId, jobType: type },
      actionType: DOWNLOAD_TYPES.has(type) ? 'DOWNLOAD' : 'NAVIGATE',
    });
  } catch (e) {
    const code = e instanceof AppError ? e.code : e instanceof Error ? e.message : 'JOB_FAILED';
    await jobRepository.setFailed(jobId, code);
    emit(userId, 'job:done', { id: jobId, status: 'FAILED', progress: 0 });
    notifier?.({
      userId,
      type: 'JOB_FAILED',
      title: FAIL_TITLE[type],
      payload: { jobId, jobType: type },
      actionType: 'NAVIGATE',
    });
    logger.warn('job failed', { jobId, type, error: code });
  }
}

/** The BullMQ queue name (Valkey). Distinct prefix so it never collides with another app's keys. */
const JOB_QUEUE = 'acs-jobs';

// Lazy BullMQ queue, resolved once (promise-cached so concurrent first-calls share one Queue).
let queuePromise: Promise<import('bullmq').Queue | null> | undefined;

/** Parse REDIS_QUEUE_URL into BullMQ connection options (it owns the ioredis connection). */
function connectionOpts(url: string): import('bullmq').ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}), // TLS Valkey (prod)
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

function getQueue(): Promise<import('bullmq').Queue | null> {
  queuePromise ??= (async (): Promise<import('bullmq').Queue | null> => {
    const url = loadEnv().REDIS_QUEUE_URL;
    if (!url) return null;
    const { Queue } = await import('bullmq');
    const q = new Queue(JOB_QUEUE, { connection: connectionOpts(url) });
    logger.info('jobs: BullMQ queue ready (out-of-process worker tier)');
    return q;
  })();
  return queuePromise;
}

/**
 * Enqueue a job: INSERT a PENDING row, then dispatch. With REDIS_QUEUE_URL set the job is added to the
 * BullMQ queue and a ROLE=worker process runs it out-of-process; otherwise it runs in-process on the
 * next tick (dev/tests need no Valkey). Either path runs the SAME runJob. Returns the PENDING tray row.
 */
export async function enqueue(type: JobType, payload: unknown, userId: string): Promise<JobView> {
  const job = await jobRepository.insert(type, payload, userId);
  const q = await getQueue().catch((e: unknown) => {
    logger.warn('jobs: queue init failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (q) {
    try {
      await q.add(
        'run',
        { jobId: job.id, type, payload, userId },
        { removeOnComplete: true, removeOnFail: 500 },
      );
      logger.info('jobs: enqueued to BullMQ', { jobId: job.id, type });
      return job;
    } catch (e) {
      // Valkey unreachable at runtime → degrade to in-process rather than 500 + orphan PENDING row.
      logger.warn('jobs: BullMQ enqueue failed — running in-process', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const run = runJob(job.id, type, payload, userId).catch((e: unknown) =>
    logger.error('job run crashed', { jobId: job.id, error: e instanceof Error ? e.message : String(e) }),
  );
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run));
  return job;
}

/**
 * Start the BullMQ worker that consumes the queue and runs each job out-of-process (the ROLE=worker
 * boot). No-op (warns) when REDIS_QUEUE_URL is unset. runJob already writes FAILED on a processor
 * error, so the BullMQ job rarely rejects; the `failed` handler is a backstop for unexpected throws.
 */
export async function startJobWorker(): Promise<void> {
  const url = loadEnv().REDIS_QUEUE_URL;
  if (!url) {
    logger.warn('worker: REDIS_QUEUE_URL unset — no queue to consume');
    return;
  }
  const { Worker } = await import('bullmq');
  const worker = new Worker(
    JOB_QUEUE,
    async (bullJob) => {
      const d = bullJob.data as { jobId: string; type: JobType; payload: unknown; userId: string };
      await runJob(d.jobId, d.type, d.payload, d.userId);
    },
    { connection: connectionOpts(url), concurrency: 4 },
  );
  worker.on('failed', (j, err) =>
    logger.warn('bullmq job failed', { id: j?.id, error: err instanceof Error ? err.message : String(err) }),
  );
  logger.info('job worker listening', { queue: JOB_QUEUE });
}
