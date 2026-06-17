import { describe, it, expect, afterEach } from 'vitest';
import { getPusher, setPusher, pushConfigured, type Pusher } from '../index.js';

afterEach(() => setPusher(null));

describe('FCM push seam (ADR-0027)', () => {
  it('is unconfigured + disabled (no-op) when no service account is set', async () => {
    // The test env has no FIREBASE_SERVICE_ACCOUNT_PATH → disabled pusher.
    expect(pushConfigured({ FIREBASE_SERVICE_ACCOUNT_PATH: undefined } as never)).toBe(false);
    const p = getPusher({ FIREBASE_SERVICE_ACCOUNT_PATH: undefined } as never);
    expect(p.ready()).toBe(false);
    // No tokens + with tokens both no-op cleanly (push is never the failure that breaks a caller).
    await expect(p.sendDataMessage([], {})).resolves.toEqual({
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
    });
    await expect(p.sendDataMessage(['t1'], { type: 'LOCATION_REQUEST' })).resolves.toMatchObject({
      successCount: 0,
    });
  });

  it('honors an injected fake pusher (mirrors setGeocoder/setStorage)', async () => {
    const sent: { tokens: string[]; data: Record<string, string> }[] = [];
    const fake: Pusher = {
      sendDataMessage: (tokens, data) => {
        sent.push({ tokens, data });
        return Promise.resolve({ successCount: tokens.length, failureCount: 0, invalidTokens: ['dead'] });
      },
      ready: () => true,
    };
    setPusher(fake);
    const res = await getPusher().sendDataMessage(['a', 'b'], { type: 'LOCATION_REQUEST', requestId: 'r1' });
    expect(getPusher().ready()).toBe(true);
    expect(res.invalidTokens).toEqual(['dead']);
    expect(sent[0]?.data['requestId']).toBe('r1');
  });
});
