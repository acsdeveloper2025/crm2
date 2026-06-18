import { describe, it, expect } from 'vitest';
import { LocationCaptureSchema, LOCATION_SOURCES } from './location.js';

const base = {
  latitude: 19.07,
  longitude: 72.87,
  accuracy: 8,
  timestamp: '2026-06-11T10:00:00.000Z',
  source: 'TRACKING' as const,
};

describe('device location capture contract (ADR-0026)', () => {
  it('accepts a valid TRACKING + ADMIN_PING fix', () => {
    expect(LocationCaptureSchema.safeParse(base).success).toBe(true);
    expect(
      LocationCaptureSchema.safeParse({ ...base, source: 'ADMIN_PING', requestedBy: 'admin-1' }).success,
    ).toBe(true);
  });
  it('accuracy is optional (the device sometimes omits it)', () => {
    const { accuracy: _omit, ...noAcc } = base;
    expect(LocationCaptureSchema.safeParse(noAcc).success).toBe(true);
  });
  it('rejects out-of-range coordinates', () => {
    expect(LocationCaptureSchema.safeParse({ ...base, latitude: 91 }).success).toBe(false);
    expect(LocationCaptureSchema.safeParse({ ...base, longitude: -181 }).success).toBe(false);
  });
  it('rejects an unknown source and a non-ISO timestamp', () => {
    expect(LocationCaptureSchema.safeParse({ ...base, source: 'GHOST' }).success).toBe(false);
    expect(LocationCaptureSchema.safeParse({ ...base, timestamp: 'yesterday' }).success).toBe(false);
  });
  it('exposes the contract sources incl. the device task-capture sources (GPS/NETWORK/PASSIVE)', () => {
    expect([...LOCATION_SOURCES]).toEqual(['ADMIN_PING', 'TRACKING', 'TASK', 'GPS', 'NETWORK', 'PASSIVE']);
  });
});
