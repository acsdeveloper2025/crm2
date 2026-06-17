import { describe, it, expect } from 'vitest';
import { ServerTimeSchema, computeClockOffsetMs, serverNowMs } from './time.js';

describe('ServerTime contract (ADR-0028)', () => {
  it('accepts a well-formed server time', () => {
    expect(
      ServerTimeSchema.safeParse({ serverTime: '2026-06-12T10:00:00.000Z', epochMs: 1781258400000 }).success,
    ).toBe(true);
  });
  it('rejects a non-offset timestamp or negative epoch', () => {
    expect(ServerTimeSchema.safeParse({ serverTime: '2026-06-12 10:00', epochMs: 1 }).success).toBe(false);
    expect(ServerTimeSchema.safeParse({ serverTime: '2026-06-12T10:00:00.000Z', epochMs: -1 }).success).toBe(
      false,
    );
  });
});

describe('computeClockOffsetMs (½-RTT)', () => {
  it('is ~0 when the local clock matches the server (symmetric latency)', () => {
    // sent at 1000, server read 1050 at the midpoint, received at 1100 → RTT 100, midpoint 1050.
    expect(computeClockOffsetMs(1000, 1050, 1100)).toBe(0);
  });
  it('reports a positive offset when the local clock is behind the server', () => {
    // local 1000→1100 (RTT 100, midpoint 1050) but server reads 6050 → offset +5000.
    expect(computeClockOffsetMs(1000, 6050, 1100)).toBe(5000);
  });
  it('reports a negative offset when the local clock is ahead of the server', () => {
    expect(computeClockOffsetMs(10000, 5050, 10100)).toBe(-5000);
  });
});

describe('serverNowMs', () => {
  it('adds the offset to the supplied instant', () => {
    expect(serverNowMs(5000, 1000)).toBe(6000);
    expect(serverNowMs(-250, 1000)).toBe(750);
  });
});
