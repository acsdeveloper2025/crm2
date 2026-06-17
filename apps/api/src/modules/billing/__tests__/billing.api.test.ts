import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER'); // holds billing.view
const TL = authHeaderForRole('TEAM_LEADER'); // does NOT hold billing.view
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function seedCpvUnit(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
  const clientId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: `C_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `P_${tag}` })),
  ).id;
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `U_${tag}` })),
  ).id;
  const cpId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId, productId, effectiveFrom: PAST }),
  ).id;
  seeded(
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId: cpId, verificationUnitId: unitId, effectiveFrom: PAST }),
  );
  return { clientId, productId, unitId };
}

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Seed a case with one task, assign to `fa`, and device-complete it. Returns the case id. */
async function seedCompletedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  fa: string,
  name: string,
): Promise<{ caseId: string; caseNumber: string; taskId: string }> {
  const created = seeded<{ id: string; caseNumber: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name, mobile: '9000012345' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  );
  const applicantId = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
  ).applicants[0]!.id;
  const tasks = seeded<{ id: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${created.id}/tasks`)
      .set(SA)
      .send({
        tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '12 MG ROAD', trigger: 'x' }],
      }),
  );
  const taskId = tasks[0]!.id;
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${created.id}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 })
    ).status,
  ).toBe(200);
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  return { caseId: created.id, caseNumber: created.caseNumber, taskId };
}

describe.skipIf(!RUN)('billing API (ADR-0036 slice 5b)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'commission_rates',
      'rates',
      'task_assignment_history',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'users',
    );
  });

  it('rolls up a completed task into per-case bill + commission totals', async () => {
    const ctx = await seedCpvUnit('ROLL');
    const fa = await createUser({ username: 'bil_fa', name: 'BILL FA', role: 'FIELD_AGENT' });
    // a LOCAL rate ₹100 for the CPV (location-less default) + a LOCAL commission ₹30 for the agent
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        rateType: 'LOCAL',
        amount: 100,
      }),
    );
    seeded(
      await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId: fa, rateType: 'LOCAL', amount: 30 }),
    );
    const c = await seedCompletedTask(ctx, fa, 'ROLL APP');

    const list = await request(app).get('/api/v2/billing/cases').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const row = list.body.items[0];
    expect(row.caseNumber).toBe(c.caseNumber);
    expect(row.completedTaskCount).toBe(1);
    expect(row.billTotal).toBe(100);
    expect(row.commissionTotal).toBe(30);
    expect(typeof row.billTotal).toBe('number');
    expect(row.lastCompletedAt).toBeTruthy();

    const lines = await request(app).get(`/api/v2/billing/cases/${c.caseId}/tasks`).set(SA);
    expect(lines.status).toBe(200);
    expect(lines.body).toHaveLength(1);
    expect(lines.body[0]).toMatchObject({
      taskNumber: `${c.caseNumber}-1`,
      billingClass: 'ORIGINAL',
      rateType: 'LOCAL',
      billAmount: 100,
      commissionAmount: 30,
    });
  });

  it('eligibility = ANY completed task; commission is null when the assignee has no rate (bill still resolves)', async () => {
    const ctx = await seedCpvUnit('ANY');
    const fa = await createUser({ username: 'bil_fa2', name: 'BILL FA2', role: 'FIELD_AGENT' });
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        rateType: 'LOCAL',
        amount: 100,
      }),
    );
    // NO commission rate for this agent
    const c = await seedCompletedTask(ctx, fa, 'ANY APP');
    const lines = await request(app).get(`/api/v2/billing/cases/${c.caseId}/tasks`).set(SA);
    expect(lines.body[0].billAmount).toBe(100);
    expect(lines.body[0].commissionAmount).toBeNull(); // unset, not a failure
    const list = await request(app).get('/api/v2/billing/cases').set(SA);
    expect(list.body.items[0].commissionTotal).toBe(0); // SUM coalesces null → 0
    expect(list.body.items[0].billTotal).toBe(100);
  });

  it('excludes a case with no COMPLETED tasks (only completed tasks bill)', async () => {
    const ctx = await seedCpvUnit('PEND');
    // a case with a PENDING task only (created, not assigned/completed)
    const created = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [{ name: 'PEND APP', mobile: '9000012345' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    );
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
    ).applicants[0]!.id;
    seeded(
      await request(app)
        .post(`/api/v2/cases/${created.id}/tasks`)
        .set(SA)
        .send({ tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: 'a', trigger: 'x' }] }),
    );
    const list = await request(app).get('/api/v2/billing/cases').set(SA);
    expect(list.body.items).toHaveLength(0);
  });

  it('billing.view gates the read: BACKEND_USER allowed, TEAM_LEADER + FIELD_AGENT denied; lines 404 out-of-scope', async () => {
    const ctx = await seedCpvUnit('PERM');
    const fa = await createUser({ username: 'bil_perm', name: 'BP', role: 'FIELD_AGENT' });
    const c = await seedCompletedTask(ctx, fa, 'PERM APP');
    expect((await request(app).get('/api/v2/billing/cases').set(BE)).status).toBe(200);
    expect((await request(app).get('/api/v2/billing/cases').set(TL)).status).toBe(403);
    expect((await request(app).get('/api/v2/billing/cases').set(hdr('FIELD_AGENT', fa))).status).toBe(403);
    // a billing.view holder still can't see a case outside scope / absent → 404 (IDOR-safe)
    const absent = '00000000-0000-0000-0000-0000000000ff';
    expect((await request(app).get(`/api/v2/billing/cases/${absent}/tasks`).set(BE)).status).toBe(404);
    // a non-uuid id → 400, not 500
    expect((await request(app).get('/api/v2/billing/cases/not-a-uuid/tasks').set(SA)).status).toBe(400);
    // sanity: SA sees the real case lines
    expect((await request(app).get(`/api/v2/billing/cases/${c.caseId}/tasks`).set(SA)).status).toBe(200);

    // export carries the SAME bill+commission amounts → must share the list's audience (billing.view),
    // NOT just data.export. TEAM_LEADER holds data.export but NOT billing.view → must be 403 on export
    // too (else a TL blocked from /cases could exfiltrate the amounts via export).
    expect((await request(app).get('/api/v2/billing/cases/export?format=csv&mode=all').set(BE)).status).toBe(
      200,
    );
    expect((await request(app).get('/api/v2/billing/cases/export?format=csv&mode=all').set(TL)).status).toBe(
      403,
    );
  });
});
