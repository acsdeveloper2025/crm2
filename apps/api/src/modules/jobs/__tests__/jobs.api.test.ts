import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { setStorage } from '../../../platform/storage/index.js';
import { enqueue, awaitAllJobs } from '../../../platform/jobs/index.js';
import { registerExportBuilder } from '../../../platform/export/job.js';
import { importConfirmOrEnqueue, registerImportRunner } from '../../../platform/import/index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true }); // registers the real EXPORT processor via registerJobs()
const SA = authHeaderForRole('SUPER_ADMIN');
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

async function createUser(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username, role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!RUN)('background jobs (ADR-0030, B-7 / B-13)', () => {
  let userA: string;
  let userB: string;
  const aHdr = (): Record<string, string> => hdr('FIELD_AGENT', userA);
  const bHdr = (): Record<string, string> => hdr('FIELD_AGENT', userB);

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    userA = await createUser('jobs_a');
    userB = await createUser('jobs_b');
    // Map-backed fake object store (no MinIO in tests) so import round-trips (put→get) work; the REAL
    // export/import job processors (registered by createApp) drive it. 'nope' has no builder → fail path.
    const store = new Map<string, Buffer>();
    setStorage({
      put: (key: string, body: Buffer) => {
        store.set(key, body);
        return Promise.resolve({ key });
      },
      get: (key: string) => Promise.resolve(store.get(key) ?? Buffer.from('')),
      signedUrl: (key: string) => Promise.resolve(`https://fake.local/${key}`),
      remove: (key: string) => {
        store.delete(key);
        return Promise.resolve();
      },
    });
    // a test import runner (the worker re-runs it); returns fixed counts regardless of the file bytes.
    registerImportRunner('test-import', () =>
      Promise.resolve({ totalRows: 12000, successRows: 11990, failedRows: 10, durationMs: 5, errors: [] }),
    );
    registerExportBuilder('test-export', (_q, _a, _cols, format) =>
      Promise.resolve({ body: Buffer.from('a,b\n1,2'), filename: `test.${format}`, rowCount: 1 }),
    );
    // a builder whose full match (totalCount) exceeds what it returned → the capped/truncation path.
    registerExportBuilder('test-export-capped', (_q, _a, _cols, format) =>
      Promise.resolve({
        body: Buffer.from('a\n1'),
        filename: `capped.${format}`,
        rowCount: 1,
        totalCount: 5,
      }),
    );
  });
  afterAll(async () => {
    setStorage(null);
    await db!.end();
  });

  const enqExport = (resource: string, owner: string): Promise<{ id: string; status: string }> =>
    enqueue('EXPORT', { resource, query: {}, format: 'csv', cols: [], actorId: owner }, owner);

  it('runs an EXPORT job in-process → SUCCEEDED with a stored artifact pointer', async () => {
    const job = await enqExport('test-export', userA);
    expect(job.status).toBe('PENDING');
    await awaitAllJobs();

    const res = await request(app).get(`/api/v2/jobs/${job.id}`).set(aHdr());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: 'EXPORT',
      status: 'SUCCEEDED',
      progress: 100,
      result: { filename: 'test.csv', rowCount: 1 },
    });
    expect(res.body.result.storageKey).toContain(`exports/${userA}/`);
    expect(res.body.startedAt).not.toBeNull();
    expect(res.body.completedAt).not.toBeNull();
  });

  it('serves a presigned download for the finished export (result-url)', async () => {
    const job = await enqExport('test-export', userA);
    await awaitAllJobs();
    const res = await request(app).get(`/api/v2/jobs/${job.id}/result-url`).set(aHdr());
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('https://fake.local/exports/');
    expect(res.body.filename).toBe('test.csv');
  });

  it('notifies the owner (JOB_COMPLETED + DOWNLOAD action) on success', async () => {
    await enqExport('test-export', userA);
    await awaitAllJobs();
    const feed = await request(app).get('/api/v2/notifications?unreadOnly=true').set(aHdr());
    const n = feed.body.items.find((x: { type: string }) => x.type === 'JOB_COMPLETED');
    expect(n).toBeTruthy();
    expect(n.actionType).toBe('DOWNLOAD');
    expect(n.payload).toMatchObject({ jobType: 'EXPORT' });
  });

  it('FAILS an export for an unregistered resource + notifies JOB_FAILED; result-url 400s', async () => {
    const job = await enqExport('nope', userB);
    await awaitAllJobs();

    const got = await request(app).get(`/api/v2/jobs/${job.id}`).set(bHdr());
    expect(got.body).toMatchObject({ status: 'FAILED', error: 'NO_EXPORT_BUILDER' });

    const url = await request(app).get(`/api/v2/jobs/${job.id}/result-url`).set(bHdr());
    expect(url.status).toBe(400);

    const feed = await request(app).get('/api/v2/notifications').set(bHdr());
    expect(feed.body.items.some((x: { type: string }) => x.type === 'JOB_FAILED')).toBe(true);
  });

  it('lists the own tray newest-first in the paginated envelope', async () => {
    const res = await request(app).get('/api/v2/jobs').set(aHdr());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1 });
    expect(res.body.totalCount).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((j: { type: string }) => j.type === 'EXPORT')).toBe(true);
  });

  it('surfaces a capped export (totalCount > rowCount) rather than silently truncating', async () => {
    const job = await enqExport('test-export-capped', userA);
    await awaitAllJobs();
    const res = await request(app).get(`/api/v2/jobs/${job.id}`).set(aHdr());
    expect(res.body.result).toMatchObject({ rowCount: 1, totalCount: 5, capped: true });
  });

  it('is own-user scoped — B cannot read A’s job nor its download (404)', async () => {
    const job = await enqExport('test-export', userA);
    await awaitAllJobs();
    expect((await request(app).get(`/api/v2/jobs/${job.id}`).set(bHdr())).status).toBe(404);
    expect((await request(app).get(`/api/v2/jobs/${job.id}/result-url`).set(bHdr())).status).toBe(404);
  });

  it('importConfirmOrEnqueue: <threshold runs inline; ≥threshold enqueues an IMPORT job that the worker runs', async () => {
    // small file → synchronous result (the runner ignores bytes, returns fixed counts)
    const small = await importConfirmOrEnqueue(Buffer.from('h\n1\n2'), 'test-import', { userId: userA });
    expect(small.kind).toBe('result');

    // ≥10k rows → background IMPORT job (header + 10000 data rows)
    const big = Buffer.from('h\n' + Array.from({ length: 10_000 }, (_, i) => i).join('\n'));
    const out = await importConfirmOrEnqueue(big, 'test-import', { userId: userA });
    expect(out.kind).toBe('job');
    if (out.kind !== 'job') throw new Error('expected a job');
    await awaitAllJobs();

    const res = await request(app).get(`/api/v2/jobs/${out.job.id}`).set(aHdr());
    expect(res.body).toMatchObject({
      type: 'IMPORT',
      status: 'SUCCEEDED',
      result: { totalRows: 12000, successRows: 11990, failedRows: 10 },
    });
  });

  it('rejects a malformed id with 404 (no pg 22P02 → 500)', async () => {
    expect((await request(app).get('/api/v2/jobs/not-a-uuid').set(aHdr())).status).toBe(404);
    expect((await request(app).get('/api/v2/jobs/not-a-uuid/result-url').set(aHdr())).status).toBe(404);
  });

  it('401s an unauthenticated request', async () => {
    expect((await request(app).get('/api/v2/jobs')).status).toBe(401);
  });
});
