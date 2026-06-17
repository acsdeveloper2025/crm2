import { describe, it, expect } from 'vitest';
import { SyncDownloadQuerySchema } from './sync.js';

describe('SyncDownloadQuery contract', () => {
  it('accepts an empty query and valid bounds', () => {
    expect(SyncDownloadQuerySchema.safeParse({}).success).toBe(true);
    expect(
      SyncDownloadQuerySchema.safeParse({ lastSyncTimestamp: '2026-01-01T00:00:00Z', limit: 50, offset: 0 })
        .success,
    ).toBe(true);
  });
  it('rejects a non-positive limit and a negative offset', () => {
    expect(SyncDownloadQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(SyncDownloadQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});
