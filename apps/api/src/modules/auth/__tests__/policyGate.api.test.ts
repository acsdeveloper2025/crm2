import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { authRepository as repo } from '../repository.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
// SA + USER_ID resolve to the same seeded admin user (migration 0007), so the same id can both POST
// /consents/accept and be queried via pendingPoliciesForUser.
const USER_ID = '00000000-0000-0000-0000-000000000001';
const SA = authHeaderForRole('SUPER_ADMIN', USER_ID);

async function seedActivePolicy(code = 'TESTPOL', contentVersion = 1): Promise<void> {
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
    // Acceptances live in the shared `consents` store; the migration seeds an ACTIVE policy too.
    await db!.truncate('consents', 'policies');
  });

  it('reports an active policy as pending until a matching consents row exists', async () => {
    await seedActivePolicy('POLA', 1);

    const before = await repo.pendingPoliciesForUser(USER_ID);
    expect(before.map((p) => p.code)).toContain('POLA');

    // Accepting via the shared consents endpoint records (user, policy_version = content_version).
    const accept = await request(app).post('/api/v2/consents/accept').set(SA).send({ policyVersion: 1 });
    expect(accept.status).toBe(200);

    const after = await repo.pendingPoliciesForUser(USER_ID);
    expect(after.map((p) => p.code)).not.toContain('POLA');
  });

  it('a direct consents row at the policy version clears the gate', async () => {
    await seedActivePolicy('POLB', 2);
    await db!.pool.query(`INSERT INTO consents (user_id, policy_version) VALUES ($1, 2)`, [USER_ID]);

    const pending = await repo.pendingPoliciesForUser(USER_ID);
    expect(pending.map((p) => p.code)).not.toContain('POLB');
  });

  it('bumping the policy content_version re-gates an already-accepted policy', async () => {
    await seedActivePolicy('POLC', 1);
    await db!.pool.query(`INSERT INTO consents (user_id, policy_version) VALUES ($1, 1)`, [USER_ID]);

    // accepted v1 → not pending
    const accepted = await repo.pendingPoliciesForUser(USER_ID);
    expect(accepted.map((p) => p.code)).not.toContain('POLC');

    // bump the master content_version → the v1 consent no longer matches → re-gated
    await db!.pool.query(`UPDATE policies SET content_version = 2 WHERE code = 'POLC'`);
    const regated = await repo.pendingPoliciesForUser(USER_ID);
    expect(regated.map((p) => p.code)).toContain('POLC');
  });

  it('consents/accept rejects an invalid body (400)', async () => {
    const res = await request(app).post('/api/v2/consents/accept').set(SA).send({ policyVersion: 0 });
    expect(res.status).toBe(400);
  });

  it('consents/accept requires authentication (401)', async () => {
    const res = await request(app).post('/api/v2/consents/accept').send({ policyVersion: 1 });
    expect(res.status).toBe(401);
  });
});
