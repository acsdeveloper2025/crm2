import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import type { VerificationTypeOutcome, RevokeReason } from '@crm2/sdk';
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
    .send({ username, name: username, role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!RUN)('reference masters (mobile parity)', () => {
  let user: string;
  const h = (): Record<string, string> => hdr('FIELD_AGENT', user);

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    user = await createUser('ref_user');
  });
  afterAll(async () => {
    await db!.end();
  });

  it('serves per-type field outcomes in the v1 { success, data } envelope', async () => {
    const res = await request(app).get('/api/v2/reference/verification-type-outcomes').set(h());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as VerificationTypeOutcome[];
    // 7 standard types × 5 outcomes + 2 property types × 4 = 43 rows
    expect(data).toHaveLength(43);
    expect(typeof data[0]!.id).toBe('number');

    const residence = data.filter((o) => o.verificationTypeCode === 'RESIDENCE');
    expect(residence.map((o) => o.outcomeCode)).toEqual([
      'POSITIVE',
      'SHIFTED',
      'NSP',
      'ENTRY_RESTRICTED',
      'UNTRACEABLE',
    ]);
    expect(residence[0]).toMatchObject({ displayLabel: 'Positive', sortOrder: 1, isActive: true });

    // Property APF carries NEGATIVE in place of Shifted/NSP.
    const apf = data.filter((o) => o.verificationTypeCode === 'PROPERTY_APF').map((o) => o.outcomeCode);
    expect(apf).toEqual(['POSITIVE', 'NEGATIVE', 'ENTRY_RESTRICTED', 'UNTRACEABLE']);
  });

  it('serves revoke reasons in the v1 { success, data } envelope', async () => {
    const res = await request(app).get('/api/v2/reference/revoke-reasons').set(h());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as RevokeReason[];
    expect(data).toHaveLength(9);
    expect(data[0]).toMatchObject({
      code: 'NOT_MY_AREA',
      label: 'Not my area',
      sortOrder: 10,
      isActive: true,
    });
    expect(typeof data[0]!.id).toBe('number');
  });

  it('401s an unauthenticated request', async () => {
    const res = await request(app).get('/api/v2/reference/revoke-reasons');
    expect(res.status).toBe(401);
  });
});
