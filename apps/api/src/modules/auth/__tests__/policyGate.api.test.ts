import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const USER_ID = '00000000-0000-0000-0000-000000000001';

async function seedActivePolicy(code = 'TESTPOL', contentVersion = 1) {
  await db!.pool.query(
    `INSERT INTO policies (code, name, content, content_version, is_active) VALUES ($1,$1,'body',$2,true)`,
    [code, contentVersion],
  );
}

describe.skipIf(!RUN)('policy gate API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('policy_acceptances', 'policies');
  });

  it('GET pending via accept then no-op: accepting an active policy records one row, idempotently', async () => {
    await seedActivePolicy('POLA');
    const { rows } = await db!.pool.query<{ id: number }>(`SELECT id FROM policies WHERE code='POLA'`);
    const id = rows[0]!.id;

    const first = await request(app)
      .post('/api/v2/auth/accept-policies')
      .set(SA)
      .send({ policyIds: [id] });
    expect(first.status).toBe(200);
    const again = await request(app)
      .post('/api/v2/auth/accept-policies')
      .set(SA)
      .send({ policyIds: [id] });
    expect(again.status).toBe(200);

    const count = await db!.pool.query(
      `SELECT count(*)::int AS n FROM policy_acceptances WHERE user_id=$1 AND policy_id=$2`,
      [USER_ID, id],
    );
    expect(count.rows[0].n).toBe(1); // idempotent — no duplicate
  });

  it('bumping content_version re-gates an already-accepted policy', async () => {
    await seedActivePolicy('POLB', 1);
    const { rows } = await db!.pool.query<{ id: number }>(`SELECT id FROM policies WHERE code='POLB'`);
    const id = rows[0]!.id;
    await db!.pool.query(
      `INSERT INTO policy_acceptances (user_id, policy_id, content_version) VALUES ($1,$2,1)`,
      [USER_ID, id],
    );

    // accepted v1 → clear
    const before = await db!.pool.query(
      `SELECT count(*)::int AS n FROM policies p WHERE p.is_active AND p.effective_from<=now()
         AND NOT EXISTS (SELECT 1 FROM policy_acceptances pa WHERE pa.user_id=$1 AND pa.policy_id=p.id AND pa.content_version=p.content_version)`,
      [USER_ID],
    );
    expect(before.rows[0].n).toBe(0);

    await db!.pool.query(`UPDATE policies SET content_version=2 WHERE id=$1`, [id]);
    const after = await db!.pool.query(
      `SELECT count(*)::int AS n FROM policies p WHERE p.is_active AND p.effective_from<=now()
         AND NOT EXISTS (SELECT 1 FROM policy_acceptances pa WHERE pa.user_id=$1 AND pa.policy_id=p.id AND pa.content_version=p.content_version)`,
      [USER_ID],
    );
    expect(after.rows[0].n).toBe(1); // re-gated
  });

  it('accept-policies rejects an unknown/empty body (400)', async () => {
    const res = await request(app).post('/api/v2/auth/accept-policies').set(SA).send({ policyIds: [] });
    expect(res.status).toBe(400);
  });

  it('accept-policies requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/v2/auth/accept-policies')
      .send({ policyIds: [1] });
    expect(res.status).toBe(401);
  });
});
