import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

async function createUser(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username, email: `${username}@test.crm2.local`, role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!RUN)('mobile consents + telemetry (parity)', () => {
  let user: string;
  const h = (): Record<string, string> => hdr('FIELD_AGENT', user);

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    user = await createUser('consent_user');
  });
  afterAll(async () => {
    await db!.end();
  });

  it('accepts a DPDP consent and is idempotent per version (UPSERT, no duplicate row)', async () => {
    const r1 = await request(app).post('/api/v2/consents/accept').set(h()).send({ policyVersion: 3 });
    expect(r1.status).toBe(200);
    expect(r1.body.success).toBe(true);
    expect(r1.body.data.policyVersion).toBe(3);
    const id1 = r1.body.data.id as string;

    const r2 = await request(app).post('/api/v2/consents/accept').set(h()).send({ policyVersion: 3 });
    expect(r2.body.data.id).toBe(id1); // same row on re-accept
  });

  it('rejects a bad consent body (400)', async () => {
    const r = await request(app).post('/api/v2/consents/accept').set(h()).send({ policyVersion: 0 });
    expect(r.status).toBe(400);
  });

  it('accepts a telemetry batch (202) and counts events', async () => {
    const r = await request(app)
      .post('/api/v2/telemetry/mobile/ingest')
      .set(h())
      .send({ events: [{ a: 1 }, { b: 2 }] });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ accepted: 2 });
  });

  it('telemetry tolerates an empty body', async () => {
    const r = await request(app).post('/api/v2/telemetry/mobile/ingest').set(h()).send({});
    expect(r.status).toBe(202);
    expect(r.body.accepted).toBe(0);
  });

  it('401s unauthenticated on both endpoints', async () => {
    expect((await request(app).post('/api/v2/consents/accept').send({ policyVersion: 1 })).status).toBe(401);
    expect((await request(app).post('/api/v2/telemetry/mobile/ingest').send({})).status).toBe(401);
  });
});
