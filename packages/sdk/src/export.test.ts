import { describe, it, expect } from 'vitest';
import { exportQueryToParams, type ExportRequest } from './export.js';
import { createSdk, SdkError } from './client.js';

describe('exportQueryToParams', () => {
  it('mode:current keeps the page+limit (the exact page the user sees)', () => {
    const r: ExportRequest = { format: 'xlsx', mode: 'current', page: 3, limit: 50, search: 'hdfc' };
    const p = exportQueryToParams(r);
    expect(p.get('page')).toBe('3');
    expect(p.get('limit')).toBe('50');
    expect(p.get('search')).toBe('hdfc');
    expect(p.get('format')).toBe('xlsx');
    expect(p.get('mode')).toBe('current');
  });

  it('mode:all drops page+limit (server returns all matching, capped by the job threshold)', () => {
    const r: ExportRequest = {
      format: 'csv',
      mode: 'all',
      page: 2,
      limit: 100,
      sortBy: 'name',
      sortOrder: 'desc',
    };
    const p = exportQueryToParams(r);
    expect(p.has('page')).toBe(false);
    expect(p.has('limit')).toBe(false);
    expect(p.get('sortBy')).toBe('name');
    expect(p.get('sortOrder')).toBe('desc');
    expect(p.get('format')).toBe('csv');
    expect(p.get('mode')).toBe('all');
  });

  it('serializes filters (same whitelist as the list) + visible cols', () => {
    const r: ExportRequest = {
      format: 'xlsx',
      mode: 'all',
      filters: { active: true, f_code: 'HD' },
      cols: ['code', 'name'],
    };
    const p = exportQueryToParams(r);
    expect(p.get('active')).toBe('true');
    expect(p.get('f_code')).toBe('HD');
    expect(p.get('cols')).toBe('code,name');
  });
});

/** A fake fetch that returns a file blob + Content-Disposition (export transport, not JSON). */
function fakeBlobFetch(status: number, body: string, disposition?: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (k: string) => (k.toLowerCase() === 'content-disposition' ? (disposition ?? null) : null),
      },
      text: async () => body,
      blob: async () => new Blob([body]),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('createSdk — export transport (reqBlob)', () => {
  it('GETs /clients/export with the query and returns the blob + Content-Disposition filename', async () => {
    const { impl, calls } = fakeBlobFetch(
      200,
      'code,name\nHDFC,Hdfc',
      'attachment; filename="clients-2026.csv"',
    );
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl, getAuthToken: () => 'Bearer t' });
    const res = await sdk.clients.export({ format: 'csv', mode: 'all', cols: ['code', 'name'] });
    expect(calls[0]?.url).toBe('http://x/api/v2/clients/export?format=csv&mode=all&cols=code%2Cname');
    expect(calls[0]?.init.method).toBe('GET');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(res.filename).toBe('clients-2026.csv');
    expect(await res.blob.text()).toContain('HDFC');
  });

  it('falls back to <resource>.<format> when no Content-Disposition is present', async () => {
    const { impl } = fakeBlobFetch(200, 'x');
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    const res = await sdk.products.export({ format: 'xlsx', mode: 'current', page: 1, limit: 25 });
    expect(res.filename).toBe('products.xlsx');
  });

  it('a too-large export throws SdkError carrying the code (413 EXPORT_TOO_LARGE)', async () => {
    const { impl } = fakeBlobFetch(413, JSON.stringify({ error: 'EXPORT_TOO_LARGE' }));
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await expect(sdk.clients.export({ format: 'csv', mode: 'all' })).rejects.toMatchObject({
      status: 413,
      code: 'EXPORT_TOO_LARGE',
    });
    expect(SdkError).toBeDefined();
  });

  it('every exportable resource GETs its own /export endpoint (B-13 rollout)', async () => {
    const { impl, calls } = fakeBlobFetch(200, 'x');
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await s.verificationUnits.export({ format: 'csv', mode: 'all' });
    await s.users.export({ format: 'csv', mode: 'all' });
    await s.reportTemplates.export({ format: 'csv', mode: 'all' });
    await s.locations.export({ format: 'csv', mode: 'all' });
    await s.rates.export({ format: 'csv', mode: 'all' });
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/v2/verification-units/export?format=csv&mode=all',
      'http://x/api/v2/users/export?format=csv&mode=all',
      'http://x/api/v2/report-templates/export?format=csv&mode=all',
      'http://x/api/v2/locations/export?format=csv&mode=all',
      'http://x/api/v2/rates/export?format=csv&mode=all',
    ]);
  });
});
