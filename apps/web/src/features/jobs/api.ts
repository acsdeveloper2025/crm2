/** Background-job tray REST (ADR-0030/B-7). The durable own-user job list; the socket only nudges refetch. */
import type { JobView, JobResultUrl, Paginated } from '@crm2/sdk';
import { api } from '../../lib/sdk.js';

export const JOBS_KEY = ['jobs'] as const;

export function fetchJobs(limit = 15): Promise<Paginated<JobView>> {
  return api<Paginated<JobView>>('GET', `/api/v2/jobs?limit=${limit}`);
}

export function fetchJobResultUrl(id: string): Promise<JobResultUrl> {
  return api<JobResultUrl>('GET', `/api/v2/jobs/${id}/result-url`);
}
