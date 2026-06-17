import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';

/**
 * Dedicated reverse-geocode queue (ADR-0040, S4 Slice B) — async-on-upload for FIELD photos, mirroring
 * v1's `reverseGeocodeQueue` and the platform/jobs degradation contract. With REDIS_QUEUE_URL set the
 * job runs out-of-process on a BullMQ worker (3 attempts, exp backoff); without it, it runs in-process
 * after the HTTP response (dev/tests need no Valkey). A job that exhausts retries (or fails the single
 * in-process attempt) is dead-lettered. The on-view fallback (Slice A) still recovers any missed photo.
 *
 * Kept generic: the domain work (resolve+persist into case_attachments) and the DLQ write are injected
 * at boot (registerJobs), so platform never imports a feature module — exactly like registerJobProcessor.
 */
export interface ReverseGeocodeJob {
  attachmentId: string;
  lat: number;
  lng: number;
}

/** Resolve+persist one field photo's address; THROWS to request a BullMQ retry (transient failure). */
type Processor = (job: ReverseGeocodeJob) => Promise<void>;
let processor: Processor | null = null;
export function registerReverseGeocodeProcessor(fn: Processor): void {
  processor = fn;
}

/** Record a job that exhausted retries (BullMQ) or failed its single in-process attempt → DLQ. */
type DeadLetter = (job: ReverseGeocodeJob, error: string) => Promise<void>;
let deadLetter: DeadLetter | null = null;
export function setReverseGeocodeDeadLetter(fn: DeadLetter): void {
  deadLetter = fn;
}

// In-flight in-process runs so tests can deterministically await completion (no Valkey).
const inFlight = new Set<Promise<void>>();
/** Test helper: resolve once every in-process geocode started so far has settled. */
export async function awaitAllReverseGeocodeJobs(): Promise<void> {
  await Promise.all([...inFlight]);
}

const QUEUE = 'crm2-geocode';
const ATTEMPTS = 3;

async function runProcessor(job: ReverseGeocodeJob): Promise<void> {
  if (!processor) {
    logger.warn('reverse-geocode: no processor registered', { attachmentId: job.attachmentId });
    return;
  }
  await processor(job);
}

/** Parse REDIS_QUEUE_URL into BullMQ connection options (mirrors platform/jobs). */
function connectionOpts(url: string): import('bullmq').ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

let queuePromise: Promise<import('bullmq').Queue | null> | undefined;
function getQueue(): Promise<import('bullmq').Queue | null> {
  queuePromise ??= (async (): Promise<import('bullmq').Queue | null> => {
    const url = loadEnv().REDIS_QUEUE_URL;
    if (!url) return null;
    const { Queue } = await import('bullmq');
    const q = new Queue(QUEUE, { connection: connectionOpts(url) });
    logger.info('reverse-geocode: BullMQ queue ready');
    return q;
  })();
  return queuePromise;
}

/**
 * Enqueue a reverse-geocode for one field photo. With Valkey → BullMQ (a ROLE=worker runs it, retries +
 * DLQ on exhaustion); otherwise → in-process after the response (single attempt; DLQ on failure). Fire-
 * and-forget: never blocks or fails the upload — the photo is the evidence, the address is best-effort.
 */
export async function enqueueReverseGeocode(job: ReverseGeocodeJob): Promise<void> {
  const q = await getQueue().catch((e: unknown) => {
    logger.warn('reverse-geocode: queue init failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (q) {
    try {
      await q.add('reverse', job, {
        jobId: `attach:${job.attachmentId}`, // at-most-one in-flight per attachment (dedup)
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      });
      return;
    } catch (e) {
      logger.warn('reverse-geocode: enqueue failed — running in-process', {
        attachmentId: job.attachmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const run = runProcessor(job).catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('reverse-geocode in-process failed', { attachmentId: job.attachmentId, error: msg });
    await deadLetter?.(job, msg).catch(() => undefined);
  });
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run));
}

/** Start the BullMQ worker that consumes the queue out-of-process (ROLE=worker boot). No-op without
 *  REDIS_QUEUE_URL. On final-attempt failure the job is dead-lettered for admin replay. */
export async function startReverseGeocodeWorker(): Promise<void> {
  const url = loadEnv().REDIS_QUEUE_URL;
  if (!url) {
    logger.warn('reverse-geocode worker: REDIS_QUEUE_URL unset — no queue to consume');
    return;
  }
  const { Worker } = await import('bullmq');
  const worker = new Worker(
    QUEUE,
    async (bullJob) => {
      await runProcessor(bullJob.data as ReverseGeocodeJob);
    },
    { connection: connectionOpts(url), concurrency: 5 },
  );
  worker.on('failed', (bullJob, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (bullJob && (bullJob.attemptsMade ?? 0) >= ATTEMPTS) {
      void deadLetter?.(bullJob.data as ReverseGeocodeJob, msg).catch(() => undefined);
    } else {
      logger.warn('reverse-geocode job will retry', { id: bullJob?.id, error: msg });
    }
  });
  logger.info('reverse-geocode worker listening', { queue: QUEUE });
}
