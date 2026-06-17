import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES, NOTIFICATION_ACTION_TYPES } from './notifications.js';

describe('notification contract (ADR-0027)', () => {
  it('exposes the notification types the DB CHECK whitelists', () => {
    expect([...NOTIFICATION_TYPES]).toEqual([
      'CASE_TASK_ASSIGNED',
      'CASE_TASK_REASSIGNED',
      'TASK_COMPLETED',
      'TASK_SUBMITTED_FOR_REVIEW',
      'TASK_REVOKED',
      'CASE_ASSIGNED',
      'SYSTEM',
      'JOB_COMPLETED', // ADR-0030 background jobs
      'JOB_FAILED',
    ]);
  });
  it('exposes the navigation action types', () => {
    expect([...NOTIFICATION_ACTION_TYPES]).toEqual(['OPEN_CASE', 'OPEN_TASK', 'NAVIGATE', 'DOWNLOAD']);
  });
});
