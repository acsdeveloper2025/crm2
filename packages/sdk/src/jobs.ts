/**
 * @crm2/sdk — background jobs (ADR-0030, B-7). The >8s / ≥10k worker tier: long-running export/import
 * (and later report/MIS/billing) run as a job; the user keeps working and is notified on completion.
 * Own-user scoped server-side (identity, not a permission) — every authenticated user reads their own
 * tray, exactly like the notification feed.
 */
import type { PageQuery } from './pagination.js';

export const JOB_TYPES = ['EXPORT', 'IMPORT', 'CASE_REPORT'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A job-tray row. `result` carries the artifact pointer on success (e.g. { storageKey, filename, rowCount }). */
export interface JobView {
  id: string;
  type: JobType;
  status: JobStatus;
  /** real 0..100 progress (no fake %); the runner sets it per canonical stage map. */
  progress: number;
  stage: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** Presigned download for a SUCCEEDED export job's artifact (B-13). */
export interface JobResultUrl {
  url: string;
  filename: string;
}

export type JobListQuery = PageQuery;
