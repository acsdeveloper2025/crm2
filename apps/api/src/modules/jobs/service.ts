import type { JobResultUrl, JobView, Paginated } from '@crm2/sdk';
import { jobRepository } from '../../platform/jobs/repository.js';
import { resolvePage, buildPage, type PageSpec } from '../../platform/pagination.js';
import { getStorage } from '../../platform/storage/index.js';
import { AppError } from '../../platform/errors.js';

/** Newest-first; only createdAt is sortable (the tray is a chronological list). */
const JOB_PAGE_SPEC: PageSpec = {
  sortMap: { createdAt: 'created_at' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
};

/**
 * Background-job read API (ADR-0030). Own-user scoped (identity, not a permission — like the
 * notification feed): every read filters by created_by = actor; a non-owner `:id` 404s (IDOR-safe).
 * Jobs are created by producers (export/import) via platform/jobs `enqueue`, not here.
 */
export const jobService = {
  async list(userId: string, rawQuery: Record<string, unknown>): Promise<Paginated<JobView>> {
    const page = resolvePage(rawQuery, JOB_PAGE_SPEC);
    const [items, totalCount] = await Promise.all([
      jobRepository.listOwned({
        userId,
        limit: page.limit,
        offset: page.offset,
        sortColumn: page.sortColumn,
        sortOrder: page.sortOrder,
      }),
      jobRepository.countOwned(userId),
    ]);
    return buildPage(items, totalCount, page);
  },

  async get(userId: string, id: string): Promise<JobView> {
    const job = await jobRepository.getOwned(id, userId);
    if (!job) throw AppError.notFound();
    return job;
  },

  /** Presigned download for a SUCCEEDED export job's artifact (B-13). Own-job only (404 otherwise). */
  async resultUrl(userId: string, id: string): Promise<JobResultUrl> {
    const job = await jobRepository.getOwned(id, userId);
    if (!job) throw AppError.notFound();
    if (job.status !== 'SUCCEEDED' || !job.result)
      throw AppError.badRequest('JOB_NOT_READY', { status: job.status });
    const result = job.result as { storageKey?: string; filename?: string };
    if (!result.storageKey) throw AppError.badRequest('JOB_NO_ARTIFACT');
    const url = await getStorage().signedUrl(result.storageKey);
    return { url, filename: result.filename ?? 'download' };
  },
};
