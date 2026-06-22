import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Env } from '@crm2/config';
import {
  getStaticMapProvider,
  setStaticMapProvider,
  staticMapConfigured,
  type StaticMapProvider,
} from '../index.js';

/** A minimal Env stub — only GOOGLE_GEOCODING_API_KEY is read by the static-map seam. */
const env = (over: Partial<Env>): Env => ({ ...over }) as unknown as Env;

/** Build a Response-like object for the global fetch stub (only the fields the provider reads). */
const fetchRes = (over: { ok: boolean; contentType?: string; body?: Buffer }): Response =>
  ({
    ok: over.ok,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (over.contentType ?? null) : null) },
    arrayBuffer: () => Promise.resolve(over.body ? Buffer.from(over.body) : Buffer.alloc(0)),
  }) as unknown as Response;

describe('static-map seam (ADR-0060)', () => {
  afterEach(() => {
    setStaticMapProvider(null); // restore the factory + clear the cache between cases
    vi.unstubAllGlobals();
  });

  describe('staticMapConfigured', () => {
    it('is true only when GOOGLE_GEOCODING_API_KEY is set', () => {
      expect(staticMapConfigured(env({ GOOGLE_GEOCODING_API_KEY: 'k' }))).toBe(true);
      expect(staticMapConfigured(env({}))).toBe(false);
      expect(staticMapConfigured(env({ GOOGLE_GEOCODING_API_KEY: '' }))).toBe(false);
    });
  });

  describe('setStaticMapProvider / getStaticMapProvider', () => {
    it('returns the injected override, then restores the factory on setStaticMapProvider(null)', async () => {
      const fake: StaticMapProvider = { thumbnail: () => Promise.resolve(Buffer.from('OVERRIDE')) };
      setStaticMapProvider(fake);
      expect(getStaticMapProvider(env({}))).toBe(fake);
      expect(await getStaticMapProvider(env({})).thumbnail(1, 2)).toEqual(Buffer.from('OVERRIDE'));

      setStaticMapProvider(null);
      // with no key the factory yields the disabled null-provider (not the override)
      expect(getStaticMapProvider(env({}))).not.toBe(fake);
      expect(await getStaticMapProvider(env({})).thumbnail(1, 2)).toBeNull();
    });

    it('degrades to the null-provider when no key is configured', async () => {
      expect(await getStaticMapProvider(env({})).thumbnail(19.07, 72.87)).toBeNull();
    });
  });

  describe('real provider (keyed) over global fetch', () => {
    const keyed = env({ GOOGLE_GEOCODING_API_KEY: 'test-key' });

    it('returns a PNG Buffer on 200 + image/* content-type', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(fetchRes({ ok: true, contentType: 'image/png', body: png }))),
      );
      const out = await getStaticMapProvider(keyed).thumbnail(19.07, 72.87);
      expect(Buffer.isBuffer(out)).toBe(true);
      expect(out).toEqual(png);
    });

    it('returns null on a non-image body (Google quota/disabled returns text/html)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(fetchRes({ ok: true, contentType: 'text/html', body: Buffer.from('quota') })),
        ),
      );
      expect(await getStaticMapProvider(keyed).thumbnail(19.07, 72.87)).toBeNull();
    });

    it('returns null when the response is not ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(fetchRes({ ok: false }))),
      );
      expect(await getStaticMapProvider(keyed).thumbnail(19.07, 72.87)).toBeNull();
    });

    it('returns null when fetch throws (network error / timeout)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('network down'))),
      );
      expect(await getStaticMapProvider(keyed).thumbnail(19.07, 72.87)).toBeNull();
    });
  });
});
