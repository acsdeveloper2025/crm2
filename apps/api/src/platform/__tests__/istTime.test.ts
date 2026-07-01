import { describe, it, expect } from 'vitest';
import { IST_OFFSET_MS, istMidnightUtcMs, istHour } from '../istTime.js';

// CODE_QUALITY-02 (docs/audit/17-code-quality.md): this logic was duplicated verbatim across
// dashboard/service.ts, field-monitoring/service.ts, and location/service.ts.
describe('istTime', () => {
  it('IST_OFFSET_MS is 5h30m', () => {
    expect(IST_OFFSET_MS).toBe(5.5 * 60 * 60 * 1000);
  });

  it('istMidnightUtcMs: 2026-01-01T10:00:00Z (15:30 IST) → same-day IST midnight in UTC', () => {
    const now = Date.parse('2026-01-01T10:00:00.000Z');
    expect(new Date(istMidnightUtcMs(now)).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('istMidnightUtcMs: 2026-01-01T19:00:00Z (00:30 IST Jan 2 — past the IST day rollover)', () => {
    const now = Date.parse('2026-01-01T19:00:00.000Z');
    expect(new Date(istMidnightUtcMs(now)).toISOString()).toBe('2026-01-01T18:30:00.000Z');
  });

  it('istHour: a UTC timestamp maps to the correct IST hour', () => {
    expect(istHour('2026-01-01T00:00:00.000Z')).toBe(5); // 00:00 UTC = 05:30 IST
    expect(istHour('2026-01-01T18:30:00.000Z')).toBe(0); // 18:30 UTC = 00:00 IST
  });
});
